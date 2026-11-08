/*
 * KHUSUS DEV: RPC analitik (file 11) untuk /preview/owner, dihitung dari pesanan tiruan.
 * Meniru supabase/usulan/11-bi-analitik.sql secara ringkas (definisi & bentuk JSON sama).
 * QA: tambahkan ?ai=mati di URL untuk mensimulasikan Edge Function advisor belum aktif.
 */
import { addDaysToKey, jakartaDateKey } from '../lib/format.js'
import { inventoryRpc } from './mockInventory.js'
import { quickAnswer } from '../lib/bi.js'

const ok = (data) => ({ data, error: null })
const isoDow = (key) => { const day = new Date(`${key}T00:00:00Z`).getUTCDay(); return day === 0 ? 7 : day }
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
const range = (from, to) => { const keys = []; for (let key = from; key <= to; key = addDaysToKey(key, 1)) keys.push(key); return keys }
const paid = (order) => order.order_status !== 'cancelled' && order.payment_status === 'paid'
const sum = (list, pick) => list.reduce((total, item) => total + (Number(pick(item)) || 0), 0)

function daily(store, from, to) {
  const map = new Map(range(from, to).map((key) => [key, { day: key, revenue: 0, orders: 0 }]))
  for (const order of store.orders) {
    if (!paid(order)) continue
    const row = map.get(jakartaDateKey(order.created_at))
    if (row) { row.revenue += Number(order.total_amount); row.orders += 1 }
  }
  return [...map.values()]
}

function fit(store, from, to) {
  const rows = daily(store, from, to)
  const avg = sum(rows, (r) => r.revenue) / rows.length
  const oavg = sum(rows, (r) => r.orders) / rows.length
  const idx = Array(8).fill(1)
  const oidx = Array(8).fill(1)
  for (let k = 1; k <= 7; k += 1) {
    const same = rows.filter((r) => isoDow(r.day) === k)
    if (same.length >= 2 && avg > 0) idx[k] = sum(same, (r) => r.revenue) / same.length / avg
    if (same.length >= 2 && oavg > 0) oidx[k] = sum(same, (r) => r.orders) / same.length / oavg
  }
  const recent = rows.slice(-28)
  const level = sum(recent, (r) => r.revenue) / (sum(recent, (r) => idx[isoDow(r.day)]) || 1)
  const olevel = sum(recent, (r) => r.orders) / (sum(recent, (r) => oidx[isoDow(r.day)]) || 1)
  const residuals = recent.map((r) => r.revenue - level * idx[isoDow(r.day)])
  const mean = sum(residuals, (v) => v) / residuals.length
  const sigma = residuals.length > 1 ? Math.sqrt(sum(residuals, (v) => (v - mean) ** 2) / (residuals.length - 1)) : 0
  return { idx, oidx, level, olevel, sigma }
}

function compare(store, key, from, to, prevFrom, prevTo) {
  const cur = daily(store, from, to)
  const prev = daily(store, prevFrom, prevTo)
  const revenue = sum(cur, (r) => r.revenue)
  const previous = sum(prev, (r) => r.revenue)
  return { key, from, to, previous_from: prevFrom, previous_to: prevTo, revenue, previous_revenue: previous, orders: sum(cur, (r) => r.orders), previous_orders: sum(prev, (r) => r.orders), change_pct: previous > 0 ? Math.round(((revenue - previous) / previous) * 1000) / 10 : null }
}

function forecast(store, horizon = 14) {
  const today = jakartaDateKey()
  const end = addDaysToKey(today, -1)
  const first = store.orders.filter(paid).map((order) => jakartaDateKey(order.created_at)).sort()[0]
  const monthStart = `${today.slice(0, 8)}01`
  const mtdDays = daysBetween(monthStart, today)
  const comparisons = [compare(store, 'last_7', addDaysToKey(today, -7), end, addDaysToKey(today, -14), addDaysToKey(today, -8)), compare(store, 'last_28', addDaysToKey(today, -28), end, addDaysToKey(today, -56), addDaysToKey(today, -29))]
  if (mtdDays > 0) {
    const [y, m] = today.split('-').map(Number)
    const prevMonth = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}-01`
    comparisons.push(compare(store, 'month_to_date', monthStart, end, prevMonth, addDaysToKey(prevMonth, mtdDays - 1)))
    comparisons.push(compare(store, 'month_to_date_last_year', monthStart, end, `${y - 1}${monthStart.slice(4)}`, addDaysToKey(`${y - 1}${monthStart.slice(4)}`, mtdDays - 1)))
  }
  const start = first && first > addDaysToKey(today, -56) ? first : addDaysToKey(today, -56)
  const days = first ? daysBetween(start, end) + 1 : 0
  const history = first ? daily(store, start > addDaysToKey(today, -28) ? start : addDaysToKey(today, -28), today) : []
  const active = first ? daily(store, start, end).filter((r) => r.revenue > 0).length : 0
  if (days < 14 || active < 10) {
    return { basis: 'data_kurang', reason: `Butuh minimal 14 hari riwayat dan 10 hari berjualan; tersedia ${days} hari riwayat, ${active} hari berjualan.`, today, history_days: days, active_days: active, daily: [], weekly: [], monthly: [], history, comparisons }
  }
  const model = fit(store, start, end)
  const at = (key) => model.level * model.idx[isoDow(key)]
  const z = 1.2816
  const dailyRows = range(today, addDaysToKey(today, horizon - 1)).map((key) => ({
    day: key, revenue: Math.round(at(key)), low: Math.round(Math.max(at(key) - z * model.sigma, 0)), high: Math.round(at(key) + z * model.sigma),
    orders: Math.round(model.olevel * model.oidx[isoDow(key)] * 10) / 10, actual: key === today ? daily(store, today, today)[0].revenue : null,
  }))
  const block = (from, to) => {
    const actual = from <= end ? sum(daily(store, from, to < end ? to : end), (r) => r.revenue) : 0
    const rest = range(from > today ? from : today, to)
    const fc = sum(rest, at)
    return { actual, forecast_rest: Math.round(fc), projection: Math.round(actual + fc), low: Math.round(Math.max(actual + fc - z * model.sigma * Math.sqrt(rest.length), actual)), high: Math.round(actual + fc + z * model.sigma * Math.sqrt(rest.length)) }
  }
  const monday = addDaysToKey(today, -(isoDow(today) - 1))
  const weekly = [0, 1, 2, 3].map((i) => {
    const from = addDaysToKey(monday, i * 7)
    const to = addDaysToKey(from, 6)
    return { week_start: from, week_end: to, ...block(from, to), previous_actual: addDaysToKey(to, -7) <= end ? sum(daily(store, addDaysToKey(from, -7), addDaysToKey(to, -7)), (r) => r.revenue) : null }
  })
  const monthly = [0, 1].map((i) => {
    const [y, m] = today.split('-').map(Number)
    const date = new Date(Date.UTC(y, m - 1 + i, 1))
    const from = date.toISOString().slice(0, 10)
    const to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
    const prevFrom = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1)).toISOString().slice(0, 10)
    return { month: from, month_end: to, ...block(from, to), previous_month_actual: addDaysToKey(from, -1) <= end ? sum(daily(store, prevFrom, addDaysToKey(from, -1)), (r) => r.revenue) : null, last_year_actual: null }
  })
  const btStart = addDaysToKey(today, -14)
  let wape = null
  if (days >= 42) {
    const bt = fit(store, start, addDaysToKey(today, -15))
    const rows = daily(store, btStart, end)
    const actual = sum(rows, (r) => r.revenue)
    wape = actual > 0 ? Math.round((sum(rows, (r) => Math.abs(r.revenue - bt.level * bt.idx[isoDow(r.day)])) / actual) * 1000) / 10 : null
  }
  return {
    basis: 'ok', today, history_days: days, active_days: active,
    method: 'Rata-rata per hari (Senin–Minggu) dari riwayat s/d 8 minggu, disesuaikan dengan tingkat penjualan 4 minggu terakhir. Asumsi: pola terakhir berlanjut; promo, libur, dan cuaca tidak diperhitungkan.',
    level: Math.round(model.level), sigma: Math.round(model.sigma), backtest_wape: wape, interval: 80, daily: dailyRows, weekly, monthly, history, comparisons,
  }
}

function demand(store) {
  const today = jakartaDateKey()
  const start28 = addDaysToKey(today, -28)
  const ordersById = new Map(store.orders.filter(paid).map((order) => [order.id, order]))
  const first = [...ordersById.values()].map((order) => jakartaDateKey(order.created_at)).sort()[0]
  const enough = first && daysBetween(first, today) >= 14
  const model = enough ? fit(store, first > addDaysToKey(today, -56) ? first : addDaysToKey(today, -56), addDaysToKey(today, -1)) : null
  const past = model ? sum(range(first > start28 ? first : start28, addDaysToKey(today, -1)), (key) => model.oidx[isoDow(key)]) : 0
  const future = model ? sum(range(today, addDaysToKey(today, 6)), (key) => model.oidx[isoDow(key)]) : 0
  return store.products.map((product) => {
    const items = store.order_items.filter((item) => item.product_id === product.id && ordersById.has(item.order_id))
    const q28 = sum(items.filter((item) => jakartaDateKey(ordersById.get(item.order_id).created_at) >= start28 && jakartaDateKey(ordersById.get(item.order_id).created_at) < today), (item) => item.quantity)
    const forecastQty = model && past ? Math.round((q28 / past) * future * 10) / 10 : null
    const portions = store.cafe_settings[0].inventory_tracking && product.id === 'p7' ? 9 : null
    return { product_id: product.id, name: product.name, is_available: product.is_available, quantity_28: q28, quantity_prev_28: 0, trend_pct: null, avg_daily: Math.round((q28 / 28) * 100) / 100, forecast_quantity: forecastQty, portions, days_cover: portions && forecastQty ? Math.round((portions / (forecastQty / 7)) * 10) / 10 : null, basis: model ? 'ok' : 'data_kurang' }
  }).filter((row) => row.quantity_28 > 0 || row.is_available).sort((a, b) => b.quantity_28 - a.quantity_28)
}

function customers(store, from, to, includePeople = true) {
  const today = jakartaDateKey()
  const days = daysBetween(from, to) + 1
  const prevFrom = addDaysToKey(from, -days)
  const sales = store.orders.filter(paid).map((order) => ({ ...order, key: jakartaDateKey(order.created_at) })).filter((order) => order.key <= to)
  const cur = sales.filter((order) => order.key >= from)
  const per = new Map()
  for (const order of cur.filter((o) => o.customer_id)) per.set(order.customer_id, [...(per.get(order.customer_id) || []), order])
  const firstOf = new Map()
  for (const order of sales.filter((o) => o.customer_id)) if (!firstOf.has(order.customer_id) || order.key < firstOf.get(order.customer_id)) firstOf.set(order.customer_id, order.key)
  const prevSet = new Set(sales.filter((o) => o.customer_id && o.key >= prevFrom && o.key < from).map((o) => o.customer_id))
  const retained = [...prevSet].filter((id) => per.has(id)).length
  const avg = (list) => (list.length ? Math.round(sum(list, (o) => o.total_amount) / list.length) : null)
  const counts = [...per.values()].map((list) => list.length)
  const gaps = [...per.values()].filter((list) => list.length >= 2).map((list) => daysBetween(list[0].key, list.at(-1).key) / (list.length - 1)).sort((a, b) => a - b)
  const productMap = new Map()
  for (const order of cur.filter((o) => o.customer_id)) {
    for (const item of store.order_items.filter((row) => row.order_id === order.id)) {
      const entry = productMap.get(item.product_id) || { name: item.product_name, quantity: 0, buyers: new Map() }
      entry.quantity += item.quantity
      entry.buyers.set(order.customer_id, (entry.buyers.get(order.customer_id) || 0) + 1)
      productMap.set(item.product_id, entry)
    }
  }
  const lastOf = new Map()
  for (const order of sales.filter((o) => o.customer_id)) {
    const entry = lastOf.get(order.customer_id) || { orders: 0, spend: 0, last: order.created_at }
    entry.orders += 1
    entry.spend += Number(order.total_amount)
    if (order.created_at > entry.last) entry.last = order.created_at
    lastOf.set(order.customer_id, entry)
  }
  const inactive = [...lastOf.entries()].map(([id, entry]) => ({ customer_id: id, ...entry, days: daysBetween(jakartaDateKey(entry.last), today) }))
  return {
    from, to, previous_from: prevFrom, previous_to: addDaysToKey(from, -1),
    summary: {
      orders: cur.length, revenue: sum(cur, (o) => o.total_amount), account_orders: cur.filter((o) => o.customer_id).length, guest_orders: cur.filter((o) => !o.customer_id).length,
      account_revenue: sum(cur.filter((o) => o.customer_id), (o) => o.total_amount), aov: avg(cur), aov_account: avg(cur.filter((o) => o.customer_id)), aov_guest: avg(cur.filter((o) => !o.customer_id)),
      customers: per.size, new_customers: [...per.keys()].filter((id) => firstOf.get(id) >= from).length, returning_customers: [...per.keys()].filter((id) => firstOf.get(id) < from).length,
      repeat_customers: counts.filter((n) => n >= 2).length, orders_per_customer: counts.length ? Math.round((sum(counts, (n) => n) / counts.length) * 100) / 100 : null,
      spend_per_customer: per.size ? Math.round(sum(cur.filter((o) => o.customer_id), (o) => o.total_amount) / per.size) : null,
    },
    retention: { previous_customers: prevSet.size, retained, rate_pct: prevSet.size ? Math.round((retained / prevSet.size) * 1000) / 10 : null },
    frequency: [['1', (n) => n === 1], ['2-3', (n) => n >= 2 && n <= 3], ['4-9', (n) => n >= 4 && n <= 9], ['10+', (n) => n >= 10]].map(([bucket, test]) => ({ bucket, customers: counts.filter(test).length })),
    interval: { customers: gaps.length, median_days: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)] * 10) / 10 : null },
    products: [...productMap.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 10).map((entry) => ({ name: entry.name, quantity: entry.quantity, buyers: entry.buyers.size, repeat_buyers: [...entry.buyers.values()].filter((n) => n >= 2).length })),
    cohorts: (() => {
      const month = today.slice(0, 7)
      const [y, m] = month.split('-').map(Number)
      const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`
      const sizeOf = (key) => [...firstOf.values()].filter((value) => value.startsWith(key)).length
      return [{ month: `${prev}-01`, size: sizeOf(prev), m1: Math.max(0, sizeOf(prev) - 1), m2: null, m3: null }, { month: `${month}-01`, size: sizeOf(month) || 2, m1: null, m2: null, m3: null }].filter((row) => row.size)
    })(),
    inactive: {
      d30_59: 1 + inactive.filter((row) => row.days >= 30 && row.days < 60).length, d60_89: 1, d90_plus: 0, total_customers: lastOf.size + 2,
      people: includePeople ? [
        { customer_id: 'cust-old-1', full_name: 'Wulan Sari', orders: 14, lifetime_spend: 486000, last_order_at: new Date(Date.now() - 41 * 86400000).toISOString(), days_since: 41 },
        { customer_id: 'cust-old-2', full_name: null, orders: 3, lifetime_spend: 92000, last_order_at: new Date(Date.now() - 67 * 86400000).toISOString(), days_since: 67 },
      ] : null,
    },
  }
}

function stats(store, from, to) {
  const rows = store.orders.filter((order) => { const key = jakartaDateKey(order.created_at); return key >= from && key <= to })
  const ok = rows.filter(paid)
  const revenue = sum(ok, (o) => o.total_amount)
  return {
    from, to, days: daysBetween(from, to) + 1, revenue, orders: ok.length, aov: ok.length ? Math.round(revenue / ok.length) : null,
    unpaid_orders: rows.filter((o) => o.order_status !== 'cancelled' && o.payment_status !== 'paid').length,
    cancelled_orders: rows.filter((o) => o.order_status === 'cancelled').length, cancelled_value: sum(rows.filter((o) => o.order_status === 'cancelled'), (o) => o.total_amount),
    refunds: 0, refund_count: 0, discounts: 0, days_without_sales: daily(store, from, to).filter((r) => r.revenue === 0).length, customers: new Set(ok.map((o) => o.customer_id).filter(Boolean)).size,
  }
}

function facts(store, from, to) {
  const today = jakartaDateKey()
  const end = to > today ? today : to
  const days = daysBetween(from, end) + 1
  const sameMonth = from.endsWith('-01') && from.slice(0, 7) === end.slice(0, 7)
  let prevFrom
  let prevTo
  if (sameMonth) {
    const [y, m] = from.split('-').map(Number)
    prevFrom = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10)
    const lastPrev = addDaysToKey(from, -1)
    const same = `${prevFrom.slice(0, 8)}${end.slice(8)}`
    prevTo = same > lastPrev ? lastPrev : same
  } else {
    prevTo = addDaysToKey(from, -1)
    prevFrom = addDaysToKey(from, -days)
  }
  const cur = stats(store, from, end)
  const prev = stats(store, prevFrom, prevTo)
  const effectOrders = prev.orders ? Math.round((cur.orders - prev.orders) * (prev.revenue / prev.orders)) : 0
  const productTotals = (a, b) => {
    const map = new Map()
    const ids = new Set(store.orders.filter((o) => paid(o) && jakartaDateKey(o.created_at) >= a && jakartaDateKey(o.created_at) <= b).map((o) => o.id))
    for (const item of store.order_items.filter((row) => ids.has(row.order_id))) {
      const entry = map.get(item.product_name) || { revenue: 0, qty: 0 }
      entry.revenue += Number(item.subtotal)
      entry.qty += item.quantity
      map.set(item.product_name, entry)
    }
    return map
  }
  const curP = productTotals(from, end)
  const prevP = productTotals(prevFrom, prevTo)
  const names = new Set([...curP.keys(), ...prevP.keys()])
  const changes = [...names].map((name) => ({ name, current: curP.get(name)?.revenue || 0, previous: prevP.get(name)?.revenue || 0, current_qty: curP.get(name)?.qty || 0, previous_qty: prevP.get(name)?.qty || 0 })).map((row) => ({ ...row, change: row.current - row.previous }))
  const profitRows = inventoryRpc(store, 'inventory_product_profitability', { p_cafe_id: 'cafe-1', p_from: new Date(`${from}T00:00:00+07:00`).toISOString(), p_to: new Date(`${addDaysToKey(end, 1)}T00:00:00+07:00`).toISOString() })?.data || []
  const costed = profitRows.filter((row) => Number(row.uncosted_quantity) < Number(row.quantity_sold))
  const pick = (row) => ({ name: row.product_name, quantity: row.quantity_sold, revenue: row.revenue, gross_profit: row.gross_profit, margin_pct: row.margin_pct, basis: Number(row.estimated_cost) > 0 ? 'estimasi' : 'aktual' })
  const margins = costed.map((row) => Number(row.margin_pct)).sort((a, b) => a - b)
  const qtys = costed.map((row) => Number(row.quantity_sold)).sort((a, b) => a - b)
  const medMargin = margins[Math.floor(margins.length / 2)]
  const medQty = qtys[Math.floor(qtys.length / 2)]
  const stockRows = inventoryRpc(store, 'inventory_forecast', { p_cafe_id: 'cafe-1', p_lookback_days: 28 })?.data || []
  return {
    generated_at: new Date().toISOString(), today, currency: 'IDR', timezone: 'Asia/Jakarta',
    period: { from, to: end, days, previous_from: prevFrom, previous_to: prevTo, partial_today: end === today },
    revenue: {
      current: cur, previous: prev, comparison: sameMonth ? 'same_days_previous_month' : 'previous_equal_period',
      change: cur.revenue - prev.revenue, change_pct: prev.revenue ? Math.round(((cur.revenue - prev.revenue) / prev.revenue) * 1000) / 10 : null,
      effect_orders: effectOrders, effect_basket: cur.revenue - prev.revenue - effectOrders,
      by_channel: [{ channel: 'app', current: Math.round(cur.revenue * 0.62), previous: Math.round(prev.revenue * 0.55), current_orders: Math.round(cur.orders * 0.6), previous_orders: Math.round(prev.orders * 0.55) }, { channel: 'kasir', current: cur.revenue - Math.round(cur.revenue * 0.62), previous: prev.revenue - Math.round(prev.revenue * 0.55), current_orders: cur.orders - Math.round(cur.orders * 0.6), previous_orders: prev.orders - Math.round(prev.orders * 0.55) }],
      by_weekday: [1, 2, 3, 4, 5, 6, 7].map((k) => {
        const avgOf = (a, b) => { const rows = daily(store, a, b).filter((r) => isoDow(r.day) === k); return rows.length ? Math.round(sum(rows, (r) => r.revenue) / rows.length) : null }
        return { isodow: k, current_avg: avgOf(from, end), previous_avg: avgOf(prevFrom, prevTo) }
      }),
      products: { decreases: changes.filter((row) => row.change < 0).sort((a, b) => a.change - b.change).slice(0, 5), increases: changes.filter((row) => row.change > 0).sort((a, b) => b.change - a.change).slice(0, 5) },
    },
    profit: {
      totals: { revenue: sum(profitRows, (r) => r.revenue), gross_profit: sum(costed, (r) => r.gross_profit), revenue_without_recipe: sum(profitRows.filter((r) => !costed.includes(r)), (r) => r.revenue) },
      top_profit: [...costed].sort((a, b) => b.gross_profit - a.gross_profit).slice(0, 5).map(pick),
      top_margin: costed.filter((r) => r.quantity_sold >= 3).sort((a, b) => b.margin_pct - a.margin_pct).slice(0, 5).map(pick),
      low_margin: costed.filter((r) => r.quantity_sold >= 3).sort((a, b) => a.margin_pct - b.margin_pct).slice(0, 5).map(pick),
      without_recipe: profitRows.filter((r) => !costed.includes(r)).map((r) => r.product_name),
    },
    stock: {
      basis: stockRows[0]?.basis || 'data_kurang', tracked_ingredients: stockRows.length,
      low: stockRows.filter((row) => Number(row.on_hand) <= Number(row.min_stock) || (row.days_left !== null && Number(row.days_left) <= Number(row.lead_time_days) + 3))
        .map((row) => ({ name: row.name, unit: row.unit, on_hand: row.on_hand, min_stock: row.min_stock, avg_daily_usage: row.avg_daily_usage, days_left: row.days_left, depletion_date: row.depletion_date, lead_time_days: row.lead_time_days, suggested_quantity: row.suggested_quantity, below_minimum: Number(row.on_hand) <= Number(row.min_stock) })),
    },
    expenses: {
      total: 4350000, previous_total: 3900000,
      by_account: [
        { account: 'Listrik, air & gas', current: 1350000, previous: 900000, change: 450000, change_pct: 50 },
        { account: 'Perlengkapan & kemasan non-stok', current: 500000, previous: 500000, change: 0, change_pct: 0 },
        { account: 'Sewa tempat', current: 2500000, previous: 2500000, change: 0, change_pct: 0 },
      ],
      purchases: 2140000, previous_purchases: 1890000, waste: 86000, previous_waste: 41000,
    },
    promote: costed.length >= 3 ? {
      basis: 'ok', median_margin_pct: medMargin, median_quantity: medQty,
      candidates: costed.filter((row) => Number(row.margin_pct) >= medMargin && Number(row.quantity_sold) <= medQty).sort((a, b) => b.margin_pct - a.margin_pct).slice(0, 5)
        .map((row) => ({ name: row.product_name, quantity: row.quantity_sold, margin_pct: row.margin_pct, gross_profit: row.gross_profit, previous_quantity: prevP.get(row.product_name)?.qty || 0, portions: null, rating: 4.6, rating_count: 5, reasons: ['margin_tinggi', 'penjualan_rendah', ...((prevP.get(row.product_name)?.qty || 0) > row.quantity_sold ? ['penjualan_turun'] : [])] })),
    } : { basis: 'data_kurang', reason: 'Butuh minimal 3 produk terjual yang punya resep (HPP) di periode ini.', candidates: [] },
    customers: customers(store, from, end, false),
    data_quality: { inventory_tracking: Boolean(store.cafe_settings[0].inventory_tracking), accounting_go_live: '2026-11-01', products_without_recipe: profitRows.length - costed.length, account_order_share_pct: 86.4 },
  }
}

export function biRpc(store, name, args) {
  switch (name) {
    case 'bi_sales_forecast': return ok(forecast(store, args.p_horizon))
    case 'bi_product_demand': return ok(demand(store))
    case 'bi_customer_analytics': return ok(customers(store, args.p_from, args.p_to, args.p_include_people !== false))
    case 'bi_advisor_facts': return ok(facts(store, args.p_from || `${jakartaDateKey().slice(0, 8)}01`, args.p_to || jakartaDateKey()))
    case 'bi_advisor_quota': {
      const used = (store.ai_advisor_logs || []).filter((row) => row.status !== 'error' && jakartaDateKey(row.created_at) === jakartaDateKey()).length
      return ok({ allowed: true, limit: 30, used, remaining: Math.max(30 - used, 0) })
    }
    default: return null
  }
}

export function advisorInvoke(store, body) {
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('ai') === 'mati') {
    return { data: { error: 'Tanya AI belum diaktifkan di server (ANTHROPIC_API_KEY belum diatur).', hint: 'ai_not_configured' }, error: null }
  }
  const pack = facts(store, body.from, body.to)
  const revenue = quickAnswer('revenue', pack)
  const answer = `(Pratinjau — contoh jawaban, bukan AI sungguhan)\n\n${revenue.headline}\n\n${revenue.points.slice(0, 3).map((point) => `• ${point}`).join('\n')}\n\nSaran:\n${(revenue.actions.length ? revenue.actions : ['Pantau angka ini minggu depan.']).map((point) => `• ${point}`).join('\n')}`
  store.ai_advisor_logs = store.ai_advisor_logs || []
  store.ai_advisor_logs.push({ id: `log-${store.ai_advisor_logs.length + 1}`, cafe_id: 'cafe-1', question: body.question, answer, status: 'answered', created_at: new Date().toISOString() })
  const used = store.ai_advisor_logs.filter((row) => row.status !== 'error').length
  return { data: { answer, model: 'claude-opus-5-5', period: pack.period, truncated: false, remaining: Math.max(30 - used, 0) }, error: null }
}
