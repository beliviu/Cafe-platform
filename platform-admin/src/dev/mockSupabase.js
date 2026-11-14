/*
 * Supabase tiruan untuk pratinjau tampilan (VITE_MOCK=1 npm run dev). Tidak dipakai di build produksi.
 * Data contoh: 6 kafe, tagihan, notifikasi, perlu tindakan, riwayat 12 bulan.
 */
import { billingInvoke, billingRpc } from './mockBilling.js'

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
  { id: 'i2', number: 'INV-2611-00013', cafe_id: 'c1', cafe_name: 'Kopi Senja', plan_code: 'pro', plan_name: 'Pro', months: 1, period_start: iso(18), period_end: iso(48), amount: 299000, list_amount: 349000, credit_amount: 50000, promo_discount: 0, referral_discount: 0, status: 'pending', state: 'pending', due_at: iso(18), source: 'system' },
  { id: 'i3', number: 'INV-2611-00009', cafe_id: 'c5', cafe_name: 'Basecamp Coffee', plan_code: 'basic', plan_name: 'Basic', months: 3, period_start: iso(-65), period_end: iso(25), amount: 357600, list_amount: 447000, promo_code: 'HEMAT20', promo_discount: 89400, referral_discount: 0, credit_amount: 0, status: 'paid', state: 'paid', due_at: iso(-60), paid_at: iso(-62), method: 'gateway', payment_ref: 'INV-2611-00009-261110', source: 'owner' },
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

let settings = { support_whatsapp: '6281122223333', theme_color: '#C8734A', theme_color2: null, email_from_name: 'Dailybrew', email_admin_kinds: ['invoice_overdue', 'payment_failed', 'invoice_paid', 'cafe_created'], email_owner_kinds: ['invoice_due_7', 'invoice_due_1', 'invoice_overdue', 'trial_ending'], updated_at: iso(0) }

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

// ---------- File 16: kesehatan, analitik, linimasa, tiket ----------
const healthHistory = (start, end) => Array.from({ length: 30 }, (_, index) => {
  const score = Math.round(start + ((end - start) * index) / 29 + Math.sin(index / 3) * 3)
  return { day: iso(index - 29).slice(0, 10), score, label: score >= 75 ? 'healthy' : score >= 50 ? 'watch' : 'risk' }
})
const health = {
  c1: { score: 92, label: 'healthy', reasons: [], history: healthHistory(84, 92), components: { orders: { score: 35, max: 35, last_14: 412, prev_14: 398 }, login: { score: 25, max: 25, days: 1 }, modules: { score: 20, max: 20, used: ['pos', 'inventory', 'finance', 'app'] }, payment: { score: 12, max: 20, late_paid: 1, invoices: 6 } } },
  c2: { score: 38, label: 'risk', reasons: ['Pesanan turun 46%', 'Tagihan telat 3 hari'], history: healthHistory(72, 38), components: { orders: { score: 8, max: 35, last_14: 54, prev_14: 100 }, login: { score: 20, max: 25, days: 5 }, modules: { score: 10, max: 20, used: ['pos', 'app'] }, payment: { score: 0, max: 20, overdue_days: 3, invoices: 4 } } },
  c3: { score: 88, label: 'healthy', reasons: [], history: healthHistory(86, 88), components: { orders: { score: 35, max: 35, last_14: 620, prev_14: 590 }, login: { score: 20, max: 25, days: 6 }, modules: { score: 15, max: 20, used: ['pos', 'finance', 'app'] }, payment: { score: 20, max: 20, invoices: 0 } } },
  c4: { score: 45, label: 'risk', reasons: ['Belum ada pesanan 28 hari terakhir'], history: healthHistory(45, 45).slice(-12), components: { orders: { score: 0, max: 35, last_14: 0, prev_14: 0 }, login: { score: 25, max: 25, days: 2 }, modules: { score: 0, max: 20, used: [] }, payment: { score: 20, max: 20, invoices: 0 } } },
  c5: { score: 61, label: 'watch', reasons: ['Owner terakhir login 12 hari lalu'], history: healthHistory(80, 61), components: { orders: { score: 28, max: 35, last_14: 88, prev_14: 104 }, login: { score: 12, max: 25, days: 12 }, modules: { score: 5, max: 20, used: ['pos'] }, payment: { score: 20, max: 20, invoices: 2 } } },
}
const setupSteps = (done) => ['Identitas dan logo', 'Jam buka', 'Pajak', 'Kategori dan produk', 'Meja dan QR', 'Staff', 'Pembayaran (QRIS)', 'Struk']
  .map((label, index) => ({ no: index + 1, key: `s${index + 1}`, label, done: index < done }))
const setupOf = (cafeId) => {
  const done = { c4: 3, c7: 6, c8: 1 }[cafeId] ?? 8
  const steps = setupSteps(done)
  const stuck = steps.find((step) => !step.done)
  return { done, total: 8, steps, stuck_key: stuck?.key ?? null, stuck_step: stuck?.label ?? null, stuck_days: stuck ? { c4: 5, c7: 2, c8: 9 }[cafeId] ?? 0 : null }
}
const notes = [{ id: 1, cafe_id: 'c2', body: 'Owner minta dihubungi sore hari, pagi sibuk di kasir.', created_by: 'admin', created_at: iso(-6) }]
const timelineOf = (cafeId) => {
  const row = cafes.find((cafe) => cafe.cafe_id === cafeId) || cafes[0]
  return [
    ...notes.filter((note) => note.cafe_id === cafeId).map((note) => ({ at: note.created_at, kind: 'note', action: 'cafe.note', title: null, detail: { id: note.id, body: note.body }, actor: 'Iwan Iqlal' })),
    { at: iso(-0.4), kind: 'whatsapp', action: 'whatsapp.open', title: null, detail: { after: { template: 'tagihan' } }, actor: 'iwaniqlal@gmail.com' },
    { at: iso(-2), kind: 'health', action: null, title: null, detail: { score: 48, label: 'risk', prev_label: 'watch', reasons: ['Pesanan turun 46%', 'Tagihan telat 1 hari'] }, actor: null },
    { at: iso(-3), kind: 'invoice', action: 'invoice.create', title: null, detail: { after: { number: 'INV-2611-00012', amount: 349000 }, note: 'Tagihan otomatis' }, actor: 'sistem' },
    { at: iso(-8), kind: 'ticket', action: null, title: 'Printer struk tidak mencetak logo', detail: { id: 't2', number: 'TKT-00002', status: 'resolved', category: 'aplikasi' }, actor: null },
    { at: iso(-34), kind: 'payment', action: 'invoice.paid', title: null, detail: { after: { number: 'INV-2610-00008', amount: 349000 } }, actor: 'midtrans' },
    { at: iso(-60), kind: 'plan', action: 'subscription.plan', title: null, detail: { before: { plan_code: 'basic' }, after: { plan_code: 'pro' } }, actor: 'iwaniqlal@gmail.com' },
    { at: row.created_at, kind: 'signup', action: null, title: 'Kafe terdaftar', detail: null, actor: null },
  ].sort((a, b) => (a.at < b.at ? 1 : -1))
}
const mrrMonths = Array.from({ length: 12 }, (_, index) => {
  const offset = 11 - index
  const has = offset <= 6
  const end = [0, 0, 0, 0, 0, 500000, 698000, 847000, 996000, 996000, 1145000, 1196000][index]
  const start = index ? [0, 0, 0, 0, 0, 500000, 698000, 847000, 996000, 996000, 1145000, 1196000][index - 1] : 0
  const churn = index === 9 ? -149000 : 0
  const contraction = index === 10 ? -50000 : 0
  const expansion = index === 8 ? 200000 : index === 11 ? 51000 : 0
  return {
    month: monthKey(offset), start_mrr: start, end_mrr: end, has_data: has,
    new: Math.max(0, end - start - churn - contraction - expansion), expansion, contraction, churn,
    new_cafes: end > start ? 1 : 0, churned_cafes: churn ? 1 : 0,
  }
})
const cohorts = [6, 5, 4, 3, 2, 1].map((offset, index) => ({
  month: monthKey(offset), size: [2, 1, 1, 1, 1, 1][index],
  cells: Array.from({ length: offset + 1 }, (_, cell) => {
    const pct = cell === 0 ? 100 : [[100, 100, 100, 100, 50, 50, 50], [100, 100, 100, 0, 0, 0], [100, 100, 100, 100, 100], [100, 100, 100, 100], [100, 100, 100], [100, 100]][index][cell] ?? 100
    return { offset: cell, pct, retained: Math.round((pct / 100) * [2, 1, 1, 1, 1, 1][index]) }
  }),
}))
let tickets = [
  { id: 't1', number: 'TKT-00003', cafe_id: 'c2', cafe_name: 'Teras Kopi Bandung', category: 'pembayaran', title: 'QRIS tidak terdeteksi lunas', status: 'new', priority: 'high', assigned_to: null, assigned_name: null, admin_unread: true, owner_unread: false, first_response_at: null, resolved_at: null, created_at: iso(-0.2), last_message_at: iso(-0.1), message_count: 2, last_message: 'Sudah dicoba ulang tetap belum lunas, padahal saldo masuk.' },
  { id: 't2', number: 'TKT-00002', cafe_id: 'c1', cafe_name: 'Kopi Senja', category: 'aplikasi', title: 'Printer struk tidak mencetak logo', status: 'in_progress', priority: 'normal', assigned_to: 'admin', assigned_name: 'Iwan Iqlal', admin_unread: false, owner_unread: true, first_response_at: iso(-1.9), resolved_at: null, created_at: iso(-2), last_message_at: iso(-1.9), message_count: 2, last_message: 'Coba aktifkan Tampilkan logo di Pengaturan → Struk.' },
  { id: 't3', number: 'TKT-00001', cafe_id: 'c5', cafe_name: 'Basecamp Coffee', category: 'akun', title: 'Tambah akun staff baru', status: 'resolved', priority: 'low', assigned_to: 'admin', assigned_name: 'Iwan Iqlal', admin_unread: false, owner_unread: false, first_response_at: iso(-9.8), resolved_at: iso(-9), created_at: iso(-10), last_message_at: iso(-9), message_count: 3, last_message: 'Sudah bisa, terima kasih!' },
]
const messages = {
  t1: [
    { id: 1, author_role: 'owner', author_name: 'Dimas Pratama', body: 'Pembayaran QRIS dari customer sudah masuk ke rekening, tapi di dashboard pesanan tetap "Belum dibayar".', attachments: ['c2/bukti-transfer.jpg'], created_at: iso(-0.2) },
    { id: 2, author_role: 'owner', author_name: 'Dimas Pratama', body: 'Sudah dicoba ulang tetap belum lunas, padahal saldo masuk.', attachments: [], created_at: iso(-0.1) },
  ],
  t2: [
    { id: 3, author_role: 'owner', author_name: 'Rina Wulandari', body: 'Logo kafe tidak muncul di struk printer 58mm.', attachments: [], created_at: iso(-2) },
    { id: 4, author_role: 'admin', author_name: 'Iwan Iqlal', body: 'Coba aktifkan Tampilkan logo di Pengaturan → Struk.', attachments: [], created_at: iso(-1.9) },
  ],
  t3: [
    { id: 5, author_role: 'owner', author_name: 'Sari Dewi', body: 'Mau tambah akun staff baru tapi gagal.', attachments: [], created_at: iso(-10) },
    { id: 6, author_role: 'admin', author_name: 'Iwan Iqlal', body: 'Paket Basic dibatasi 3 staff aktif. Nonaktifkan satu staff lama dulu, atau naik ke Pro.', attachments: [], created_at: iso(-9.8) },
    { id: 7, author_role: 'owner', author_name: 'Sari Dewi', body: 'Sudah bisa, terima kasih!', attachments: [], created_at: iso(-9) },
  ],
}
const ticketCounts = () => ({
  new: tickets.filter((t) => t.status === 'new').length, in_progress: tickets.filter((t) => t.status === 'in_progress').length,
  resolved: tickets.filter((t) => t.status === 'resolved').length, unread: tickets.filter((t) => t.admin_unread && t.status !== 'resolved').length,
})

const RPC = {
  pa_health_map: () => Object.fromEntries(Object.entries(health).map(([id, item]) => [id, { score: item.score, label: item.label }])),
  pa_cafe_health: ({ p_cafe: cafeId }) => {
    const item = health[cafeId]
    return { latest: item ? { score: item.score, label: item.label, reasons: item.reasons, components: item.components, day: iso(0).slice(0, 10), computed_at: iso(-0.3) } : null, history: item?.history || [], setup: setupOf(cafeId) }
  },
  pa_cafe_timeline: ({ p_cafe: cafeId }) => timelineOf(cafeId),
  pa_cafe_note_add: ({ p_cafe: cafeId, p_body: body }) => {
    const note = { id: notes.length + 1, cafe_id: cafeId, body, created_by: 'admin', created_at: new Date().toISOString() }
    notes.push(note)
    return note
  },
  pa_analytics_summary: () => ({ mrr: 1196000, paying: 4, arpa: 299000, churn_rate: 0.0833, churn_months: 3, ltv: 3589000, ltv_note: null, months_with_data: 6, enough: true }),
  pa_analytics_mrr: () => ({ months: mrrMonths, months_with_data: 7, enough: true }),
  pa_analytics_cohort: () => ({ cohorts, enough: true }),
  pa_tickets_list: ({ p_status: status, p_search: search }) => {
    const rows = tickets.filter((t) => (!status || t.status === status) && (!search || `${t.title} ${t.number} ${t.cafe_name}`.toLowerCase().includes(search.toLowerCase())))
    return { counts: ticketCounts(), avg_first_response_minutes: 42, total: rows.length, rows }
  },
  pa_ticket_detail: ({ p_ticket: id }) => {
    const ticket = tickets.find((t) => t.id === id) || tickets[0]
    ticket.admin_unread = false
    const row = cafes.find((cafe) => cafe.cafe_id === ticket.cafe_id)
    return {
      ticket, messages: messages[ticket.id] || [],
      cafe: { id: row.cafe_id, name: row.name, owner_name: row.owner_name, owner_email: row.owner_email, owner_whatsapp: '6281234567890', plan_name: row.plan_name, state: row.state },
      admins: [{ user_id: 'admin', full_name: 'Iwan Iqlal' }, { user_id: 'admin-2', full_name: 'Nadia (Support)' }],
    }
  },
  pa_ticket_reply: ({ p_ticket: id, p_body: body, p_resolve: resolve }) => {
    const ticket = tickets.find((t) => t.id === id)
    messages[id] = [...(messages[id] || []), { id: Date.now(), author_role: 'admin', author_name: 'Iwan Iqlal', body, attachments: [], created_at: new Date().toISOString() }]
    Object.assign(ticket, { status: resolve ? 'resolved' : ticket.status === 'new' ? 'in_progress' : ticket.status, first_response_at: ticket.first_response_at || new Date().toISOString(), owner_unread: true, last_message_at: new Date().toISOString(), message_count: messages[id].length, last_message: body })
    return ticket
  },
  pa_ticket_update: ({ p_ticket: id, p_status: status, p_priority: priority, p_assigned_to: assigned, p_unassign: unassign }) => {
    const ticket = tickets.find((t) => t.id === id)
    if (status) ticket.status = status
    if (priority) ticket.priority = priority
    if (assigned) Object.assign(ticket, { assigned_to: assigned, assigned_name: assigned === 'admin' ? 'Iwan Iqlal' : 'Nadia (Support)' })
    if (unassign) Object.assign(ticket, { assigned_to: null, assigned_name: null })
    return ticket
  },
  ...billingRpc({ cafes }),
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
  // Bentuk data ini = kontrak untuk file SQL 16 (skor kesehatan & progres setup)
  pa_setup_progress: () => [
    { cafe_id: 'c4', cafe_name: 'Kedai Pagi', owner_name: 'Bagus Santoso', owner_whatsapp: '6281299990000', done: 3, total: 8, stuck_step: 'Pembayaran (QRIS)', stuck_days: 5, trial_ends_at: iso(2) },
    { cafe_id: 'c7', cafe_name: 'Titik Temu Kopi', owner_name: 'Laras', owner_whatsapp: '6281377770000', done: 6, total: 8, stuck_step: 'Meja dan QR', stuck_days: 2, trial_ends_at: iso(19) },
    { cafe_id: 'c8', cafe_name: 'Senandung Roastery', owner_name: 'Yoga', owner_whatsapp: null, done: 1, total: 8, stuck_step: 'Jam buka', stuck_days: 9, trial_ends_at: iso(11) },
  ],
  pa_health_overview: () => ({
    counts: { healthy: 3, watch: 1, risk: 1 },
    rows: [
      { cafe_id: 'c2', cafe_name: 'Teras Kopi Bandung', score: 38, label: 'risk', reason: 'Pesanan turun 46% · tagihan telat 3 hari' },
      { cafe_id: 'c5', cafe_name: 'Basecamp Coffee', score: 61, label: 'watch', reason: 'Owner terakhir login 12 hari lalu' },
    ],
  }),
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
  pa_invoice_mark_paid: ({ p_invoice: id, p_paid_at: paidAt, p_ref: ref }) => {
    const invoice = invoices.find((item) => item.id === id)
    if (invoice) Object.assign(invoice, { status: 'paid', state: 'paid', paid_at: paidAt || new Date().toISOString(), method: 'manual_transfer', payment_ref: ref })
    return invoice
  },
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
    storage: { from: () => ({ createSignedUrl: async (path) => ({ data: { signedUrl: 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='480' height='320'><rect width='100%' height='100%' fill='%23272019'/><text x='50%' y='50%' fill='%23BCAB9B' font-family='sans-serif' font-size='20' text-anchor='middle'>${path.split('/').pop()}</text></svg>`.replace(/%23/g, '#')) }, error: null }) }) },
    removeChannel: () => null,
    functions: { invoke: async (name, { body } = {}) => billingInvoke(name, body) || { data: { ok: true, cafe_id: 'c4' }, error: null } },
  }
}
