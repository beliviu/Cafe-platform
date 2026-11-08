/*
 * Perhitungan dashboard owner di frontend (zona WIB).
 * Menggantikan RPC owner_dashboard_analytics yang mengelompokkan per tanggal UTC.
 *
 * Aturan:
 * - Pendapatan = pesanan LUNAS yang tidak dibatalkan.
 * - Jumlah pesanan = pesanan yang tidak dibatalkan.
 * - "Selesai belum lunas" dihitung terpisah agar owner tahu uang yang belum tercatat.
 */
import { dateKeysBetween } from './dateRange.js'
import { jakartaDateKey, jakartaHour, minutesSince } from './format.js'

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000
const amount = (order) => Number(order.total_amount) || 0
export const isCancelled = (order) => order.order_status === 'cancelled'
export const isPaid = (order) => order.payment_status === 'paid' && !isCancelled(order)
export const isCompletedUnpaid = (order) => order.order_status === 'completed' && order.payment_status !== 'paid'

/** 0 = Senin … 6 = Minggu (WIB). */
export function jakartaWeekday(value) {
  const day = new Date(new Date(value).getTime() + JAKARTA_OFFSET_MS).getUTCDay()
  return (day + 6) % 7
}

export function percentChange(current, previous) {
  if (!previous) return current ? null : 0
  return ((current - previous) / previous) * 100
}

function summarize(orders) {
  const active = orders.filter((order) => !isCancelled(order))
  const paid = active.filter(isPaid)
  const completedUnpaid = active.filter(isCompletedUnpaid)
  const revenue = paid.reduce((sum, order) => sum + amount(order), 0)
  return {
    revenue,
    orders: active.length,
    paidOrders: paid.length,
    averageOrder: paid.length ? revenue / paid.length : 0,
    cancelled: orders.length - active.length,
    unpaid: active.filter((order) => order.payment_status !== 'paid').length,
    completedUnpaid: completedUnpaid.length,
    completedUnpaidValue: completedUnpaid.reduce((sum, order) => sum + amount(order), 0),
  }
}

/**
 * orders: pesanan dari range.previous.start s/d range.endExclusive
 * items: order_items untuk pesanan-pesanan tersebut
 * products: (opsional) katalog, untuk thumbnail & produk nonaktif
 */
export function computeDashboard({ orders = [], items = [], products = [], range, now = Date.now() }) {
  const startMs = range.start.getTime()
  const endMs = range.endExclusive.getTime()
  const prevStartMs = range.previous.start.getTime()
  const created = (order) => new Date(order.created_at).getTime()

  const current = orders.filter((order) => created(order) >= startMs && created(order) < endMs)
  const previous = orders.filter((order) => created(order) >= prevStartMs && created(order) < startMs)
  const summary = summarize(current)
  const previousSummary = summarize(previous)

  // Per hari
  const keys = dateKeysBetween(range.startKey, range.endKey)
  const dayIndex = new Map(keys.map((key, index) => [key, index]))
  const byDay = keys.map((key) => ({ key, revenue: 0, orders: 0, completedUnpaidValue: 0 }))
  const prevByDay = Array.from({ length: keys.length }, () => ({ revenue: 0, orders: 0 }))
  const prevKeyOffset = new Map(dateKeysBetween(range.previous.startKey, range.previous.endKey).map((key, index) => [key, index]))

  // Per jam & heatmap hari × jam
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, revenue: 0 }))
  const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0))

  for (const order of current) {
    if (isCancelled(order)) continue
    const day = byDay[dayIndex.get(jakartaDateKey(order.created_at))]
    const hour = jakartaHour(order.created_at)
    if (day) {
      day.orders += 1
      if (isPaid(order)) day.revenue += amount(order)
      if (isCompletedUnpaid(order)) day.completedUnpaidValue += amount(order)
    }
    byHour[hour].orders += 1
    if (isPaid(order)) byHour[hour].revenue += amount(order)
    heatmap[jakartaWeekday(order.created_at)][hour] += 1
  }
  for (const order of previous) {
    if (isCancelled(order)) continue
    const slot = prevByDay[prevKeyOffset.get(jakartaDateKey(order.created_at))]
    if (!slot) continue
    slot.orders += 1
    if (isPaid(order)) slot.revenue += amount(order)
  }

  // Produk populer (pesanan tidak dibatalkan)
  const activeIds = new Set(current.filter((order) => !isCancelled(order)).map((order) => order.id))
  const productMap = new Map(products.map((product) => [product.id, product]))
  const popularMap = new Map()
  let itemRevenueTotal = 0
  for (const item of items) {
    if (!activeIds.has(item.order_id)) continue
    const key = item.product_id || item.product_name
    const entry = popularMap.get(key) || { key, productId: item.product_id, name: item.product_name, quantity: 0, revenue: 0 }
    entry.quantity += Number(item.quantity) || 0
    entry.revenue += Number(item.subtotal) || 0
    itemRevenueTotal += Number(item.subtotal) || 0
    popularMap.set(key, entry)
  }
  const popular = [...popularMap.values()]
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue || a.name.localeCompare(b.name))
    .map((entry) => ({
      ...entry,
      imageUrl: productMap.get(entry.productId)?.image_url || null,
      share: itemRevenueTotal ? (entry.revenue / itemRevenueTotal) * 100 : 0,
    }))

  // Metode pembayaran (pesanan lunas)
  const methodMap = new Map()
  for (const order of current.filter(isPaid)) {
    const method = order.payment_method || 'unknown'
    const entry = methodMap.get(method) || { method, count: 0, amount: 0 }
    entry.count += 1
    entry.amount += amount(order)
    methodMap.set(method, entry)
  }
  const paymentMethods = [...methodMap.values()].sort((a, b) => b.amount - a.amount)

  // Perlu perhatian (dari seluruh rentang saat ini)
  const waitingTooLong = current
    .filter((order) => order.order_status === 'pending' && minutesSince(order.created_at, now) >= 10)
    .sort((a, b) => created(a) - created(b))
  const completedUnpaid = current.filter((order) => !isCancelled(order) && isCompletedUnpaid(order))
    .sort((a, b) => created(b) - created(a))
  const inactiveProducts = products.filter((product) => !product.is_available)

  const recent = [...current].sort((a, b) => created(b) - created(a)).slice(0, 5)

  return {
    summary,
    previousSummary,
    deltas: {
      revenue: percentChange(summary.revenue, previousSummary.revenue),
      orders: percentChange(summary.orders, previousSummary.orders),
      averageOrder: percentChange(summary.averageOrder, previousSummary.averageOrder),
      cancelled: percentChange(summary.cancelled, previousSummary.cancelled),
    },
    byDay,
    prevByDay,
    byHour,
    heatmap,
    popular,
    paymentMethods,
    attention: { waitingTooLong, completedUnpaid, inactiveProducts },
    recent,
  }
}

/** Rentang jam yang ditampilkan: minimal 07–21, diperluas bila ada pesanan di luar itu. */
export function visibleHours(matrix) {
  let first = 7
  let last = 21
  matrix.forEach((row) => row.forEach((count, hour) => {
    if (count > 0) {
      first = Math.min(first, hour)
      last = Math.max(last, hour)
    }
  }))
  return Array.from({ length: last - first + 1 }, (_, index) => first + index)
}
