import { useCallback, useEffect, useRef, useState } from 'react'
import { Coffee, LogOut, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Drawer, IconButton } from '../ui/index.js'
import { initials } from '../../lib/format.js'

const STORAGE_KEY = 'dailybrew.sidebar.collapsed'

function readCollapsed() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored !== null) return stored === '1'
  } catch {
    // localStorage bisa diblokir (mode privat) — pakai default.
  }
  // Tablet (≤ 1180px): mulai dari mode ikon agar konten lebih lega.
  return window.innerWidth <= 1180
}

/** Logo + nama kafe. Tanpa logo: ikon kopi di kotak warna brand. */
export function BrandMark({ brand, size = 36 }) {
  return (
    <span className={`shell-brand-mark${brand?.logoUrl ? ' has-logo' : ''}`} style={{ width: size, height: size }}>
      {brand?.logoUrl
        ? <img src={brand.logoUrl} alt="" />
        : <Coffee size={Math.round(size * 0.53)} strokeWidth={2.2} aria-hidden="true" />}
    </span>
  )
}

function BrandLockup({ brand, compact = false, homeTo = '/' }) {
  return (
    <Link className="shell-brand" to={homeTo} aria-label={`${brand.name}, ke halaman utama`}>
      <BrandMark brand={brand} />
      {!compact && <span className="shell-brand-name" title={brand.name}>{brand.name}</span>}
    </Link>
  )
}

function NavGroups({ groups, collapsed = false, onNavigate, onHint }) {
  return (
    <nav className="shell-nav" aria-label="Navigasi utama">
      {groups.map((group) => (
        <div className="shell-nav-group" key={group.label}>
          {collapsed ? <span className="shell-nav-divider" aria-hidden="true" /> : <span className="shell-nav-label">{group.label}</span>}
          <ul>
            {group.items.map(({ to, label, icon: Icon, end, badge }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  onClick={onNavigate}
                  className={({ isActive }) => `shell-link${isActive ? ' is-active' : ''}`}
                  aria-label={collapsed ? label : undefined}
                  onMouseEnter={collapsed && onHint ? (event) => onHint(event.currentTarget, label) : undefined}
                  onMouseLeave={collapsed && onHint ? () => onHint(null) : undefined}
                  onFocus={collapsed && onHint ? (event) => onHint(event.currentTarget, label) : undefined}
                  onBlur={collapsed && onHint ? () => onHint(null) : undefined}
                >
                  <Icon size={19} aria-hidden="true" />
                  {!collapsed && <span className="shell-link-text">{label}</span>}
                  {badge ? <span className="shell-link-badge tabular">{badge}</span> : null}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function Account({ title, subtitle, imageUrl, onSignOut, collapsed }) {
  return (
    <div className={`shell-account${collapsed ? ' is-collapsed' : ''}`}>
      {imageUrl ? (
        <img className="shell-avatar" src={imageUrl} alt="" />
      ) : (
        <span className="shell-avatar" aria-hidden="true">{initials(title)}</span>
      )}
      {!collapsed && (
        <span className="shell-account-text">
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </span>
      )}
      <IconButton icon={LogOut} label="Keluar dari akun" onClick={onSignOut} className={collapsed ? 'tooltip-right' : ''} />
    </div>
  )
}

/**
 * Kerangka aplikasi web (owner, nanti juga staff):
 * - ≥ 768px: sidebar yang bisa diciutkan jadi ikon (disimpan di browser).
 * - < 768px: bar atas + menu dalam drawer.
 */
export function AppShell({ brand, navigation, account, banner, homeTo = '/', children }) {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
    } catch {
      // abaikan
    }
  }, [collapsed])

  // Area menu bisa di-scroll; bayangan atas/bawah menandakan masih ada menu di luar layar
  const scrollRef = useRef(null)
  const [edges, setEdges] = useState({ top: false, bottom: false })
  const [hint, setHint] = useState(null)
  const measure = useCallback(() => {
    const node = scrollRef.current
    if (!node) return
    setEdges({ top: node.scrollTop > 2, bottom: node.scrollTop + node.clientHeight < node.scrollHeight - 2 })
  }, [])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return undefined
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [collapsed, measure, navigation.length])

  // Menu aktif selalu terlihat (mis. Pengaturan di paling bawah)
  useEffect(() => {
    const active = scrollRef.current?.querySelector('.shell-link.is-active')
    active?.scrollIntoView({ block: 'nearest' })
    measure()
  }, [location.pathname, collapsed, measure])

  // Label melayang untuk sidebar ciut (tooltip CSS terpotong oleh area scroll)
  const showHint = useCallback((node, label) => {
    if (!node) return setHint(null)
    const rect = node.getBoundingClientRect()
    setHint({ label, top: rect.top + rect.height / 2, left: rect.right + 10 })
    return undefined
  }, [])

  const currentLabel = navigation
    .flatMap((group) => group.items)
    .find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)))?.label

  return (
    <div className={`shell${collapsed ? ' is-collapsed' : ''}`}>
      <aside className="shell-sidebar" aria-label="Sidebar">
        <div className="shell-sidebar-top">
          <BrandLockup brand={brand} compact={collapsed} homeTo={homeTo} />
          <IconButton
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            label={collapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar'}
            size="sm"
            className={`shell-collapse${collapsed ? ' tooltip-right' : ''}`}
            onClick={() => setCollapsed((value) => !value)}
            aria-expanded={!collapsed}
          />
        </div>
        <div
          ref={scrollRef}
          className={`shell-sidebar-scroll${edges.top ? ' has-above' : ''}${edges.bottom ? ' has-below' : ''}`}
          onScroll={() => { measure(); setHint(null) }}
        >
          <NavGroups groups={navigation} collapsed={collapsed} onHint={showHint} />
        </div>
        <Account {...account} collapsed={collapsed} />
      </aside>
      {collapsed && hint && <span className="shell-flyout" role="tooltip" style={{ top: hint.top, left: hint.left }}>{hint.label}</span>}

      <header className="shell-topbar">
        <IconButton icon={Menu} label="Buka menu" onClick={() => setMobileOpen(true)} tooltip={false} />
        <BrandLockup brand={brand} homeTo={homeTo} />
        <span className="shell-topbar-page">{currentLabel}</span>
      </header>

      {mobileOpen && (
        <Drawer title="Menu" onClose={() => setMobileOpen(false)} className="shell-mobile-drawer" size="sm">
          <NavGroups groups={navigation} onNavigate={() => setMobileOpen(false)} />
          <Account {...account} />
        </Drawer>
      )}

      <main className="shell-main" id="konten">
        {banner}
        {children}
      </main>
    </div>
  )
}
