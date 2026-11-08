/*
 * KHUSUS DEV: klien Supabase tiruan berisi data contoh di memori.
 * Dipakai rute /preview/owner untuk QA visual tanpa login & tanpa menyentuh database.
 * Tidak pernah ikut ke build produksi (dimuat lewat import.meta.env.DEV).
 */

function seeded(seed) {
  let value = seed
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

function swatch(color, label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="${color}"/><circle cx="100" cy="92" r="46" fill="#fffefb" opacity=".85"/><rect x="62" y="130" width="76" height="16" rx="8" fill="#fffefb" opacity=".6"/><text x="100" y="100" text-anchor="middle" font-family="Georgia" font-size="22" fill="${color}">${label}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export function createFixtures(now = new Date()) {
  const random = seeded(42)
  const cafeId = 'cafe-1'
  const categories = [
    { id: 'cat-kopi', cafe_id: cafeId, name: 'Kopi Susu', sort_order: 1, created_at: '2026-10-01T00:00:00Z' },
    { id: 'cat-manual', cafe_id: cafeId, name: 'Manual Brew', sort_order: 2, created_at: '2026-10-01T00:00:00Z' },
    { id: 'cat-nonkopi', cafe_id: cafeId, name: 'Non-kopi', sort_order: 3, created_at: '2026-10-01T00:00:00Z' },
    { id: 'cat-pastry', cafe_id: cafeId, name: 'Pastry', sort_order: 4, created_at: '2026-10-01T00:00:00Z' },
    { id: 'cat-kosong', cafe_id: cafeId, name: 'Musiman', sort_order: 5, created_at: '2026-10-01T00:00:00Z' },
  ]
  const productSeed = [
    ['p1', 'cat-kopi', 'Es Kopi Susu Gula Aren', 24000, '#8a6a4f', 'Aren'],
    ['p2', 'cat-kopi', 'Vanilla Latte', 28000, '#b08a63', 'Latte'],
    ['p3', 'cat-kopi', 'Caramel Macchiato', 32000, '#a0703e', 'Macc'],
    ['p4', 'cat-manual', 'V60 Gayo', 30000, '#5e4636', 'V60'],
    ['p5', 'cat-nonkopi', 'Matcha Latte', 30000, '#7f9a63', 'Matcha'],
    ['p6', 'cat-nonkopi', 'Cokelat Panas', 26000, null, ''],
    ['p7', 'cat-pastry', 'Croissant Mentega', 22000, '#d1a660', 'Crois'],
    ['p8', 'cat-pastry', 'Banana Bread', 20000, null, ''],
    ['p9', 'cat-kopi', 'Kopi Susu Rp 1 (uji)', 1, null, ''],
  ]
  const products = productSeed.map(([id, categoryId, name, price, color, label], index) => ({
    id,
    cafe_id: cafeId,
    category_id: categoryId,
    name,
    description: index % 3 === 0 ? 'Espresso, susu segar, dan gula aren cair. Manis pas, cocok untuk siang hari.' : index % 3 === 1 ? 'Lembut dengan aroma vanila.' : null,
    price,
    image_url: color ? swatch(color, label) : null,
    is_available: !['p6', 'p9'].includes(id),
    created_at: new Date(Date.UTC(2026, 9, 1 + index)).toISOString(),
  }))

  const customers = ['Rani Putri', 'Bagas Pratama', 'Sinta Dewi', 'Dimas Arya', '', 'Ayu Lestari', 'Fajar Nugroho']
  const statuses = ['completed', 'completed', 'completed', 'completed', 'completed', 'cancelled']
  const methods = ['qris', 'qris', 'cash', 'cash', 'bank_transfer', 'ewallet']
  const orders = []
  const items = []
  const names = new Map()
  const nowMs = now.getTime()
  let sequence = 0
  for (let dayAgo = 34; dayAgo >= 0; dayAgo -= 1) {
    const count = dayAgo === 0 ? 7 : 2 + Math.floor(random() * 6)
    const perDay = []
    for (let index = 0; index < count; index += 1) {
      const hour = [7, 8, 8, 9, 10, 12, 13, 15, 16, 17, 19, 20][Math.floor(random() * 12)]
      const createdAt = new Date(nowMs - dayAgo * 86400000)
      createdAt.setUTCHours(hour - 7, Math.floor(random() * 60), 0, 0)
      if (createdAt.getTime() > nowMs) createdAt.setTime(nowMs - (count - index) * 7 * 60000)
      perDay.push(createdAt)
    }
    perDay.sort((a, b) => a - b).forEach((createdAt, index) => {
      sequence += 1
      const id = `order-${sequence}`
      let status = statuses[Math.floor(random() * statuses.length)]
      if (dayAgo === 0) status = ['completed', 'ready', 'preparing', 'confirmed', 'pending', 'pending', 'completed'][index] || 'pending'
      const paid = status !== 'cancelled' && (dayAgo > 3 || random() > 0.4) && status === 'completed'
      const lineCount = 1 + Math.floor(random() * 3)
      let total = 0
      for (let line = 0; line < lineCount; line += 1) {
        const product = products[Math.floor(random() * 8)]
        const quantity = 1 + Math.floor(random() * 2)
        total += product.price * quantity
        items.push({
          id: `${id}-item-${line}`,
          order_id: id,
          cafe_id: cafeId,
          product_id: product.id,
          product_name: product.name,
          price: product.price,
          quantity,
          subtotal: product.price * quantity,
          notes: line === 0 && random() > 0.7 ? 'Less sugar, es sedikit' : null,
          created_at: createdAt.toISOString(),
        })
      }
      orders.push({
        id,
        cafe_id: cafeId,
        order_number: String(95449854819529000 + sequence),
        customer_id: `cust-${sequence % 7}`,
        total_amount: total,
        order_status: status,
        payment_status: paid ? 'paid' : 'unpaid',
        payment_method: paid ? methods[Math.floor(random() * methods.length)] : null,
        notes: random() > 0.85 ? 'Tolong dibungkus terpisah ya' : null,
        created_at: createdAt.toISOString(),
        queue_number: index + 1,
        paid_at: paid ? new Date(createdAt.getTime() + 9 * 60000).toISOString() : null,
        cancel_reason: status === 'cancelled' ? 'Menu habis' : null,
        cancelled_at: status === 'cancelled' ? createdAt.toISOString() : null,
      })
      names.set(id, customers[sequence % customers.length])
    })
  }
  orders.push({
    id: 'order-legacy', cafe_id: cafeId, order_number: 'e1c9a5d2-6d4b-4f2e-9c1a-1234567890ab', customer_id: null, total_amount: 1,
    order_status: 'completed', payment_status: 'unpaid', payment_method: null, notes: null,
    created_at: new Date(nowMs - 2 * 86400000).toISOString(), queue_number: null, paid_at: null, cancel_reason: null, cancelled_at: null,
  })

  const events = []
  for (const order of orders.slice(-12)) {
    const base = new Date(order.created_at).getTime()
    events.push({ id: events.length + 1, order_id: order.id, event_type: 'status', from_status: null, to_status: 'pending', note: null, changed_by: null, created_at: order.created_at })
    const flow = ['confirmed', 'preparing', 'ready', 'completed']
    const target = order.order_status === 'cancelled' ? 0 : flow.indexOf(order.order_status) + 1
    flow.slice(0, target).forEach((status, index) => {
      events.push({ id: events.length + 1, order_id: order.id, event_type: 'status', from_status: index ? flow[index - 1] : 'pending', to_status: status, note: null, changed_by: index % 2 ? 'staff-1' : 'owner-1', created_at: new Date(base + (index + 1) * 3 * 60000).toISOString() })
    })
  }

  return {
    cafe: {
      id: cafeId, name: 'Kopi Senja', address: 'Jl. Kaliurang Km 5, Yogyakarta', phone: '0812 3456 7890',
      description: 'Kopi susu gula aren & roti panggang sejak 2019.', opening_hours: null, accepted_payment_methods: ['cash', 'qris'],
    },
    profile: { id: 'owner-1', full_name: 'Iqlal Iwan', phone: '081200000000', role: 'owner', cafe_id: cafeId },
    tables: {
      categories, products, orders, order_items: items, order_status_events: events,
      payments: orders.filter((order) => order.payment_status === 'paid').map((order) => ({
        id: `pay-${order.id}`, order_id: order.id, method: order.payment_method, payment_method: order.payment_method, status: 'paid',
        payment_status: 'paid', amount: order.total_amount, paid_at: order.paid_at, created_at: order.paid_at,
      })),
      cafes: [],
      profiles: [],
    },
    names,
    team: [
      { id: 'owner-1', full_name: 'Iqlal Iwan', role: 'owner', created_at: '2026-10-01T00:00:00Z' },
      { id: 'staff-1', full_name: 'Nadia Barista', role: 'staff', created_at: '2026-10-03T00:00:00Z' },
    ],
  }
}

class Query {
  constructor(store, table) {
    this.store = store
    this.table = table
    this.filters = []
    this.sorts = []
    this.window = null
    this.mode = 'select'
    this.payload = null
    this.single = false
  }
  select() { return this }
  eq(column, value) { this.filters.push((row) => column.includes('.') || row[column] === value); return this }
  neq(column, value) { this.filters.push((row) => column.includes('.') || row[column] !== value); return this }
  gte(column, value) { this.filters.push((row) => row[column] >= value); return this }
  lt(column, value) { this.filters.push((row) => row[column] < value); return this }
  in(column, values) { this.filters.push((row) => values.includes(row[column])); return this }
  or() { return this }
  order(column, { ascending = true } = {}) { this.sorts.push([column, ascending]); return this }
  limit(count) { this.window = [0, count - 1]; return this }
  range(from, to) { this.window = [from, to]; return this }
  maybeSingle() { this.single = true; return this }
  update(values) { this.mode = 'update'; this.payload = values; return this }
  insert(values) { this.mode = 'insert'; this.payload = values; return this }
  delete() { this.mode = 'delete'; return this }

  run() {
    const rows = this.store[this.table] || (this.store[this.table] = [])
    if (this.mode === 'insert') {
      const row = { id: `${this.table}-${rows.length + 1}-${Math.round(performance.now())}`, created_at: new Date().toISOString(), ...this.payload }
      rows.unshift(row)
      return { data: this.single ? row : [row], error: null }
    }
    let matched = rows.filter((row) => this.filters.every((filter) => filter(row)))
    if (this.mode === 'update') {
      matched.forEach((row) => Object.assign(row, this.payload))
      return { data: this.single ? matched[0] || null : matched, error: null }
    }
    if (this.mode === 'delete') {
      this.store[this.table] = rows.filter((row) => !matched.includes(row))
      return { data: this.single ? matched[0] || null : matched, error: null }
    }
    for (const [column, ascending] of [...this.sorts].reverse()) {
      matched = [...matched].sort((a, b) => (a[column] > b[column] ? 1 : a[column] < b[column] ? -1 : 0) * (ascending ? 1 : -1))
    }
    if (this.window) matched = matched.slice(this.window[0], this.window[1] + 1)
    return { data: this.single ? matched[0] || null : matched, error: null }
  }

  then(resolve, reject) {
    return new Promise((done) => window.setTimeout(() => done(this.run()), 120)).then(resolve, reject)
  }
}

export function createMockSupabase(fixtures) {
  const store = fixtures.tables
  store.cafes = [fixtures.cafe]
  store.profiles = [fixtures.profile]
  const listeners = new Set()
  const statusListeners = new Set()
  let extra = 0
  // Kendali QA dari konsol / skrip: tambah pesanan baru, putus/sambung realtime.
  const controls = {
    addOrder(name = 'Customer Baru') {
      extra += 1
      const id = `order-new-${extra}`
      const product = store.products[extra % store.products.length]
      const createdAt = new Date().toISOString()
      const queue = Math.max(0, ...store.orders.filter((order) => order.created_at.slice(0, 10) === createdAt.slice(0, 10)).map((order) => order.queue_number || 0)) + 1
      const order = { id, cafe_id: fixtures.cafe.id, order_number: String(95449854819600000 + extra), customer_id: 'cust-new', total_amount: product.price * 2,
        order_status: 'pending', payment_status: 'unpaid', payment_method: null, notes: extra % 2 ? 'Es dipisah ya kak' : null, created_at: createdAt,
        queue_number: queue, paid_at: null, cancel_reason: null, cancelled_at: null }
      store.orders.push(order)
      store.order_items.push({ id: `${id}-item`, order_id: id, cafe_id: fixtures.cafe.id, product_id: product.id, product_name: product.name, price: product.price, quantity: 2, subtotal: product.price * 2, notes: 'Gula sedikit', created_at: createdAt })
      fixtures.names.set(id, name)
      listeners.forEach((callback) => callback({ eventType: 'INSERT', new: order }))
      return order
    },
    setRealtime(status) { statusListeners.forEach((callback) => callback(status)) },
    isLive: () => listeners.size > 0,
  }
  if (typeof window !== 'undefined') {
    window.__dailybrewMock = controls
    // Untuk skrip QA (dunia terisolasi): document.dispatchEvent(new CustomEvent('dailybrew-mock', { detail: '{"action":"addOrder","args":["Nama"]}' }))
    // StrictMode bisa membuat klien dua kali — teruskan ke semua instance.
    window.__dailybrewMockAll = [...(window.__dailybrewMockAll || []), controls]
    if (!window.__dailybrewMockListener) {
      window.__dailybrewMockListener = (event) => {
        const { action, args = [] } = JSON.parse(event.detail)
        window.__dailybrewMockAll.filter((instance) => instance.isLive()).forEach((instance) => instance[action]?.(...args))
      }
      document.addEventListener('dailybrew-mock', window.__dailybrewMockListener)
    }
  }
  return {
    from: (table) => new Query(store, table),
    rpc: async (name, args) => {
      if (name === 'staff_order_customer_names') {
        return { data: args.p_order_ids.map((id) => ({ order_id: id, customer_name: fixtures.names.get(id) || '' })), error: null }
      }
      if (name === 'cafe_team_members') return { data: fixtures.team, error: null }
      if (name === 'staff_mark_order_paid') {
        const order = store.orders.find((row) => row.id === args.p_order_id)
        Object.assign(order, { payment_status: 'paid', payment_method: args.p_method, paid_at: new Date().toISOString() })
        return { data: order, error: null }
      }
      if (name === 'staff_cancel_order') {
        const order = store.orders.find((row) => row.id === args.p_order_id)
        Object.assign(order, { order_status: 'cancelled', cancel_reason: args.p_reason, cancelled_at: new Date().toISOString() })
        return { data: order, error: null }
      }
      if (name === 'staff_set_product_availability') {
        const product = store.products.find((row) => row.id === args.p_product_id)
        product.is_available = args.p_is_available
        return { data: product, error: null }
      }
      return { data: null, error: { message: `RPC ${name} tidak ada di mock` } }
    },
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
        getPublicUrl: (path) => ({ data: { publicUrl: `https://example.invalid/storage/v1/object/public/product-images/${path}` } }),
      }),
    },
    auth: { signOut: async () => ({ error: null }) },
    channel: () => {
      const own = { listeners: [], statuses: [] }
      return {
        on(_event, _filter, callback) { own.listeners.push(callback); listeners.add(callback); return this },
        subscribe(callback) {
          if (callback) {
            own.statuses.push(callback)
            statusListeners.add(callback)
            window.setTimeout(() => callback('SUBSCRIBED'), 300)
          }
          this.own = own
          return this
        },
      }
    },
    removeChannel: (channel) => {
      channel?.own?.listeners.forEach((callback) => listeners.delete(callback))
      channel?.own?.statuses.forEach((callback) => statusListeners.delete(callback))
    },
  }
}
