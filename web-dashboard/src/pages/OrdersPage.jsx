import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { CreditCard, Eye, ReceiptText, ShoppingBag } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import { Modal, PageEmpty, PageError, PageLoading } from '../components/PageState.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { formatRupiah } from '../lib/format.js'
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '../lib/status.js'

const ORDER_STATUSES = [['all', 'Semua status'], ...Object.entries(ORDER_STATUS_LABELS)]

function formatDate(value, withYear = true) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Tanggal tidak tersedia'

  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function OrderDetails({ order, cafeId, supabase }) {
  const [items, setItems] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let active = true
    async function loadDetails() {
      const [itemsResult, paymentsResult] = await Promise.all([
        supabase.from('order_items')
          .select('id, product_name, price, quantity, subtotal')
          .eq('cafe_id', cafeId)
          .eq('order_id', order.id)
          .order('created_at', { ascending: true }),
        supabase.from('payments')
          .select('id, payment_method, amount, payment_status, created_at')
          .eq('order_id', order.id)
          .order('created_at', { ascending: false }),
      ])
      if (!active) return
      if (itemsResult.error || paymentsResult.error) {
        const error = itemsResult.error || paymentsResult.error
        setErrorMessage(`Detail transaksi gagal dimuat: ${error.message}`)
      } else {
        setItems(itemsResult.data || [])
        setPayments(paymentsResult.data || [])
      }
      setLoading(false)
    }
    loadDetails()
    return () => { active = false }
  }, [cafeId, order.id, supabase])

  return (
    <div className="order-detail">
      <div className="order-detail-summary">
        <span className="order-detail-icon"><ReceiptText size={19} /></span>
        <div><span>Nomor transaksi</span><strong>#{order.order_number}</strong></div>
        <div><span>Waktu pesanan</span><strong>{formatDate(order.created_at)}</strong></div>
      </div>
      <div className="order-detail-status">
        <span className={`status-pill status-${order.order_status}`}>{ORDER_STATUS_LABELS[order.order_status] || order.order_status}</span>
        <span className={`status-pill payment-status-pill payment-${order.payment_status}`}>
          {PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status}
        </span>
      </div>

      {loading ? <PageLoading label="Memuat detail transaksi..." /> : errorMessage ? (
        <div className="form-alert" role="alert">{errorMessage}</div>
      ) : (
        <>
          <section className="detail-section">
            <h3>Item pesanan</h3>
            {items.length ? items.map((item) => (
              <div className="order-item-row" key={item.id}>
                <div><strong>{item.product_name}</strong><span>{item.quantity} × {formatRupiah(item.price)}</span></div>
                <strong>{formatRupiah(item.subtotal)}</strong>
              </div>
            )) : <p className="detail-muted">Tidak ada item untuk transaksi ini.</p>}
            <div className="order-total-row"><span>Total pesanan</span><strong>{formatRupiah(order.total_amount)}</strong></div>
          </section>

          <section className="detail-section">
            <h3><CreditCard size={15} /> Pembayaran</h3>
            {payments.length ? payments.map((payment) => (
              <div className="payment-row" key={payment.id}>
                <div><strong>{payment.payment_method}</strong><span>{PAYMENT_STATUS_LABELS[payment.payment_status] || payment.payment_status} · {formatDate(payment.created_at)}</span></div>
                <strong>{formatRupiah(payment.amount)}</strong>
              </div>
            )) : (
              <div className="payment-row">
                <div><strong>{order.payment_method || 'Metode belum tercatat'}</strong><span>{PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status}</span></div>
                <strong>{formatRupiah(order.total_amount)}</strong>
              </div>
            )}
          </section>

          {order.notes && (
            <section className="detail-section">
              <h3>Catatan pelanggan</h3>
              <p className="order-note">{order.notes}</p>
            </section>
          )}
        </>
      )}
    </div>
  )
}

export function OrdersPage() {
  const { cafe } = useOutletContext()
  const { supabase } = useAuth()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedOrder, setSelectedOrder] = useState(null)

  const loadOrders = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    let request = supabase.from('orders')
      .select('id, cafe_id, order_number, customer_id, total_amount, order_status, payment_status, payment_method, notes, created_at')
      .eq('cafe_id', cafe.id)
      .order('created_at', { ascending: false })
      .limit(200)
    if (statusFilter !== 'all') request = request.eq('order_status', statusFilter)

    const { data, error } = await request
    if (error) {
      setLoadError(`Transaksi gagal dimuat: ${error.message}`)
    } else {
      setOrders(data || [])
    }
    setLoading(false)
  }, [cafe.id, statusFilter, supabase])

  useEffect(() => {
    const timer = window.setTimeout(loadOrders, 0)
    return () => window.clearTimeout(timer)
  }, [attempt, loadOrders])

  return (
    <div className="dashboard-content entity-page">
      <PageHeader
        eyebrow="AKTIVITAS"
        title="Transaksi"
        description="Pantau pesanan cafe dan lihat ringkasan pembayarannya."
      />

      <section className="entity-toolbar orders-toolbar">
        <label className="status-filter-label">
          Status pesanan
          <select aria-label="Filter status pesanan" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {ORDER_STATUSES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <span className="entity-count">{orders.length} transaksi ditampilkan · maksimal 200</span>
      </section>

      {loading ? (
        <PageLoading label="Memuat transaksi cafe..." />
      ) : loadError ? (
        <PageError message={loadError} onRetry={() => setAttempt((value) => value + 1)} />
      ) : !orders.length ? (
        <PageEmpty
          title={statusFilter === 'all' ? 'Belum ada transaksi' : 'Tidak ada pesanan dengan status ini'}
          description={statusFilter === 'all' ? 'Pesanan pelanggan akan muncul di halaman ini.' : 'Pilih status lain untuk melihat transaksi yang cocok.'}
          action={statusFilter !== 'all' && <button className="button button-secondary" type="button" onClick={() => setStatusFilter('all')}>Tampilkan semua</button>}
        />
      ) : (
        <section className="panel orders-panel">
          <div className="transaction-table-head order-table-head">
            <span>ORDER</span>
            <span>TANGGAL</span>
            <span>STATUS</span>
            <span>PEMBAYARAN</span>
            <span className="amount-heading">TOTAL</span>
            <span />
          </div>
          {orders.map((order) => (
            <article className="transaction-row order-list-row" key={order.id}>
              <span className="transaction-order">
                <span className="order-icon"><ShoppingBag size={15} /></span>
                <strong>#{order.order_number}</strong>
              </span>
              <span className="transaction-date">
                {formatDate(order.created_at)}
                <small>{String(order.customer_id || 'Pelanggan').slice(0, 8)}</small>
              </span>
              <span><span className={`status-pill status-${order.order_status}`}>{ORDER_STATUS_LABELS[order.order_status] || order.order_status}</span></span>
              <span className="payment-cell">
                <span className={`payment-dot payment-${order.payment_status}`} />
                <span>{PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status}</span>
                {order.payment_method && <small>{order.payment_method}</small>}
              </span>
              <strong className="transaction-amount">{formatRupiah(order.total_amount)}</strong>
              <button type="button" className="icon-button order-view-button" aria-label={`Lihat transaksi ${order.order_number}`} onClick={() => setSelectedOrder(order)}>
                <Eye size={16} />
              </button>
            </article>
          ))}
        </section>
      )}

      {selectedOrder && (
        <Modal
          title="Detail transaksi"
          description={`${cafe.name} · Pesanan pelanggan`}
          onClose={() => setSelectedOrder(null)}
          wide
        >
          <OrderDetails order={selectedOrder} cafeId={cafe.id} supabase={supabase} />
        </Modal>
      )}
    </div>
  )
}
