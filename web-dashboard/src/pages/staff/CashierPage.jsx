/*
 * Sesi kasir staff: buka/tutup kasir, kas masuk/keluar, ringkasan berjalan, riwayat sesi sendiri.
 * Angka "kas seharusnya" dihitung database (cashier_summary), bukan di browser.
 */
import { useCallback, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { ArrowDownUp, Banknote, Lock, Wallet } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui/index.js'
import { CashMoveDialog, CloseSessionDialog, OpenSessionDialog } from '../../components/pos/CashierDialogs.jsx'
import { friendlyError, POS_REQUIRED } from '../../lib/db.js'
import { formatDateTime, formatRupiah, formatTime } from '../../lib/format.js'
import { useLoader } from '../../lib/inventory.js'
import { rpc } from '../../lib/pos.js'
import { paymentMethodLabel } from '../../lib/status.js'
import { fetchTeam } from '../../lib/team.js'

export function CashierPage() {
  const context = useOutletContext()
  return (
    <div className="page">
      <PageHeader eyebrow={context.cafe.name} title="Sesi kasir" description="Modal awal, kas masuk/keluar, dan hitung laci saat tutup." />
      {context.features?.pos ? <CashierContent cafe={context.cafe} profile={context.profile} finance={Boolean(context.features?.finance)} /> : <Card><EmptyState title="Belum tersedia" description={POS_REQUIRED} /></Card>}
    </div>
  )
}

function CashierContent({ cafe, profile, finance }) {
  const { supabase, session: authSession } = useAuth()
  const userId = authSession?.user?.id || profile?.id
  const [dialog, setDialog] = useState(null)

  const load = useCallback(async () => {
    const [sessions, team] = await Promise.all([
      supabase.from('cashier_sessions').select('*').eq('cafe_id', cafe.id).order('opened_at', { ascending: false }).limit(30),
      fetchTeam(supabase, cafe.id).catch(() => []),
    ])
    if (sessions.error) throw new Error(friendlyError(sessions.error))
    const all = sessions.data || []
    const open = all.find((row) => row.status === 'open' && row.opened_by === userId) || null
    const [summary, movements] = open ? await Promise.all([
      rpc(supabase, 'cashier_summary', { p_session_id: open.id }),
      supabase.from('cash_movements').select('id, direction, amount, reason, created_at').eq('session_id', open.id).order('created_at', { ascending: false }),
    ]) : [null, { data: [] }]
    const handover = all.find((row) => row.handover_to === userId && row.status === 'closed') || null
    return { open, summary, movements: movements.data || [], history: all.filter((row) => row.opened_by === userId && row.status === 'closed'), handover, team }
  }, [cafe.id, supabase, userId])
  const { data, error, reload } = useLoader(load)

  if (error) return <Card><ErrorState message={error} onRetry={reload} /></Card>
  if (!data) return <Card padding="none"><SkeletonRows rows={5} label="Memuat sesi kasir" /></Card>
  const names = new Map(data.team.map((member) => [member.id, member.full_name]))
  const { open, summary } = data
  const lastHandover = data.handover && (!data.history[0] || data.handover.closed_at > data.history[0].closed_at) ? data.handover : null

  return (
    <div className="inv-page">
      {open ? (
        <>
          <section className="dash-stats inv-stats" aria-label="Ringkasan sesi">
            <StatCard icon={Banknote} label="Kas seharusnya di laci" value={formatRupiah(summary.expected_cash)} caption={`Dibuka ${formatTime(open.opened_at)} · modal ${formatRupiah(open.opening_cash)}`} />
            <StatCard icon={Wallet} tone="green" label="Tunai diterima" value={formatRupiah(summary.cash_sales)} caption={summary.cash_refunds ? `Refund tunai −${formatRupiah(summary.cash_refunds)}` : `${summary.orders} pesanan kasir`} />
            <StatCard icon={Wallet} tone="blue" label="Non-tunai" value={formatRupiah(Object.entries(summary.by_method || {}).filter(([method]) => method !== 'cash').reduce((sum, [, value]) => sum + Number(value), 0))}
              caption={Object.entries(summary.by_method || {}).filter(([method]) => method !== 'cash').map(([method, value]) => `${paymentMethodLabel(method)} ${formatRupiah(value)}`).join(' · ') || 'Belum ada'} />
            <StatCard icon={ArrowDownUp} tone="neutral" label="Kas masuk / keluar" value={`${formatRupiah(summary.cash_in)} / ${formatRupiah(summary.cash_out)}`} caption={`${data.movements.length} catatan`} />
          </section>
          <Card padding="none">
            <div className="table-card-head">
              <CardHeader title="Kas masuk & keluar" description="Uang laci di luar penjualan: setoran, belanja kecil, uang kembalian tambahan."
                actions={(
                  <>
                    <Button variant="secondary" icon={ArrowDownUp} onClick={() => setDialog('move')}>Kas masuk/keluar</Button>
                    <Button icon={Lock} onClick={() => setDialog('close')}>Tutup kasir</Button>
                  </>
                )} />
            </div>
            <div className="table-card-body">
              {!data.movements.length ? <p className="text-muted">Belum ada kas masuk/keluar di sesi ini.</p> : (
                <ul className="po-payments">
                  {data.movements.map((move) => (
                    <li key={move.id}>
                      <span className="inv-name"><strong>{move.reason}</strong><small>{formatDateTime(move.created_at)}</small></span>
                      <strong className={`tabular inv-qty${move.direction === 'out' ? ' is-out' : ''}`}>{move.direction === 'out' ? '−' : '+'}{formatRupiah(move.amount)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </>
      ) : (
        <Card>
          <EmptyState icon={Wallet} title="Kasir belum dibuka" description="Buka kasir dengan menghitung modal awal di laci. Tunai di halaman Kasir hanya bisa diterima saat sesi terbuka."
            action={<Button icon={Wallet} onClick={() => setDialog('open')}>Buka kasir</Button>} />
          {lastHandover && (
            <div className="cashier-handover">
              <strong>Serah terima dari {names.get(lastHandover.opened_by) || 'shift sebelumnya'}</strong>
              <span>{formatDateTime(lastHandover.closed_at)} · kas di laci {formatRupiah(lastHandover.counted_cash)}</span>
              {lastHandover.handover_note && <p>{lastHandover.handover_note}</p>}
            </div>
          )}
        </Card>
      )}

      <Card padding="none">
        <div className="table-card-head"><CardHeader title="Riwayat sesi saya" description="30 sesi terakhir" /></div>
        {!data.history.length ? <div className="table-card-body"><p className="text-muted">Belum ada sesi yang ditutup.</p></div> : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th scope="col">Dibuka</th><th scope="col">Ditutup</th><th scope="col" className="num">Seharusnya</th><th scope="col" className="num">Dihitung</th><th scope="col">Selisih</th><th scope="col">Serah terima</th></tr></thead>
              <tbody>
                {data.history.map((row) => (
                  <tr key={row.id}>
                    <td className="tabular">{formatDateTime(row.opened_at)}</td>
                    <td className="tabular">{formatDateTime(row.closed_at)}</td>
                    <td className="num tabular">{formatRupiah(row.expected_cash)}</td>
                    <td className="num tabular">{formatRupiah(row.counted_cash)}</td>
                    <td><DifferenceBadge value={row.difference} /></td>
                    <td>{row.handover_to ? names.get(row.handover_to) || 'Anggota tim' : <span className="text-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dialog === 'open' && <OpenSessionDialog cafeId={cafe.id} suggestion={lastHandover ? Number(lastHandover.counted_cash) : undefined} onClose={() => setDialog(null)} onOpened={() => { setDialog(null); reload() }} />}
      {dialog === 'move' && <CashMoveDialog sessionId={open.id} finance={finance} onClose={() => setDialog(null)} onDone={reload} />}
      {dialog === 'close' && <CloseSessionDialog session={open} summary={summary} team={data.team} onClose={() => setDialog(null)} onClosed={() => { setDialog(null); reload() }} />}
    </div>
  )
}

export function DifferenceBadge({ value }) {
  const number = Number(value)
  if (value === null || value === undefined) return <span className="text-muted">—</span>
  if (Math.abs(number) < 1) return <Badge tone="green" size="sm">Sesuai</Badge>
  return <Badge tone={number < 0 ? 'red' : 'amber'} size="sm">{number > 0 ? '+' : ''}{formatRupiah(number)}</Badge>
}
