import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Activity, BarChart3, Coffee, Eye, FileClock, Flag, LayoutDashboard, LifeBuoy, Megaphone, Package, Receipt, Settings, Sparkles, Store, UserPlus, Users, Wallet } from 'lucide-react'
import { optional, rpc } from '../lib/api.js'
import { endImpersonation } from '../lib/impersonation.js'
import { can } from '../lib/roles.js'
import { useAuth } from '../auth/useAuth.js'
import { AdminShell } from './shell/AdminShell.jsx'
import { Button } from './ui/index.js'

// fn = fungsi SQL yang dibutuhkan halaman; menu disembunyikan bila peran admin tidak boleh (file SQL 18)
const SECTIONS = [
  { label: 'Utama', items: [
    { to: '/', label: 'Ringkasan', icon: LayoutDashboard, end: true, fn: 'pa_overview' },
    { to: '/kafe', label: 'Kafe', icon: Store, fn: 'pa_cafes_list' },
    { to: '/pendaftaran', label: 'Pendaftaran', icon: UserPlus, fn: 'pa_signups_list' },
    { to: '/tagihan', label: 'Tagihan', icon: Receipt, fn: 'pa_invoices_list' },
    { to: '/keuangan', label: 'Keuangan', icon: Wallet, fn: 'pa_finance_overview' },
    { to: '/analitik', label: 'Analitik', icon: BarChart3, fn: 'pa_analytics_summary' },
    { to: '/tanya-ai', label: 'Tanya AI', icon: Sparkles, fn: 'pa_ai_quota' },
  ] },
  { label: 'Layanan', items: [
    { to: '/tiket', label: 'Tiket bantuan', icon: LifeBuoy, fn: 'pa_tickets_list', badgeKey: 'tickets' },
    { to: '/status-sistem', label: 'Status sistem', icon: Activity, fn: 'pa_status_admin' },
  ] },
  { label: 'Kelola', items: [
    { to: '/paket', label: 'Paket', icon: Package, fn: 'pa_plans_list' },
    { to: '/fitur', label: 'Feature flag', icon: Flag, fn: 'pa_flags_overview' },
    { to: '/pengumuman', label: 'Pengumuman', icon: Megaphone, fn: 'pa_announcements_list' },
  ] },
  { label: 'Sistem', items: [
    { to: '/tim', label: 'Tim admin', icon: Users, fn: 'pa_admins_list' },
    { to: '/audit', label: 'Log audit', icon: FileClock, fn: 'pa_audit_list' },
    { to: '/pengaturan', label: 'Pengaturan', icon: Settings, fn: 'pa_settings_get' },
  ] },
]

const sections = (admin, badges) => SECTIONS
  .map((section) => ({
    ...section,
    items: section.items.filter((item) => can(admin, item.fn)).map(({ fn: _fn, badgeKey, ...item }) => ({ ...item, badge: badgeKey ? badges[badgeKey] || null : undefined })),
  }))
  .filter((section) => section.items.length > 0)

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

/** Sesi lihat-sebagai milik admin ini masih berjalan (dari pa_whoami) */
function ImpersonationBanner({ session }) {
  const { refresh } = useAuth()
  const [busy, setBusy] = useState(false)
  return (
    <div className="shell-banner is-info" role="status">
      <span><Eye size={16} aria-hidden="true" /> Sesi lihat-sebagai masih aktif sampai {new Date(session.expires_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}. Akses baca ke kafe itu berakhir saat sesi diakhiri.</span>
      <span className="shell-banner-actions">
        <Button size="sm" variant="ghost" loading={busy} onClick={async () => { setBusy(true); try { await endImpersonation(session.id) } finally { setBusy(false); refresh() } }}>Akhiri sesi</Button>
      </span>
    </div>
  )
}

export function AdminLayout() {
  const { aal, admin, loading, session, signOut } = useAuth()
  const location = useLocation()
  const ticketBadge = useTicketBadge(Boolean(admin?.is_admin) && aal === 'aal2' && can(admin, 'pa_tickets_list'), location.pathname)

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
    <AdminShell sections={sections(admin, { tickets: ticketBadge })} account={{ name: admin.full_name, email: session.user.email, onSignOut: signOut }}
      banner={admin.impersonation ? <ImpersonationBanner session={admin.impersonation} /> : null}>
      <Outlet />
    </AdminShell>
  )
}
