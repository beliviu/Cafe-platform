import { useEffect, useState } from 'react'
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

function NavGroups({ groups, collapsed = false, onNavigate }) {
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
                  data-tooltip={collapsed ? label : undefined}
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
        <NavGroups groups={navigation} collapsed={collapsed} />
        <div className="shell-spacer" />
        <Account {...account} collapsed={collapsed} />
      </aside>

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
