import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import {
  ArrowRight, BarChart3, Boxes, CalendarClock, CircleCheck, Clock3, Coffee, CreditCard, EyeOff,
  Flame, PackageOpen, ShoppingBag, TriangleAlert, Wallet,
} from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import { ColumnChart } from '../components/charts/ColumnChart.jsx'
import { DonutChart } from '../components/charts/DonutChart.jsx'
import { HourHeatmap } from '../components/charts/HourHeatmap.jsx'
import {
  Card, CardHeader, DateRangePicker, EmptyState, ErrorState, OrderStatusBadge, PageHeader, PaymentBadge,
  Badge, KpiCard, SegmentedControl, Skeleton,
} from '../components/ui/index.js'
import { computeDashboard, visibleHours } from '../lib/analytics.js'
import { PAYMENT_METHOD_COLORS, PAYMENT_METHOD_ORDER, paymentMethodSlot } from '../lib/chartColors.js'
import { previousRangeLabel, resolveRange } from '../lib/dateRange.js'
import { customerLabel, fetchAllRows, fetchCustomerNames, friendlyError, orderColumns } from '../lib/db.js'
import {
  formatDate, formatDateShort, formatNumber, formatQueueNumber, formatRupiah, formatRupiahCompact, formatTime,
  addDaysToKey, greetingForNow, jakartaDateKey, startOfJakartaDay,
} from '../lib/format.js'
import { paymentMethodLabel } from '../lib/status.js'

const DAY_MS = 86400000
const hourLabel = (hour) => `${String(hour).padStart(2, '0')}.00`

function TrendCard({ data, range }) {
  const [metric, setMetric] = useState('revenue')
  const hourly = range.days === 1
  const hours = visibleHours([data.byHour.map((entry) => entry.orders)])
  const entries = hourly
    ? hours.map((hour) => ({
      key: String(hour),
      label: String(hour).padStart(2, '0'),
      tooltipLabel: `${hourLabel(hour)}–${hourLabel(hour + 1)}`,
      value: data.byHour[hour][metric],
    }))
    : data.byDay.map((day) => ({
      key: day.key,
      label: formatDateShort(startOfJakartaDay(day.key)),
      tooltipLabel: formatDate(startOfJakartaDay(day.key)),
      value: day[metric],
    }))
  const isRevenue = metric === 'revenue'
  const empty = entries.every((entry) => !entry.value)

  return (
    <Card className="dash-trend">
      <CardHeader
        title={hourly ? 'Tren per jam' : 'Tren harian'}
        description={isRevenue ? 'Pendapatan dari pesanan lunas' : 'Pesanan yang tidak dibatalkan'}
        actions={(
          <SegmentedControl
            size="sm"
            label="Pilih metrik grafik"
            value={metric}
            onChange={setMetric}
            options={[{ value: 'revenue', label: 'Pendapatan' }, { value: 'orders', label: 'Jumlah pesanan' }]}
          />
        )}
      />
      {empty ? (
        <EmptyState
          compact
          icon={BarChart3}
          title={isRevenue ? 'Belum ada pendapatan lunas' : 'Belum ada pesanan'}
          description={isRevenue
            ? 'Pendapatan muncul setelah pesanan ditandai lunas oleh staff.'
            : 'Coba pilih rentang tanggal yang lebih panjang.'}
        />
      ) : (
        <ColumnChart
          data={entries}
          ariaLabel={`${isRevenue ? 'Pendapatan' : 'Jumlah pesanan'} ${hourly ? 'per jam' : 'per hari'}, ${range.label}`}
          formatValue={isRevenue ? formatRupiah : (value) => `${formatNumber(value)} pesanan`}
          formatTick={isRevenue ? formatRupiahCompact : formatNumber}
        />
      )}
    </Card>
  )
}

/** Peringatan stok untuk kotak "Perlu perhatian" — gagal dimuat = diabaikan (dashboard tetap jalan). */
async function loadInventoryAttention(supabase, cafeId) {
  const soon = addDaysToKey(jakartaDateKey(), 3)
  const [ingredientResult, batchResult, issueResult] = await Promise.all([
    supabase.from('ingredients').select('id, name, on_hand, min_stock, is_active').eq('cafe_id', cafeId).eq('is_active', true),
    supabase.from('ingredient_batches').select('id, expires_at, remaining').eq('cafe_id', cafeId).gt('remaining', 0).lte('expires_at', soon),
    supabase.from('inventory_sync_issues').select('id, resolved_at').eq('cafe_id', cafeId).limit(50),
  ])
  if (ingredientResult.error || batchResult.error || issueResult.error) return null
  return {
    needBuy: (ingredientResult.data || []).filter((item) => Number(item.on_hand) <= Number(item.min_stock)),
    expiring: (batchResult.data || []).length,
    issues: (issueResult.data || []).filter((issue) => !issue.resolved_at).length,
  }
}

function AttentionCard({ attention, features }) {
  const { waitingTooLong, completedUnpaid, inactiveProducts, inventory } = attention
  const unpaidValue = completedUnpaid.reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0)
  const items = [
    waitingTooLong.length > 0 && {
      key: 'waiting',
      tone: 'red',
      icon: Clock3,
      title: `${formatNumber(waitingTooLong.length)} pesanan menunggu > 10 menit`,
      detail: `Paling lama ${formatQueueNumber(waitingTooLong[0])} · ${formatTime(waitingTooLong[0].created_at)}`,
      to: '/orders?status=pending',
    },
    completedUnpaid.length > 0 && {
      key: 'unpaid',
      tone: 'amber',
      icon: Wallet,
      title: `${formatNumber(completedUnpaid.length)} pesanan selesai belum lunas`,
      detail: `${formatRupiah(unpaidValue)} belum tercatat sebagai pendapatan${features?.operations ? '' : ' · tombol lunas aktif setelah update database'}`,
      to: '/orders?status=completed&payment=unpaid',
    },
    inactiveProducts.length > 0 && {
      key: 'inactive',
      tone: 'neutral',
      icon: EyeOff,
      title: `${formatNumber(inactiveProducts.length)} produk nonaktif`,
      detail: inactiveProducts.slice(0, 2).map((product) => product.name).join(', ') + (inactiveProducts.length > 2 ? ', …' : ''),
      to: '/products?status=unavailable',
    },
    inventory?.issues > 0 && {
      key: 'stock-sync',
      tone: 'red',
      icon: TriangleAlert,
      title: `${formatNumber(inventory.issues)} pesanan gagal memotong stok`,
      detail: 'Pesanan tetap selesai · tinjau & sesuaikan stok',
      to: '/inventory',
    },
    inventory?.needBuy.length > 0 && {
      key: 'stock-low',
      tone: 'amber',
      icon: Boxes,
      title: `${formatNumber(inventory.needBuy.length)} bahan perlu dibeli`,
      detail: inventory.needBuy.slice(0, 2).map((item) => item.name).join(', ') + (inventory.needBuy.length > 2 ? ', …' : ''),
      to: '/inventory?filter=attention',
    },
    inventory?.expiring > 0 && {
      key: 'stock-expiry',
      tone: 'amber',
      icon: CalendarClock,
      title: `${formatNumber(inventory.expiring)} batch bahan kedaluwarsa ≤ 3 hari`,
      detail: 'Pakai dulu atau catat sebagai terbuang',
      to: '/inventory?filter=expiring',
    },
  ].filter(Boolean)

  const TONE_WORD = { red: 'Mendesak', amber: 'Perlu dicek', neutral: 'Info' }
  return (
    <Card className="dash-attention" aria-label="Perlu perhatian">
      <CardHeader
        title="Perlu perhatian"
        description={items.length ? 'Hal yang sebaiknya diurus dulu hari ini' : undefined}
        actions={items.length ? <Badge tone="amber" dot={false}>{formatNumber(items.length)} hal</Badge> : null}
      />
      {items.length ? (
        <ul className="attention-list">
          {items.map(({ key, tone, icon: Icon, title, detail, to }) => (
            <li key={key}>
              <Link to={to} className="attention-item">
                <span className={`attention-icon attention-${tone}`}><Icon size={17} aria-hidden="true" /></span>
                <span className="attention-text">
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </span>
                <span className="attention-side">
                  <Badge tone={tone} size="sm">{TONE_WORD[tone]}</Badge>
                  <ArrowRight size={16} aria-hidden="true" className="attention-arrow" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact tone="green" icon={CircleCheck} title="Semua beres" description="Tidak ada pesanan tertahan, semua pesanan selesai sudah lunas, dan semua produk aktif." />
      )}
    </Card>
  )
}

function PaymentCard({ methods }) {
  const totals = new Map()
  for (const entry of methods) {
    const slot = paymentMethodSlot(entry.method)
    const current = totals.get(slot) || { amount: 0, count: 0 }
    totals.set(slot, { amount: current.amount + entry.amount, count: current.count + entry.count })
  }
  const segments = PAYMENT_METHOD_ORDER
    .filter((slot) => totals.has(slot))
    .map((slot) => ({
      key: slot,
      label: slot === 'other' ? 'Lainnya' : paymentMethodLabel(slot),
      value: totals.get(slot).amount,
      detail: `${formatNumber(totals.get(slot).count)} pesanan`,
      color: PAYMENT_METHOD_COLORS[slot],
    }))
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)

  return (
    <Card className="dash-payments">
      <CardHeader title="Metode pembayaran" description="Porsi pendapatan lunas" />
      {segments.length ? (
        <DonutChart
          segments={segments}
          centerValue={formatRupiahCompact(total)}
          centerLabel="total lunas"
          formatValue={formatRupiah}
          ariaLabel={`Metode pembayaran: ${segments.map((segment) => `${segment.label} ${formatRupiah(segment.value)}`).join(', ')}`}
        />
      ) : (
        <EmptyState compact icon={CreditCard} title="Belum ada pembayaran lunas" description="Rincian metode muncul setelah staff menandai pesanan lunas." />
      )}
    </Card>
  )
}

function PeakHoursCard({ data }) {
  const busiest = data.byHour.reduce((best, entry) => (entry.orders > best.orders ? entry : best), { hour: null, orders: 0 })
  const empty = !busiest.orders
  return (
    <Card className="dash-heatmap">
      <CardHeader
        title="Jam ramai"
        description={empty ? 'Jumlah pesanan per hari dan jam (WIB)' : `Tersibuk ${hourLabel(busiest.hour)}–${hourLabel(busiest.hour + 1)} · ${formatNumber(busiest.orders)} pesanan pada rentang ini`}
      />
      {empty ? (
        <EmptyState compact icon={Flame} title="Belum ada pesanan" description="Pola jam ramai muncul setelah ada pesanan pada rentang ini." />
      ) : (
        <HourHeatmap matrix={data.heatmap} />
      )}
    </Card>
  )
}

function PopularCard({ popular }) {
  const top = popular.slice(0, 5)
  return (
    <Card className="dash-popular">
      <CardHeader title="Produk populer" description="Peringkat jumlah terjual · bar = kontribusi pendapatan" />
      {top.length ? (
        <ol className="popular-v3">
          {top.map((product, index) => (
            <li key={product.key}>
              <span className="popular-v3-rank tabular">{index + 1}</span>
              {product.imageUrl ? (
                <img className="popular-v3-thumb" src={product.imageUrl} alt="" loading="lazy" />
              ) : (
                <span className="popular-v3-thumb is-empty" aria-hidden="true"><Coffee size={16} /></span>
              )}
              <span className="popular-v3-main">
                <span className="popular-v3-line">
                  <strong>{product.name}</strong>
                  <span className="tabular">{formatRupiah(product.revenue)}</span>
                </span>
                <span className="popular-v3-bar" aria-hidden="true"><span style={{ width: `${Math.max(2, product.share)}%` }} /></span>
                <small className="tabular">{formatNumber(product.quantity)} terjual · {Math.round(product.share)}% pendapatan item</small>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState compact icon={PackageOpen} title="Belum ada produk terjual" description="Coba pilih rentang tanggal yang lebih panjang." />
      )}
    </Card>
  )
}

function RecentCard({ recent }) {
  return (
    <Card className="dash-recent">
      <CardHeader
        title="Transaksi terbaru"
        description="5 pesanan terakhir pada rentang ini"
        actions={<Link to="/orders" className="ui-link-button">Lihat semua <ArrowRight size={15} aria-hidden="true" /></Link>}
      />
      {recent.length ? (
        <ul className="recent-v3">
          {recent.map((order) => (
            <li key={order.id}>
              <strong className="recent-v3-queue tabular">{formatQueueNumber(order)}</strong>
              <span className="recent-v3-who">
                <span>{customerLabel(order)}</span>
                <small className="tabular">{formatDateShort(order.created_at)} · {formatTime(order.created_at)}</small>
              </span>
              <span className="recent-v3-badges">
                <OrderStatusBadge status={order.order_status} size="sm" />
                <PaymentBadge status={order.payment_status} size="sm" />
              </span>
              <strong className="recent-v3-amount tabular">{formatRupiah(order.total_amount)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact icon={ShoppingBag} title="Belum ada transaksi" description="Pesanan dari customer akan tampil di sini." />
      )}
    </Card>
  )
}

function DashboardSkeleton() {
  return (
    <div className="dash" role="status" aria-label="Memuat statistik dashboard">
      <Skeleton height={132} radius={20} />
      <div className="ui-kpi-grid">
        {[0, 1, 2, 3].map((index) => <KpiCard key={index} loading hero={index === 0} label="Memuat…" />)}
      </div>
      <div className="dash-grid">
        <Skeleton className="dash-trend" height={320} radius={20} />
        <Skeleton className="dash-payments" height={320} radius={20} />
      </div>
    </div>
  )
}

export function DashboardPage() {
  const { cafe, profile, features } = useOutletContext()
  const { supabase } = useAuth()
  const [rangeValue, setRangeValue] = useState({ preset: '7d', custom: null })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  const requestId = useRef(0)

  const range = useMemo(() => resolveRange(rangeValue.preset, rangeValue.custom), [rangeValue])

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
    const [{ names }, inventoryAttention] = await Promise.all([
      fetchCustomerNames(supabase, result.recent.map((order) => order.id)),
      features?.inventory ? loadInventoryAttention(supabase, cafe.id) : null,
    ])
    result.attention.inventory = inventoryAttention
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
    <div className="page">
      <div className="dash-intro">
        <PageHeader
          hero
          eyebrow={`Ringkasan · ${cafe.name}`}
          title={`${greetingForNow()}${ownerFirstName ? `, ${ownerFirstName}` : ''}`}
          description={`Performa ${cafe.name} untuk ${range.label.replace('Hari ini, ', 'hari ini, ')} (WIB).`}
          actions={<DateRangePicker value={rangeValue} onChange={setRangeValue} />}
        />
      </div>

      {errorMessage ? (
        <Card><ErrorState message={errorMessage} onRetry={() => setAttempt((value) => value + 1)} /></Card>
      ) : !data ? (
        <DashboardSkeleton />
      ) : (
        <div className={`dash${loading ? ' is-refreshing' : ''}`} aria-busy={loading}>
          <AttentionCard attention={data.attention} features={features} />

          <section className="ui-kpi-grid" aria-label="Ringkasan performa">
            <KpiCard
              hero
              label="Pendapatan lunas"
              value={Number(summary.revenue) || 0}
              format={formatRupiah}
              delta={data.deltas.revenue}
              deltaLabel={compareLabel}
              trend={data.byDay.length > 1 ? data.byDay.map((day) => day.revenue) : undefined}
              caption={`${formatNumber(summary.paidOrders)} pesanan lunas`}
            />
            <KpiCard
              label="Jumlah pesanan"
              value={Number(summary.orders) || 0}
              delta={data.deltas.orders}
              deltaLabel={compareLabel}
              trend={data.byDay.length > 1 ? data.byDay.map((day) => day.orders) : undefined}
              caption="Tidak termasuk yang dibatalkan"
            />
            <KpiCard
              label="Rata-rata per pesanan"
              value={Number(summary.averageOrder) || 0}
              format={formatRupiah}
              delta={summary.paidOrders ? data.deltas.averageOrder : null}
              deltaLabel={compareLabel}
              caption="Dari pesanan lunas"
            />
            <KpiCard
              label="Selesai, belum lunas"
              value={Number(summary.completedUnpaidValue) || 0}
              format={formatRupiah}
              caption={`${formatNumber(summary.completedUnpaid)} pesanan · ${formatNumber(summary.cancelled)} dibatalkan`}
            />
          </section>

          {summary.completedUnpaid > 0 && summary.paidOrders === 0 && (
            <div className="dash-hint" role="note">
              <Wallet size={17} aria-hidden="true" />
              <span>
                Ada {formatNumber(summary.completedUnpaid)} pesanan selesai senilai <strong>{formatRupiah(summary.completedUnpaidValue)}</strong> yang
                belum ditandai lunas, jadi belum dihitung sebagai pendapatan.
                {features?.operations ? ' Staff bisa menandainya lunas dari halaman Pesanan.' : ' Tombol "Tandai lunas" aktif setelah pembaruan database diterapkan.'}
              </span>
            </div>
          )}

          <div className={`dash-grid${range.days === 1 ? ' is-single-day' : ''}`}>
            <TrendCard data={data} range={range} />
            <PaymentCard methods={data.paymentMethods} />
            {range.days > 1 && <PeakHoursCard data={data} />}
            <PopularCard popular={data.popular} />
            <RecentCard recent={data.recent} />
          </div>
        </div>
      )}
    </div>
  )
}
