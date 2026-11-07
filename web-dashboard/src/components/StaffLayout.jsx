import { useEffect, useState } from 'react'
import { Coffee, ClipboardList, History, LogOut } from 'lucide-react'
import { Link, NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { LoadingScreen } from './LoadingScreen.jsx'

const STAFF_NAVIGATION = [
  { to: '/staff', label: 'Pesanan', icon: ClipboardList, end: true },
  { to: '/staff/history', label: 'Riwayat', icon: History },
]

export function StaffLayout() {
  const { session, supabase } = useAuth()
  const navigate = useNavigate()
  const [staffData, setStaffData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [signOutError, setSignOutError] = useState('')

  useEffect(() => {
    if (!supabase || !session?.user?.id) return undefined

    let active = true
    async function loadStaffCafe() {
      setLoading(true)
      setLoadError('')
      setStaffData(null)
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, role, cafe_id')
        .eq('id', session.user.id)
        .maybeSingle()

      if (!active) return
      if (profileError) {
        setLoadError(`Profil staff tidak dapat dimuat: ${profileError.message}`)
        setLoading(false)
        return
      }
      if (!profile || profile.role !== 'staff' || !profile.cafe_id) {
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
        setStaffData({ profile, cafe })
      } else {
        setLoadError('Cafe yang ditugaskan ke akun staff ini tidak ditemukan.')
      }
      setLoading(false)
    }

    loadStaffCafe()
    return () => { active = false }
  }, [attempt, session?.user?.id, supabase])

  async function handleSignOut() {
    setSignOutError('')
    const { error } = await supabase.auth.signOut()
    if (error) {
      setSignOutError(`Tidak dapat keluar: ${error.message}`)
      return
    }
    navigate('/login', { replace: true })
  }

  if (loading) return <LoadingScreen label="Memeriksa akses staff..." />
  if (loadError) {
    return (
      <main className="access-state">
        <div className="access-card">
          <span className="brand-mark brand-mark-large"><Coffee size={24} /></span>
          <h1>Dashboard staff belum tersedia</h1>
          <p>{loadError}</p>
          <button className="button button-primary" type="button" onClick={() => setAttempt((value) => value + 1)}>
            Coba lagi
          </button>
        </div>
      </main>
    )
  }
  if (!staffData) return <Navigate to="/" replace />

  const initials = staffData.cafe.name.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand-lockup" to="/staff" aria-label="Dailybrew, pesanan staff">
          <span className="brand-mark"><Coffee size={20} strokeWidth={2.2} /></span>
          <span className="brand-name">daily<span>brew</span></span>
        </Link>
        <div className="sidebar-section-label">OPERASIONAL</div>
        <nav className="sidebar-nav" aria-label="Navigasi staff">
          {STAFF_NAVIGATION.map(({ to, label, icon: Icon, end }) => (
            <NavLink className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`} to={to} end={end} key={to}>
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-cafe">
          <span className="cafe-avatar cafe-avatar-fallback">{initials}</span>
          <span className="cafe-identity">
            <strong>{staffData.cafe.name}</strong>
            <span>Staff workspace</span>
          </span>
          <button type="button" className="icon-button signout-button" onClick={handleSignOut} aria-label="Keluar" title="Keluar">
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <main className="main-panel">
        {signOutError && <div className="inline-alert" role="alert">{signOutError}</div>}
        <div className="mobile-brand">
          <span className="brand-mark"><Coffee size={19} /></span>
          <span className="brand-name">daily<span>brew</span></span>
          <button type="button" className="icon-button" onClick={handleSignOut} aria-label="Keluar"><LogOut size={17} /></button>
        </div>
        <nav className="mobile-nav" aria-label="Navigasi staff">
          {STAFF_NAVIGATION.map(({ to, label, icon: Icon, end }) => (
            <NavLink className={({ isActive }) => `mobile-nav-link${isActive ? ' active' : ''}`} to={to} end={end} key={to}>
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <Outlet context={staffData} />
      </main>
    </div>
  )
}
