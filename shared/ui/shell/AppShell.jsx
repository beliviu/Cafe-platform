/*
 * Kerangka aplikasi bersama (owner, staff, admin platform).
 * - ≥ 768px: SATU sidebar. Bisa diciutkan jadi rail ikon bertooltip (status diingat). Menu aktif ditandai
 *   indikator yang meluncur dengan efek pegas; grup menu berlabel; badge jumlah.
 *     grouped = false → semua grup tampil dengan label (admin: sedikit menu).
 *     grouped = true  → grup bisa dibuka-tutup; saat ciut, rail menampilkan ikon grup + menu melayang (owner: banyak menu).
 * - < 768px: bar atas + drawer menu; mobileNav="bottom" menambah menu bawah (staff).
 * - Ctrl/Cmd+K: palet perintah (halaman, mode tampilan, animasi, + pencarian data lewat prop `search`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Coffee, LogOut, Menu as MenuIcon, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Search, Sun, WifiOff, Zap, ZapOff } from 'lucide-react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { IconButton } from '../components/Button.jsx'
import { Drawer } from '../components/Dialog.jsx'
import { useSlidingIndicator } from '../components/hooks.js'
import { useAppearance } from '../theme/appearance.js'
import { useThemeMode } from '../theme/themeMode.js'
import { CommandPalette } from './CommandPalette.jsx'

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
    // localStorage bisa diblokir (mode privat) — hanya kenyamanan
  }
}

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() || '').join('') || '?'

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

/** Logo + nama. Tanpa logo: ikon kopi di kotak warna aksen. */
export function BrandMark({ brand, size = 36 }) {
  return (
    <span className={`brand-mark${brand?.logoUrl ? ' has-logo' : ''}`} style={{ width: size, height: size }}>
      {brand?.logoUrl
        ? <img src={brand.logoUrl} alt="" />
        : <Coffee size={Math.round(size * 0.5)} strokeWidth={2.2} aria-hidden="true" />}
    </span>
  )
}

function NavItem({ item, onNavigate, rail = false }) {
  const { to, label, icon: Icon, end, badge } = item
  return (
    <li>
      <NavLink to={to} end={end} onClick={onNavigate} aria-label={rail ? label : undefined}
        data-tooltip={rail ? label : undefined} data-tooltip-side={rail ? 'right' : undefined}
        className={({ isActive }) => `sb-link${isActive ? ' is-active' : ''}`}>
        <Icon size={18} aria-hidden="true" />
        {!rail && <span className="sb-link-text">{label}</span>}
        {badge ? <span className="sb-badge tabular" aria-label={`${badge} perlu perhatian`}>{badge}</span> : null}
      </NavLink>
    </li>
  )
}

/** Tombol tema + animasi + keluar. */
function Tools({ onSignOut, side }) {
  const { mode, toggle } = useThemeMode()
  const appearance = useAppearance()
  return (
    <>
      <IconButton icon={mode === 'dark' ? Sun : Moon} size="sm" label={mode === 'dark' ? 'Ganti ke mode terang' : 'Ganti ke mode gelap'} onClick={toggle} tooltipSide={side} />
      <IconButton icon={appearance.motion ? Zap : ZapOff} size="sm" label={appearance.motion ? 'Animasi: nyala. Tekan untuk mematikan' : 'Animasi: mati. Tekan untuk menyalakan'}
        aria-pressed={appearance.motion} onClick={() => appearance.set({ motion: !appearance.motion })} tooltipSide={side} />
      {onSignOut && <IconButton icon={LogOut} size="sm" label="Keluar dari akun" onClick={onSignOut} tooltipSide={side} />}
    </>
  )
}

function Account({ account, collapsed = false }) {
  return (
    <div className={`sb-account${collapsed ? ' is-collapsed' : ''}`}>
      {account.imageUrl
        ? <img className="sb-avatar" src={account.imageUrl} alt="" />
        : <span className="sb-avatar" aria-hidden="true" title={collapsed ? `${account.title} · ${account.subtitle}` : undefined}>{initials(account.title)}</span>}
      {!collapsed && <span className="sb-account-text"><strong>{account.title}</strong><span>{account.subtitle}</span></span>}
      <span className="sb-account-tools"><Tools onSignOut={account.onSignOut} side={collapsed ? 'right' : undefined} /></span>
    </div>
  )
}

function SidebarNav({ navigation, grouped, openGroups, onToggleGroup, activeIndex, onNavigate, pathname }) {
  const scrollRef = useSlidingIndicator('.sb-link.is-active', [pathname, grouped, navigation.length])
  useEffect(() => {
    scrollRef.current?.querySelector('.sb-link.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [pathname, scrollRef])

  return (
    <div className="sb-scroll" ref={scrollRef}>
      <span className="sb-indicator" aria-hidden="true" />
      <nav className="sb-nav" aria-label="Navigasi utama">
        {navigation.map((group, index) => {
          if (!grouped) {
            return (
              <div className="sb-section" key={group.label}>
                <span className="sb-label">{group.label}</span>
                <ul>{group.items.map((item) => <NavItem key={item.to} item={item} onNavigate={onNavigate} />)}</ul>
              </div>
            )
          }
          if (group.items.length === 1) {
            return <ul className="sb-single" key={group.label}><NavItem item={group.items[0]} onNavigate={onNavigate} /></ul>
          }
          const open = openGroups.includes(group.label)
          const badge = group.items.reduce((sum, item) => sum + (Number(item.badge) || 0), 0)
          return (
            <section className={`sb-group${index === activeIndex ? ' has-active' : ''}${open ? ' is-open' : ''}`} key={group.label}>
              <button type="button" className="sb-group-head" aria-expanded={open} onClick={() => onToggleGroup(group.label)}>
                <span>{group.label}</span>
                {!open && badge > 0 && <span className="sb-badge tabular">{badge}</span>}
                <ChevronDown size={15} aria-hidden="true" className="sb-chevron" />
              </button>
              <div className="sb-group-body" inert={!open}>
                <ul>{group.items.map((item) => <NavItem key={item.to} item={item} onNavigate={onNavigate} />)}</ul>
              </div>
            </section>
          )
        })}
      </nav>
    </div>
  )
}

/** Rail ikon (sidebar ciut). grouped: ikon grup + menu melayang; selain itu ikon tiap halaman + tooltip. */
function RailNav({ navigation, grouped, activeIndex, pathname, flyoutIndex, onGroup, onGroupEnter, onGroupLeave }) {
  const ref = useSlidingIndicator('.is-active', [pathname, grouped, navigation.length])
  return (
    <div className="sb-scroll is-rail" ref={ref}>
      <span className="sb-indicator" aria-hidden="true" />
      <nav className="sb-nav" aria-label="Navigasi utama">
        {grouped ? (
          <ul>
            {navigation.map((group, index) => {
              const Icon = group.icon || group.items[0].icon
              const badge = group.items.reduce((sum, item) => sum + (Number(item.badge) || 0), 0)
              const multi = group.items.length > 1
              return (
                <li key={group.label}>
                  <button type="button" className={`sb-link${index === activeIndex ? ' is-active' : ''}${flyoutIndex === index ? ' is-open' : ''}`}
                    aria-label={group.label} aria-current={index === activeIndex ? 'true' : undefined} aria-haspopup={multi ? 'menu' : undefined} aria-expanded={multi ? flyoutIndex === index : undefined}
                    data-tooltip={multi ? undefined : group.label} data-tooltip-side="right"
                    onClick={(event) => onGroup(index, event.currentTarget)}
                    onMouseEnter={multi ? (event) => onGroupEnter(index, event.currentTarget) : undefined}
                    onMouseLeave={multi ? onGroupLeave : undefined}>
                    <Icon size={18} aria-hidden="true" />
                    {badge > 0 && <span className="sb-badge tabular">{badge}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : navigation.map((group) => (
          <div className="sb-section" key={group.label}>
            <ul>{group.items.map((item) => <NavItem key={item.to} item={item} rail />)}</ul>
          </div>
        ))}
      </nav>
    </div>
  )
}

export function AppShell({
  brand,
  navigation,
  account,
  banner,
  homeTo = '/',
  grouped = false,
  mobileNav = 'drawer',
  storageKey = 'dailybrew.sidebar',
  defaultCollapsed,
  crumbRoot,
  extraCrumbs = [],
  actions,
  search,
  commands = [],
  searchLabel = 'Cari halaman…',
  className = '',
  children,
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const online = useOnline()
  const { mode, toggle } = useThemeMode()
  const appearance = useAppearance()
  const [collapsed, setCollapsed] = useState(() => readStored(`${storageKey}.collapsed`, defaultCollapsed ?? (typeof window !== 'undefined' && window.innerWidth <= 1180)))
  const [openGroups, setOpenGroups] = useState(() => readStored(`${storageKey}.groups`, []))
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [flyout, setFlyout] = useState(null)
  const closeTimer = useRef(null)

  const activeIndex = navigation.findIndex((group) => group.items.some((item) => isItemActive(item, location.pathname)))
  const activeGroup = navigation[activeIndex]
  const activeItem = activeGroup?.items.find((item) => isItemActive(item, location.pathname))
  // Grup halaman aktif selalu terbuka
  const visibleGroups = activeGroup && !openGroups.includes(activeGroup.label) ? [...openGroups, activeGroup.label] : openGroups

  useEffect(() => { store(`${storageKey}.collapsed`, collapsed) }, [collapsed, storageKey])
  useEffect(() => { store(`${storageKey}.groups`, openGroups) }, [openGroups, storageKey])

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

  const toggleGroup = useCallback((label) => {
    setOpenGroups((current) => {
      const base = activeGroup && !current.includes(activeGroup.label) ? [...current, activeGroup.label] : current
      return base.includes(label) ? base.filter((item) => item !== label) : [...base, label]
    })
  }, [activeGroup])

  function showFlyout(index, node) {
    window.clearTimeout(closeTimer.current)
    const rect = node.getBoundingClientRect()
    setFlyout({ index, top: Math.max(12, Math.min(rect.top - 8, window.innerHeight - 72 - navigation[index].items.length * 44)) })
  }
  function hideFlyoutSoon() {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setFlyout(null), 180)
  }
  function onRailGroup(index, node) {
    const group = navigation[index]
    if (group.items.length === 1) {
      navigate(group.items[0].to)
      setFlyout(null)
    } else if (flyout?.index === index) setFlyout(null)
    else showFlyout(index, node)
  }

  const entries = useMemo(() => [
    ...navigation.flatMap((group) => group.items.map((item) => ({ key: `page:${item.to}`, label: item.label, hint: group.label, group: 'Halaman', icon: item.icon, run: () => navigate(item.to) }))),
    ...commands.map((command) => ({ group: 'Perintah', ...command })),
    { key: 'cmd:theme', label: mode === 'dark' ? 'Ganti ke mode terang' : 'Ganti ke mode gelap', hint: 'Tampilan', group: 'Perintah', icon: mode === 'dark' ? Sun : Moon, run: toggle },
    { key: 'cmd:motion', label: appearance.motion ? 'Matikan animasi' : 'Nyalakan animasi', hint: 'Tampilan', group: 'Perintah', icon: appearance.motion ? ZapOff : Zap, run: () => appearance.set({ motion: !appearance.motion }) },
  ], [navigation, commands, mode, toggle, appearance, navigate])

  const crumbs = [
    ...(crumbRoot ? [{ label: crumbRoot }] : []),
    ...(grouped && activeGroup && activeGroup.items.length > 1 && activeGroup.label !== activeItem?.label ? [{ label: activeGroup.label }] : []),
    ...(activeItem ? [{ label: activeItem.label, to: extraCrumbs.length ? activeItem.to : undefined }] : crumbRoot ? [] : [{ label: brand.name }]),
    ...extraCrumbs,
  ]
  const flyoutGroup = flyout ? navigation[flyout.index] : null
  const bottomItems = mobileNav === 'bottom' ? navigation.flatMap((group) => group.items).slice(0, 4) : []

  return (
    <div className={`app${collapsed ? ' is-collapsed' : ''}${bottomItems.length ? ' has-bottomnav' : ''} ${className}`.trim()}>
      <a className="app-skip" href="#konten">Lompat ke konten</a>
      <aside className="sb" aria-label="Sidebar">
        <div className="sb-head">
          <Link className="sb-brand" to={homeTo} aria-label={`${brand.name}, ke halaman utama`}>
            <BrandMark brand={brand} size={36} />
            {!collapsed && <span className="sb-brand-text"><strong title={brand.name}>{brand.name}</strong>{brand.tagline && <span>{brand.tagline}</span>}</span>}
          </Link>
          <IconButton icon={collapsed ? PanelLeftOpen : PanelLeftClose} size="sm" className="sb-collapse" label={collapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar'}
            tooltipSide={collapsed ? 'right' : 'bottom'} aria-expanded={!collapsed} onClick={() => { setCollapsed((value) => !value); setFlyout(null) }} />
        </div>
        {collapsed
          ? <RailNav navigation={navigation} grouped={grouped} activeIndex={activeIndex} pathname={location.pathname} flyoutIndex={flyout?.index ?? null}
              onGroup={onRailGroup} onGroupEnter={showFlyout} onGroupLeave={hideFlyoutSoon} />
          : <SidebarNav navigation={navigation} grouped={grouped} openGroups={visibleGroups} onToggleGroup={toggleGroup} activeIndex={activeIndex} pathname={location.pathname} />}
        <Account account={account} collapsed={collapsed} />
      </aside>

      {collapsed && flyoutGroup && (
        <div className="sb-flyout" style={{ top: flyout.top }} role="menu" aria-label={flyoutGroup.label}
          onMouseEnter={() => window.clearTimeout(closeTimer.current)} onMouseLeave={hideFlyoutSoon}>
          <strong>{flyoutGroup.label}</strong>
          <ul>{flyoutGroup.items.map((item) => <NavItem key={item.to} item={item} onNavigate={() => setFlyout(null)} />)}</ul>
        </div>
      )}

      <div className="app-main">
        <header className="app-topbar">
          <IconButton icon={MenuIcon} label="Buka menu" className="app-menu-btn" onClick={() => setMobileOpen(true)} tooltip={false} />
          <Link className="app-topbar-brand" to={homeTo}><BrandMark brand={brand} size={30} /><span>{brand.name}</span></Link>
          <nav className="app-crumbs" aria-label="Lokasi">
            {crumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} className="app-crumb">
                {index > 0 && <ChevronRight size={14} aria-hidden="true" />}
                {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span aria-current={index === crumbs.length - 1 ? 'page' : undefined}>{crumb.label}</span>}
              </span>
            ))}
          </nav>
          <button type="button" className="app-search" onClick={() => setPaletteOpen(true)} aria-label="Cari" aria-keyshortcuts={IS_MAC ? 'Meta+K' : 'Control+K'}>
            <Search size={16} aria-hidden="true" />
            <span className="app-search-text">{searchLabel}</span>
            <kbd>{SHORTCUT}</kbd>
          </button>
          {actions}
        </header>
        <main className="app-content" id="konten" tabIndex={-1}>
          {!online && (
            <div className="shell-banner is-offline" role="status">
              <span><WifiOff size={16} aria-hidden="true" /> Koneksi internet terputus. Data yang tampil mungkin belum terbaru; perubahan baru bisa disimpan setelah tersambung lagi.</span>
            </div>
          )}
          {banner}
          {children}
        </main>
      </div>

      {bottomItems.length > 0 && (
        <nav className="app-bottomnav" aria-label="Menu utama">
          {bottomItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `app-bottomnav-item${isActive ? ' is-active' : ''}`}>
                <span className="app-bottomnav-icon"><Icon size={20} aria-hidden="true" />{item.badge ? <span className="sb-badge tabular">{item.badge}</span> : null}</span>
                <span>{item.shortLabel || item.label}</span>
              </NavLink>
            )
          })}
          <button type="button" className="app-bottomnav-item" onClick={() => setMobileOpen(true)}>
            <span className="app-bottomnav-icon"><MoreHorizontal size={20} aria-hidden="true" /></span>
            <span>Lainnya</span>
          </button>
        </nav>
      )}

      {mobileOpen && (
        <Drawer title={brand.name} description={brand.tagline} onClose={() => setMobileOpen(false)} className="sb-drawer" size="sm">
          <SidebarNav navigation={navigation} grouped={grouped} openGroups={visibleGroups} onToggleGroup={toggleGroup} activeIndex={activeIndex} pathname={location.pathname} onNavigate={() => setMobileOpen(false)} />
          <Account account={account} />
        </Drawer>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} entries={entries} search={search}
        placeholder={search ? 'Cari halaman, data, atau perintah…' : 'Cari halaman atau perintah…'} />
    </div>
  )
}
