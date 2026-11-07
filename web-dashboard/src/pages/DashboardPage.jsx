import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { CircleDollarSign, Clock3, PackageOpen, ReceiptText, ShoppingBag, TrendingUp, Wallet } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import { EmptyState, ErrorState, OrderStatusBadge, PaymentBadge, SegmentedControl, Skeleton, StatCard } from '../components/ui/index.js'
import { computeDashboard } from '../lib/analytics.js'
import { previousRangeLabel, RANGE_PRESETS, resolveRange } from '../lib/dateRange.js'
import { customerLabel, fetchAllRows, fetchCustomerNames, friendlyError, orderColumns } from '../lib/db.js'
import {
  formatDateShort, formatNumber, formatQueueNumber, formatRupiah, formatTime, greetingForNow, startOfJakartaDay,
} from '../lib/format.js'

const DAY_MS = 86400000

function RevenueChart({ entries }) {
  const points = useMemo(() => {
    if (!entries.length) return []
    const width = 840
    const left = 14
    const right = 14
    const top = 14
    const bottom = 22
    const max = Math.max(...entries.map((entry) => entry.revenue), 1)
    const chartWidth = width - left - right
    const chartHeight = 204 - top - bottom
    return entries.map((entry, index) => ({
      ...entry,
      x: entries.length === 1 ? width / 2 : left + (index / (entries.length - 1)) * chartWidth,
      y: top + chartHeight - (entry.revenue / max) * chartHeight,
    }))
  }, [entries])

  if (!points.length || points.every((point) => point.revenue === 0)) {
    return (
      <EmptyState
        compact
        icon={TrendingUp}
        title="Belum ada pendapatan lunas"
        description="Pendapatan muncul setelah pesanan ditandai lunas oleh staff."
      />
    )
  }

  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const area = `${line} L ${points.at(-1).x} 182 L ${points[0].x} 182 Z`
  const labelIndexes = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])
  const label = (key) => formatDateShort(startOfJakartaDay(key))

  return (
    <div className="chart-wrap">
      <svg className="revenue-chart" viewBox="0 0 840 204" role="img" aria-label="Grafik pendapatan harian dari pesanan lunas">
        <defs>
          <linearGradient id="revenueFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#63846b" stopOpacity=".2" />
            <stop offset="100%" stopColor="#63846b" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[20, 72, 124, 182].map((y) => <line key={y} x1="14" x2="826" y1={y} y2={y} className="chart-gridline" />)}
        <path d={area} fill="url(#revenueFill)" />
        <path d={line} className="chart-line" />
        {points.map((point) => (
          <circle key={point.key} cx={point.x} cy={point.y} r="3.2" className="chart-point">
            <title>{`${label(point.key)}: ${formatRupiah(point.revenue)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="chart-labels" aria-hidden="true">
        {points.map((point, index) => (
          <span key={point.key} className={labelIndexes.has(index) ? '' : 'chart-label-hidden'}>{label(point.key)}</span>
        ))}
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton-v2" role="status" aria-label="Memuat statistik dashboard">
      <div className="metrics-grid-v2">
        {[0, 1, 2, 3].map((index) => <StatCard key={index} loading label="Memuat…" />)}
      </div>
      <Skeleton height={260} radius={18} />
    </div>
  )
}

export function DashboardPage() {
  const { cafe, profile, features } = useOutletContext()
  const { supabase } = useAuth()
  const [preset, setPreset] = useState('7d')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  const requestId = useRef(0)

  const range = useMemo(() => resolveRange(preset), [preset])

  const loadDashboard = useCallback(async () => {
    const currentRequest = ++requestId.current
    setLoading(true)
    setErrorMessage('')

    const [ordersResult, itemsResult, productsResult] = await Promise.all([
      fetchAllRows(() => supabase.from('orders')
        .select(orderColumns(features))
        .eq('cafe_id', cafe.id)
        .gte('created_at', range.previous.start.toISOString())
        .lt('created_at', range.endExclusive.toISOString())
        .order('created_at', { ascending: true })),
      // Item dicari per tanggal (+ buffer 1 hari) lalu dicocokkan dengan id pesanan.
      fetchAllRows(() => supabase.from('order_items')
        .select('order_id, product_id, product_name, quantity, subtotal')
        .eq('cafe_id', cafe.id)
        .gte('created_at', new Date(range.start.getTime() - DAY_MS).toISOString())
        .lt('created_at', new Date(range.endExclusive.getTime() + DAY_MS).toISOString())
        .order('created_at', { ascending: true })),
      supabase.from('products').select('id, name, image_url, is_available').eq('cafe_id', cafe.id),
    ])
    if (currentRequest !== requestId.current) return

    const error = ordersResult.error || itemsResult.error || productsResult.error
    if (error) {
      setErrorMessage(friendlyError(error))
      setLoading(false)
      return
    }

    const result = computeDashboard({
      orders: ordersResult.data,
      items: itemsResult.data,
      products: productsResult.data || [],
      range,
    })
    const { names } = await fetchCustomerNames(supabase, result.recent.map((order) => order.id))
    if (currentRequest !== requestId.current) return
    result.recent = result.recent.map((order) => ({ ...order, customer_name: names.get(order.id) || '' }))

    setData(result)
    setLoading(false)
  }, [cafe.id, features, range, supabase])

  useEffect(() => {
    const timer = window.setTimeout(loadDashboard, 0)
    return () => {
      window.clearTimeout(timer)
      requestId.current += 1
    }
  }, [attempt, loadDashboard])

  const ownerFirstName = profile?.full_name?.trim().split(/\s+/)[0]
  const compareLabel = previousRangeLabel(range)
  const summary = data?.summary

  return (
    <div className="dashboard-content">
      <header className="page-heading">
        <div>
          <span className="page-eyebrow"><span className="eyebrow-dot" /> RINGKASAN · {cafe.name.toUpperCase()}</span>
          <h1>{greetingForNow()}{ownerFirstName ? `, ${ownerFirstName}` : ''}<span className="heading-period">.</span></h1>
          <p>Berikut performa {cafe.name} untuk {range.label.replace('Hari ini, ', 'hari ini, ')}.</p>
        </div>
      </header>

      <section className="range-toolbar" aria-label="Rentang tanggal">
        <SegmentedControl label="Pilih rentang tanggal" value={preset} onChange={setPreset} options={RANGE_PRESETS} />
        <span className="data-note"><Clock3 size={14} aria-hidden="true" /> {range.label} · WIB</span>
      </section>

      {errorMessage ? (
        <ErrorState message={errorMessage} onRetry={() => setAttempt((value) => value + 1)} />
      ) : loading || !data ? (
        <DashboardSkeleton />
      ) : (
        <>
          <section className="metrics-grid-v2" aria-label="Ringkasan performa">
            <StatCard
              icon={CircleDollarSign}
              label="Pendapatan lunas"
              value={formatRupiah(summary.revenue)}
              delta={data.deltas.revenue}
              deltaLabel={compareLabel}
              trend={data.byDay.length > 1 ? data.byDay.map((day) => day.revenue) : undefined}
              caption={`${formatNumber(summary.paidOrders)} pesanan lunas`}
            />
            <StatCard
              icon={ShoppingBag}
              tone="blue"
              label="Jumlah pesanan"
              value={formatNumber(summary.orders)}
              delta={data.deltas.orders}
              deltaLabel={compareLabel}
              trend={data.byDay.length > 1 ? data.byDay.map((day) => day.orders) : undefined}
              caption="Tidak termasuk yang dibatalkan"
            />
            <StatCard
              icon={ReceiptText}
              tone="neutral"
              label="Rata-rata per pesanan"
              value={formatRupiah(summary.averageOrder)}
              delta={summary.paidOrders ? data.deltas.averageOrder : null}
              deltaLabel={compareLabel}
              caption="Dari pesanan lunas"
            />
            <StatCard
              icon={Wallet}
              tone="amber"
              label="Selesai, belum lunas"
              value={formatRupiah(summary.completedUnpaidValue)}
              caption={`${formatNumber(summary.completedUnpaid)} pesanan · ${formatNumber(summary.cancelled)} dibatalkan`}
            />
          </section>

          {summary.completedUnpaid > 0 && summary.paidOrders === 0 && (
            <div className="dashboard-hint" role="note">
              <Wallet size={17} aria-hidden="true" />
              <span>
                Ada {formatNumber(summary.completedUnpaid)} pesanan selesai senilai <strong>{formatRupiah(summary.completedUnpaidValue)}</strong> yang
                belum ditandai lunas, jadi belum dihitung sebagai pendapatan.
                {features?.operations ? ' Staff bisa menandainya lunas dari halaman Pesanan.' : ' Tombol "Tandai lunas" aktif setelah pembaruan database diterapkan.'}
              </span>
            </div>
          )}

          <section className="dashboard-grid">
            <article className="panel revenue-panel">
              <div className="panel-heading">
                <div>
                  <h2>Pendapatan per hari</h2>
                  <p>{range.label}</p>
                </div>
                <div className="chart-legend"><span /> Pendapatan lunas</div>
              </div>
              <RevenueChart entries={data.byDay} />
            </article>

            <article className="panel popular-panel">
              <div className="panel-heading">
                <div>
                  <h2>Produk populer</h2>
                  <p>Jumlah terjual, pesanan tidak dibatalkan</p>
                </div>
              </div>
              {data.popular.length ? (
                <ol className="popular-list">
                  {data.popular.slice(0, 5).map((product, index) => (
                    <li className="popular-item" key={product.key}>
                      <span className={`popular-rank${index === 0 ? ' top-rank' : ''}`}>{String(index + 1).padStart(2, '0')}</span>
                      <span className="popular-product-info">
                        <strong>{product.name}</strong>
                        <span className="tabular">{formatNumber(product.quantity)} terjual · {Math.round(product.share)}%</span>
                      </span>
                      <span className="popular-revenue tabular">{formatRupiah(product.revenue)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState compact icon={PackageOpen} title="Belum ada produk terjual" description="Coba pilih rentang tanggal yang lebih panjang." />
              )}
            </article>
          </section>

          <section className="panel transactions-panel">
            <div className="panel-heading transactions-heading">
              <div>
                <h2>Transaksi terbaru</h2>
                <p>5 pesanan terakhir pada rentang ini</p>
              </div>
            </div>
            {data.recent.length ? (
              <div className="recent-list">
                {data.recent.map((order) => (
                  <article className="recent-row" key={order.id}>
                    <strong className="recent-queue tabular">{formatQueueNumber(order)}</strong>
                    <span className="recent-customer">
                      <span>{customerLabel(order)}</span>
                      <small>{formatDateShort(order.created_at)} · {formatTime(order.created_at)}</small>
                    </span>
                    <OrderStatusBadge status={order.order_status} size="sm" />
                    <PaymentBadge status={order.payment_status} size="sm" />
                    <strong className="recent-amount tabular">{formatRupiah(order.total_amount)}</strong>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState compact icon={ShoppingBag} title="Belum ada transaksi" description="Pesanan dari customer akan tampil di sini." />
            )}
          </section>
        </>
      )}
    </div>
  )
}
