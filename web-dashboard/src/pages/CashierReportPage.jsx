/*
 * Owner: laporan sesi kasir (selisih kas, serah terima) dan persetujuan refund.
 */
import { useCallback, useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Banknote, Check, RotateCcw, Wallet, X } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import {
  Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, PageHeader, SegmentedControl, SkeletonRows, StatCard, TextField, useToast,
} from '../components/ui/index.js'
import { DifferenceBadge } from './staff/CashierPage.jsx'
import { friendlyError, POS_REQUIRED } from '../lib/db.js'
import { formatDateTime, formatNumber, formatQueueNumber, formatRupiah, jakartaDateKey } from '../lib/format.js'
import { useLoader } from '../lib/inventory.js'
import { rpc } from '../lib/pos.js'
import { paymentMethodLabel } from '../lib/status.js'
import { fetchTeam } from '../lib/team.js'

export function CashierReportPage() {
  const context = useOutletContext()
  return (
    <div className="page page-wide">
      <PageHeader eyebrow="Penjualan" title="Kasir & refund" description="Sesi kasir setiap staff, selisih kas, serah terima shift, dan refund yang menunggu persetujuan." />
      {context.features?.pos ? <CashierReport cafe={context.cafe} /> : <Card><EmptyState title="Belum tersedia" description={POS_REQUIRED} /></Card>}
    </div>
  )
}

function CashierReport({ cafe }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'refunds' ? 'refunds' : 'sessions'
  const [openSession, setOpenSession] = useState(null)
  const [decision, setDecision] = useState(null)

  const load = useCallback(async () => {
    const [sessions, refunds, team] = await Promise.all([
      supabase.from('cashier_sessions').select('*').eq('cafe_id', cafe.id).order('opened_at', { ascending: false }).limit(200),
      supabase.from('refunds').select('*').eq('cafe_id', cafe.id).order('requested_at', { ascending: false }).limit(200),
      fetchTeam(supabase, cafe.id).catch(() => []),
    ])
    const failure = sessions.error || refunds.error
    if (failure) throw new Error(friendlyError(failure))
    const orderIds = [...new Set((refunds.data || []).map((refund) => refund.order_id))]
    const orders = orderIds.length
      ? (await supabase.from('orders').select('id, queue_number, order_number, created_at, total_amount, paid_amount, refunded_amount').in('id', orderIds)).data || []
      : []
    return { sessions: sessions.data || [], refunds: refunds.data || [], team, orders: new Map(orders.map((order) => [order.id, order])) }
  }, [cafe.id, supabase])
  const { data, error, reload, loading } = useLoader(load)

  const names = useMemo(() => new Map((data?.team || []).map((member) => [member.id, member.full_name || 'Tanpa nama'])), [data])
  if (error) return <Card><ErrorState message={error} onRetry={reload} /></Card>
  if (!data) return <Card padding="none"><SkeletonRows rows={6} label="Memuat kasir" /></Card>

  const pending = data.refunds.filter((refund) => refund.status === 'requested')
  const open = data.sessions.filter((session) => session.status === 'open')
  const closed = data.sessions.filter((session) => session.status === 'closed')
  const shortage = closed.filter((session) => Number(session.difference) <= -1)
  const thisMonth = jakartaDateKey().slice(0, 7)
  const refundedMonth = data.refunds.filter((refund) => refund.status === 'approved' && String(refund.requested_at).startsWith(thisMonth))

  async function decide(refund, approve, note) {
    await rpc(supabase, 'refund_decide', { p_refund_id: refund.id, p_approve: approve, p_note: note || null })
    toast({ tone: approve ? 'success' : 'info', title: approve ? `Refund ${formatRupiah(refund.amount)} disetujui` : 'Refund ditolak' })
    setDecision(null)
    reload()
  }

  return (
    <div className={`inv-page${loading ? ' is-refreshing' : ''}`}>
      <section className="dash-stats inv-stats" aria-label="Ringkasan kasir">
        <StatCard icon={RotateCcw} label="Refund menunggu" value={formatNumber(pending.length)} caption={pending.length ? formatRupiah(pending.reduce((sum, refund) => sum + Number(refund.amount), 0)) : 'Tidak ada'}
          onClick={pending.length ? () => setParams({ tab: 'refunds' }) : undefined} />
        <StatCard icon={Wallet} tone="blue" label="Kasir terbuka" value={formatNumber(open.length)} caption={open.map((session) => names.get(session.opened_by)).filter(Boolean).join(', ') || 'Semua tutup'} />
        <StatCard icon={AlertTriangle} tone="amber" label="Sesi kurang kas" value={formatNumber(shortage.length)}
          caption={shortage.length ? `Total ${formatRupiah(shortage.reduce((sum, session) => sum + Number(session.difference), 0))}` : 'Dari 200 sesi terakhir'} />
        <StatCard icon={Banknote} tone="neutral" label="Refund bulan ini" value={formatRupiah(refundedMonth.reduce((sum, refund) => sum + Number(refund.amount), 0))} caption={`${refundedMonth.length} disetujui`} />
      </section>

      <SegmentedControl label="Bagian" value={tab} onChange={(value) => setParams(value === 'refunds' ? { tab: 'refunds' } : {})}
        options={[{ value: 'sessions', label: 'Sesi kasir' }, { value: 'refunds', label: 'Refund', count: pending.length || undefined }]} />

      {tab === 'sessions' ? (
        <Card padding="none" className="table-card">
          {!data.sessions.length ? <EmptyState compact icon={Wallet} title="Belum ada sesi kasir" description="Staff membuka kasir dari menu Sesi kasir di web staff." /> : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr><th scope="col">Kasir</th><th scope="col">Dibuka</th><th scope="col">Ditutup</th><th scope="col" className="num">Modal</th>
                    <th scope="col" className="num">Seharusnya</th><th scope="col" className="num">Dihitung</th><th scope="col">Selisih</th></tr>
                </thead>
                <tbody>
                  {data.sessions.map((session) => (
                    <tr key={session.id} className="is-clickable" onClick={() => setOpenSession(session)}>
                      <td><strong>{names.get(session.opened_by) || 'Anggota tim'}</strong>{session.handover_to && <small className="cell-sub">serah terima ke {names.get(session.handover_to) || 'anggota tim'}</small>}</td>
                      <td className="tabular">{formatDateTime(session.opened_at)}</td>
                      <td>{session.status === 'open' ? <Badge tone="blue" size="sm">Masih buka</Badge> : <span className="tabular">{formatDateTime(session.closed_at)}</span>}</td>
                      <td className="num tabular">{formatRupiah(session.opening_cash)}</td>
                      <td className="num tabular">{session.expected_cash === null ? '—' : formatRupiah(session.expected_cash)}</td>
                      <td className="num tabular">{session.counted_cash === null ? '—' : formatRupiah(session.counted_cash)}</td>
                      <td><DifferenceBadge value={session.difference} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card padding="none" className="table-card">
          {!data.refunds.length ? <EmptyState compact icon={RotateCcw} title="Belum ada refund" description="Staff mengajukan refund dari detail pesanan; persetujuannya muncul di sini." /> : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr><th scope="col">Pesanan</th><th scope="col">Alasan</th><th scope="col">Diajukan</th><th scope="col" className="num">Nominal</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Aksi</span></th></tr>
                </thead>
                <tbody>
                  {data.refunds.map((refund) => {
                    const order = data.orders.get(refund.order_id)
                    return (
                      <tr key={refund.id}>
                        <td><strong className="tabular">{order ? formatQueueNumber(order) : '—'}</strong>{order && <small className="cell-sub">dibayar {formatRupiah(order.paid_amount)}</small>}</td>
                        <td>{refund.reason}<small className="cell-sub">{paymentMethodLabel(refund.method)}{refund.restock ? ' · bahan kembali ke stok' : ''}</small></td>
                        <td>{names.get(refund.requested_by) || 'Anggota tim'}<small className="cell-sub tabular">{formatDateTime(refund.requested_at)}</small></td>
                        <td className="num tabular"><strong>{formatRupiah(refund.amount)}</strong></td>
                        <td>
                          {refund.status === 'requested' ? <Badge tone="amber" size="sm">Menunggu</Badge>
                            : refund.status === 'approved' ? <Badge tone="green" size="sm">Disetujui</Badge>
                              : <Badge tone="neutral" size="sm" title={refund.decision_note || undefined}>Ditolak</Badge>}
                        </td>
                        <td className="cell-actions">
                          {refund.status === 'requested' && (
                            <span className="pos-held-actions">
                              <Button size="sm" variant="ghost" icon={X} onClick={() => setDecision({ refund, approve: false })}>Tolak</Button>
                              <Button size="sm" icon={Check} onClick={() => setDecision({ refund, approve: true })}>Setujui</Button>
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {openSession && <SessionDrawer session={openSession} names={names} onClose={() => setOpenSession(null)} />}
      {decision && <DecisionDialog decision={decision} onClose={() => setDecision(null)} onDecide={decide} />}
    </div>
  )
}

function DecisionDialog({ decision, onClose, onDecide }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const { refund, approve } = decision
  return (
    <ConfirmDialog
      tone={approve ? 'primary' : 'danger'}
      title={approve ? `Setujui refund ${formatRupiah(refund.amount)}?` : 'Tolak refund?'}
      description={approve
        ? `Uang dikembalikan lewat ${paymentMethodLabel(refund.method)}${refund.restock ? ' dan bahan dikembalikan ke stok' : ''}. Tercatat di pesanan dan sesi kasir.`
        : 'Pengaju melihat alasan penolakan di detail pesanan.'}
      confirmLabel={approve ? 'Setujui refund' : 'Tolak'}
      onClose={onClose}
      onConfirm={async () => {
        if (!approve && note.trim().length < 3) {
          setError('Tulis alasan penolakan')
          return false
        }
        await onDecide(refund, approve, note.trim())
        return true
      }}
    >
      <TextField label={approve ? 'Catatan (opsional)' : 'Alasan penolakan'} value={note} maxLength={300} error={error} onChange={(event) => { setNote(event.target.value); setError('') }} />
    </ConfirmDialog>
  )
}

function SessionDrawer({ session, names, onClose }) {
  const { supabase } = useAuth()
  const load = useCallback(async () => {
    const [summary, movements] = await Promise.all([
      rpc(supabase, 'cashier_summary', { p_session_id: session.id }),
      supabase.from('cash_movements').select('id, direction, amount, reason, created_at').eq('session_id', session.id).order('created_at'),
    ])
    return { summary, movements: movements.data || [] }
  }, [session.id, supabase])
  const { data, error, reload } = useLoader(load)
  return (
    <Drawer title={`Kasir ${names.get(session.opened_by) || ''}`} description={`${formatDateTime(session.opened_at)}${session.closed_at ? ` – ${formatDateTime(session.closed_at)}` : ' · masih buka'}`} onClose={onClose}>
      {error ? <ErrorState compact message={error} onRetry={reload} /> : !data ? <SkeletonRows rows={5} label="Memuat sesi" /> : (
        <>
          <dl className="inv-facts">
            <div><dt>Modal awal</dt><dd className="tabular">{formatRupiah(data.summary.opening_cash)}</dd></div>
            <div><dt>Tunai diterima</dt><dd className="tabular">{formatRupiah(data.summary.cash_sales)}</dd></div>
            <div><dt>Kas masuk / keluar</dt><dd className="tabular">{formatRupiah(data.summary.cash_in)} / {formatRupiah(data.summary.cash_out)}</dd></div>
            <div><dt>Refund tunai</dt><dd className="tabular">{formatRupiah(data.summary.cash_refunds)}</dd></div>
            <div><dt>Kas seharusnya</dt><dd className="tabular">{formatRupiah(data.summary.expected_cash)}</dd></div>
            <div><dt>Dihitung</dt><dd className="tabular">{data.summary.counted_cash === null ? '—' : formatRupiah(data.summary.counted_cash)} <DifferenceBadge value={data.summary.difference} /></dd></div>
            <div><dt>Pesanan kasir</dt><dd className="tabular">{data.summary.orders} · diskon {formatRupiah(data.summary.discounts)}</dd></div>
            <div><dt>Per metode</dt><dd>{Object.entries(data.summary.by_method || {}).map(([method, value]) => `${paymentMethodLabel(method)} ${formatRupiah(value)}`).join(' · ') || '—'}</dd></div>
          </dl>
          {session.closing_note && <p className="inv-note-box">Catatan tutup: {session.closing_note}</p>}
          {session.handover_to && (
            <p className="inv-note-box">Serah terima ke {names.get(session.handover_to) || 'anggota tim'}{session.active_orders_at_close ? ` · ${session.active_orders_at_close} pesanan aktif saat itu` : ''}{session.handover_note ? ` — ${session.handover_note}` : ''}</p>
          )}
          <section className="inv-section">
            <h3>Kas masuk & keluar</h3>
            {!data.movements.length ? <p className="text-muted">Tidak ada.</p> : (
              <ul className="po-payments">
                {data.movements.map((move) => (
                  <li key={move.id}>
                    <span className="inv-name"><strong>{move.reason}</strong><small>{formatDateTime(move.created_at)}</small></span>
                    <strong className={`tabular inv-qty${move.direction === 'out' ? ' is-out' : ''}`}>{move.direction === 'out' ? '−' : '+'}{formatRupiah(move.amount)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Drawer>
  )
}
