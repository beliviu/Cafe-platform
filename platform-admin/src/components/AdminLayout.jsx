import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { BarChart3, Coffee, FileClock, LayoutDashboard, LifeBuoy, Megaphone, Package, Receipt, Settings, Store, Wallet } from 'lucide-react'
import { optional, rpc } from '../lib/api.js'
import { useAuth } from '../auth/useAuth.js'
import { AdminShell } from './shell/AdminShell.jsx'
import { Button } from './ui/index.js'

const sections = (ticketBadge) => [
  { label: 'Utama', items: [
    { to: '/', label: 'Ringkasan', icon: LayoutDashboard, end: true },
    { to: '/kafe', label: 'Kafe', icon: Store },
    { to: '/tagihan', label: 'Tagihan', icon: Receipt },
    { to: '/keuangan', label: 'Keuangan', icon: Wallet },
    { to: '/analitik', label: 'Analitik', icon: BarChart3 },
  ] },
  { label: 'Layanan', items: [
    { to: '/tiket', label: 'Tiket bantuan', icon: LifeBuoy, badge: ticketBadge || null },
  ] },
  { label: 'Kelola', items: [
    { to: '/paket', label: 'Paket', icon: Package },
    { to: '/pengumuman', label: 'Pengumuman', icon: Megaphone },
  ] },
  { label: 'Sistem', items: [
    { to: '/audit', label: 'Log audit', icon: FileClock },
    { to: '/pengaturan', label: 'Pengaturan', icon: Settings },
  ] },
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
/** Jumlah tiket belum dibaca untuk badge menu (diperbarui setiap pindah halaman). */
function useTicketBadge(enabled, pathname) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    optional(rpc('pa_tickets_list', { p_limit: 1, p_offset: 0 }))
      .then((result) => { if (active) setCount(Number(result?.counts?.unread) || 0) })
      .catch(() => {})
    return () => { active = false }
  }, [enabled, pathname])
  return count
}

export function AdminLayout() {
  const { aal, admin, loading, session, signOut } = useAuth()
  const location = useLocation()
  const ticketBadge = useTicketBadge(Boolean(admin?.is_admin) && aal === 'aal2', location.pathname)

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
    <AdminShell sections={sections(ticketBadge)} account={{ name: admin.full_name, email: session.user.email, onSignOut: signOut }}>
      <Outlet />
    </AdminShell>
  )
}
