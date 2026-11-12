/*
 * Supabase tiruan untuk pratinjau tampilan (VITE_MOCK=1 npm run dev). Tidak dipakai di build produksi.
 * Data contoh: 6 kafe, tagihan, notifikasi, perlu tindakan, riwayat 12 bulan.
 */
const day = 86400000
const now = Date.now()
const iso = (offsetDays) => new Date(now + offsetDays * day).toISOString()
const monthKey = (offset) => {
  const date = new Date()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() - offset)
  return date.toISOString().slice(0, 10)
}

const cafes = [
  { cafe_id: 'c1', name: 'Kopi Senja', owner_name: 'Rina Wulandari', owner_email: 'rina@kopisenja.id', plan_code: 'pro', plan_name: 'Pro', state: 'active', monthly_price: 349000, created_at: iso(-210), current_period_end: iso(18), sub_status: 'active', price_override: null },
  { cafe_id: 'c2', name: 'Teras Kopi Bandung', owner_name: 'Dimas Pratama', owner_email: 'dimas@teras.id', plan_code: 'pro', plan_name: 'Pro', state: 'past_due', monthly_price: 349000, created_at: iso(-160), current_period_end: iso(-3), sub_status: 'past_due', price_override: null },
  { cafe_id: 'c3', name: 'Ruang Seduh', owner_name: 'Ayu Lestari', owner_email: 'ayu@ruangseduh.id', plan_code: 'enterprise', plan_name: 'Enterprise', state: 'active', monthly_price: 0, created_at: iso(-300), current_period_end: null, sub_status: 'active', price_override: null },
  { cafe_id: 'c4', name: 'Kedai Pagi', owner_name: 'Bagus Santoso', owner_email: 'bagus@kedaipagi.id', plan_code: 'pro', plan_name: 'Pro', state: 'trial', monthly_price: 349000, created_at: iso(-12), trial_ends_at: iso(2), sub_status: 'trialing', price_override: null },
  { cafe_id: 'c5', name: 'Basecamp Coffee', owner_name: 'Sari Dewi', owner_email: 'sari@basecamp.id', plan_code: 'basic', plan_name: 'Basic', state: 'active', monthly_price: 149000, created_at: iso(-90), current_period_end: iso(25), sub_status: 'active', price_override: null },
  { cafe_id: 'c6', name: 'Warung Kopi Lama', owner_name: 'Joko', owner_email: 'joko@wkl.id', plan_code: 'basic', plan_name: 'Basic', state: 'suspended', monthly_price: 149000, created_at: iso(-400), suspended_at: iso(-20), sub_status: 'past_due', price_override: null },
]

const plans = [
  { code: 'basic', name: 'Basic', description: 'Kasir, pesanan app, menu & tim kecil', price_monthly: 149000, limits: { staff: 3, tables: 10, products: 80 }, features: [], is_public: true, is_archived: false, sort_order: 1, cafes: 2 },
  { code: 'pro', name: 'Pro', description: 'Semua modul operasional & keuangan', price_monthly: 349000, limits: { staff: 15, tables: 50, products: 500 }, features: ['inventory', 'finance', 'loyalty', 'qr_ordering', 'payment_gateway', 'ai_advisor'], is_public: true, is_archived: false, sort_order: 2, cafes: 3 },
  { code: 'enterprise', name: 'Enterprise', description: 'Tanpa batas, untuk grup kafe', price_monthly: null, limits: {}, features: ['inventory', 'finance', 'loyalty', 'qr_ordering', 'payment_gateway', 'ai_advisor'], is_public: false, is_archived: false, sort_order: 3, cafes: 1 },
]

const history = Array.from({ length: 7 }, (_, index) => ({ month: monthKey(6 - index), mrr: [500000, 698000, 847000, 996000, 996000, 1145000, 1196000][index], paying: [2, 3, 3, 4, 4, 4, 4][index], trial: [1, 0, 1, 1, 2, 1, 1][index] }))
const revenueHistory = Array.from({ length: 12 }, (_, index) => ({ month: monthKey(11 - index), amount: index < 5 ? 0 : [349000, 498000, 847000, 698000, 1047000, 996000, 847000][index - 5] }))

const invoices = [
  { id: 'i1', number: 'INV-2611-00012', cafe_id: 'c2', cafe_name: 'Teras Kopi Bandung', plan_code: 'pro', plan_name: 'Pro', months: 1, period_start: iso(-3), period_end: iso(27), amount: 349000, status: 'pending', state: 'overdue', due_at: iso(-3), source: 'system' },
  { id: 'i2', number: 'INV-2611-00013', cafe_id: 'c1', cafe_name: 'Kopi Senja', plan_code: 'pro', plan_name: 'Pro', months: 1, period_start: iso(18), period_end: iso(48), amount: 349000, status: 'pending', state: 'pending', due_at: iso(18), source: 'system' },
  { id: 'i3', number: 'INV-2611-00009', cafe_id: 'c5', cafe_name: 'Basecamp Coffee', plan_code: 'basic', plan_name: 'Basic', months: 3, period_start: iso(-65), period_end: iso(25), amount: 447000, status: 'paid', state: 'paid', due_at: iso(-60), paid_at: iso(-62), method: 'gateway', payment_ref: 'INV-2611-00009-261110', source: 'owner' },
]

const actions = [
  { rank: 1, kind: 'invoice_overdue', cafe_id: 'c2', cafe_name: 'Teras Kopi Bandung', owner_name: 'Dimas Pratama', owner_whatsapp: '6281234567890', reason: 'Tagihan INV-2611-00012 telat 3 hari', ref_id: 'i1', amount: 349000, due_at: iso(-3) },
  { rank: 2, kind: 'payment_failed', cafe_id: 'c1', cafe_name: 'Kopi Senja', owner_name: 'Rina Wulandari', owner_whatsapp: '6281311112222', reason: 'Pembayaran QRIS: tanda tangan webhook tidak valid', ref_id: 'pe:9' },
  { rank: 3, kind: 'trial_ending', cafe_id: 'c4', cafe_name: 'Kedai Pagi', owner_name: 'Bagus Santoso', owner_whatsapp: null, reason: 'Masa coba habis dalam 2 hari', ref_id: 'c4:x', due_at: iso(2) },
  { rank: 4, kind: 'idle_cafe', cafe_id: 'c5', cafe_name: 'Basecamp Coffee', owner_name: 'Sari Dewi', owner_whatsapp: '6285700001111', reason: 'Tanpa pesanan sejak 02/11', ref_id: 'c5:x' },
]

let notifications = [
  { id: 6, kind: 'invoice_overdue', severity: 'warning', title: 'Tagihan telat: Teras Kopi Bandung', body: 'INV-2611-00012 · Rp 349.000', link: '/kafe/c2', created_at: iso(-0.1), read_at: null },
  { id: 5, kind: 'payment_failed', severity: 'danger', title: 'Pembayaran gagal: Kopi Senja', body: 'Pembayaran QRIS: tanda tangan webhook tidak valid', link: '/kafe/c1', created_at: iso(-0.4), read_at: null },
  { id: 4, kind: 'cafe_created', severity: 'success', title: 'Kafe baru: Kedai Pagi', body: 'Owner Bagus Santoso · paket pro', link: '/kafe/c4', created_at: iso(-12), read_at: null },
  { id: 3, kind: 'invoice_paid', severity: 'success', title: 'Tagihan lunas: Basecamp Coffee', body: 'Rp 447.000 via Midtrans', link: '/tagihan', created_at: iso(-62), read_at: iso(-61) },
]

let settings = { support_whatsapp: '6281122223333', theme_color: '#B0805A', theme_color2: null, email_from_name: 'Dailybrew', email_admin_kinds: ['invoice_overdue', 'payment_failed', 'invoice_paid', 'cafe_created'], email_owner_kinds: ['invoice_due_7', 'invoice_due_1', 'invoice_overdue', 'trial_ending'], updated_at: iso(0) }

function detail(cafeId) {
  const row = cafes.find((cafe) => cafe.cafe_id === cafeId) || cafes[0]
  const plan = plans.find((item) => item.code === row.plan_code)
  return {
    summary: row,
    cafe: { id: row.cafe_id, name: row.name, created_at: row.created_at, phone: '022-555-0101', address: 'Jl. Braga No. 12, Bandung', suspended_at: row.suspended_at || null, suspended_reason: row.suspended_at ? 'Tagihan 2 bulan belum dibayar' : null, owner_whatsapp: row.cafe_id === 'c4' ? null : '6281234567890' },
    subscription: { plan_code: row.plan_code, status: row.sub_status, trial_ends_at: row.trial_ends_at || null, current_period_end: row.current_period_end || null, price_override: row.price_override, notes: null },
    plan,
    effective_plan: { code: plan.code, name: plan.name, limits: plan.limits, features: plan.features },
    usage: { staff: 4, tables: 12, products: 64 },
    members: [{ id: 'u1', full_name: row.owner_name, role: 'owner', is_active: true, email: row.owner_email, last_sign_in_at: iso(-1) }, { id: 'u2', full_name: 'Staff Kasir', role: 'staff', is_active: true, email: 'kasir@contoh.id' }],
    orders_30d: 812,
    last_order_at: iso(-0.2),
  }
}

const RPC = {
  pa_whoami: () => ({ is_admin: true, aal: 'aal2', full_name: 'Iwan Iqlal' }),
  pa_theme: () => ({ color: settings.theme_color, color2: settings.theme_color2 }),
  pa_overview: () => ({
    total: 6, active: 4, past_due: 1, trial: 1, inactive: 1, suspended: 1, expired: 0, mrr: 1196000, trial_potential: 349000, new_cafes_30d: 1,
    by_plan: { pro: 3, basic: 1, enterprise: 1 }, unpriced: [{ cafe_id: 'c3', name: 'Ruang Seduh', plan_name: 'Enterprise' }],
    month: monthKey(0), mrr_prev: 1145000, revenue_month: 847000, revenue_prev: 996000, pending_count: 1, overdue_count: 1, overdue_amount: 349000,
    invoice_count: 14, history, revenue_history: revenueHistory, action_count: actions.length,
  }),
  pa_plans_list: () => plans,
  pa_action_items: () => actions,
  pa_cafes_list: ({ p_state: state, p_search: search }) => {
    const rows = cafes.filter((cafe) => (!state || cafe.state === state) && (!search || cafe.name.toLowerCase().includes(search.toLowerCase())))
    return { total: rows.length, rows }
  },
  pa_cafe_detail: ({ p_cafe: cafeId }) => detail(cafeId),
  pa_invoices_list: ({ p_cafe: cafeId, p_state: state }) => {
    const rows = invoices.filter((invoice) => (!cafeId || invoice.cafe_id === cafeId) && (!state || invoice.state === state))
    return { total: rows.length, rows, summary: { paid: 1, paid_amount: 447000, pending: 1, pending_amount: 349000, overdue: 1, overdue_amount: 349000, void: 0 } }
  },
  pa_audit_list: () => ({ total: 2, actions: ['invoice', 'cafe'], rows: [
    { id: 2, created_at: iso(-0.5), actor_label: 'admin@dailybrew.id', action: 'whatsapp.open', cafe_id: 'c2', cafe_name: 'Teras Kopi Bandung', before: null, after: { template: 'tagihan' } },
    { id: 1, created_at: iso(-3), actor_label: 'sistem', action: 'invoice.create', cafe_id: 'c2', cafe_name: 'Teras Kopi Bandung', before: null, after: { number: 'INV-2611-00012', amount: 349000 }, note: 'Tagihan otomatis' },
  ] }),
  pa_cafe_outbox: () => [
    { id: 3, channel: 'email', audience: 'owner', recipient: 'dimas@teras.id', kind: 'invoice_overdue', subject: 'Tagihan langganan lewat jatuh tempo', status: 'sent', created_at: iso(-0.1), sent_at: iso(-0.1) },
    { id: 2, channel: 'email', audience: 'owner', recipient: 'dimas@teras.id', kind: 'invoice_due_1', subject: 'Tagihan jatuh tempo besok', status: 'failed', error: 'Domain belum diverifikasi di Resend', created_at: iso(-4) },
  ],
  pa_notifications_list: () => ({ unread: notifications.filter((item) => !item.read_at).length, rows: notifications }),
  pa_notifications_mark_read: ({ p_ids: ids }) => {
    notifications = notifications.map((item) => (!ids || ids.includes(item.id) ? { ...item, read_at: item.read_at || iso(0) } : item))
    return 1
  },
  pa_settings_get: () => settings,
  pa_settings_update: ({ p_patch: patch }) => { settings = { ...settings, ...patch }; return settings },
  pa_announcements_list: () => [{ id: 'a1', title: 'Fitur baru: laporan laba rugi', body: 'Kini owner bisa melihat laba rugi bulanan langsung dari menu Keuangan.', target_cafe_ids: null, send_email: true, recipients: 6, read_count: 3, created_at: iso(-5), created_by_email: 'admin@dailybrew.id' }],
  pa_log_whatsapp: () => null,
}

export function createMockSupabase() {
  const session = { user: { id: 'admin', email: 'iwaniqlal@gmail.com' }, access_token: 'mock' }
  const channel = { on() { return channel }, subscribe() { return channel } }
  return {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => ({ error: null }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal2' } }) },
    },
    rpc: async (name, args = {}) => {
      await new Promise((resolve) => setTimeout(resolve, 120))
      const handler = RPC[name]
      return handler ? { data: handler(args), error: null } : { data: null, error: { message: `Mock: ${name} belum ada` } }
    },
    channel: () => channel,
    removeChannel: () => null,
    functions: { invoke: async () => ({ data: { ok: true, cafe_id: 'c4' }, error: null }) },
  }
}
