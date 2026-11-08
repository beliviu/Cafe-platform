/*
 * Keuangan: Ringkasan, Laporan, Jurnal, Buku besar, Akun & periode.
 * Sebelum "Mulai pembukuan" (go-live + saldo awal) hanya tab Ringkasan yang berisi wizard.
 */
import { useCallback } from 'react'
import { Navigate, NavLink, Outlet, useMatch, useOutletContext } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth.js'
import { Card, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui/index.js'
import { FINANCE_REQUIRED, friendlyError } from '../../lib/db.js'
import { useLoader, useOwnerBase } from '../../lib/inventory.js'

const TABS = [
  { to: '.', label: 'Ringkasan', end: true },
  { to: 'reports', label: 'Laporan' },
  { to: 'journal', label: 'Jurnal' },
  { to: 'ledger', label: 'Buku besar' },
  { to: 'accounts', label: 'Akun & periode' },
]

export function FinanceLayout() {
  const context = useOutletContext()
  return (
    <div className="page page-wide">
      <PageHeader eyebrow="Keuangan" title="Keuangan" description="Pembukuan double-entry: semua laporan dihitung dari jurnal, bukan perkiraan." />
      {context.features?.finance ? <FinanceData context={context} /> : <Card><EmptyState title="Belum tersedia" description={FINANCE_REQUIRED} /></Card>}
    </div>
  )
}

function FinanceData({ context }) {
  const { supabase } = useAuth()
  const cafeId = context.cafe.id
  const load = useCallback(async () => {
    const [settings, accounts] = await Promise.all([
      supabase.from('cafe_settings').select('accounting_go_live').eq('cafe_id', cafeId).maybeSingle(),
      supabase.from('accounts').select('id, code, name, type, cash_flow, is_cash, is_system, is_active').eq('cafe_id', cafeId).order('code'),
    ])
    const failure = settings.error || accounts.error
    if (failure) throw new Error(friendlyError(failure))
    return { goLive: settings.data?.accounting_go_live || null, accounts: accounts.data || [] }
  }, [cafeId, supabase])
  const finance = useLoader(load)
  const onIndex = useMatch({ path: `${useOwnerBase()}/finance`, end: true })

  if (finance.error && !finance.data) return <Card><ErrorState message={finance.error} onRetry={finance.reload} /></Card>
  if (!finance.data) return <Card padding="none"><SkeletonRows rows={5} label="Memuat keuangan" /></Card>
  // Sebelum go-live hanya wizard di Ringkasan yang berlaku.
  if (!finance.data.goLive && !onIndex) return <Navigate to="." replace />
  return (
    <>
      {finance.data.goLive && (
        <nav className="settings-tabs" aria-label="Bagian keuangan">
          {TABS.map((tab) => (
            <NavLink key={tab.label} to={tab.to} end={tab.end} className={({ isActive }) => `settings-tab${isActive ? ' is-active' : ''}`}>{tab.label}</NavLink>
          ))}
        </nav>
      )}
      <Outlet context={{ ...context, finance: { ...finance.data, reload: finance.reload } }} />
    </>
  )
}
