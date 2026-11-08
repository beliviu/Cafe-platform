/*
 * KHUSUS DEV: data & RPC fitur pelanggan (file 08) untuk /preview/owner dan /preview/staff.
 * Meniru supabase/usulan/08-pelanggan-qr.sql secara ringkas.
 */
let seq = 7000
const uid = (prefix) => `${prefix}-${(seq += 1)}`
const ok = (data) => ({ data, error: null })
const fail = (message) => ({ data: null, error: { message } })
const DAY = 86400000
const token = () => Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')

export function createCustomerFixtures({ cafeId, orders, products, now = new Date() }) {
  const t = now.getTime()
  const iso = (offset) => new Date(t - offset).toISOString()
  const customers = [['cust-1', 'Rani Putri'], ['cust-2', 'Bagas Pratama'], ['cust-3', 'Sinta Dewi'], ['cust-4', 'Dimas Arya']]
  const active = orders.filter((order) => ['pending', 'confirmed', 'preparing'].includes(order.order_status))
  // Satu pesanan aktif dari QR meja & satu terjadwal
  if (active[0]) Object.assign(active[0], { table_id: 'table-1', table_label: '2', order_type: 'dine_in' })
  if (active[1]) Object.assign(active[1], { scheduled_for: new Date(t + 2 * 3600000).toISOString() })
  const completed = orders.filter((order) => order.order_status === 'completed').slice(0, 6)
  return {
    settings: {
      ordering_paused: false, ordering_message: null, scheduled_orders_enabled: true, prep_minutes_base: 10, prep_minutes_per_order: 2, qr_ordering_enabled: true,
      loyalty_enabled: true, loyalty_spend_per_point: 10000, loyalty_point_value: 100, loyalty_min_redeem: 50, loyalty_max_redeem_pct: 50,
      loyalty_tiers: [{ name: 'Bronze', min_spend: 0, multiplier: 1 }, { name: 'Silver', min_spend: 500000, multiplier: 1.25 }, { name: 'Gold', min_spend: 2000000, multiplier: 1.5 }],
    },
    tables: {
      vouchers: [
        { id: 'v-1', cafe_id: cafeId, code: 'NGOPI10', name: 'Diskon 10% semua menu', discount_type: 'percent', discount_value: 10, max_discount: 15000, min_subtotal: 30000, starts_at: null, ends_at: new Date(t + 20 * DAY).toISOString(), usage_limit: 200, per_customer_limit: 1, is_public: true, is_active: true, created_at: iso(10 * DAY) },
        { id: 'v-2', cafe_id: cafeId, code: 'IGKOPI', name: 'Potongan Rp5.000 dari Instagram', discount_type: 'amount', discount_value: 5000, max_discount: null, min_subtotal: 20000, starts_at: null, ends_at: null, usage_limit: null, per_customer_limit: 2, is_public: false, is_active: true, created_at: iso(30 * DAY) },
        { id: 'v-3', cafe_id: cafeId, code: 'LEBARAN', name: 'Promo Lebaran 15%', discount_type: 'percent', discount_value: 15, max_discount: 20000, min_subtotal: 0, starts_at: iso(60 * DAY), ends_at: iso(40 * DAY), usage_limit: null, per_customer_limit: 1, is_public: true, is_active: true, created_at: iso(70 * DAY) },
      ],
      voucher_redemptions: Array.from({ length: 14 }, (_, index) => ({ id: `vr-${index}`, cafe_id: cafeId, voucher_id: index % 3 ? 'v-1' : 'v-2', order_id: `x-${index}`, customer_id: customers[index % 4][0], amount: index % 3 ? 3200 : 5000, status: 'applied' })),
      loyalty_accounts: customers.map(([id], index) => ({ cafe_id: cafeId, customer_id: id, points_balance: [240, 95, 610, 12][index], lifetime_points: [300, 95, 800, 12][index], lifetime_spend: [820000, 310000, 2450000, 64000][index], tier: ['Silver', 'Bronze', 'Gold', 'Bronze'][index] })),
      product_reviews: completed.flatMap((order, index) => {
        const product = products[index % products.length]
        return [{ id: `rv-${index}`, cafe_id: cafeId, product_id: product.id, order_id: order.id, customer_id: customers[index % 4][0], rating: [5, 4, 2, 5, 3, 5][index], comment: ['Gula arennya pas!', 'Enak, tapi agak lama.', 'Kopinya terlalu encer hari ini.', null, 'Croissant kurang hangat.', 'Favorit tiap pagi.'][index], reply: index === 0 ? 'Terima kasih, Kak Rani!' : null, replied_at: index === 0 ? iso(DAY) : null, is_hidden: false, created_at: iso((index + 1) * 0.7 * DAY) }]
      }),
      support_tickets: [
        { id: 'tk-1', cafe_id: cafeId, customer_id: 'cust-2', order_id: completed[0]?.id || null, subject: 'Croissant tidak ada di pesanan', status: 'open', last_message_at: iso(40 * 60000), created_at: iso(45 * 60000), closed_at: null },
        { id: 'tk-2', cafe_id: cafeId, customer_id: 'cust-1', order_id: null, subject: 'Bisa pesan untuk acara kantor?', status: 'answered', last_message_at: iso(DAY), created_at: iso(DAY + 3600000), closed_at: null },
        { id: 'tk-3', cafe_id: cafeId, customer_id: 'cust-3', order_id: null, subject: 'Saran menu oat milk', status: 'closed', last_message_at: iso(4 * DAY), created_at: iso(5 * DAY), closed_at: iso(4 * DAY) },
      ],
      support_messages: [
        { id: 'sm-1', ticket_id: 'tk-1', cafe_id: cafeId, sender: 'customer', body: 'Halo kak, croissant saya tidak ada di kantong. Pesanan sudah dibayar.', created_at: iso(45 * 60000) },
        { id: 'sm-2', ticket_id: 'tk-1', cafe_id: cafeId, sender: 'customer', body: 'Saya masih di meja dekat jendela.', created_at: iso(40 * 60000) },
        { id: 'sm-3', ticket_id: 'tk-2', cafe_id: cafeId, sender: 'customer', body: 'Mau pesan 30 kopi susu untuk Jumat pagi, bisa?', created_at: iso(DAY + 3600000) },
        { id: 'sm-4', ticket_id: 'tk-2', cafe_id: cafeId, sender: 'cafe', body: 'Bisa kak, kami hubungi via WhatsApp ya.', created_at: iso(DAY) },
        { id: 'sm-5', ticket_id: 'tk-3', cafe_id: cafeId, sender: 'customer', body: 'Tolong tambah pilihan oat milk.', created_at: iso(5 * DAY) },
      ],
    },
    names: new Map(customers),
  }
}

export function customerRpc(store, name, args, names) {
  const settings = store.cafe_settings[0]
  switch (name) {
    case 'cafe_status':
      return ok({ open: true, paused: settings.ordering_paused, message: settings.ordering_message, accepting: !settings.ordering_paused, scheduled_enabled: settings.scheduled_orders_enabled, prep_minutes: 14, qr_enabled: settings.qr_ordering_enabled, loyalty_enabled: settings.loyalty_enabled })
    case 'cafe_set_ordering_paused':
      Object.assign(settings, { ordering_paused: args.p_paused, ordering_message: args.p_paused ? args.p_message : null })
      return ok(null)
    case 'cafe_tables_qr':
      return ok(store.cafe_tables.map((table) => {
        if (!table.qr_token) table.qr_token = token()
        const live = store.orders.filter((order) => order.table_id === table.id && ['pending', 'confirmed', 'preparing', 'ready'].includes(order.order_status))
        return { table_id: table.id, label: table.label, area: table.area, capacity: table.capacity, is_active: table.is_active, sort_order: table.sort_order, qr_token: table.qr_token, active_orders: live.length, occupied_since: live[0]?.created_at || null }
      }))
    case 'table_qr_rotate': {
      const table = store.cafe_tables.find((row) => row.id === args.p_table_id)
      table.qr_token = token()
      return ok(table.qr_token)
    }
    case 'loyalty_customers':
      return ok(store.loyalty_accounts.map((account) => ({ ...account, full_name: names.get(account.customer_id), orders: Math.round(account.lifetime_spend / 45000), last_order_at: new Date(Date.now() - (account.points_balance % 7) * DAY).toISOString() })))
    case 'loyalty_adjust': {
      const account = store.loyalty_accounts.find((row) => row.customer_id === args.p_customer_id)
      if (account.points_balance + args.p_points < 0) return fail('Saldo poin tidak cukup')
      account.points_balance += args.p_points
      return ok(account.points_balance)
    }
    case 'review_moderate': {
      const review = store.product_reviews.find((row) => row.id === args.p_review_id)
      Object.assign(review, { is_hidden: args.p_hidden, reply: args.p_reply, replied_at: args.p_reply ? new Date().toISOString() : null })
      return ok(null)
    }
    case 'support_reply': {
      const ticket = store.support_tickets.find((row) => row.id === args.p_ticket_id)
      store.support_messages.push({ id: uid('sm'), ticket_id: ticket.id, cafe_id: ticket.cafe_id, sender: 'cafe', body: args.p_body, created_at: new Date().toISOString() })
      Object.assign(ticket, { status: 'answered', last_message_at: new Date().toISOString(), closed_at: null })
      return ok('ok')
    }
    case 'support_close':
      Object.assign(store.support_tickets.find((row) => row.id === args.p_ticket_id), { status: 'closed', closed_at: new Date().toISOString() })
      return ok(null)
    default:
      return null
  }
}
