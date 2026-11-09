/*
 * KHUSUS DEV/QA: klien Supabase tiruan untuk app customer (EXPO_PUBLIC_MOCK=1).
 * Data contoh di memori, meniru RPC file 06 & 08 secara ringkas. Tidak menyentuh database live.
 * Kendali QA (web): window.__customerMock.setStatus(orderId, 'ready') · .pause(true) · .closeNow(true)
 */
// QA: ?qris=statis → gateway mati & QRIS statis kafe terpasang
const STATIC_QRIS_DEMO = typeof window !== 'undefined' && /qris=statis/.test(window.location?.search || '')
const DEMO_QRIS_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#fff"/><text x="150" y="40" font-size="22" text-anchor="middle" font-family="Arial" font-weight="bold">QRIS</text><rect x="50" y="80" width="200" height="200" fill="none" stroke="#000" stroke-width="10"/><rect x="90" y="120" width="40" height="40"/><rect x="170" y="120" width="40" height="40"/><rect x="90" y="200" width="40" height="40"/><rect x="150" y="180" width="20" height="60"/><text x="150" y="330" font-size="16" text-anchor="middle" font-family="Arial">KOPI SENJA (DEMO)</text></svg>')}`
const CAFE_ID = 'cafe-1'
const USER_ID = 'cust-1'
const DAY = 86400000
let seq = 100
const uid = (prefix) => `${prefix}-${(seq += 1)}`
const now = () => new Date().toISOString()
const fail = (message, hint) => ({ data: null, error: { message, hint } })
const ok = (data) => ({ data, error: null })
const wait = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms))

function fixtures() {
  const t = Date.now()
  const products = [
    ['p1', 'cat-kopi', 'Es Kopi Susu Gula Aren', 24000, 'Espresso, susu segar, gula aren.'],
    ['p2', 'cat-kopi', 'Vanilla Latte', 28000, 'Lembut dengan aroma vanila.'],
    ['p3', 'cat-kopi', 'Caramel Macchiato', 32000, null],
    ['p4', 'cat-non', 'Matcha Latte', 30000, 'Matcha Uji, susu segar.'],
    ['p5', 'cat-pastry', 'Croissant Mentega', 22000, 'Dipanggang setiap pagi.'],
    ['p6', 'cat-pastry', 'Banana Bread', 20000, null],
  ].map(([id, category_id, name, price, description]) => ({ id, cafe_id: CAFE_ID, category_id, name, price, description, image_url: null, is_available: id !== 'p6' }))
  const orderDone = { id: 'order-done', cafe_id: CAFE_ID, customer_id: USER_ID, order_number: '1001', queue_number: 12, subtotal_amount: 52000, discount_amount: 0, voucher_discount: 0, points_discount: 0, points_redeemed: 0, service_charge_amount: 0, tax_amount: 5200, rounding_amount: -200, total_amount: 57000, order_status: 'completed', payment_status: 'paid', payment_method: 'cash', created_at: new Date(t - 3 * DAY).toISOString(), paid_at: new Date(t - 3 * DAY).toISOString(), estimated_ready_at: null, scheduled_for: null, table_label: null, order_type: 'takeaway', cancel_reason: null, cancelled_at: null, cancelled_by: null, voucher_code: null, discount_reason: null, notes: null, paid_amount: 57000, refunded_amount: 0 }
  const orderCancelled = { ...orderDone, id: 'order-cancel', order_number: '1002', queue_number: 4, order_status: 'cancelled', payment_status: 'unpaid', paid_amount: 0, paid_at: null, cancel_reason: 'Susu habis', cancelled_at: new Date(t - DAY).toISOString(), cancelled_by: 'cafe', created_at: new Date(t - DAY - 600000).toISOString() }
  return {
    cafes: [{ id: CAFE_ID, name: 'Kopi Senja', description: 'Kopi susu gula aren & roti panggang sejak 2019.', address: 'Jl. Kaliurang Km 5', phone: '081234567890', opening_hours: null, app_name: null, logo_url: null, tagline: 'Pesan, ambil, nikmati', brand_color: null, brand_color_2: null }],
    cafe_settings: [{ cafe_id: CAFE_ID, tax_enabled: true, tax_rate: 10, tax_inclusive: false, service_charge_enabled: false, rounding_unit: 500, order_types: ['dine_in', 'takeaway'], ordering_paused: false, ordering_message: null, scheduled_orders_enabled: true, prep_minutes_base: 10, prep_minutes_per_order: 2, qr_ordering_enabled: true, payment_gateway_enabled: !STATIC_QRIS_DEMO, qris_image_url: STATIC_QRIS_DEMO ? DEMO_QRIS_IMAGE : null, loyalty_enabled: true, loyalty_spend_per_point: 10000, loyalty_point_value: 100, loyalty_min_redeem: 50, loyalty_max_redeem_pct: 50, loyalty_tiers: [{ name: 'Bronze', min_spend: 0, multiplier: 1 }, { name: 'Silver', min_spend: 500000, multiplier: 1.25 }, { name: 'Gold', min_spend: 2000000, multiplier: 1.5 }] }],
    categories: [{ id: 'cat-kopi', cafe_id: CAFE_ID, name: 'Kopi' }, { id: 'cat-non', cafe_id: CAFE_ID, name: 'Non-kopi' }, { id: 'cat-pastry', cafe_id: CAFE_ID, name: 'Pastry' }],
    products,
    product_option_groups: [
      { id: 'g-size', cafe_id: CAFE_ID, product_id: 'p2', name: 'Ukuran', selection_type: 'single', is_required: true, max_select: null, sort_order: 0 },
      { id: 'g-extra', cafe_id: CAFE_ID, product_id: 'p2', name: 'Tambahan', selection_type: 'multiple', is_required: false, max_select: 2, sort_order: 1 },
    ],
    product_options: [
      { id: 'o-reg', cafe_id: CAFE_ID, group_id: 'g-size', name: 'Regular', price_delta: 0, is_available: true, is_default: true, sort_order: 0 },
      { id: 'o-large', cafe_id: CAFE_ID, group_id: 'g-size', name: 'Large', price_delta: 6000, is_available: true, is_default: false, sort_order: 1 },
      { id: 'o-shot', cafe_id: CAFE_ID, group_id: 'g-extra', name: 'Extra shot', price_delta: 5000, is_available: true, is_default: false, sort_order: 0 },
      { id: 'o-oat', cafe_id: CAFE_ID, group_id: 'g-extra', name: 'Oat milk', price_delta: 7000, is_available: false, is_default: false, sort_order: 1 },
    ],
    profiles: [{ id: USER_ID, full_name: 'Rani Putri', role: 'customer', cafe_id: null }],
    orders: [orderDone, orderCancelled],
    order_items: [
      { id: 'oi-1', order_id: 'order-done', cafe_id: CAFE_ID, product_id: 'p2', product_name: 'Vanilla Latte (Large)', price: 34000, quantity: 1, subtotal: 34000, notes: null, created_at: orderDone.created_at },
      { id: 'oi-2', order_id: 'order-done', cafe_id: CAFE_ID, product_id: 'p6', product_name: 'Banana Bread', price: 18000, quantity: 1, subtotal: 18000, notes: null, created_at: orderDone.created_at },
      { id: 'oi-3', order_id: 'order-cancel', cafe_id: CAFE_ID, product_id: 'p1', product_name: 'Es Kopi Susu Gula Aren', price: 24000, quantity: 2, subtotal: 48000, notes: null, created_at: orderCancelled.created_at },
    ],
    order_item_options: [{ id: 'oio-1', order_id: 'order-done', order_item_id: 'oi-1', option_id: 'o-large', group_name: 'Ukuran', option_name: 'Large', price_delta: 6000 }],
    payments: [{ id: 'pay-1', order_id: 'order-done', method: 'cash', payment_method: 'cash', status: 'paid', payment_status: 'paid', amount: 57000, paid_at: orderDone.paid_at, created_at: orderDone.paid_at }],
    vouchers: [
      { id: 'v-1', cafe_id: CAFE_ID, code: 'NGOPI10', name: 'Diskon 10% semua menu', discount_type: 'percent', discount_value: 10, max_discount: 15000, min_subtotal: 30000, ends_at: new Date(t + 20 * DAY).toISOString(), is_public: true, is_active: true },
      { id: 'v-2', cafe_id: CAFE_ID, code: 'PAGI5K', name: 'Potongan Rp5.000 sebelum jam 10', discount_type: 'amount', discount_value: 5000, max_discount: null, min_subtotal: 20000, ends_at: null, is_public: true, is_active: true },
    ],
    voucher_redemptions: [],
    loyalty_accounts: [{ cafe_id: CAFE_ID, customer_id: USER_ID, points_balance: 120, lifetime_points: 140, lifetime_spend: 420000, tier: 'Bronze' }],
    loyalty_ledger: [
      { id: 'l-1', cafe_id: CAFE_ID, customer_id: USER_ID, order_id: 'order-done', kind: 'earn', points: 5, balance_after: 120, note: 'Pesanan #12', created_at: orderDone.created_at },
      { id: 'l-0', cafe_id: CAFE_ID, customer_id: USER_ID, order_id: null, kind: 'adjust', points: 115, balance_after: 115, note: 'Bonus member baru', created_at: new Date(t - 10 * DAY).toISOString() },
    ],
    product_reviews: [{ id: 'r-1', cafe_id: CAFE_ID, product_id: 'p2', order_id: 'order-x', customer_id: 'cust-9', rating: 5, comment: 'Vanilanya pas, tidak terlalu manis.', reply: 'Terima kasih, Kak!', is_hidden: false, created_at: new Date(t - 5 * DAY).toISOString(), reviewer: 'Bagas P.' }],
    wishlist_items: [{ customer_id: USER_ID, product_id: 'p4', cafe_id: CAFE_ID, created_at: new Date(t - 2 * DAY).toISOString() }],
    support_tickets: [{ id: 'tk-1', cafe_id: CAFE_ID, customer_id: USER_ID, order_id: 'order-cancel', subject: 'Kenapa pesanan dibatalkan?', status: 'answered', last_message_at: new Date(t - DAY + 3600000).toISOString(), created_at: new Date(t - DAY + 600000).toISOString(), closed_at: null }],
    support_messages: [
      { id: 'sm-1', ticket_id: 'tk-1', cafe_id: CAFE_ID, sender: 'customer', body: 'Pesanan saya dibatalkan, kenapa ya?', created_at: new Date(t - DAY + 600000).toISOString() },
      { id: 'sm-2', ticket_id: 'tk-1', cafe_id: CAFE_ID, sender: 'cafe', body: 'Maaf Kak, susu kami habis. Belum ada pembayaran yang terpotong.', created_at: new Date(t - DAY + 3600000).toISOString() },
    ],
    notifications: [
      { id: 'n-1', user_id: USER_ID, cafe_id: CAFE_ID, kind: 'support', title: 'Balasan: Kenapa pesanan dibatalkan?', body: 'Maaf Kak, susu kami habis.', data: { ticket_id: 'tk-1' }, read_at: null, created_at: new Date(t - DAY + 3600000).toISOString() },
      { id: 'n-2', user_id: USER_ID, cafe_id: CAFE_ID, kind: 'order', title: 'Terima kasih!', body: 'Pesanan #12 selesai. Kamu dapat 5 poin.', data: { order_id: 'order-done' }, read_at: new Date(t - 2 * DAY).toISOString(), created_at: orderDone.created_at },
    ],
    cafe_tables: [{ id: 'tbl-1', cafe_id: CAFE_ID, label: 'A1', area: 'Indoor', is_active: true, qr_token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' }, { id: 'tbl-x', cafe_id: 'cafe-lain', label: 'B9', area: null, is_active: true, qr_token: 'ffffeeeeddddccccbbbbaaaa99998888' }],
    push_tokens: [],
    payment_intents: [],
  }
}

class Query {
  constructor(db, table) { Object.assign(this, { db, table, filters: [], sorts: [], limitTo: null, single: false, mode: 'select', payload: null }) }
  select() { return this }
  eq(c, v) { this.filters.push((r) => r[c] === v); return this }
  neq(c, v) { this.filters.push((r) => r[c] !== v); return this }
  in(c, v) { this.filters.push((r) => v.includes(r[c])); return this }
  is(c, v) { this.filters.push((r) => (r[c] ?? null) === v); return this }
  gte(c, v) { this.filters.push((r) => r[c] >= v); return this }
  lte(c, v) { this.filters.push((r) => r[c] <= v); return this }
  order(c, { ascending = true } = {}) { this.sorts.push([c, ascending]); return this }
  limit(n) { this.limitTo = n; return this }
  maybeSingle() { this.single = true; return this }
  insert(v) { this.mode = 'insert'; this.payload = v; return this }
  update(v) { this.mode = 'update'; this.payload = v; return this }
  delete() { this.mode = 'delete'; return this }
  run() {
    const rows = this.db[this.table] || (this.db[this.table] = [])
    if (this.mode === 'insert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((v) => {
        const row = { id: uid(this.table), created_at: now(), ...v }
        if (this.table === 'wishlist_items') Object.assign(row, { customer_id: USER_ID, cafe_id: this.db.products.find((p) => p.id === v.product_id)?.cafe_id })
        if (this.table === 'wishlist_items' && rows.some((r) => r.product_id === row.product_id && r.customer_id === row.customer_id)) return null
        rows.push(row)
        return row
      }).filter(Boolean)
      return ok(this.single ? list[0] : list)
    }
    let matched = rows.filter((r) => this.filters.every((f) => f(r)))
    if (this.mode === 'update') { matched.forEach((r) => Object.assign(r, this.payload)); return ok(this.single ? matched[0] || null : matched) }
    if (this.mode === 'delete') { this.db[this.table] = rows.filter((r) => !matched.includes(r)); return ok(matched) }
    for (const [c, asc] of [...this.sorts].reverse()) matched = [...matched].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1))
    if (this.limitTo) matched = matched.slice(0, this.limitTo)
    return ok(this.single ? matched[0] || null : matched)
  }
  then(resolve, reject) { return wait().then(() => this.run()).then(resolve, reject) }
}

function priceOrder(db, subtotal, discount) {
  const s = db.cafe_settings[0]
  const base = subtotal - discount
  const tax = s.tax_enabled ? Math.round(base * s.tax_rate) / 100 : 0
  const before = base + tax
  const total = s.rounding_unit ? Math.round(before / s.rounding_unit) * s.rounding_unit : before
  return { tax_amount: tax, rounding_amount: total - before, total_amount: total, discount_amount: discount }
}

function evaluateVoucher(db, code, subtotal) {
  const v = db.vouchers.find((x) => x.code === String(code || '').trim().toUpperCase() && x.is_active)
  if (!v) return { problem: 'Kode voucher tidak ditemukan' }
  if (subtotal < v.min_subtotal) return { problem: `Minimal belanja Rp ${v.min_subtotal.toLocaleString('id-ID')} untuk voucher ini` }
  if (db.voucher_redemptions.some((r) => r.voucher_id === v.id && r.status === 'applied')) return { problem: 'Kamu sudah memakai voucher ini' }
  let discount = v.discount_type === 'percent' ? Math.round(subtotal * v.discount_value / 100) : v.discount_value
  if (v.max_discount) discount = Math.min(discount, v.max_discount)
  return { voucher: v, discount: Math.min(discount, subtotal) }
}

function notify(db, title, body, data, kind = 'order') {
  db.notifications.push({ id: uid('n'), user_id: USER_ID, cafe_id: CAFE_ID, kind, title, body, data, read_at: null, created_at: now() })
}

function rpcs(db, state) {
  const settings = db.cafe_settings[0]
  return {
    cafe_status: () => {
      const open = !state.closed
      const active = db.orders.filter((o) => ['pending', 'confirmed', 'preparing'].includes(o.order_status) && !o.scheduled_for).length
      return ok({ open, hours_set: true, paused: settings.ordering_paused, message: settings.ordering_message, accepting: open && !settings.ordering_paused, scheduled_enabled: settings.scheduled_orders_enabled, next_open: open ? null : new Date(Date.now() + 9 * 3600000).toISOString(), prep_minutes: settings.prep_minutes_base + settings.prep_minutes_per_order * active, qr_enabled: true, loyalty_enabled: settings.loyalty_enabled })
    },
    product_availability: () => ok(db.products.map((p) => ({ product_id: p.id, available: p.is_available, reason: p.is_available ? null : 'manual' }))),
    product_rating_summary: () => {
      const map = new Map()
      for (const r of db.product_reviews.filter((x) => !x.is_hidden)) map.set(r.product_id, [...(map.get(r.product_id) || []), r.rating])
      return ok([...map.entries()].map(([product_id, list]) => ({ product_id, rating: (list.reduce((a, b) => a + b, 0) / list.length).toFixed(1), reviews: list.length })))
    },
    product_reviews_public: ({ p_product_id }) => ok(db.product_reviews.filter((r) => r.product_id === p_product_id && !r.is_hidden).map((r) => ({ ...r, is_mine: r.customer_id === USER_ID, reviewer: r.reviewer || 'Rani P.' }))),
    table_qr_resolve: ({ p_token }) => {
      const t = db.cafe_tables.find((x) => x.qr_token === p_token)
      return ok(t ? { table_id: t.id, label: t.label, area: t.area, active: t.is_active, cafe_id: t.cafe_id, cafe_name: t.cafe_id === CAFE_ID ? 'Kopi Senja' : 'Kafe Lain', qr_enabled: true } : null)
    },
    voucher_check: ({ p_code, p_subtotal }) => {
      const e = evaluateVoucher(db, p_code, p_subtotal)
      return ok({ ok: !e.problem, name: e.voucher?.name || null, discount: e.discount || 0, message: e.problem || null })
    },
    loyalty_me: () => {
      if (!settings.loyalty_enabled) return ok({ enabled: false })
      const a = db.loyalty_accounts[0]
      const tiers = settings.loyalty_tiers
      const tier = [...tiers].reverse().find((t) => t.min_spend <= a.lifetime_spend)
      const next = tiers.find((t) => t.min_spend > a.lifetime_spend) || null
      return ok({ enabled: true, balance: a.points_balance, lifetime_points: a.lifetime_points, lifetime_spend: a.lifetime_spend, tier, next_tier: next, tiers, spend_per_point: settings.loyalty_spend_per_point, point_value: settings.loyalty_point_value, min_redeem: settings.loyalty_min_redeem, max_redeem_pct: settings.loyalty_max_redeem_pct })
    },
    customer_use_static_qris: ({ p_order_id }) => {
      const order = db.orders.find((row) => row.id === p_order_id)
      if (order) order.payment_method = 'qris'
      return ok(null)
    },
    customer_place_order: (args) => {
      if (settings.ordering_paused) return fail(`Kafe sedang tidak menerima pesanan: ${settings.ordering_message || ''}`, 'ordering_paused')
      if (state.closed && !args.p_scheduled_for) return fail('Kafe sedang tutup. Buka lagi besok 08.00 WIB. Kamu bisa menjadwalkan pesanan.', 'cafe_closed')
      const existing = args.p_idempotency_key && db.orders.find((o) => o.idempotency_key === args.p_idempotency_key)
      if (existing) return ok(existing.id)
      const table = args.p_table_token ? db.cafe_tables.find((t) => t.qr_token === args.p_table_token) : null
      if (args.p_table_token && !table) return fail('QR meja tidak valid. Scan ulang QR di meja.', 'table_invalid')
      if (table && table.cafe_id !== args.p_cafe_id) return fail('QR meja ini milik kafe lain.', 'table_other_cafe')
      const id = uid('order')
      let subtotal = 0
      for (const item of args.p_items) {
        const p = db.products.find((x) => x.id === item.product_id)
        if (!p?.is_available) return fail(`${p?.name || 'Menu'} sedang habis`, 'product_unavailable')
        const opts = db.product_options.filter((o) => (item.option_ids || []).includes(o.id))
        const price = p.price + opts.reduce((s, o) => s + o.price_delta, 0)
        subtotal += price * item.quantity
        const itemId = uid('oi')
        db.order_items.push({ id: itemId, order_id: id, cafe_id: CAFE_ID, product_id: p.id, product_name: p.name + (opts.length ? ` (${opts.map((o) => o.name).join(', ')})` : ''), price, quantity: item.quantity, subtotal: price * item.quantity, notes: item.notes || null, created_at: now() })
        opts.forEach((o) => db.order_item_options.push({ id: uid('oio'), order_id: id, order_item_id: itemId, option_id: o.id, group_name: '', option_name: o.name, price_delta: o.price_delta }))
      }
      let voucherDiscount = 0
      let voucher = null
      if (args.p_voucher_code) {
        const e = evaluateVoucher(db, args.p_voucher_code, subtotal)
        if (e.problem) return fail(e.problem, 'voucher_invalid')
        voucher = e.voucher
        voucherDiscount = e.discount
      }
      let points = Number(args.p_redeem_points || 0)
      const account = db.loyalty_accounts[0]
      if (points > 0) {
        if (points < settings.loyalty_min_redeem) return fail(`Minimal tukar ${settings.loyalty_min_redeem} poin`)
        if (points > account.points_balance) return fail(`Poin tidak cukup (saldo ${account.points_balance})`)
        points = Math.min(points, Math.floor(Math.floor((subtotal - voucherDiscount) * settings.loyalty_max_redeem_pct / 100) / settings.loyalty_point_value))
        account.points_balance -= points
        db.loyalty_ledger.push({ id: uid('l'), cafe_id: CAFE_ID, customer_id: USER_ID, order_id: id, kind: 'redeem', points: -points, balance_after: account.points_balance, note: 'Tukar poin', created_at: now() })
      }
      const pointsDiscount = points * settings.loyalty_point_value
      const prep = rpcs(db, state).cafe_status().data.prep_minutes
      const order = {
        id, cafe_id: CAFE_ID, customer_id: USER_ID, order_number: String(2000 + seq), queue_number: 20 + (seq % 50), subtotal_amount: subtotal,
        ...priceOrder(db, subtotal, voucherDiscount + pointsDiscount), service_charge_amount: 0, voucher_discount: voucherDiscount, voucher_code: voucher?.code || null, points_redeemed: points, points_discount: pointsDiscount,
        discount_reason: [voucher && `Voucher ${voucher.code}`, points && `${points} poin`].filter(Boolean).join(' + ') || null,
        order_status: 'pending', payment_status: 'unpaid', payment_method: args.p_payment_method, notes: args.p_notes, created_at: now(), paid_at: null, paid_amount: 0, refunded_amount: 0,
        scheduled_for: args.p_scheduled_for || null, estimated_ready_at: args.p_scheduled_for || new Date(Date.now() + prep * 60000).toISOString(),
        table_id: table?.id || null, table_label: table?.label || null, order_type: table ? 'dine_in' : args.p_order_type, cancel_reason: null, cancelled_at: null, cancelled_by: null, idempotency_key: args.p_idempotency_key,
      }
      db.orders.push(order)
      if (voucher) db.voucher_redemptions.push({ id: uid('vr'), voucher_id: voucher.id, order_id: id, customer_id: USER_ID, amount: voucherDiscount, status: 'applied' })
      return ok(id)
    },
    customer_cancel_order: ({ p_order_id, p_reason }) => {
      const o = db.orders.find((x) => x.id === p_order_id)
      if (o.order_status !== 'pending') return fail('Pesanan sudah diproses kafe. Hubungi kafe untuk membatalkan.')
      Object.assign(o, { order_status: 'cancelled', cancel_reason: p_reason || 'Dibatalkan pelanggan', cancelled_at: now(), cancelled_by: 'customer' })
      db.voucher_redemptions.filter((r) => r.order_id === o.id).forEach((r) => { r.status = 'released' })
      if (o.points_redeemed) {
        const a = db.loyalty_accounts[0]
        a.points_balance += o.points_redeemed
        db.loyalty_ledger.push({ id: uid('l'), cafe_id: CAFE_ID, customer_id: USER_ID, order_id: o.id, kind: 'redeem_return', points: o.points_redeemed, balance_after: a.points_balance, note: 'Pesanan dibatalkan', created_at: now() })
      }
      return ok(o)
    },
    customer_reorder_items: ({ p_order_id }) => ok(db.order_items.filter((i) => i.order_id === p_order_id).map((i) => {
      const p = db.products.find((x) => x.id === i.product_id)
      const optionIds = db.order_item_options.filter((o) => o.order_item_id === i.id).map((o) => o.option_id)
      const opts = db.product_options.filter((o) => optionIds.includes(o.id) && o.is_available)
      const unit = p ? p.price + opts.reduce((s, o) => s + o.price_delta, 0) : null
      return { product_id: i.product_id, name: p?.name || i.product_name, quantity: i.quantity, option_ids: opts.map((o) => o.id), options_label: opts.map((o) => o.name).join(', ') || null, old_unit_price: i.price, unit_price: unit, available: Boolean(p?.is_available), note: !p ? 'Menu sudah tidak dijual' : !p.is_available ? 'Sedang habis' : unit !== i.price ? 'Harga berubah' : null }
    })),
    review_submit: ({ p_order_id, p_product_id, p_rating, p_comment }) => {
      const existing = db.product_reviews.find((r) => r.order_id === p_order_id && r.product_id === p_product_id)
      if (existing) Object.assign(existing, { rating: p_rating, comment: p_comment })
      else db.product_reviews.push({ id: uid('r'), cafe_id: CAFE_ID, product_id: p_product_id, order_id: p_order_id, customer_id: USER_ID, rating: p_rating, comment: p_comment, reply: null, is_hidden: false, created_at: now(), reviewer: 'Rani P.' })
      return ok('ok')
    },
    support_open: ({ p_subject, p_body, p_order_id }) => {
      const id = uid('tk')
      db.support_tickets.push({ id, cafe_id: CAFE_ID, customer_id: USER_ID, order_id: p_order_id || null, subject: p_subject, status: 'open', last_message_at: now(), created_at: now(), closed_at: null })
      db.support_messages.push({ id: uid('sm'), ticket_id: id, cafe_id: CAFE_ID, sender: 'customer', body: p_body, created_at: now() })
      return ok(id)
    },
    support_reply: ({ p_ticket_id, p_body }) => {
      db.support_messages.push({ id: uid('sm'), ticket_id: p_ticket_id, cafe_id: CAFE_ID, sender: 'customer', body: p_body, created_at: now() })
      Object.assign(db.support_tickets.find((t) => t.id === p_ticket_id), { status: 'open', last_message_at: now() })
      return ok('ok')
    },
    support_close: ({ p_ticket_id }) => { Object.assign(db.support_tickets.find((t) => t.id === p_ticket_id), { status: 'closed', closed_at: now() }); return ok(null) },
    notifications_mark_read: ({ p_ids }) => { db.notifications.filter((n) => !n.read_at && (!p_ids || p_ids.includes(n.id))).forEach((n) => { n.read_at = now() }); return ok(1) },
    push_register: () => ok(null),
    push_unregister: () => ok(null),
  }
}

export function createMockSupabase() {
  const db = fixtures()
  const state = { closed: false }
  let session = { user: { id: USER_ID, email: 'rani@contoh.id' }, access_token: 'mock' }
  const authListeners = new Set()
  const channels = new Set()
  const emit = (event) => authListeners.forEach((cb) => cb(event, session))
  const ping = (table) => channels.forEach((ch) => ch.handlers.filter((h) => h.table === table).forEach((h) => h.cb({ eventType: 'UPDATE' })))
  const controls = {
    setStatus(orderId, status) {
      const o = db.orders.find((x) => x.id === orderId) || [...db.orders].reverse().find((x) => x.order_status !== 'completed' && x.order_status !== 'cancelled')
      if (!o) return
      o.order_status = status
      if (status === 'completed') { o.payment_status = 'paid'; o.paid_at = now() }
      notify(db, `Pesanan A-${String(o.queue_number).padStart(3, '0')} ${status === 'ready' ? 'siap' : status === 'completed' ? 'selesai' : 'diperbarui'}`, 'Status pesananmu berubah.', { order_id: o.id })
      ping('orders'); ping('notifications')
    },
    pause(paused, message = 'Antrean sedang penuh') { db.cafe_settings[0].ordering_paused = paused; db.cafe_settings[0].ordering_message = paused ? message : null },
    closeNow(closed) { state.closed = closed },
    signOut() { session = null; emit('SIGNED_OUT') },
    // Simulasi bank mengonfirmasi pembayaran QRIS (webhook gateway)
    payIntent(orderId) {
      const intent = [...db.payment_intents].reverse().find((row) => row.status === 'pending' && (!orderId || row.order_id === orderId))
      if (!intent) return
      Object.assign(intent, { status: 'paid', paid_at: now() })
      const o = db.orders.find((row) => row.id === intent.order_id)
      Object.assign(o, { payment_status: 'paid', paid_at: now(), paid_amount: o.total_amount, payment_method: 'qris' })
      db.payments.push({ id: uid('pay'), order_id: o.id, method: 'qris', payment_method: 'qris', status: 'paid', payment_status: 'paid', amount: intent.amount, paid_at: now(), created_at: now() })
      notify(db, 'Pembayaran diterima', 'Pembayaran QRIS untuk pesananmu sudah kami terima.', { order_id: o.id })
      ping('payment_intents'); ping('orders'); ping('notifications')
    },
  }
  if (typeof window !== 'undefined') {
    window.__customerMock = controls
    document.addEventListener?.('customer-mock', (event) => { const { action, args = [] } = JSON.parse(event.detail); controls[action]?.(...args) })
  }
  const handlers = rpcs(db, state)
  return {
    from: (table) => new Query(db, table),
    rpc: async (name, args = {}) => {
      await wait(150)
      const handler = handlers[name]
      if (name === 'create_order') return handlers.customer_place_order({ ...args, p_items: args.p_items })
      return handler ? handler(args) : { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } }
    },
    channel: () => {
      const ch = { handlers: [], on(_type, filter, cb) { this.handlers.push({ table: filter.table, cb }); return this }, subscribe() { channels.add(this); return this } }
      return ch
    },
    removeChannel: (ch) => { channels.delete(ch) },
    functions: {
      invoke: async (name, { body }) => {
        await wait(300)
        if (name !== 'payments') return { data: null, error: { message: `Fungsi ${name} tidak ada di mock` } }
        const o = db.orders.find((row) => row.id === body.order_id)
        if (body.action === 'create') {
          if (!o) return { data: { error: 'Pesanan tidak ditemukan' }, error: null }
          if (o.payment_status === 'paid') return { data: { error: 'Pesanan sudah lunas' }, error: null }
          const active = db.payment_intents.find((row) => row.order_id === o.id && row.status === 'pending' && Date.parse(row.expires_at) > Date.now() + 30000)
          if (active) return { data: { intent: active, reused: true }, error: null }
          db.payment_intents.filter((row) => row.order_id === o.id && row.status === 'pending').forEach((row) => { row.status = 'expired' })
          const intent = { id: uid('pi'), order_id: o.id, amount: o.total_amount - (o.paid_amount || 0), status: 'pending', qr_string: `00020101021226670016COM.MOCK.QRIS${o.id}5204581253033605802ID5909KOPISENJA6007BANTUL6304ABCD`,
            qr_url: null, expires_at: new Date(Date.now() + 15 * 60000).toISOString(), paid_at: null, created_at: now() }
          db.payment_intents.push(intent)
          o.payment_method = 'qris'
          return { data: { intent }, error: null }
        }
        if (body.action === 'status') return { data: { checked: 1, changed: 0 }, error: null }
        return { data: { error: 'Aksi tidak dikenal' }, error: null }
      },
    },
    storage: { from: () => ({ getPublicUrl: (path) => ({ data: { publicUrl: path } }) }) },
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      getUser: async () => ({ data: { user: session?.user || null }, error: null }),
      onAuthStateChange: (cb) => { authListeners.add(cb); return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } } },
      signInWithPassword: async ({ email }) => { await wait(); session = { user: { id: USER_ID, email }, access_token: 'mock' }; emit('SIGNED_IN'); return { data: { session }, error: null } },
      signUp: async ({ email }) => { await wait(); session = { user: { id: USER_ID, email }, access_token: 'mock' }; emit('SIGNED_IN'); return { data: { session, user: session.user }, error: null } },
      signOut: async () => { session = null; emit('SIGNED_OUT'); return { error: null } },
      resetPasswordForEmail: async () => { await wait(); return { data: {}, error: null } },
      updateUser: async () => { await wait(); return { data: { user: session?.user }, error: null } },
      setSession: async () => ({ data: { session }, error: null }),
      exchangeCodeForSession: async () => ({ data: { session }, error: null }),
      startAutoRefresh: () => {},
      stopAutoRefresh: () => {},
    },
  }
}
