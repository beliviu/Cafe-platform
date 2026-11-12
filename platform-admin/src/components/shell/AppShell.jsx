// Salinan dari web-dashboard/src/components/shell/AppShell.jsx — sinkronkan manual bila aslinya berubah.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown, ChevronRight, Coffee, CornerDownLeft, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun, WifiOff,
} from 'lucide-react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Drawer, IconButton } from '../ui/index.js'
import { initials } from '../../lib/format.js'
import { useThemeMode } from '../../lib/themeMode.js'

const COLLAPSED_KEY = 'dailybrew.sidebar.collapsed'
const GROUPS_KEY = 'dailybrew.sidebar.groups'
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
const SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl K'

function readStored(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

function store(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // localStorage bisa diblokir (mode privat) — abaikan, hanya kenyamanan.
  }
}

/** Status koneksi perangkat (event online/offline browser). */
function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  return online
}

const isItemActive = (item, pathname) => (item.end
  ? pathname === item.to || pathname === `${item.to}/`
  : pathname === item.to || pathname.startsWith(`${item.to}/`))

/** Logo + nama kafe. Tanpa logo: ikon kopi di kotak warna brand. */
export function BrandMark({ brand, size = 36 }) {
  return (
    <span className={`shell-brand-mark${brand?.logoUrl ? ' has-logo' : ''}`} style={{ width: size, height: size }}>
      {brand?.logoUrl
        ? <img src={brand.logoUrl} alt="" />
        : <Coffee size={Math.round(size * 0.5)} strokeWidth={2.2} aria-hidden="true" />}
    </span>
  )
}

function ThemeToggle({ className = '', tooltip = true }) {
  const { mode, toggle } = useThemeMode()
  return (
    <IconButton
      icon={mode === 'dark' ? Sun : Moon}
      label={mode === 'dark' ? 'Ganti ke mode terang' : 'Ganti ke mode gelap'}
      onClick={toggle}
      className={className}
      tooltip={tooltip}
    />
  )
}

function NavItem({ item, onNavigate }) {
  const { to, label, icon: Icon, end, badge } = item
  return (
    <li>
      <NavLink to={to} end={end} onClick={onNavigate} className={({ isActive }) => `shell-link${isActive ? ' is-active' : ''}`}>
        <Icon size={18} aria-hidden="true" />
        <span className="shell-link-text">{label}</span>
        {badge ? <span className="shell-link-badge tabular">{badge}</span> : null}
      </NavLink>
    </li>
  )
}

/** Daftar menu per grup; grup bisa dibuka-tutup. Grup berisi satu menu tampil langsung. */
function PanelNav({ groups, openGroups, onToggleGroup, activeIndex, onNavigate, groupRefs }) {
  return (
    <nav className="shell-nav" aria-label="Navigasi utama">
      {groups.map((group, index) => {
        if (group.items.length === 1) {
          return <ul className="shell-nav-single" key={group.label}><NavItem item={group.items[0]} onNavigate={onNavigate} /></ul>
        }
        const open = openGroups.includes(group.label)
        const badge = group.items.reduce((sum, item) => sum + (Number(item.badge) || 0), 0)
        return (
          <section className={`shell-nav-group${index === activeIndex ? ' has-active' : ''}${open ? ' is-open' : ''}`} key={group.label}
            ref={(node) => { if (groupRefs) groupRefs.current[index] = node }}>
            <button type="button" className="shell-nav-head" aria-expanded={open} onClick={() => onToggleGroup(group.label)}>
              <span>{group.label}</span>
              {!open && badge > 0 && <span className="shell-link-badge tabular">{badge}</span>}
              <ChevronDown size={15} aria-hidden="true" className="shell-nav-chevron" />
            </button>
            {open && <ul>{group.items.map((item) => <NavItem key={item.to} item={item} onNavigate={onNavigate} />)}</ul>}
          </section>
        )
      })}
    </nav>
  )
}

function AccountCard({ title, subtitle, imageUrl, onSignOut }) {
  return (
    <div className="shell-account">
      {imageUrl ? <img className="shell-avatar" src={imageUrl} alt="" /> : <span className="shell-avatar" aria-hidden="true">{initials(title)}</span>}
      <span className="shell-account-text"><strong>{title}</strong><span>{subtitle}</span></span>
      <IconButton icon={LogOut} label="Keluar dari akun" onClick={onSignOut} size="sm" />
    </div>
  )
}

function SearchButton({ onClick, compact = false }) {
  return (
    <button type="button" className={`shell-search${compact ? ' is-compact' : ''}`} onClick={onClick} aria-label="Cari halaman" aria-keyshortcuts={IS_MAC ? 'Meta+K' : 'Control+K'}>
      <Search size={16} aria-hidden="true" />
      {!compact && <span>Cari halaman…</span>}
      {!compact && <kbd>{SHORTCUT}</kbd>}
    </button>
  )
}

/** Palet perintah (⌘K / Ctrl K): lompat ke halaman mana pun & ganti mode tampilan. */
function CommandPalette({ open, onClose, groups }) {
  const ref = useRef(null)
  const listRef = useRef(null)
  const navigate = useNavigate()
  const { mode, toggle } = useThemeMode()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)

  const entries = useMemo(() => {
    const pages = groups.flatMap((group) => group.items.map((item) => ({ key: item.to, label: item.label, hint: group.label, icon: item.icon, run: () => navigate(item.to) })))
    pages.push({ key: 'theme', label: mode === 'dark' ? 'Ganti ke mode terang' : 'Ganti ke mode gelap', hint: 'Tampilan', icon: mode === 'dark' ? Sun : Moon, run: toggle })
    const words = query.trim().toLocaleLowerCase('id').split(/\s+/).filter(Boolean)
    return words.length ? pages.filter((entry) => words.every((word) => `${entry.label} ${entry.hint}`.toLocaleLowerCase('id').includes(word))) : pages
  }, [groups, mode, navigate, query, toggle])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  function close() {
    setQuery('')
    setCursor(0)
    onClose()
  }

  function choose(entry) {
    if (!entry) return
    close()
    entry.run()
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setCursor((value) => Math.min(entries.length - 1, value + 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setCursor((value) => Math.max(0, value - 1)) }
    if (event.key === 'Enter') { event.preventDefault(); choose(entries[cursor]) }
  }

  return (
    <dialog ref={ref} className="shell-palette" aria-label="Cari halaman"
      onCancel={(event) => { event.preventDefault(); close() }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <div className="shell-palette-panel">
        <label className="shell-palette-search">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Cari halaman atau perintah</span>
          <input autoFocus value={query} placeholder="Cari halaman atau perintah…" role="combobox" aria-expanded="true" aria-controls="shell-palette-list"
            aria-activedescendant={entries[cursor] ? `palette-${cursor}` : undefined}
            onChange={(event) => { setQuery(event.target.value); setCursor(0) }} onKeyDown={onKeyDown} />
          <kbd>Esc</kbd>
        </label>
        <ul id="shell-palette-list" ref={listRef} className="shell-palette-list" role="listbox">
          {entries.length === 0 && <li className="shell-palette-empty">Tidak ada yang cocok dengan “{query}”.</li>}
          {entries.map((entry, index) => {
            const Icon = entry.icon
            return (
              <li key={entry.key} id={`palette-${index}`} role="option" aria-selected={index === cursor}
                className={index === cursor ? 'is-active' : ''} onMouseMove={() => setCursor(index)} onMouseDown={(event) => { event.preventDefault(); choose(entry) }}>
                <span className="shell-palette-icon"><Icon size={16} aria-hidden="true" /></span>
                <span className="shell-palette-label">{entry.label}</span>
                <span className="shell-palette-hint">{entry.hint}</span>
                {index === cursor && <CornerDownLeft size={14} aria-hidden="true" className="shell-palette-enter" />}
              </li>
            )
          })}
        </ul>
        <footer className="shell-palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> pilih</span><span><kbd>Enter</kbd> buka</span></footer>
      </div>
    </dialog>
  )
}

/**
 * Kerangka aplikasi web (owner & staff):
 * - ≥ 768px: rail ikon modul (paling gelap) + panel menu (bisa diciutkan; saat ciut, rail membuka menu melayang).
 * - < 768px: bar atas + menu dalam drawer.
 * - ⌘K / Ctrl K: cari & lompat ke halaman.
 */
export function AppShell({ brand, navigation, account, banner, homeTo = '/', children }) {
  const location = useLocation()
  const navigate = useNavigate()
  const online = useOnline()
  const [collapsed, setCollapsed] = useState(() => readStored(COLLAPSED_KEY, window.innerWidth <= 1180))
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [flyout, setFlyout] = useState(null)
  const closeTimer = useRef(null)
  const groupRefs = useRef([])
  const scrollRef = useRef(null)

  const activeIndex = navigation.findIndex((group) => group.items.some((item) => isItemActive(item, location.pathname)))
  const activeGroup = navigation[activeIndex]
  const activeItem = activeGroup?.items.find((item) => isItemActive(item, location.pathname))
  const [openGroups, setOpenGroups] = useState(() => readStored(GROUPS_KEY, []))
  // Grup halaman aktif selalu terbuka
  const visibleGroups = activeGroup && !openGroups.includes(activeGroup.label) ? [...openGroups, activeGroup.label] : openGroups

  useEffect(() => { store(COLLAPSED_KEY, collapsed) }, [collapsed])
  useEffect(() => { store(GROUPS_KEY, openGroups) }, [openGroups])

  useEffect(() => {
    function onKey(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      }
      if (event.key === 'Escape') setFlyout(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Menu aktif selalu terlihat di panel
  useEffect(() => {
    scrollRef.current?.querySelector('.shell-link.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [location.pathname, collapsed])

  const toggleGroup = useCallback((label) => {
    setOpenGroups((current) => {
      const base = activeGroup && !current.includes(activeGroup.label) ? [...current, activeGroup.label] : current
      return base.includes(label) ? base.filter((item) => item !== label) : [...base, label]
    })
  }, [activeGroup])

  function showFlyout(index, node) {
    window.clearTimeout(closeTimer.current)
    const rect = node.getBoundingClientRect()
    setFlyout({ index, top: Math.min(rect.top, window.innerHeight - 80 - navigation[index].items.length * 44) })
  }
  function hideFlyoutSoon() {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setFlyout(null), 180)
  }

  function onRailGroup(index, event) {
    const group = navigation[index]
    if (group.items.length === 1) {
      navigate(group.items[0].to)
      setFlyout(null)
      return
    }
    if (collapsed) {
      if (flyout?.index === index) setFlyout(null)
      else showFlyout(index, event.currentTarget)
      return
    }
    setOpenGroups((current) => (current.includes(group.label) ? current : [...current, group.label]))
    window.requestAnimationFrame(() => groupRefs.current[index]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }

  const flyoutGroup = flyout ? navigation[flyout.index] : null

  return (
    <div className={`shell${collapsed ? ' is-collapsed' : ''}`}>
      <aside className="shell-sidebar" aria-label="Sidebar">
        <div className="shell-rail">
          <Link className="shell-rail-brand" to={homeTo} aria-label={`${brand.name}, ke halaman utama`}><BrandMark brand={brand} size={40} /></Link>
          <ul className="shell-rail-groups" aria-label="Modul">
            {navigation.map((group, index) => {
              const Icon = group.icon || group.items[0].icon
              const badge = group.items.reduce((sum, item) => sum + (Number(item.badge) || 0), 0)
              return (
                <li key={group.label}>
                  <button type="button" className={`shell-rail-btn${index === activeIndex ? ' is-active' : ''}${flyout?.index === index ? ' is-open' : ''}`}
                    aria-label={group.label} aria-current={index === activeIndex ? 'true' : undefined}
                    onClick={(event) => onRailGroup(index, event)}
                    onMouseEnter={collapsed && group.items.length > 1 ? (event) => showFlyout(index, event.currentTarget) : undefined}
                    onMouseLeave={collapsed ? hideFlyoutSoon : undefined}
                    data-label={group.label}>
                    <Icon size={20} aria-hidden="true" />
                    {badge > 0 && <span className="shell-rail-dot" aria-hidden="true" />}
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="shell-rail-foot">
            <ThemeToggle className="shell-rail-tool tooltip-right" />
            <IconButton icon={collapsed ? PanelLeftOpen : PanelLeftClose} label={collapsed ? 'Tampilkan panel menu' : 'Sembunyikan panel menu'}
              className="shell-rail-tool tooltip-right" onClick={() => { setCollapsed((value) => !value); setFlyout(null) }} aria-expanded={!collapsed} />
            {collapsed && (
              <>
                <span className="shell-rail-avatar" title={`${account.title} · ${account.subtitle}`}>
                  {account.imageUrl ? <img src={account.imageUrl} alt="" /> : initials(account.title)}
                </span>
                <IconButton icon={LogOut} label="Keluar dari akun" className="shell-rail-tool tooltip-right" onClick={account.onSignOut} />
              </>
            )}
          </div>
        </div>

        {!collapsed && (
          <div className="shell-panel">
            <div className="shell-panel-head">
              <strong className="shell-brand-name" title={brand.name}>{brand.name}</strong>
              <span>{brand.tagline || account.subtitle}</span>
            </div>
            <SearchButton onClick={() => setPaletteOpen(true)} />
            <div ref={scrollRef} className="shell-panel-scroll">
              <PanelNav groups={navigation} openGroups={visibleGroups} onToggleGroup={toggleGroup} activeIndex={activeIndex} groupRefs={groupRefs} />
            </div>
            <AccountCard {...account} />
          </div>
        )}
      </aside>

      {flyoutGroup && (
        <div className="shell-flyout" style={{ top: Math.max(12, flyout.top) }} role="menu" aria-label={flyoutGroup.label}
          onMouseEnter={() => window.clearTimeout(closeTimer.current)} onMouseLeave={hideFlyoutSoon}>
          <strong>{flyoutGroup.label}</strong>
          <ul>{flyoutGroup.items.map((item) => <NavItem key={item.to} item={item} onNavigate={() => setFlyout(null)} />)}</ul>
        </div>
      )}

      <header className="shell-topbar">
        <IconButton icon={Menu} label="Buka menu" onClick={() => setMobileOpen(true)} tooltip={false} />
        <Link className="shell-topbar-brand" to={homeTo}><BrandMark brand={brand} size={30} /><span>{brand.name}</span></Link>
        <SearchButton compact onClick={() => setPaletteOpen(true)} />
        <ThemeToggle tooltip={false} />
      </header>

      {mobileOpen && (
        <Drawer title={brand.name} onClose={() => setMobileOpen(false)} className="shell-mobile-drawer" size="sm">
          <PanelNav groups={navigation} openGroups={visibleGroups} onToggleGroup={toggleGroup} activeIndex={activeIndex} onNavigate={() => setMobileOpen(false)} />
          <AccountCard {...account} />
        </Drawer>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} groups={navigation} />

      <main className="shell-main" id="konten">
        <div className="shell-bar">
          <nav className="shell-crumbs" aria-label="Lokasi">
            {activeGroup && activeGroup.items.length > 1 && activeGroup.label !== activeItem?.label && <><span>{activeGroup.label}</span><ChevronRight size={14} aria-hidden="true" /></>}
            <strong>{activeItem?.label || brand.name}</strong>
          </nav>
          <SearchButton onClick={() => setPaletteOpen(true)} />
        </div>
        {!online && (
          <div className="shell-banner is-offline" role="status">
            <span><WifiOff size={16} aria-hidden="true" /> Koneksi internet terputus. Data yang tampil mungkin belum terbaru; perubahan baru bisa disimpan setelah tersambung lagi.</span>
          </div>
        )}
        {banner}
        {children}
      </main>
    </div>
  )
}
