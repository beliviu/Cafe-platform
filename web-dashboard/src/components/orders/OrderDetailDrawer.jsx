import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Ban, CircleDollarSign, MessageSquareText, Printer, ReceiptText, RotateCcw, UserRound } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Badge, Button, Drawer, ErrorState, OrderStatusBadge, PaymentBadge, SkeletonText } from '../ui/index.js'
import { brandOf } from '../../lib/branding.js'
import { customerLabel, friendlyError } from '../../lib/db.js'
import { formatDateTime, formatOrderReference, formatQueueNumber, formatRupiah } from '../../lib/format.js'
import { printReceipt } from '../../lib/printReceipt.js'
import {
  ACTIVE_ORDER_STATUSES, ORDER_FLOW, ORDER_SOURCE, ORDER_TYPE_LABEL, orderStatusMeta, paymentMethodLabel, paymentStatusMeta,
} from '../../lib/status.js'
import { CancelOrderDialog } from './CancelOrderDialog.jsx'
import { MarkPaidDialog } from './MarkPaidDialog.jsx'
import { RefundDialog } from './RefundDialog.jsx'

const REFUND_STATUS = { requested: { label: 'Menunggu owner', tone: 'amber' }, approved: { label: 'Disetujui', tone: 'green' }, rejected: { label: 'Ditolak', tone: 'neutral' } }
const methodList = (note) => String(note || '').split('+').filter(Boolean).map(paymentMethodLabel).join(' + ')

const teamCache = new Map()

/** Map user id → nama tim kafe (RPC cafe_team_members), di-cache per kafe. */
function fetchTeamNames(supabase, cafeId) {
  if (!teamCache.has(cafeId)) {
    teamCache.set(cafeId, supabase.rpc('cafe_team_members', { p_cafe_id: cafeId })
      .then(({ data, error }) => (error ? new Map() : new Map((data || []).map((member) => [member.id, member.full_name || (member.role === 'owner' ? 'Owner' : 'Staff')]))))
      .catch(() => new Map()))
  }
  return teamCache.get(cafeId)
}

function eventLabel(event) {
  if (event.event_type === 'payment' && event.to_status === 'partial') return `Dibayar sebagian · ${methodList(event.note)}`
  if (event.event_type === 'payment') return `Lunas · ${methodList(event.note)}`
  if (event.event_type === 'refund') return `Refund disetujui${event.note ? ` · ${event.note}` : ''}`
  if (!event.from_status) return 'Pesanan dibuat'
  return orderStatusMeta(event.to_status).label
}

function eventTone(event) {
  if (event.event_type === 'refund') return 'neutral'
  if (event.event_type === 'payment') return 'green'
  if (!event.from_status) return 'amber'
  return orderStatusMeta(event.to_status).tone
}

/** Linimasa dari order_status_events; pesanan lama (sebelum pembaruan) memakai versi ringkas. */
function Timeline({ order, events, teamNames }) {
  if (!events.length) {
    const current = orderStatusMeta(order.order_status)
    return (
      <ol className="timeline">
        <li className="timeline-item tone-amber"><span className="timeline-dot" /><span><strong>Pesanan dibuat</strong><small>{formatDateTime(order.created_at)}</small></span></li>
        {order.order_status !== 'pending' && (
          <li className={`timeline-item tone-${current.tone}`}><span className="timeline-dot" /><span><strong>{current.label}</strong><small>Waktu tidak tercatat (pesanan sebelum riwayat status aktif)</small></span></li>
        )}
        {order.paid_at && (
          <li className="timeline-item tone-green"><span className="timeline-dot" /><span><strong>Ditandai lunas · {paymentMethodLabel(order.payment_method)}</strong><small>{formatDateTime(order.paid_at)}</small></span></li>
        )}
      </ol>
    )
  }

  const reached = new Set(events.filter((event) => event.event_type === 'status').map((event) => event.to_status))
  const remaining = order.order_status === 'cancelled' ? [] : ORDER_FLOW.filter((status) => !reached.has(status) && status !== 'pending')

  return (
    <ol className="timeline">
      {events.map((event) => (
        <li key={event.id} className={`timeline-item tone-${eventTone(event)}`}>
          <span className="timeline-dot" />
          <span>
            <strong>{eventLabel(event)}</strong>
            <small>
              {formatDateTime(event.created_at)}
              {event.changed_by && teamNames.get(event.changed_by) ? ` · oleh ${teamNames.get(event.changed_by)}` : ''}
            </small>
            {event.to_status === 'cancelled' && event.note && <em className="timeline-note">Alasan: {event.note}</em>}
          </span>
        </li>
      ))}
      {remaining.map((status) => (
        <li key={status} className="timeline-item is-upcoming"><span className="timeline-dot" /><span><strong>{orderStatusMeta(status).label}</strong><small>Belum</small></span></li>
      ))}
    </ol>
  )
}

/**
 * Detail pesanan: item + catatan, pembayaran, linimasa status, dan aksi (lunas / batalkan).
 * onChanged(updatedOrder) dipanggil setelah aksi berhasil.
 */
export function OrderDetailDrawer({ order, cafe, features, onClose, onChanged, actions, onPrint }) {
  const { supabase } = useAuth()
  const outlet = useOutletContext()
  const isOwner = outlet?.profile?.role === 'owner'
  const [state, setState] = useState({ loading: true, error: '', items: [], payments: [], events: [], refunds: [], teamNames: new Map() })
  const [attempt, setAttempt] = useState(0)
  const [dialog, setDialog] = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      const [itemsResult, paymentsResult, eventsResult, teamNames, refundsResult] = await Promise.all([
        supabase.from('order_items').select('id, product_name, price, quantity, subtotal, notes').eq('order_id', order.id).order('created_at', { ascending: true }),
        supabase.from('payments').select(`id, method, payment_method, status, payment_status, amount, paid_at, created_at${features?.pos ? ', reference, tendered_amount, change_amount, refund_id, recorded_by' : ''}`).eq('order_id', order.id).order('created_at', { ascending: true }),
        features?.operations
          ? supabase.from('order_status_events').select('id, event_type, from_status, to_status, note, changed_by, created_at').eq('order_id', order.id).order('created_at', { ascending: true }).order('id', { ascending: true })
          : Promise.resolve({ data: [], error: null }),
        features?.operations ? fetchTeamNames(supabase, cafe.id) : Promise.resolve(new Map()),
        features?.pos
          ? supabase.from('refunds').select('id, amount, method, reason, status, restock, requested_by, requested_at, decided_by, decision_note').eq('order_id', order.id).order('requested_at', { ascending: true })
          : Promise.resolve({ data: [], error: null }),
      ])
      if (!active) return
      const error = itemsResult.error || paymentsResult.error
      setState({
        loading: false,
        error: error ? friendlyError(error) : '',
        items: itemsResult.data || [],
        payments: paymentsResult.data || [],
        events: eventsResult.error ? [] : eventsResult.data || [],
        refunds: refundsResult.error ? [] : refundsResult.data || [],
        teamNames,
      })
    }
    load()
    return () => { active = false }
  }, [attempt, cafe.id, features?.operations, features?.pos, order.id, order.order_status, order.payment_status, order.refunded_amount, supabase])

  const canPay = features?.operations && order.payment_status !== 'paid' && order.payment_status !== 'refunded' && order.order_status !== 'cancelled'
  const refundable = Number(order.paid_amount || 0) - Number(order.refunded_amount || 0)
  const pendingRefund = state.refunds.some((refund) => refund.status === 'requested')
  const canRefund = features?.pos && refundable > 0 && !pendingRefund
  const v2 = Number(order.pricing_version) >= 2

  async function handlePrintReceipt() {
    const { data: settings } = await supabase.from('cafe_settings').select('*').eq('cafe_id', cafe.id).maybeSingle()
    printReceipt({ order, items: state.items, payments: state.payments, cafe, settings: settings || {}, brand: brandOf(cafe) })
  }
  const canCancel = features?.operations && ACTIVE_ORDER_STATUSES.includes(order.order_status)
  const itemTotal = state.items.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0)

  return (
    <>
      <Drawer
        title={`Pesanan ${formatQueueNumber(order)}`}
        description={`${customerLabel(order)} · ${formatDateTime(order.created_at)}`}
        onClose={onClose}
        headerExtra={(
          <div className="order-drawer-badges">
            <OrderStatusBadge status={order.order_status} />
            <PaymentBadge status={order.payment_status} method={order.payment_method} showMethod={order.payment_status === 'paid'} />
          </div>
        )}
        footer={(canPay || canCancel || canRefund || actions || onPrint || features?.pos) ? (
          <>
            {onPrint && (
              <Button variant="ghost" icon={Printer} className="order-drawer-print" disabled={state.loading}
                onClick={() => onPrint({ ...order, items: state.items })}>Label</Button>
            )}
            {features?.pos && (
              <Button variant="ghost" icon={ReceiptText} className={onPrint ? '' : 'order-drawer-print'} disabled={state.loading} onClick={handlePrintReceipt}>Struk</Button>
            )}
            {canRefund && <Button variant="ghost" icon={RotateCcw} onClick={() => setDialog('refund')}>{isOwner ? 'Refund' : 'Ajukan refund'}</Button>}
            {canCancel && <Button variant="danger-soft" icon={Ban} onClick={() => setDialog('cancel')}>Batalkan</Button>}
            {canPay && <Button variant={actions ? 'secondary' : 'primary'} icon={CircleDollarSign} onClick={() => setDialog('pay')}>Tandai lunas</Button>}
            {actions}
          </>
        ) : null}
      >
        {state.loading ? (
          <SkeletonText lines={6} />
        ) : state.error ? (
          <ErrorState compact message={state.error} onRetry={() => { setState((current) => ({ ...current, loading: true })); setAttempt((value) => value + 1) }} />
        ) : (
          <div className="order-detail-v2">
            <dl className="order-facts">
              <div><dt>Customer</dt><dd><UserRound size={14} aria-hidden="true" /> {customerLabel(order)}</dd></div>
              {order.source && (
                <div><dt>Sumber</dt><dd>{ORDER_SOURCE[order.source] || order.source}{order.order_type ? ` · ${ORDER_TYPE_LABEL[order.order_type]}` : ''}{order.table_label ? ` · Meja ${order.table_label}` : ''}</dd></div>
              )}
              <div><dt>Referensi</dt><dd className="tabular">{formatOrderReference(order)}</dd></div>
              <div><dt>Pembayaran</dt><dd>{paymentStatusMeta(order.payment_status).label} · {paymentMethodLabel(order.payment_method)}</dd></div>
              <div><dt>Lunas pada</dt><dd>{order.paid_at ? formatDateTime(order.paid_at) : '—'}</dd></div>
            </dl>

            {order.order_status === 'cancelled' && order.cancel_reason && (
              <p className="order-cancel-note"><Ban size={15} aria-hidden="true" /> Dibatalkan: {order.cancel_reason}</p>
            )}

            <section className="order-section">
              <h3>Item pesanan</h3>
              {state.items.length ? (
                <ul className="order-items-v2">
                  {state.items.map((item) => (
                    <li key={item.id}>
                      <span className="order-item-qty tabular">{item.quantity}×</span>
                      <span className="order-item-name">
                        <strong>{item.product_name}</strong>
                        <small className="tabular">@ {formatRupiah(item.price)}</small>
                        {item.notes && <span className="order-item-note"><MessageSquareText size={13} aria-hidden="true" /> {item.notes}</span>}
                      </span>
                      <span className="tabular">{formatRupiah(item.subtotal)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="settings-note">Tidak ada item tercatat.</p>}
              {v2 && (
                <dl className="order-breakdown">
                  <div><dt>Subtotal</dt><dd className="tabular">{formatRupiah(order.subtotal_amount)}</dd></div>
                  {Number(order.discount_amount) > 0 && <div><dt>Diskon{order.discount_reason ? ` · ${order.discount_reason}` : ''}</dt><dd className="tabular">−{formatRupiah(order.discount_amount)}</dd></div>}
                  {Number(order.service_charge_amount) > 0 && <div><dt>Service</dt><dd className="tabular">{formatRupiah(order.service_charge_amount)}</dd></div>}
                  {Number(order.tax_amount) > 0 && <div><dt>Pajak{order.tax_inclusive ? ' (termasuk harga)' : ''}</dt><dd className="tabular">{formatRupiah(order.tax_amount)}</dd></div>}
                  {Number(order.rounding_amount) !== 0 && <div><dt>Pembulatan</dt><dd className="tabular">{formatRupiah(order.rounding_amount)}</dd></div>}
                </dl>
              )}
              <div className="order-total-v2">
                <span>Total</span>
                <strong className="tabular">{formatRupiah(order.total_amount)}</strong>
              </div>
              {v2 && Number(order.refunded_amount) > 0 && (
                <p className="settings-note">Sudah direfund {formatRupiah(order.refunded_amount)} dari {formatRupiah(order.paid_amount)} yang dibayar.</p>
              )}
              {!v2 && state.items.length > 0 && Math.round(itemTotal) !== Math.round(Number(order.total_amount) || 0) && (
                <p className="settings-note">Total item ({formatRupiah(itemTotal)}) berbeda dari total pesanan — data lama atau ada penyesuaian.</p>
              )}
            </section>

            {order.notes && (
              <section className="order-section">
                <h3>Catatan customer</h3>
                <p className="order-note-v2">{order.notes}</p>
              </section>
            )}

            <section className="order-section">
              <h3>Linimasa</h3>
              <Timeline order={order} events={state.events} teamNames={state.teamNames} />
            </section>

            {state.payments.length > 0 && (
              <section className="order-section">
                <h3>Catatan pembayaran</h3>
                <ul className="order-payments">
                  {state.payments.map((payment) => {
                    const status = payment.payment_status || payment.status
                    const extra = [
                      payment.reference && payment.reference !== 'refund' ? `Ref ${payment.reference}` : '',
                      Number(payment.tendered_amount) ? `diterima ${formatRupiah(payment.tendered_amount)}` : '',
                      Number(payment.change_amount) ? `kembali ${formatRupiah(payment.change_amount)}` : '',
                    ].filter(Boolean).join(' · ')
                    return (
                      <li key={payment.id}>
                        <span>
                          <strong>{payment.refund_id ? 'Refund · ' : ''}{paymentMethodLabel(payment.payment_method || payment.method)}</strong>
                          <small>{formatDateTime(payment.paid_at || payment.created_at)}{extra ? ` · ${extra}` : ''}</small>
                        </span>
                        <Badge tone={paymentStatusMeta(status).tone} size="sm">{paymentStatusMeta(status).label}</Badge>
                        <span className="tabular">{formatRupiah(payment.amount)}</span>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}
            {state.refunds.length > 0 && (
              <section className="order-section">
                <h3>Refund</h3>
                <ul className="order-payments">
                  {state.refunds.map((refund) => (
                    <li key={refund.id}>
                      <span>
                        <strong>{refund.reason}</strong>
                        <small>
                          {paymentMethodLabel(refund.method)} · diajukan {state.teamNames.get(refund.requested_by) || ''} {formatDateTime(refund.requested_at)}
                          {refund.restock ? ' · bahan dikembalikan' : ''}{refund.decision_note ? ` · ${refund.decision_note}` : ''}
                        </small>
                      </span>
                      <Badge tone={REFUND_STATUS[refund.status].tone} size="sm">{REFUND_STATUS[refund.status].label}</Badge>
                      <span className="tabular">{formatRupiah(refund.amount)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {!features?.operations && (
              <p className="settings-note">Linimasa lengkap, tandai lunas, dan pembatalan aktif setelah pembaruan database diterapkan.</p>
            )}
          </div>
        )}
      </Drawer>

      {dialog === 'pay' && (
        <MarkPaidDialog
          order={order}
          cafe={cafe}
          onClose={() => setDialog(null)}
          onPaid={(updated) => { setDialog(null); onChanged?.(updated, 'paid') }}
        />
      )}
      {dialog === 'refund' && (
        <RefundDialog order={order} items={state.items} isOwner={isOwner} onClose={() => setDialog(null)}
          onDone={(refund) => {
            setDialog(null)
            setAttempt((value) => value + 1)
            if (refund.status === 'approved') {
              const refunded = Number(order.refunded_amount || 0) + Number(refund.amount)
              onChanged?.({ ...order, refunded_amount: refunded, payment_status: refunded >= Number(order.paid_amount) - 0.005 ? 'refunded' : order.payment_status }, 'refunded')
            }
          }} />
      )}
      {dialog === 'cancel' && (
        <CancelOrderDialog
          order={order}
          onClose={() => setDialog(null)}
          onCancelled={(updated) => { setDialog(null); onChanged?.(updated, 'cancelled') }}
        />
      )}
    </>
  )
}
