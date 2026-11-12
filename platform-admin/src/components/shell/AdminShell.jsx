/*
 * Kerangka dashboard platform (ditulis khusus admin, bukan salinan web owner):
 * - ≥ 900px: SATU sidebar yang bisa diciutkan menjadi rail ikon (status diingat di localStorage).
 * - < 900px: bar atas + menu dalam drawer.
 * - Bar atas: breadcrumb (tidak mengulang judul halaman), pencarian ⌘K / Ctrl K (satu-satunya), lonceng notifikasi.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Coffee, CornerDownLeft, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun, WifiOff } from 'lucide-react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Drawer, IconButton } from '../ui/index.js'
import { initials } from '../../lib/format.js'
import { useThemeMode } from '../../lib/themeMode.js'
import { NotificationBell } from '../NotificationBell.jsx'
import { CrumbContext } from './crumbs.js'

const COLLAPSED_KEY = 'dailybrew.platform.sidebar'
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
const SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl K'

function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}
function storeCollapsed(value) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0')
  } catch {
    // localStorage diblokir — hanya kenyamanan
  }
}

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

export function BrandMark({ size = 36 }) {
  return (
    <span className="ps-mark" style={{ width: size, height: size }}>
      <Coffee size={Math.round(size * 0.5)} strokeWidth={2.2} aria-hidden="true" />
    </span>
  )
}

const isActive = (item, pathname) => (item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`))

function SidebarNav({ sections, collapsed, onNavigate }) {
  return (
    <nav className="ps-nav" aria-label="Navigasi utama">
      {sections.map((section) => (
        <div className="ps-nav-section" key={section.label}>
          {!collapsed && <span className="ps-nav-label">{section.label}</span>}
          <ul>
            {section.items.map((item) => {
              const Icon = item.icon
              return (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.end} onClick={onNavigate} data-tip={collapsed ? item.label : undefined}
                    className={({ isActive: active }) => `ps-link${active ? ' is-active' : ''}`} aria-label={collapsed ? item.label : undefined}>
                    <Icon size={18} aria-hidden="true" />
                    {!collapsed && <span className="ps-link-text">{item.label}</span>}
                    {item.badge ? <span className="ps-link-badge tabular" aria-label={`${item.badge} perlu perhatian`}>{item.badge}</span> : null}
                  </NavLink>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function Account({ account, collapsed }) {
  const { mode, toggle } = useThemeMode()
  return (
    <div className={`ps-account${collapsed ? ' is-collapsed' : ''}`}>
      <span className="ps-avatar" title={account.email} aria-hidden="true">{initials(account.name || account.email)}</span>
      {!collapsed && (
        <span className="ps-account-text" title={account.email}>
          <strong>{account.name || 'Admin'}</strong>
          <span>Admin platform</span>
        </span>
      )}
      <span className="ps-account-tools">
        <IconButton icon={mode === 'dark' ? Sun : Moon} size="sm" label={mode === 'dark' ? 'Mode terang' : 'Mode gelap'} onClick={toggle} className={collapsed ? 'tooltip-right' : ''} />
        <IconButton icon={LogOut} size="sm" label="Keluar" onClick={account.onSignOut} className={collapsed ? 'tooltip-right' : ''} />
      </span>
    </div>
  )
}

/** Palet perintah: lompat ke halaman mana pun & ganti mode tampilan. */
function CommandPalette({ open, onClose, sections }) {
  const ref = useRef(null)
  const listRef = useRef(null)
  const navigate = useNavigate()
  const { mode, toggle } = useThemeMode()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)

  const entries = useMemo(() => {
    const pages = sections.flatMap((section) => section.items.map((item) => ({ key: item.to, label: item.label, hint: section.label, icon: item.icon, run: () => navigate(item.to) })))
    pages.push({ key: 'theme', label: mode === 'dark' ? 'Ganti ke mode terang' : 'Ganti ke mode gelap', hint: 'Tampilan', icon: mode === 'dark' ? Sun : Moon, run: toggle })
    const words = query.trim().toLocaleLowerCase('id').split(/\s+/).filter(Boolean)
    return words.length ? pages.filter((entry) => words.every((word) => `${entry.label} ${entry.hint}`.toLocaleLowerCase('id').includes(word))) : pages
  }, [mode, navigate, query, sections, toggle])

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
          <input autoFocus value={query} placeholder="Cari halaman atau perintah…" role="combobox" aria-expanded="true" aria-controls="ps-palette-list"
            aria-activedescendant={entries[cursor] ? `ps-palette-${cursor}` : undefined}
            onChange={(event) => { setQuery(event.target.value); setCursor(0) }} onKeyDown={onKeyDown} />
          <kbd>Esc</kbd>
        </label>
        <ul id="ps-palette-list" ref={listRef} className="shell-palette-list" role="listbox">
          {entries.length === 0 && <li className="shell-palette-empty">Tidak ada yang cocok dengan “{query}”.</li>}
          {entries.map((entry, index) => {
            const Icon = entry.icon
            return (
              <li key={entry.key} id={`ps-palette-${index}`} role="option" aria-selected={index === cursor}
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

export function AdminShell({ sections, account, children }) {
  const location = useLocation()
  const online = useOnline()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [extraCrumbs, setExtraCrumbs] = useState([])

  useEffect(() => { storeCollapsed(collapsed) }, [collapsed])
  useEffect(() => {
    function onKey(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const activeItem = sections.flatMap((section) => section.items).find((item) => isActive(item, location.pathname))
  const crumbs = [
    ...(activeItem ? [{ label: activeItem.label, to: extraCrumbs.length ? activeItem.to : undefined }] : []),
    ...extraCrumbs,
  ]

  return (
    <CrumbContext.Provider value={setExtraCrumbs}>
      <div className={`ps${collapsed ? ' is-collapsed' : ''}`}>
        <aside className="ps-sidebar" aria-label="Sidebar">
          <Link to="/" className="ps-brand" aria-label="Dailybrew Platform, ke ringkasan">
            <BrandMark size={36} />
            {!collapsed && <span className="ps-brand-text"><strong>Dailybrew</strong><span>Platform</span></span>}
          </Link>
          <div className="ps-sidebar-scroll"><SidebarNav sections={sections} collapsed={collapsed} /></div>
          <IconButton icon={collapsed ? PanelLeftOpen : PanelLeftClose} label={collapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar'}
            className={`ps-collapse${collapsed ? ' tooltip-right' : ''}`} size="sm" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed} />
          <Account account={account} collapsed={collapsed} />
        </aside>

        {mobileOpen && (
          <Drawer title="Dailybrew Platform" onClose={() => setMobileOpen(false)} className="ps-drawer" size="sm">
            <SidebarNav sections={sections} onNavigate={() => setMobileOpen(false)} />
            <Account account={account} />
          </Drawer>
        )}

        <div className="ps-main">
          <header className="ps-topbar">
            <IconButton icon={Menu} label="Buka menu" className="ps-menu-btn" onClick={() => setMobileOpen(true)} tooltip={false} />
            <nav className="ps-crumbs" aria-label="Lokasi">
              <span className="ps-crumbs-root">Dailybrew</span>
              {crumbs.map((crumb, index) => (
                <span key={`${crumb.label}-${index}`} className="ps-crumb">
                  <ChevronRight size={14} aria-hidden="true" />
                  {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span aria-current={index === crumbs.length - 1 ? 'page' : undefined}>{crumb.label}</span>}
                </span>
              ))}
            </nav>
            <button type="button" className="ps-search" onClick={() => setPaletteOpen(true)} aria-label="Cari halaman" aria-keyshortcuts={IS_MAC ? 'Meta+K' : 'Control+K'}>
              <Search size={16} aria-hidden="true" />
              <span className="ps-search-text">Cari halaman…</span>
              <kbd>{SHORTCUT}</kbd>
            </button>
            <NotificationBell />
          </header>
          <main className="ps-content" id="konten">
            {!online && (
              <div className="shell-banner is-offline" role="status">
                <span><WifiOff size={16} aria-hidden="true" /> Koneksi internet terputus. Data yang tampil mungkin belum terbaru.</span>
              </div>
            )}
            {children}
          </main>
        </div>

        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} sections={sections} />
      </div>
    </CrumbContext.Provider>
  )
}
