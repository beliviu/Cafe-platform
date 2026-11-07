import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Bell, Check, Clock3, Eye, History, RefreshCw, ShoppingBag, Utensils } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import { Modal, PageEmpty, PageError, PageLoading } from '../components/PageState.jsx'
import { PageHeader } from '../components/PageHeader.jsx'

const STATUS_LABELS = {
  pending: 'Pesanan masuk',
  confirmed: 'Dikonfirmasi',
  preparing: 'Sedang disiapkan',
  ready: 'Siap diambil',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
}
const PAYMENT_LABELS = {
  unpaid: 'Belum dibayar',
  pending: 'Diproses',
  paid: 'Dibayar',
  failed: 'Gagal',
  refunded: 'Dikembalikan',
}
const NEXT_STATUS = {
  pending: 'confirmed',
  confirmed: 'preparing',
  preparing: 'ready',
  ready: 'completed',
}
const STATUS_ACTION = {
  confirmed: 'Konfirmasi pesanan',
  preparing: 'Mulai menyiapkan',
  ready: 'Tandai siap',
  completed: 'Selesaikan pesanan',
}
const LIVE_STATUSES = ['pending', 'confirmed', 'preparing', 'ready']
const DATE_FILTERS = [
  ['today', 'Hari ini'],
  ['7days', '7 hari'],
  ['30days', '30 hari'],
  ['all', 'Semua tanggal'],
]

function formatCurrency(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0)
}

function formatDate(value) {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function StaffOrderDetails({ order }) {
  return (
    <div className="staff-order-detail">
      <div className="staff-detail-topline">
        <span className={`status-pill status-${order.order_status}`}>{STATUS_LABELS[order.order_status]}</span>
        <span className={`status-pill payment-status-pill payment-${order.payment_status}`}>
          {PAYMENT_LABELS[order.payment_status] || order.payment_status}
        </span>
      </div>
      <section className="staff-detail-block">
        <h3>Informasi pesanan</h3>
        <div className="staff-detail-pair"><span>Pelanggan</span><strong>{order.customer_name || 'Pelanggan'}</strong></div>
        <div className="staff-detail-pair"><span>Waktu masuk</span><strong>{formatDate(order.created_at)}</strong></div>
        {order.payment_method && <div className="staff-detail-pair"><span>Metode pembayaran</span><strong>{order.payment_method}</strong></div>}
      </section>
      <section className="staff-detail-block">
        <h3>Item pesanan</h3>
        {order.items.map((item) => (
          <div className="staff-detail-item" key={item.id}>
            <div><strong>{item.product_name}</strong><span>{item.quantity} × {formatCurrency(item.price)}</span></div>
            <strong>{formatCurrency(item.subtotal)}</strong>
          </div>
        ))}
        {!order.items.length && <p className="detail-muted">Item pesanan tidak tersedia.</p>}
        <div className="order-total-row"><span>Total pesanan</span><strong>{formatCurrency(order.total_amount)}</strong></div>
      </section>
      {order.notes && (
        <section className="staff-detail-block">
          <h3>Catatan pelanggan</h3>
          <p className="order-note">{order.notes}</p>
        </section>
      )}
    </div>
  )
}

function OrderCard({ order, onOpen, onAdvance, updating }) {
  const nextStatus = NEXT_STATUS[order.order_status]
  return (
    <article className="staff-order-card">
      <header className="staff-order-card-header">
        <div>
          <span className="staff-order-label">ORDER</span>
          <h2>#{order.order_number}</h2>
        </div>
        <span className={`status-pill status-${order.order_status}`}>{STATUS_LABELS[order.order_status]}</span>
      </header>
      <div className="staff-order-customer">
        <span className="staff-customer-icon"><Utensils size={15} /></span>
        <div><strong>{order.customer_name || 'Pelanggan'}</strong><span>{formatDate(order.created_at)}</span></div>
      </div>
      <div className="staff-order-items">
        {order.items.slice(0, 3).map((item) => (
          <div className="staff-order-item" key={item.id}>
            <span><b>{item.quantity}×</b> {item.product_name}</span>
            <strong>{formatCurrency(item.subtotal)}</strong>
          </div>
        ))}
        {order.items.length > 3 && <span className="staff-more-items">+{order.items.length - 3} item lainnya</span>}
        {!order.items.length && <span className="staff-more-items">Detail item belum tersedia</span>}
      </div>
      <div className="staff-order-total">
        <span>Total <small>{PAYMENT_LABELS[order.payment_status] || order.payment_status}</small></span>
        <strong>{formatCurrency(order.total_amount)}</strong>
      </div>
      <footer className="staff-order-actions">
        <button className="button button-secondary staff-detail-button" type="button" onClick={() => onOpen(order)}>
          <Eye size={15} /> Detail
        </button>
        {nextStatus && (
          <button className="button button-primary staff-advance-button" type="button" disabled={updating} onClick={() => onAdvance(order)}>
            {updating ? <RefreshCw className="staff-button-spinner" size={15} /> : <Check size={15} />}
            {updating ? 'Menyimpan...' : STATUS_ACTION[nextStatus]}
          </button>
        )}
      </footer>
    </article>
  )
}

export function StaffOrdersPage({ historyOnly = false }) {
  const { cafe } = useOutletContext()
  const { supabase } = useAuth()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [mutationError, setMutationError] = useState('')
  const [updatingOrderId, setUpdatingOrderId] = useState(null)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [dateFilter, setDateFilter] = useState('7days')
  const [historyStatus, setHistoryStatus] = useState('completed')
  const [realtimeState, setRealtimeState] = useState('connecting')
  const [newOrderNotice, setNewOrderNotice] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [now] = useState(() => new Date())
  const knownOrderIds = useRef(null)
  const noticeTimer = useRef(null)

  const loadOrders = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setLoadError('')
    const { data: rawOrders, error: ordersError } = await supabase
      .from('orders')
      .select('id, cafe_id, order_number, customer_id, total_amount, order_status, payment_status, payment_method, notes, created_at')
      .eq('cafe_id', cafe.id)
      .order('created_at', { ascending: false })
      .limit(300)

    if (ordersError) {
      setLoadError(`Pesanan gagal dimuat: ${ordersError.message}`)
      setLoading(false)
      return
    }

    const orderIds = rawOrders.map((order) => order.id)
    if (!orderIds.length) {
      knownOrderIds.current = new Set()
      setOrders([])
      setLoading(false)
      return
    }

    const [customersResult, itemsResult] = await Promise.all([
      supabase.rpc('staff_order_customer_names', { p_order_ids: orderIds }),
      supabase.from('order_items')
        .select('id, order_id, product_name, price, quantity, subtotal')
        .in('order_id', orderIds)
        .order('created_at', { ascending: true }),
    ])

    if (customersResult.error || itemsResult.error) {
      const error = customersResult.error || itemsResult.error
      setLoadError(`Detail pesanan gagal dimuat: ${error.message}`)
      setLoading(false)
      return
    }

    const namesByOrderId = new Map((customersResult.data || []).map((customer) => [customer.order_id, customer.customer_name]))
    const itemsByOrder = new Map()
    for (const item of itemsResult.data || []) {
      const orderItems = itemsByOrder.get(item.order_id) || []
      orderItems.push(item)
      itemsByOrder.set(item.order_id, orderItems)
    }

    setOrders(rawOrders.map((order) => ({
      ...order,
      customer_name: namesByOrderId.get(order.id) || '',
      items: itemsByOrder.get(order.id) || [],
    })))
    knownOrderIds.current = new Set(orderIds)
    setLoading(false)
  }, [cafe.id, supabase])

  useEffect(() => {
    const timer = window.setTimeout(() => loadOrders(), 0)
    return () => window.clearTimeout(timer)
  }, [attempt, loadOrders])

  useEffect(() => {
    const channel = supabase
      .channel(`staff-orders-${cafe.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `cafe_id=eq.${cafe.id}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const incoming = payload.new
          const alreadyKnown = knownOrderIds.current?.has(incoming.id)
          knownOrderIds.current?.add(incoming.id)
          if (!alreadyKnown && incoming.order_status === 'pending') {
            const notice = `Pesanan baru #${incoming.order_number} masuk`
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
        setRealtimeState(status === 'SUBSCRIBED' ? 'connected' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'error' : 'connecting')
      })

    return () => {
      window.clearTimeout(noticeTimer.current)
      supabase.removeChannel(channel)
    }
  }, [cafe.id, loadOrders, supabase])

  async function advanceOrder(order) {
    const nextStatus = NEXT_STATUS[order.order_status]
    if (!nextStatus) return
    setMutationError('')
    setUpdatingOrderId(order.id)
    const { data, error } = await supabase.from('orders')
      .update({ order_status: nextStatus })
      .eq('id', order.id)
      .eq('cafe_id', cafe.id)
      .eq('order_status', order.order_status)
      .select('id, order_status')
      .maybeSingle()

    if (error) {
      setMutationError(`Status pesanan gagal diperbarui: ${error.message}`)
    } else if (!data) {
      setMutationError('Status pesanan berubah atau akses ditolak. Muat ulang daftar sebelum mencoba lagi.')
    } else {
      setOrders((current) => current.map((item) => (
        item.id === order.id ? { ...item, order_status: data.order_status } : item
      )))
      setSelectedOrder(null)
    }
    setUpdatingOrderId(null)
  }

  const visibleOrders = useMemo(() => {
    let startDate = null
    if (now && dateFilter === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    } else if (now && dateFilter === '7days') {
      startDate = new Date(now)
      startDate.setDate(startDate.getDate() - 7)
    } else if (now && dateFilter === '30days') {
      startDate = new Date(now)
      startDate.setDate(startDate.getDate() - 30)
    }

    return orders.filter((order) => {
      const createdAt = new Date(order.created_at)
      if (startDate && createdAt < startDate) return false
      if (historyOnly) {
        const isHistory = order.order_status === 'completed' || order.order_status === 'cancelled'
        return isHistory && (historyStatus === 'all' || order.order_status === historyStatus)
      }
      return LIVE_STATUSES.includes(order.order_status)
    })
  }, [dateFilter, historyOnly, historyStatus, now, orders])

  const counts = useMemo(() => ({
    pending: orders.filter((order) => order.order_status === 'pending').length,
    preparing: orders.filter((order) => order.order_status === 'confirmed' || order.order_status === 'preparing').length,
    ready: orders.filter((order) => order.order_status === 'ready').length,
    completed: orders.filter((order) => order.order_status === 'completed').length,
  }), [orders])

  return (
    <div className="dashboard-content staff-page">
      <PageHeader
        eyebrow={historyOnly ? 'OPERASIONAL · ARSIP' : 'OPERASIONAL · REALTIME'}
        title={historyOnly ? 'Riwayat pesanan' : 'Pesanan hari ini'}
        description={historyOnly ? 'Lihat pesanan selesai dan batalkan berdasarkan rentang tanggal.' : 'Kelola pesanan masuk dan ikuti alurnya sampai selesai.'}
        actions={!historyOnly && (
          <span className={`staff-live-indicator ${realtimeState}`} role="status">
            <span /> {realtimeState === 'connected' ? 'LIVE' : realtimeState === 'error' ? 'OFFLINE' : 'MENGHUBUNGKAN'}
          </span>
        )}
      />

      {newOrderNotice && (
        <div className="staff-new-order-notice" role="status">
          <Bell size={17} />
          <strong>{newOrderNotice}</strong>
          <button type="button" className="icon-button" onClick={() => setNewOrderNotice('')} aria-label="Tutup notifikasi">×</button>
        </div>
      )}
      {realtimeState === 'error' && (
        <div className="staff-realtime-warning" role="status">
          Pembaruan langsung terputus. Pesanan tetap dapat diperbarui dengan tombol muat ulang.
          <button type="button" className="text-button" onClick={() => setAttempt((value) => value + 1)}>Muat ulang</button>
        </div>
      )}
      {mutationError && <div className="form-alert staff-mutation-alert" role="alert">{mutationError}</div>}

      <section className="staff-metrics" aria-label="Ringkasan status pesanan">
        <article className="staff-metric-card"><span className="staff-metric-icon incoming"><ShoppingBag size={18} /></span><span>Pesanan masuk</span><strong>{counts.pending}</strong><small>Menunggu konfirmasi</small></article>
        <article className="staff-metric-card"><span className="staff-metric-icon preparing"><Utensils size={18} /></span><span>Dalam proses</span><strong>{counts.preparing}</strong><small>Dikonfirmasi atau disiapkan</small></article>
        <article className="staff-metric-card"><span className="staff-metric-icon ready"><Check size={18} /></span><span>Siap</span><strong>{counts.ready}</strong><small>Menunggu diambil pelanggan</small></article>
        <article className="staff-metric-card"><span className="staff-metric-icon completed"><History size={18} /></span><span>Selesai</span><strong>{counts.completed}</strong><small>Pesanan terselesaikan</small></article>
      </section>

      <section className="staff-orders-toolbar">
        <div>
          <h2>{historyOnly ? 'Pesanan terdahulu' : 'Antrean pesanan'}</h2>
          <span>{visibleOrders.length} pesanan ditampilkan</span>
        </div>
        <div className="staff-filter-controls">
          {historyOnly && (
            <label>
              Status
              <select value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value)}>
                <option value="completed">Selesai</option>
                <option value="cancelled">Dibatalkan</option>
                <option value="all">Semua riwayat</option>
              </select>
            </label>
          )}
          <label>
            Tanggal
            <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
              {DATE_FILTERS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <button className="button button-secondary staff-refresh-button" type="button" onClick={() => setAttempt((value) => value + 1)} aria-label="Muat ulang pesanan">
            <RefreshCw size={15} /> Muat ulang
          </button>
        </div>
      </section>

      {loading ? (
        <PageLoading label="Memuat pesanan cafe..." />
      ) : loadError ? (
        <PageError message={loadError} onRetry={() => setAttempt((value) => value + 1)} />
      ) : !visibleOrders.length ? (
        <PageEmpty
          title={historyOnly ? 'Belum ada riwayat pesanan' : 'Belum ada pesanan masuk'}
          description={historyOnly ? 'Pesanan yang selesai akan tercatat di sini.' : 'Pesanan customer akan muncul otomatis saat checkout.'}
          action={dateFilter !== 'all' && <button className="button button-secondary" type="button" onClick={() => setDateFilter('all')}>Lihat semua tanggal</button>}
        />
      ) : (
        <section className="staff-order-grid">
          {visibleOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onOpen={setSelectedOrder}
              onAdvance={advanceOrder}
              updating={updatingOrderId === order.id}
            />
          ))}
        </section>
      )}

      {selectedOrder && (
        <Modal
          title={`Pesanan #${selectedOrder.order_number}`}
          description={`${cafe.name} · ${formatDate(selectedOrder.created_at)}`}
          onClose={() => setSelectedOrder(null)}
          wide
        >
          {mutationError && <div className="form-alert staff-modal-alert" role="alert">{mutationError}</div>}
          <StaffOrderDetails order={selectedOrder} />
          {NEXT_STATUS[selectedOrder.order_status] && (
            <div className="staff-modal-action">
              <button className="button button-primary" type="button" disabled={updatingOrderId === selectedOrder.id} onClick={() => advanceOrder(selectedOrder)}>
                <Check size={15} /> {STATUS_ACTION[NEXT_STATUS[selectedOrder.order_status]]}
              </button>
            </div>
          )}
        </Modal>
      )}
      <span className="staff-updated-note"><Clock3 size={13} /> Data otomatis diperbarui saat pesanan berubah</span>
    </div>
  )
}
