/*
 * KHUSUS DEV: data tiruan file SQL 18 (tim admin & peran, pendaftaran, feature flag, status sistem, Tanya AI,
 * lihat-sebagai, pengaturan platform & template email). ?mock_role=finance|support → uji tampilan per peran.
 */
const day = 86400000
const iso = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString()

const ALLOWED = {
  finance: ['pa_overview', 'pa_cafes_list', 'pa_cafe_detail', 'pa_plans_list', 'pa_invoices_list', 'pa_audit_list', 'pa_action_items', 'pa_notifications_list',
    'pa_notifications_mark_read', 'pa_announcements_list', 'pa_settings_get', 'pa_log_whatsapp', 'pa_cafe_outbox', 'pa_health_overview', 'pa_health_map', 'pa_cafe_health',
    'pa_setup_progress', 'pa_cafe_timeline', 'pa_status_admin', 'pa_ai_quota', 'pa_ai_facts', 'pa_ai_log', 'pa_ai_history', 'pa_cafe_flags', 'pa_flags_overview',
    'pa_invoice_create', 'pa_invoice_mark_paid', 'pa_invoice_void', 'pa_subscription_set_plan', 'pa_subscription_extend', 'pa_subscription_trial', 'pa_analytics_mrr',
    'pa_analytics_cohort', 'pa_analytics_summary', 'pa_promos_list', 'pa_promo_upsert', 'pa_referrals_list', 'pa_cafe_billing', 'pa_credit_adjust',
    'pa_billing_groups_list', 'pa_billing_group_upsert', 'pa_billing_group_delete', 'pa_cafe_set_billing_group', 'pa_billing_settings_update', 'pa_finance_overview'],
  support: ['pa_overview', 'pa_cafes_list', 'pa_cafe_detail', 'pa_plans_list', 'pa_invoices_list', 'pa_audit_list', 'pa_action_items', 'pa_notifications_list',
    'pa_notifications_mark_read', 'pa_announcements_list', 'pa_settings_get', 'pa_log_whatsapp', 'pa_cafe_outbox', 'pa_health_overview', 'pa_health_map', 'pa_cafe_health',
    'pa_setup_progress', 'pa_cafe_timeline', 'pa_status_admin', 'pa_ai_quota', 'pa_ai_facts', 'pa_ai_log', 'pa_ai_history', 'pa_cafe_flags', 'pa_flags_overview',
    'pa_signups_list', 'pa_impersonations_list', 'pa_cafe_note_add', 'pa_tickets_list', 'pa_ticket_detail', 'pa_ticket_reply', 'pa_ticket_update',
    'pa_impersonate_start', 'pa_impersonate_end', 'pa_incident_create', 'pa_incident_update', 'pa_service_set_status'],
}
export function mockRole() {
  const role = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('mock_role') : null
  return ['finance', 'support'].includes(role) ? role : 'super'
}
export function whoamiExtra() {
  const role = mockRole()
  return { role, allowed: role === 'super' ? ['*'] : ALLOWED[role], impersonation: null }
}

let team = [
  { user_id: 'admin', full_name: 'Iwan Iqlal', email: 'iwaniqlal@gmail.com', role: 'super', is_active: true, created_at: iso(-120), last_sign_in_at: iso(-0.1), mfa: true, is_me: true },
  { user_id: 'admin-2', full_name: 'Nadia', email: 'nadia@dailybrew.id', role: 'support', is_active: true, created_at: iso(-40), last_sign_in_at: iso(-1), mfa: true, is_me: false },
  { user_id: 'admin-3', full_name: 'Fajar', email: 'fajar@dailybrew.id', role: 'finance', is_active: true, created_at: iso(-20), last_sign_in_at: iso(-3), mfa: false, is_me: false },
  { user_id: 'admin-4', full_name: 'Raka', email: 'raka@dailybrew.id', role: 'support', is_active: false, created_at: iso(-90), last_sign_in_at: iso(-60), mfa: true, is_me: false },
]
let signups = [
  { cafe_id: 'c9', name: 'Kopi Tepi Sawah', city: 'Yogyakarta', owner_whatsapp: '6281255501111', signup_status: 'pending', signup_at: iso(-0.2), owner_name: 'Wulan', owner_email: 'wulan@tepisawah.id', email_confirmed: true, state: 'suspended', plan_name: 'Pro', trial_ends_at: iso(14) },
  { cafe_id: 'c10', name: 'Seduh Pagi', city: 'Surabaya', owner_whatsapp: '6281388802222', signup_status: 'pending', signup_at: iso(-1.1), owner_name: 'Andi', owner_email: 'andi@seduhpagi.id', email_confirmed: false, state: 'suspended', plan_name: 'Pro', trial_ends_at: iso(13) },
  { cafe_id: 'c4', name: 'Kedai Pagi', city: 'Bandung', owner_whatsapp: '6281299990000', signup_status: 'approved', signup_at: iso(-12), owner_name: 'Bagus Santoso', owner_email: 'bagus@kedaipagi.id', email_confirmed: true, state: 'trial', plan_name: 'Pro', trial_ends_at: iso(2) },
]
let features = [
  { key: 'inventory', label: 'Inventori & resep', description: 'Stok bahan, resep, HPP, pembelian', kind: 'module', cafes: [{ cafe_id: 'c5', name: 'Basecamp Coffee', enabled: true, expires_at: iso(20), note: 'Uji coba 30 hari' }] },
  { key: 'finance', label: 'Keuangan & akuntansi', description: 'Jurnal, laba rugi, neraca', kind: 'module', cafes: [] },
  { key: 'loyalty', label: 'Poin & member', description: 'Poin pelanggan dan tingkat member', kind: 'module', cafes: [] },
  { key: 'qr_ordering', label: 'Pesan dari QR meja', description: 'Pelanggan memesan dari meja', kind: 'module', cafes: [{ cafe_id: 'c2', name: 'Teras Kopi Bandung', enabled: false, expires_at: null, note: 'Dimatikan sementara' }] },
  { key: 'payment_gateway', label: 'QRIS online', description: 'Pembayaran online lewat gateway', kind: 'module', cafes: [] },
  { key: 'ai_advisor', label: 'Tanya AI owner', description: 'Advisor bisnis AI untuk owner', kind: 'module', cafes: [] },
  { key: 'kasir_baru', label: 'Kasir versi baru', description: 'Tata letak kasir cepat untuk tablet', kind: 'beta', cafes: [
    { cafe_id: 'c1', name: 'Kopi Senja', enabled: true, expires_at: null, note: 'Uji coba' }, { cafe_id: 'c4', name: 'Kedai Pagi', enabled: true, expires_at: iso(30), note: null }] },
]
const services = [
  { key: 'web', name: 'Dashboard web', description: 'Dashboard owner & staff', status: 'operational' },
  { key: 'app', name: 'Aplikasi pelanggan', description: 'Menu, QR meja, dan pesanan pelanggan', status: 'operational' },
  { key: 'payments', name: 'Pembayaran', description: 'QRIS & pembayaran online', status: 'degraded' },
  { key: 'notifications', name: 'Notifikasi', description: 'Email & pemberitahuan', status: 'operational' },
]
let incidents = [
  { id: 'i-2', title: 'Konfirmasi QRIS terlambat', impact: 'minor', status: 'identified', services: ['payments'], started_at: iso(-0.03), resolved_at: null, updates: [
    { status: 'identified', body: 'Penyebab di penyedia pembayaran. Status lunas menyusul otomatis.', created_at: iso(-0.01) },
    { status: 'investigating', body: 'Sebagian pembayaran QRIS terlambat dikonfirmasi.', created_at: iso(-0.03) }] },
  { id: 'i-1', title: 'Email notifikasi tertunda', impact: 'minor', status: 'resolved', services: ['notifications'], started_at: iso(-9), resolved_at: iso(-8.95), updates: [
    { status: 'resolved', body: 'Semua email tertunda sudah terkirim.', created_at: iso(-8.95) }, { status: 'investigating', body: 'Email pengingat terlambat terkirim.', created_at: iso(-9) }] },
]
let templates = [
  { key: 'welcome', subject: 'Selamat datang di {{platform}}', heading: 'Halo {{nama_owner}}, selamat datang!', body: '{{isi}}\n\nLangkah pertama: lengkapi identitas kafe, jam buka, menu, meja, dan pembayaran. Semuanya ada di menu Mulai.', cta_label: 'Buka dashboard', updated_at: iso(-3) },
  { key: 'invoice', subject: 'Tagihan langganan {{nama_kafe}}', heading: 'Tagihan baru untuk {{nama_kafe}}', body: '{{isi}}\n\nBayar online dengan QRIS, virtual account, e-wallet, atau kartu dari Pengaturan → Langganan.', cta_label: 'Bayar sekarang', updated_at: iso(-3) },
  { key: 'reminder', subject: '{{judul}} · {{nama_kafe}}', heading: '{{judul}}', body: '{{isi}}\n\nAbaikan pesan ini bila sudah membayar.', cta_label: 'Bayar sekarang', updated_at: iso(-3) },
  { key: 'reset_password', subject: 'Atur ulang password {{platform}}', heading: 'Atur ulang password', body: 'Kami menerima permintaan atur ulang password untuk akun ini. Tekan tombol di bawah untuk membuat password baru.', cta_label: 'Buat password baru', updated_at: iso(-3) },
]
let aiHistory = [{ id: 1, question: 'Kafe mana yang paling mungkin berhenti bulan depan?', answer: 'Teras Kopi Bandung paling berisiko (poin 77): skor kesehatan 38 turun dari 61, tagihan telat 3 hari, pesanan turun 46%.', status: 'answered', created_at: iso(-1) }]
export const platformSettingsExtra = { signup_enabled: true, signup_approval_mode: true, default_trial_days: 14, default_trial_plan: 'pro', billing_grace_days: 7, ai_daily_limit: 30 }

export function scaleRpc({ cafes }) {
  return {
    pa_admins_list: () => team,
    pa_admin_update: ({ p_user: id, p_role: role, p_active: active }) => {
      team = team.map((member) => (member.user_id === id ? { ...member, role: role ?? member.role, is_active: active ?? member.is_active } : member))
      return team.find((member) => member.user_id === id)
    },
    pa_signups_list: ({ p_status: status }) => ({
      counts: { pending: signups.filter((row) => row.signup_status === 'pending').length, approved: signups.filter((row) => row.signup_status === 'approved').length, rejected: signups.filter((row) => row.signup_status === 'rejected').length },
      rows: signups.filter((row) => !status || row.signup_status === status),
    }),
    pa_signup_decide: ({ p_cafe: id, p_approve: approve }) => {
      signups = signups.map((row) => (row.cafe_id === id ? { ...row, signup_status: approve ? 'approved' : 'rejected', state: approve ? 'trial' : 'suspended' } : row))
      return { cafe_id: id }
    },
    pa_flags_overview: () => features.map(({ cafes: list, ...feature }) => ({ ...feature, on_count: list.filter((row) => row.enabled).length, off_count: list.filter((row) => !row.enabled).length, cafes: list })),
    pa_flag_bulk: ({ p_feature: key, p_cafe_ids: ids, p_enabled: enabled }) => {
      features = features.map((feature) => (feature.key !== key ? feature : {
        ...feature,
        cafes: [...feature.cafes.filter((row) => !ids.includes(row.cafe_id)), ...(enabled === null ? [] : ids.map((id) => ({ cafe_id: id, name: cafes.find((cafe) => cafe.cafe_id === id)?.name || id, enabled, expires_at: null })))],
      }))
      return ids.length
    },
    pa_feature_upsert: ({ p_key: key, p_label: label, p_description: description }) => {
      features = [...features, { key, label, description, kind: 'beta', cafes: [] }]
      return { key, label }
    },
    pa_cafe_flags: ({ p_cafe: cafeId }) => {
      const cafe = cafes.find((row) => row.cafe_id === cafeId)
      const planFeatures = cafe?.plan_code === 'basic' ? [] : ['inventory', 'finance', 'loyalty', 'qr_ordering', 'payment_gateway', 'ai_advisor']
      return features.map((feature) => {
        const flag = feature.cafes.find((row) => row.cafe_id === cafeId)
        return { key: feature.key, label: feature.label, description: feature.description, kind: feature.kind, in_plan: planFeatures.includes(feature.key), flag: flag ? flag.enabled : null, flag_expired: false, expires_at: flag?.expires_at ?? null, effective: flag ? flag.enabled : planFeatures.includes(feature.key) }
      })
    },
    pa_flag_set: ({ p_cafe: cafeId, p_feature: key, p_enabled: enabled }) => {
      features = features.map((feature) => (feature.key !== key ? feature : {
        ...feature,
        cafes: [...feature.cafes.filter((row) => row.cafe_id !== cafeId), ...(enabled === null ? [] : [{ cafe_id: cafeId, name: cafes.find((cafe) => cafe.cafe_id === cafeId)?.name || cafeId, enabled, expires_at: null }])],
      }))
      return { feature: key, flag: enabled, effective: enabled ?? true }
    },
    pa_status_admin: () => ({ updated_at: iso(0), overall: services.some((s) => s.status !== 'operational') ? 'degraded' : 'operational', services, incidents }),
    pa_service_set_status: ({ p_service: key, p_status: status }) => { const service = services.find((s) => s.key === key); service.status = status; return service },
    pa_incident_create: ({ p_title: title, p_impact: impact, p_services: list, p_body: body }) => {
      const incident = { id: `i-${incidents.length + 1}`, title, impact, status: 'investigating', services: list, started_at: iso(0), resolved_at: null, updates: [{ status: 'investigating', body, created_at: iso(0) }] }
      incidents = [incident, ...incidents]
      return incident
    },
    pa_incident_update: ({ p_incident: id, p_status: status, p_body: body }) => {
      const incident = incidents.find((row) => row.id === id)
      Object.assign(incident, { status, resolved_at: status === 'resolved' ? iso(0) : null, updates: [{ status, body, created_at: iso(0) }, ...incident.updates] })
      if (status === 'resolved') incident.services.forEach((key) => { services.find((s) => s.key === key).status = 'operational' })
      return incident
    },
    pa_ai_quota: () => ({ limit: 30, used: aiHistory.length, remaining: 30 - aiHistory.length }),
    pa_ai_facts: () => ({
      generated_at: iso(0),
      risk_formula: '100 − skor kesehatan + 15 bila tagihan telat + 10 bila skor turun ≥15 dalam 14 hari + 10 bila owner tidak login ≥14 hari + 10 bila masa coba habis ≤7 hari dan setup <6.',
      summary: { paying_cafes: 4, trial_cafes: 1, mrr: 1196000 },
      cafes_by_risk: [
        { cafe: 'Teras Kopi Bandung', plan: 'Pro', state: 'past_due', monthly_price: 349000, risk_points: 77, health_score: 38, health_label: 'risk', health_reasons: ['Pesanan turun 46%', 'Tagihan telat 3 hari'], overdue_invoice_days: 3, owner_last_login_days: 2 },
        { cafe: 'Kedai Pagi', plan: 'Pro', state: 'trial', monthly_price: 349000, risk_points: 58, health_score: 52, health_label: 'watch', health_reasons: ['Setup 3 dari 8 langkah'], overdue_invoice_days: null, owner_last_login_days: 1 },
        { cafe: 'Basecamp Coffee', plan: 'Basic', state: 'active', monthly_price: 149000, risk_points: 49, health_score: 61, health_label: 'watch', health_reasons: ['Owner terakhir login 12 hari lalu'], overdue_invoice_days: null, owner_last_login_days: 12 },
        { cafe: 'Kopi Senja', plan: 'Pro', state: 'active', monthly_price: 349000, risk_points: 8, health_score: 92, health_label: 'healthy', health_reasons: [], overdue_invoice_days: null, owner_last_login_days: 0 },
      ],
    }),
    pa_ai_history: () => aiHistory,
    pa_impersonations_list: ({ p_cafe: cafeId }) => (cafeId === 'c2' || !cafeId ? [
      { id: 'imp-1', cafe_id: 'c2', cafe_name: 'Teras Kopi Bandung', admin_name: 'Nadia', reason: 'Owner lapor laporan penjualan kosong (TKT-00012)', started_at: iso(-2), expires_at: iso(-1.98), ended_at: iso(-1.99), end_reason: 'ended', active: false },
    ] : []),
    pa_impersonate_start: ({ p_cafe: cafeId }) => ({ id: 'imp-new', cafe_id: cafeId, expires_at: new Date(Date.now() + 30 * 60000).toISOString() }),
    pa_impersonate_end: () => ({ ended: 1 }),
    pa_email_templates_list: () => templates,
    pa_email_template_update: ({ p_key: key, p_subject: subject, p_heading: heading, p_body: body, p_cta_label: cta }) => {
      templates = templates.map((tpl) => (tpl.key === key ? { ...tpl, subject, heading, body, cta_label: cta } : tpl))
      return templates.find((tpl) => tpl.key === key)
    },
    pa_platform_settings_update: ({ p_patch: patch }) => { Object.assign(platformSettingsExtra, patch); return platformSettingsExtra },
  }
}

export function scaleInvoke(name, body) {
  if (name === 'platform-admin' && body?.action === 'invite_admin') {
    team = [...team, { user_id: `admin-${team.length + 1}`, full_name: body.full_name, email: body.email, role: body.role, is_active: true, created_at: iso(0), last_sign_in_at: null, mfa: false, is_me: false }]
    return { data: { ok: true }, error: null }
  }
  if (name === 'platform-advisor') {
    const answer = 'Teras Kopi Bandung paling mungkin berhenti (poin risiko 77): skor kesehatan 38, tagihan telat 3 hari, dan pesanan 14 hari terakhir turun 46%.\n\nKedai Pagi (masa coba, poin 58) baru menyelesaikan 3 dari 8 langkah setup dan masa cobanya habis 2 hari lagi.\n\nSaran: chat WA owner Teras Kopi soal tagihan; bantu Kedai Pagi menyelesaikan meja & QRIS hari ini.'
    aiHistory = [{ id: aiHistory.length + 1, question: body.question, answer, status: 'answered', created_at: iso(0) }, ...aiHistory]
    return { data: { answer, model: 'claude-opus-5-5 (tiruan)', truncated: false, remaining: 30 - aiHistory.length }, error: null }
  }
  return null
}
