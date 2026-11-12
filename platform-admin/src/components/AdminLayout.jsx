import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Coffee, FileClock, LayoutDashboard, Package, Receipt, Store } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import { AppShell } from './shell/AppShell.jsx'
import { Button } from './ui/index.js'

const NAVIGATION = [
  { label: 'Ringkasan', icon: LayoutDashboard, items: [{ to: '/', label: 'Ringkasan', icon: LayoutDashboard, end: true }] },
  { label: 'Kafe', icon: Store, items: [{ to: '/kafe', label: 'Kafe', icon: Store }] },
  { label: 'Tagihan', icon: Receipt, items: [{ to: '/tagihan', label: 'Tagihan', icon: Receipt }] },
  { label: 'Paket', icon: Package, items: [{ to: '/paket', label: 'Paket', icon: Package }] },
  { label: 'Log audit', icon: FileClock, items: [{ to: '/audit', label: 'Log audit', icon: FileClock }] },
]

export function LoadingScreen({ label = 'Memuat…' }) {
  return <div className="loading-screen" role="status"><span className="loading-mark" aria-hidden="true" />{label}</div>
}

export function AccessState({ title, message, action }) {
  return (
    <main className="access-v2">
      <div className="access-v2-card">
        <span className="shell-brand-mark access-v2-mark"><Coffee size={24} aria-hidden="true" /></span>
        <h1 className="ui-title">{title}<span className="ui-title-period">.</span></h1>
        <p>{message}</p>
        {action}
      </div>
    </main>
  )
}

/** Penjaga akses: login → admin platform → 2FA (aal2). Database memeriksa ulang di setiap fungsi. */
export function AdminLayout() {
  const { aal, admin, loading, session, signOut } = useAuth()
  const location = useLocation()

  if (loading || (session && !admin)) return <LoadingScreen label="Memeriksa akses…" />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (admin.error) {
    return <AccessState title="Belum siap" message={admin.error} action={<Button variant="secondary" onClick={signOut}>Keluar</Button>} />
  }
  if (!admin.is_admin) {
    return (
      <AccessState title="Bukan admin platform" message={`Akun ${session.user.email} tidak terdaftar sebagai admin Dailybrew.`}
        action={<Button variant="secondary" onClick={signOut}>Keluar</Button>} />
    )
  }
  if (aal !== 'aal2') return <Navigate to="/mfa" replace />

  return (
    <AppShell
      brand={{ name: 'Dailybrew', tagline: 'Platform admin' }}
      navigation={NAVIGATION}
      account={{ title: admin.full_name || session.user.email, subtitle: session.user.email, onSignOut: signOut }}
    >
      <Outlet />
    </AppShell>
  )
}
