import { useEffect, useState } from 'react'
import { Coffee, LogOut } from 'lucide-react'
import { Link, Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { OWNER_NAVIGATION } from '../config/ownerNavigation.js'
import { LoadingScreen } from './LoadingScreen.jsx'

function OwnerAccessState({ title, message, onRetry }) {
  return (
    <main className="access-state">
      <div className="access-card">
        <span className="brand-mark brand-mark-large"><Coffee size={24} /></span>
        <h1>{title}</h1>
        <p>{message}</p>
        {onRetry && (
          <button className="button button-primary" type="button" onClick={onRetry}>
            Coba lagi
          </button>
        )}
      </div>
    </main>
  )
}

export function OwnerLayout() {
  const { session, supabase } = useAuth()
  const navigate = useNavigate()
  const [ownerData, setOwnerData] = useState(null)
  const [profileRole, setProfileRole] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [signOutError, setSignOutError] = useState('')
  const [loadingAttempt, setLoadingAttempt] = useState(0)

  useEffect(() => {
    if (!supabase || !session?.user?.id) return undefined

    let active = true

    async function loadOwnerCafe() {
      setLoading(true)
      setLoadError('')
      setOwnerData(null)
      setProfileRole(null)

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, role, cafe_id')
        .eq('id', session.user.id)
        .maybeSingle()

      if (!active) return
      if (profileError) {
        setLoadError(`Profil owner tidak dapat dimuat: ${profileError.message}`)
        setLoading(false)
        return
      }
      setProfileRole(profile?.role || null)
      if (!profile || profile.role !== 'owner' || !profile.cafe_id) {
        setLoading(false)
        return
      }

      const { data: cafe, error: cafeError } = await supabase
        .from('cafes')
        .select('id, name')
        .eq('id', profile.cafe_id)
        .maybeSingle()

      if (!active) return
      if (cafeError) {
        setLoadError(`Data cafe tidak dapat dimuat: ${cafeError.message}`)
      } else if (cafe) {
        setOwnerData({ profile, cafe })
      } else {
        setLoadError('Cafe untuk akun owner ini tidak ditemukan.')
      }
      setLoading(false)
    }

    loadOwnerCafe()

    return () => {
      active = false
    }
  }, [loadingAttempt, session?.user?.id, supabase])

  async function handleSignOut() {
    setSignOutError('')
    const { error } = await supabase.auth.signOut()
    if (error) {
      setSignOutError(`Tidak dapat keluar: ${error.message}`)
      return
    }
    navigate('/login', { replace: true })
  }

  if (loading) return <LoadingScreen label="Memuat cafe Anda..." />
  if (profileRole === 'staff') return <Navigate to="/staff" replace />
  if (loadError) {
    return (
      <OwnerAccessState
        title="Data cafe belum tersedia"
        message={loadError}
        onRetry={() => setLoadingAttempt((attempt) => attempt + 1)}
      />
    )
  }
  if (!ownerData) {
    return (
      <OwnerAccessState
        title="Akses owner diperlukan"
        message="Akun ini belum terhubung sebagai owner ke sebuah cafe. Hubungi administrator untuk menyiapkan akses."
      />
    )
  }

  const initials = ownerData.cafe.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand-lockup" to="/" aria-label="Dailybrew, dashboard">
          <span className="brand-mark"><Coffee size={20} strokeWidth={2.2} /></span>
          <span className="brand-name">daily<span>brew</span></span>
        </Link>

        <div className="sidebar-section-label">MENU UTAMA</div>
        <nav className="sidebar-nav" aria-label="Navigasi utama">
          {OWNER_NAVIGATION.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
              to={to}
              end={end}
              key={to}
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-cafe">
          {ownerData.cafe.logo_url ? (
            <img className="cafe-avatar" src={ownerData.cafe.logo_url} alt="" />
          ) : (
            <span className="cafe-avatar cafe-avatar-fallback">{initials}</span>
          )}
          <span className="cafe-identity">
            <strong>{ownerData.cafe.name}</strong>
            <span>Owner workspace</span>
          </span>
          <button
            type="button"
            className="icon-button signout-button"
            onClick={handleSignOut}
            aria-label="Keluar"
            title="Keluar"
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <main className="main-panel">
        {signOutError && (
          <div className="inline-alert" role="alert">
            <span>{signOutError}</span>
            <button type="button" className="inline-alert-action" onClick={() => setSignOutError('')}>
              Tutup
            </button>
          </div>
        )}
        <div className="mobile-brand">
          <span className="brand-mark"><Coffee size={19} /></span>
          <span className="brand-name">daily<span>brew</span></span>
          <button type="button" className="icon-button" onClick={handleSignOut} aria-label="Keluar">
            <LogOut size={17} />
          </button>
        </div>
        <nav className="mobile-nav" aria-label="Navigasi utama">
          {OWNER_NAVIGATION.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              className={({ isActive }) => `mobile-nav-link${isActive ? ' active' : ''}`}
              to={to}
              end={end}
              key={to}
            >
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <Outlet context={ownerData} />
      </main>
    </div>
  )
}
