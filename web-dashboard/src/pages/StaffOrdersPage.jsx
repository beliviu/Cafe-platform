import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Bell, Check, CheckCircle2, CircleDollarSign, Clock3, CookingPot, Eye, Inbox, RefreshCw, ShoppingBag, Wallet, X, XCircle } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import { PageHeader } from '../components/PageHeader.jsx'
import { CancelOrderDialog } from '../components/orders/CancelOrderDialog.jsx'
import { MarkPaidDialog } from '../components/orders/MarkPaidDialog.jsx'
import {
  Button, ConfirmDialog, Drawer, EmptyState, ErrorState, IconButton, OrderStatusBadge, PaymentBadge,
  SegmentedControl, Select, SkeletonRows, StatCard, useToast,
} from '../components/ui/index.js'
import { resolveRange } from '../lib/dateRange.js'
import { customerLabel, DB_UPDATE_REQUIRED, fetchCustomerNames, fetchOrderItems, friendlyError, orderColumns } from '../lib/db.js'
import {
  formatDateTime, formatNumber, formatOrderReference, formatQueueNumber, formatRupiah, formatTime, jakartaDateKey, startOfJakartaDay,
} from '../lib/format.js'
import { advanceOrderStatus } from '../lib/orderActions.js'
import { ACTIVE_ORDER_STATUSES, NEXT_ORDER_STATUS, orderStatusMeta, paymentMethodLabel } from '../lib/status.js'

const ACTION_LABEL = {
  confirmed: 'Konfirmasi',
  preparing: 'Mulai buat',
  ready: 'Tandai siap',
  completed: 'Selesai',
}
const HISTORY_RANGES = [
  { value: 'today', label: 'Hari ini' },
  { value: '7d', label: '7 hari' },
  { value: '30d', label: '30 hari' },
]
const HISTORY_STATUSES = [['all', 'Semua status'], ['completed', 'Selesai'], ['cancelled', 'Dibatalkan']]

const canPay = (order, features) => features?.operations && order.payment_status !== 'paid' && order.order_status !== 'cancelled'
const canCancel = (order, features) => features?.operations && ACTIVE_ORDER_STATUSES.includes(order.order_status)

function OrderDetails({ order, features }) {
  return (
    <div className="staff-order-detail">
      <div className="staff-detail-topline">
        <OrderStatusBadge status={order.order_status} />
        <PaymentBadge status={order.payment_status} method={order.payment_method} showMethod={order.payment_status === 'paid'} />
      </div>
      <section className="staff-detail-block">
        <h3>Informasi pesanan</h3>
        <div className="staff-detail-pair"><span>Customer</span><strong>{customerLabel(order)}</strong></div>
        <div className="staff-detail-pair"><span>Waktu masuk</span><strong>{formatDateTime(order.created_at)}</strong></div>
        <div className="staff-detail-pair"><span>Metode bayar</span><strong>{paymentMethodLabel(order.payment_method)}</strong></div>
        {order.paid_at && <div className="staff-detail-pair"><span>Dibayar</span><strong>{formatDateTime(order.paid_at)}</strong></div>}
        <div className="staff-detail-pair"><span>No. referensi</span><strong className="tabular">{formatOrderReference(order)}</strong></div>
      </section>
      <section className="staff-detail-block">
        <h3>Item pesanan</h3>
        {order.items.map((item) => (
          <div className="staff-detail-item" key={item.id}>
            <div>
              <strong>{item.quantity}× {item.product_name}</strong>
              <span>{formatRupiah(item.price)} / item</span>
              {item.notes && <span className="staff-item-note">{item.notes}</span>}
            </div>
            <strong className="tabular">{formatRupiah(item.subtotal)}</strong>
          </div>
        ))}
        {!order.items.length && <p className="detail-muted">Item pesanan tidak tersedia.</p>}
        <div className="order-total-row"><span>Total</span><strong className="tabular">{formatRupiah(order.total_amount)}</strong></div>
      </section>
      {order.notes && (
        <section className="staff-detail-block">
          <h3>Catatan customer</h3>
          <p className="order-note">{order.notes}</p>
        </section>
      )}
      {order.cancel_reason && (
        <section className="staff-detail-block">
          <h3>Alasan dibatalkan</h3>
          <p className="order-note">{order.cancel_reason}</p>
        </section>
      )}
      {!features?.operations && order.payment_status !== 'paid' && order.order_status !== 'cancelled' && (
        <p className="detail-muted">Tandai lunas &amp; batalkan: {DB_UPDATE_REQUIRED}</p>
      )}
    </div>
  )
}

function OrderCard({ order, features, busy, onOpen, onAdvance, onPay }) {
  const nextStatus = NEXT_ORDER_STATUS[order.order_status]
  return (
    <article className="staff-order-card">
      <header className="staff-order-card-header">
        <div>
          <h2 className="tabular">{formatQueueNumber(order)}</h2>
          <span className="staff-order-label">{customerLabel(order)} · {formatTime(order.created_at)}</span>
        </div>
        <OrderStatusBadge status={order.order_status} />
      </header>
      <div className="staff-order-items">
        {order.items.slice(0, 4).map((item) => (
          <div className="staff-order-item" key={item.id}>
            <span><b>{item.quantity}×</b> {item.product_name}</span>
          </div>
        ))}
        {order.items.length > 4 && <span className="staff-more-items">+{order.items.length - 4} item lainnya</span>}
        {!order.items.length && <span className="staff-more-items">Detail item belum tersedia</span>}
        {order.notes && <span className="staff-item-note">Catatan: {order.notes}</span>}
      </div>
      <div className="staff-order-total">
        <PaymentBadge status={order.payment_status} method={order.payment_method} showMethod={order.payment_status === 'paid'} size="sm" />
        <strong className="tabular">{formatRupiah(order.total_amount)}</strong>
      </div>
      <footer className="staff-order-actions">
        <IconButton icon={Eye} label={`Detail pesanan ${formatQueueNumber(order)}`} variant="secondary" onClick={() => onOpen(order)} />
        {canPay(order, features) && (
          <Button variant="secondary" icon={Wallet} onClick={() => onPay(order)} disabled={busy}>Lunas</Button>
        )}
        {nextStatus && (
          <Button icon={Check} loading={busy} onClick={() => onAdvance(order)} className="staff-advance-button">
            {ACTION_LABEL[nextStatus]}
          </Button>
        )}
      </footer>
    </article>
  )
}

export function StaffOrdersPage({ historyOnly = false }) {
  const { cafe, features } = useOutletContext()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [historyRange, setHistoryRange] = useState('7d')
  const [historyStatus, setHistoryStatus] = useState('all')
  const [realtimeState, setRealtimeState] = useState('connecting')
  const [newOrderNotice, setNewOrderNotice] = useState('')
  const [busyOrderId, setBusyOrderId] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [dialog, setDialog] = useState(null)
  const knownOrderIds = useRef(null)
  const noticeTimer = useRef(null)

  const loadOrders = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setLoadError('')

    let query = supabase.from('orders').select(orderColumns(features)).eq('cafe_id', cafe.id).order('created_at', { ascending: false })
    if (historyOnly) {
      const range = resolveRange(historyRange)
      query = query
        .in('order_status', ['completed', 'cancelled'])
        .gte('created_at', range.start.toISOString())
        .lt('created_at', range.endExclusive.toISOString())
        .limit(500)
    } else {
      const todayStart = startOfJakartaDay(jakartaDateKey()).toISOString()
      query = query.or(`order_status.in.(${ACTIVE_ORDER_STATUSES.join(',')}),created_at.gte.${todayStart}`).limit(300)
    }

    const { data: rawOrders, error } = await query
    if (error) {
      setLoadError(friendlyError(error))
      setLoading(false)
      return
    }

    const ids = rawOrders.map((order) => order.id)
    const [{ names, error: namesError }, { byOrder, error: itemsError }] = await Promise.all([
      fetchCustomerNames(supabase, ids),
      fetchOrderItems(supabase, ids),
    ])
    if (namesError || itemsError) {
      setLoadError(friendlyError(namesError || itemsError))
      setLoading(false)
      return
    }

    setOrders(rawOrders.map((order) => ({ ...order, customer_name: names.get(order.id) || '', items: byOrder.get(order.id) || [] })))
    knownOrderIds.current = new Set(ids)
    setLoading(false)
  }, [cafe.id, features, historyOnly, historyRange, supabase])

  useEffect(() => {
    const timer = window.setTimeout(() => loadOrders(), 0)
    return () => window.clearTimeout(timer)
  }, [attempt, loadOrders])

  useEffect(() => {
    const channel = supabase
      .channel(`staff-orders-${cafe.id}-${historyOnly ? 'history' : 'live'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `cafe_id=eq.${cafe.id}` }, (payload) => {
        if (!historyOnly && payload.eventType === 'INSERT') {
          const incoming = payload.new
          const alreadyKnown = knownOrderIds.current?.has(incoming.id)
          knownOrderIds.current?.add(incoming.id)
          if (!alreadyKnown && incoming.order_status === 'pending') {
            const notice = `Pesanan baru ${formatQueueNumber(incoming)} masuk`
            setNewOrderNotice(notice)
            window.clearTimeout(noticeTimer.current)
            noticeTimer.current = window.setTimeout(() => setNewOrderNotice(''), 7000)
            if (typeof window.Notification !== 'undefined' && window.Notification.permission === 'granted') {
              new window.Notification('Pesanan baru', { body: notice })
            }
          }
        }
        loadOrders(false)
      })
      .subscribe((status) => {
        setRealtimeState(status === 'SUBSCRIBED' ? 'connected' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED' ? 'error' : 'connecting')
      })

    return () => {
      window.clearTimeout(noticeTimer.current)
      supabase.removeChannel(channel)
    }
  }, [cafe.id, historyOnly, loadOrders, supabase])

  function patchOrder(orderId, changes) {
    setOrders((current) => current.map((order) => (order.id === orderId ? { ...order, ...changes } : order)))
  }

  async function runAdvance(order) {
    setBusyOrderId(order.id)
    try {
      const data = await advanceOrderStatus(supabase, order)
      patchOrder(order.id, { order_status: data.order_status })
      toast({ title: `${formatQueueNumber(order)} · ${orderStatusMeta(data.order_status).label}` })
      if (data.order_status === 'completed') setSelectedId(null)
    } catch (caught) {
      toast({ title: 'Status gagal diperbarui', description: caught.message, tone: 'error' })
    } finally {
      setBusyOrderId(null)
    }
  }

  function handleAdvance(order) {
    if (NEXT_ORDER_STATUS[order.order_status] === 'completed' && order.payment_status !== 'paid') {
      setDialog({ type: 'complete-unpaid', order })
      return
    }
    runAdvance(order)
  }

  const visibleOrders = useMemo(() => orders.filter((order) => (historyOnly
    ? historyStatus === 'all' || order.order_status === historyStatus
    : ACTIVE_ORDER_STATUSES.includes(order.order_status))), [historyOnly, historyStatus, orders])

  const stats = useMemo(() => {
    if (historyOnly) {
      const completed = orders.filter((order) => order.order_status === 'completed')
      return {
        completed: completed.length,
        cancelled: orders.filter((order) => order.order_status === 'cancelled').length,
        paidTotal: completed.filter((order) => order.payment_status === 'paid').reduce((sum, order) => sum + Number(order.total_amount || 0), 0),
        unpaid: completed.filter((order) => order.payment_status !== 'paid').length,
      }
    }
    const todayKey = jakartaDateKey()
    return {
      pending: orders.filter((order) => order.order_status === 'pending').length,
      inProgress: orders.filter((order) => order.order_status === 'confirmed' || order.order_status === 'preparing').length,
      ready: orders.filter((order) => order.order_status === 'ready').length,
      completedToday: orders.filter((order) => order.order_status === 'completed' && jakartaDateKey(order.created_at) === todayKey).length,
    }
  }, [historyOnly, orders])

  const selectedOrder = orders.find((order) => order.id === selectedId) || null
  const historyRangeLabel = historyOnly ? resolveRange(historyRange).label : ''

  return (
    <div className="dashboard-content staff-page">
      <PageHeader
        eyebrow={historyOnly ? 'OPERASIONAL · ARSIP' : 'OPERASIONAL · REALTIME'}
        title={historyOnly ? 'Riwayat pesanan' : 'Pesanan hari ini'}
        description={historyOnly ? 'Pesanan yang sudah selesai atau dibatalkan.' : 'Pesanan aktif dan pesanan yang masuk hari ini.'}
        actions={!historyOnly && (
          <span className={`staff-live-indicator ${realtimeState}`} role="status">
            <span /> {realtimeState === 'connected' ? 'LIVE' : realtimeState === 'error' ? 'TERPUTUS' : 'MENGHUBUNGKAN'}
          </span>
        )}
      />

      {newOrderNotice && (
        <div className="staff-new-order-notice" role="status">
          <Bell size={17} aria-hidden="true" />
          <strong>{newOrderNotice}</strong>
          <IconButton icon={X} size="sm" label="Tutup notifikasi" onClick={() => setNewOrderNotice('')} tooltip={false} />
        </div>
      )}
      {realtimeState === 'error' && !historyOnly && (
        <div className="staff-realtime-warning" role="status">
          Pembaruan otomatis terputus. Muat ulang untuk melihat pesanan terbaru.
          <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => setAttempt((value) => value + 1)}>Muat ulang</Button>
        </div>
      )}

      <section className="staff-stat-strip" aria-label="Ringkasan">
        {historyOnly ? (
          <>
            <StatCard compact icon={CheckCircle2} tone="green" label="Selesai" value={formatNumber(stats.completed)} loading={loading} />
            <StatCard compact icon={XCircle} tone="red" label="Dibatalkan" value={formatNumber(stats.cancelled)} loading={loading} />
            <StatCard compact icon={CircleDollarSign} tone="sage" label="Total lunas" value={formatRupiah(stats.paidTotal)} loading={loading} />
            <StatCard compact icon={Wallet} tone="amber" label="Selesai belum lunas" value={formatNumber(stats.unpaid)} loading={loading} />
          </>
        ) : (
          <>
            <StatCard compact icon={Inbox} tone="amber" label="Masuk" value={formatNumber(stats.pending)} loading={loading} />
            <StatCard compact icon={CookingPot} tone="blue" label="Diproses" value={formatNumber(stats.inProgress)} loading={loading} />
            <StatCard compact icon={ShoppingBag} tone="green" label="Siap diambil" value={formatNumber(stats.ready)} loading={loading} />
            <StatCard compact icon={CheckCircle2} tone="neutral" label="Selesai hari ini" value={formatNumber(stats.completedToday)} loading={loading} />
          </>
        )}
      </section>

      <section className="staff-orders-toolbar">
        <div>
          <h2>{historyOnly ? historyRangeLabel : 'Antrean aktif'}</h2>
          <span>{visibleOrders.length} pesanan</span>
        </div>
        <div className="staff-filter-controls">
          {historyOnly && (
            <>
              <SegmentedControl label="Rentang tanggal" value={historyRange} onChange={setHistoryRange} options={HISTORY_RANGES} />
              <Select label="Status" hideLabel value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value)} options={HISTORY_STATUSES} />
            </>
          )}
          <Button variant="secondary" icon={RefreshCw} onClick={() => setAttempt((value) => value + 1)}>Muat ulang</Button>
        </div>
      </section>

      {loading ? (
        <SkeletonRows rows={4} label="Memuat pesanan" />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={() => setAttempt((value) => value + 1)} />
      ) : !visibleOrders.length ? (
        <EmptyState
          icon={historyOnly ? Clock3 : Inbox}
          title={historyOnly ? 'Belum ada riwayat di rentang ini' : 'Belum ada pesanan aktif'}
          description={historyOnly ? 'Coba pilih rentang tanggal yang lebih panjang.' : 'Pesanan baru akan muncul otomatis di sini.'}
          action={historyOnly && historyRange !== '30d' && <Button variant="secondary" size="sm" onClick={() => setHistoryRange('30d')}>Lihat 30 hari</Button>}
        />
      ) : (
        <section className="staff-order-grid">
          {visibleOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              features={features}
              busy={busyOrderId === order.id}
              onOpen={(target) => setSelectedId(target.id)}
              onAdvance={handleAdvance}
              onPay={(target) => setDialog({ type: 'pay', order: target })}
            />
          ))}
        </section>
      )}

      {selectedOrder && (
        <Drawer
          title={`Pesanan ${formatQueueNumber(selectedOrder)}`}
          description={`${customerLabel(selectedOrder)} · ${formatDateTime(selectedOrder.created_at)}`}
          onClose={() => setSelectedId(null)}
          footer={(
            <>
              {canCancel(selectedOrder, features) && (
                <Button variant="danger-soft" icon={XCircle} onClick={() => setDialog({ type: 'cancel', order: selectedOrder })}>Batalkan</Button>
              )}
              {canPay(selectedOrder, features) && (
                <Button variant="secondary" icon={Wallet} onClick={() => setDialog({ type: 'pay', order: selectedOrder })}>Tandai lunas</Button>
              )}
              {NEXT_ORDER_STATUS[selectedOrder.order_status] && (
                <Button icon={Check} loading={busyOrderId === selectedOrder.id} onClick={() => handleAdvance(selectedOrder)}>
                  {ACTION_LABEL[NEXT_ORDER_STATUS[selectedOrder.order_status]]}
                </Button>
              )}
            </>
          )}
        >
          <OrderDetails order={selectedOrder} features={features} />
        </Drawer>
      )}

      {dialog?.type === 'pay' && (
        <MarkPaidDialog
          order={dialog.order}
          cafe={cafe}
          confirmLabel={dialog.then === 'complete' ? 'Lunas & selesaikan' : undefined}
          onClose={() => setDialog(null)}
          onPaid={async (updated) => {
            patchOrder(updated.id, updated)
            setDialog(null)
            toast({ title: `${formatQueueNumber(updated)} lunas`, description: `${formatRupiah(updated.total_amount)} · ${paymentMethodLabel(updated.payment_method)}` })
            if (dialog.then === 'complete') await runAdvance(updated)
          }}
        />
      )}
      {dialog?.type === 'cancel' && (
        <CancelOrderDialog
          order={dialog.order}
          onClose={() => setDialog(null)}
          onCancelled={(updated) => {
            patchOrder(updated.id, updated)
            setDialog(null)
            setSelectedId(null)
            toast({ title: `${formatQueueNumber(updated)} dibatalkan`, tone: 'info' })
          }}
        />
      )}
      {dialog?.type === 'complete-unpaid' && (
        <ConfirmDialog
          title="Pesanan belum lunas"
          description={`${formatQueueNumber(dialog.order)} (${formatRupiah(dialog.order.total_amount)}) belum tercatat lunas. Pesanan yang belum lunas tidak dihitung sebagai pendapatan.`}
          confirmLabel="Tetap selesaikan"
          alternative={features?.operations ? { label: 'Tandai lunas dulu', onClick: () => setDialog({ type: 'pay', order: dialog.order, then: 'complete' }) } : undefined}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            const target = dialog.order
            setDialog(null)
            await runAdvance(target)
          }}
        />
      )}

      <span className="staff-updated-note"><Clock3 size={13} aria-hidden="true" /> Data otomatis diperbarui saat pesanan berubah</span>
    </div>
  )
}
