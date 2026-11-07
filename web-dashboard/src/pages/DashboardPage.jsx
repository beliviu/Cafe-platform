import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  CreditCard,
  PackageOpen,
  ShoppingBag,
  TrendingUp,
} from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import { formatRupiah } from '../lib/format.js'
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '../lib/status.js'

const DATE_RANGES = [
  { days: 7, label: '7 hari' },
  { days: 30, label: '30 hari' },
  { days: 90, label: '90 hari' },
]

const INITIAL_DATA = {
  summary: { revenue: 0, total_orders: 0, paid_orders: 0, average_order_value: 0 },
  revenue_by_day: [],
  popular_products: [],
  recent_orders: [],
}

function formatDate(date, options = {}) {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    ...options,
  }).format(new Date(date))
}

function getDateRange(days) {
  const end = new Date()
  end.setUTCHours(0, 0, 0, 0)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - days + 1)

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

function MetricCard({ icon: Icon, label, value, caption, tone }) {
  return (
    <article className="metric-card">
      <div className={`metric-icon metric-icon-${tone}`}><Icon size={19} strokeWidth={1.8} /></div>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <span className="metric-caption">{caption}</span>
    </article>
  )
}

function RevenueChart({ entries }) {
  const points = useMemo(() => {
    if (!entries.length) return []
    const width = 840
    const left = 14
    const right = 14
    const top = 14
    const bottom = 22
    const max = Math.max(...entries.map((entry) => Number(entry.amount) || 0), 1)
    const chartWidth = width - left - right
    const chartHeight = 204 - top - bottom

    return entries.map((entry, index) => ({
      ...entry,
      x: entries.length === 1 ? width / 2 : left + (index / (entries.length - 1)) * chartWidth,
      y: top + chartHeight - ((Number(entry.amount) || 0) / max) * chartHeight,
    }))
  }, [entries])

  if (!points.length || points.every((point) => Number(point.amount) === 0)) {
    return (
      <div className="chart-empty">
        <span className="empty-icon"><TrendingUp size={21} /></span>
        <strong>Belum ada pendapatan</strong>
        <span>Pendapatan dari transaksi lunas akan muncul di sini.</span>
      </div>
    )
  }

  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const area = `${line} L ${points.at(-1).x} 182 L ${points[0].x} 182 Z`
  const labelIndexes = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])

  return (
    <div className="chart-wrap">
      <svg
        className="revenue-chart"
        viewBox="0 0 840 204"
        role="img"
        aria-label="Grafik pendapatan harian dari transaksi lunas"
      >
        <defs>
          <linearGradient id="revenueFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#63856c" stopOpacity=".2" />
            <stop offset="100%" stopColor="#63856c" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[20, 72, 124, 182].map((y) => (
          <line key={y} x1="14" x2="826" y1={y} y2={y} className="chart-gridline" />
        ))}
        <path d={area} fill="url(#revenueFill)" />
        <path d={line} className="chart-line" />
        {points.map((point) => (
          <circle key={point.date} cx={point.x} cy={point.y} r="3.2" className="chart-point">
            <title>{`${formatDate(`${point.date}T00:00:00Z`, { timeZone: 'UTC' })}: ${formatRupiah(point.amount)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="chart-labels" aria-hidden="true">
        {points.map((point, index) => (
          <span key={point.date} className={labelIndexes.has(index) ? '' : 'chart-label-hidden'}>
            {formatDate(`${point.date}T00:00:00Z`, { timeZone: 'UTC' })}
          </span>
        ))}
      </div>
    </div>
  )
}

function DataError({ message, onRetry }) {
  return (
    <div className="dashboard-error" role="alert">
      <span className="error-icon"><PackageOpen size={21} /></span>
      <div>
        <strong>Data dashboard belum dapat dimuat</strong>
        <p>{message}</p>
        <button className="text-button" type="button" onClick={onRetry}>Coba lagi</button>
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" role="status" aria-label="Memuat statistik dashboard">
      <div className="skeleton-row">
        <span /><span /><span />
      </div>
      <span className="skeleton-block" />
      <div className="skeleton-row lower">
        <span /><span />
      </div>
    </div>
  )
}

export function DashboardPage() {
  const { cafe } = useOutletContext()
  const { supabase } = useAuth()
  const [rangeDays, setRangeDays] = useState(7)
  const [dashboardData, setDashboardData] = useState(INITIAL_DATA)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  const requestId = useRef(0)

  const loadDashboard = useCallback(async () => {
    const currentRequestId = ++requestId.current
    const range = getDateRange(rangeDays)

    const { data, error } = await supabase.rpc('owner_dashboard_analytics', {
      p_cafe_id: cafe.id,
      p_start_date: range.start,
      p_end_date: range.end,
    })

    if (currentRequestId !== requestId.current) return
    if (error) {
      setErrorMessage(
        error.code === 'PGRST202'
          ? 'Fungsi statistik belum tersedia di Supabase. Terapkan migrasi 20261108000100_restore_owner_dashboard_analytics.sql.'
          : /type "public\.app_role\[\]" does not exist/i.test(error.message)
            ? 'Skema role Supabase berbeda dari migrasi awal. Terapkan migrasi 20261108000200_fix_owner_dashboard_role_type.sql.'
          : error.message,
      )
      setLoading(false)
      return
    }

    if (!data || !data.summary || !Array.isArray(data.revenue_by_day)) {
      setErrorMessage('Respons statistik dari database tidak sesuai format.')
      setLoading(false)
      return
    }

    setDashboardData({
      summary: data.summary,
      revenue_by_day: data.revenue_by_day,
      popular_products: Array.isArray(data.popular_products) ? data.popular_products : [],
      recent_orders: Array.isArray(data.recent_orders) ? data.recent_orders : [],
    })
    setLoading(false)
  }, [cafe.id, rangeDays, supabase])

  useEffect(() => {
    const timer = window.setTimeout(loadDashboard, 0)
    return () => {
      window.clearTimeout(timer)
      requestId.current += 1
    }
  }, [attempt, loadDashboard])

  const dateRangeLabel = useMemo(() => {
    const { start, end } = getDateRange(rangeDays)
    return `${formatDate(`${start}T00:00:00Z`, { timeZone: 'UTC' })} — ${formatDate(`${end}T00:00:00Z`, { timeZone: 'UTC', year: 'numeric' })}`
  }, [rangeDays])

  const greetingName = cafe.name.split(/\s+/)[0]
  const paidOrders = Number(dashboardData.summary.paid_orders) || 0

  return (
    <div className="dashboard-content">
      <header className="page-heading">
        <div>
          <span className="page-eyebrow"><span className="eyebrow-dot" /> OVERVIEW</span>
          <h1>Selamat pagi, {greetingName}<span className="heading-period">.</span></h1>
          <p>Berikut ringkasan performa cafe Anda.</p>
        </div>
        <div className="date-range-control">
          <CalendarDays size={16} aria-hidden="true" />
          <span className="range-dates">{dateRangeLabel}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </div>
      </header>

      <section className="range-toolbar" aria-label="Filter rentang tanggal">
        <div className="range-segment" role="group" aria-label="Pilih rentang tanggal">
          {DATE_RANGES.map(({ days, label }) => (
            <button
              key={days}
              type="button"
              className={`range-button${rangeDays === days ? ' selected' : ''}`}
              aria-pressed={rangeDays === days}
              onClick={() => {
                if (rangeDays !== days) {
                  setErrorMessage('')
                  setLoading(true)
                  setRangeDays(days)
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="data-note"><Clock3 size={14} /> Data berdasarkan transaksi database</span>
      </section>

      {errorMessage ? (
        <DataError
          message={errorMessage}
          onRetry={() => {
            setErrorMessage('')
            setLoading(true)
            setAttempt((value) => value + 1)
          }}
        />
      ) : loading ? (
        <DashboardSkeleton />
      ) : (
        <>
          <section className="metrics-grid" aria-label="Ringkasan performa">
            <MetricCard
              icon={CircleDollarSign}
              label="Total pendapatan"
              value={formatRupiah(dashboardData.summary.revenue)}
              caption="Dari transaksi yang sudah dibayar"
              tone="green"
            />
            <MetricCard
              icon={ShoppingBag}
              label="Jumlah transaksi"
              value={Number(dashboardData.summary.total_orders).toLocaleString('id-ID')}
              caption={`${paidOrders.toLocaleString('id-ID')} transaksi sudah dibayar`}
              tone="sand"
            />
            <MetricCard
              icon={CreditCard}
              label="Rata-rata transaksi"
              value={formatRupiah(dashboardData.summary.average_order_value)}
              caption="Rata-rata dari transaksi dibayar"
              tone="clay"
            />
          </section>

          <section className="dashboard-grid">
            <article className="panel revenue-panel">
              <div className="panel-heading">
                <div>
                  <div className="panel-title-row">
                    <h2>Pendapatan</h2>
                    <span className="live-tag"><span /> REAL-TIME DATA</span>
                  </div>
                  <p>{dateRangeLabel}</p>
                </div>
                <div className="chart-legend"><span /> Pendapatan lunas</div>
              </div>
              <RevenueChart entries={dashboardData.revenue_by_day} />
              <div className="chart-footnote">
                <span><TrendingUp size={14} /> Hanya pesanan berstatus pembayaran lunas</span>
                <span>{formatRupiah(dashboardData.summary.revenue)} total</span>
              </div>
            </article>

            <article className="panel popular-panel">
              <div className="panel-heading">
                <div>
                  <h2>Produk populer</h2>
                  <p>Berdasarkan jumlah terjual</p>
                </div>
                <span className="panel-icon"><TrendingUp size={17} /></span>
              </div>
              {dashboardData.popular_products.length ? (
                <ol className="popular-list">
                  {dashboardData.popular_products.map((product, index) => (
                    <li className="popular-item" key={`${product.name}-${index}`}>
                      <span className={`popular-rank${index === 0 ? ' top-rank' : ''}`}>
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="popular-product-info">
                        <strong>{product.name}</strong>
                        <span>{Number(product.quantity_sold).toLocaleString('id-ID')} terjual</span>
                      </span>
                      <span className="popular-revenue">{formatRupiah(product.revenue)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="panel-empty">
                  <PackageOpen size={20} />
                  <span>Belum ada produk terjual pada periode ini.</span>
                </div>
              )}
            </article>
          </section>

          <section className="panel transactions-panel">
            <div className="panel-heading transactions-heading">
              <div>
                <h2>Transaksi terbaru</h2>
                <p>Pesanan terakhir pada periode yang dipilih</p>
              </div>
              <span className="transaction-count">
                {dashboardData.recent_orders.length} dari {Number(dashboardData.summary.total_orders).toLocaleString('id-ID')} transaksi
              </span>
            </div>

            {dashboardData.recent_orders.length ? (
              <div className="transactions-list">
                <div className="transaction-table-head">
                  <span>ORDER</span>
                  <span>TANGGAL</span>
                  <span>STATUS</span>
                  <span>PEMBAYARAN</span>
                  <span className="amount-heading">TOTAL</span>
                </div>
                {dashboardData.recent_orders.map((order) => (
                  <article className="transaction-row" key={order.order_number}>
                    <span className="transaction-order">
                      <span className="order-icon"><ShoppingBag size={15} /></span>
                      <strong>#{order.order_number}</strong>
                    </span>
                    <span className="transaction-date">
                      {formatDate(order.created_at, { year: 'numeric' })}
                      <small>{new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date(order.created_at))}</small>
                    </span>
                    <span><span className={`status-pill status-${order.order_status}`}>{ORDER_STATUS_LABELS[order.order_status] || order.order_status}</span></span>
                    <span className="payment-cell">
                      <span className={`payment-dot payment-${order.payment_status}`} />
                      <span>{PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status}</span>
                      {order.payment_method && <small>{order.payment_method}</small>}
                    </span>
                    <strong className="transaction-amount">{formatRupiah(order.total_amount)}</strong>
                  </article>
                ))}
              </div>
            ) : (
              <div className="transactions-empty">
                <span className="empty-icon"><ShoppingBag size={21} /></span>
                <strong>Belum ada transaksi</strong>
                <span>Pesanan dari pelanggan akan tampil di sini.</span>
              </div>
            )}
          </section>
          <footer className="dashboard-footer">
            <span>Data tersinkron dengan database cafe Anda.</span>
            <span>DAILYBREW · OWNER WORKSPACE</span>
          </footer>
        </>
      )}
    </div>
  )
}
