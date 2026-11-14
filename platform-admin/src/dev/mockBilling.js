/*
 * KHUSUS DEV: data tiruan file 17 (keuangan platform, promo, referral, kredit, grup cabang, pengaturan penagihan).
 * Bentuk data = keluaran fungsi SQL pa_finance_overview, pa_promos_list, pa_referrals_list, pa_cafe_billing, pa_billing_groups_list.
 */
const day = 86400000
const iso = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString()
const monthKey = (offset) => {
  const date = new Date()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() - offset)
  return date.toISOString().slice(0, 10)
}

let billingSettings = {
  billing_suspend_enabled: true, billing_suspend_after_days: 14, billing_enforce_from: iso(-2), referral_credit: 50000, referral_discount_pct: 20,
  branch_discount_pct: 15, billing_company_name: 'Dailybrew', billing_company_address: 'Jakarta Selatan', billing_company_email: 'tagihan@dailybrew.id', billing_tax_id: null,
}
let promos = [
  { id: 'p1', code: 'HEMAT20', description: 'Promo pembukaan cabang', kind: 'percent', value: 20, plan_codes: null, min_months: 1, first_payment_only: false, max_redemptions: 50, per_cafe_limit: 1, valid_from: iso(-30), valid_until: iso(30), is_active: true, used: 3, reserved: 1, discount_total: 209400, state: 'active', created_at: iso(-30) },
  { id: 'p2', code: 'TAHUNAN15', description: null, kind: 'percent', value: 15, plan_codes: ['pro'], min_months: 12, first_payment_only: false, max_redemptions: null, per_cafe_limit: 1, valid_from: null, valid_until: null, is_active: true, used: 1, reserved: 0, discount_total: 628200, state: 'active', created_at: iso(-80) },
  { id: 'p3', code: 'KENALAN50K', description: 'Kafe baru dari pameran', kind: 'amount', value: 50000, plan_codes: null, min_months: 1, first_payment_only: true, max_redemptions: 20, per_cafe_limit: 1, valid_from: iso(-120), valid_until: iso(-20), is_active: true, used: 6, reserved: 0, discount_total: 300000, state: 'expired', created_at: iso(-120) },
]
let groups = [
  { id: 'g1', name: 'Kopi Senja Group', branch_discount_pct: null, note: 'Owner Rina punya 2 cabang', created_at: iso(-60), cafeIds: ['c1', 'c5'] },
]
const ledgers = {
  c1: [{ id: 3, amount: 50000, kind: 'referral', note: 'Referral: Kedai Pagi', created_at: iso(-6) }, { id: 1, amount: 100000, kind: 'admin', note: 'Kompensasi gangguan server', created_at: iso(-40) }, { id: 2, amount: -100000, kind: 'invoice', note: 'Dipakai untuk INV-2610-00004', created_at: iso(-35) }],
}

export function billingRpc({ cafes }) {
  const cafeName = (id) => cafes.find((cafe) => cafe.cafe_id === id)?.name || id
  const groupOf = (cafeId) => groups.find((group) => group.cafeIds.includes(cafeId))
  const discountOf = (cafeId) => {
    const group = groupOf(cafeId)
    if (!group || group.cafeIds[0] === cafeId) return 0
    return group.branch_discount_pct ?? billingSettings.branch_discount_pct
  }
  const balance = (cafeId) => (ledgers[cafeId] || []).reduce((sum, row) => sum + row.amount, 0)
  return {
    pa_finance_overview: () => ({
      mrr: 1196000, collected_month: 847000, collected_prev: 996000,
      outstanding: { count: 2, amount: 648000 },
      aging: { not_due: { count: 1, amount: 299000 }, d1_7: { count: 1, amount: 349000 }, d8_30: { count: 0, amount: 0 }, d31: { count: 0, amount: 0 } },
      forecast_30: { invoiced: 648000, renewals: 149000, renewal_count: 1 },
      months: Array.from({ length: 12 }, (_, index) => ({
        month: monthKey(11 - index),
        collected: index < 5 ? 0 : [349000, 498000, 847000, 698000, 1047000, 996000, 847000][index - 5],
        invoices: index < 5 ? 0 : [1, 2, 3, 2, 3, 3, 3][index - 5],
        discounts: index < 5 ? 0 : [0, 0, 69800, 50000, 0, 69800, 69800][index - 5],
        credits: index < 5 ? 0 : [0, 0, 0, 100000, 0, 0, 50000][index - 5],
      })),
      methods: [{ method: 'gateway', count: 11, amount: 3247000 }, { method: 'manual_transfer', count: 5, amount: 1986000 }, { method: 'credit', count: 1, amount: 0 }],
      on_time: { paid: 9, on_time: 7 },
      suspended: [{ cafe_id: 'c6', name: 'Warung Kopi Lama', since: iso(-20), pending_amount: 149000 }],
      at_risk: [{ cafe_id: 'c2', name: 'Teras Kopi Bandung', suspend_at: iso(11) }],
      promos: [{ code: 'TAHUNAN15', count: 1, discount: 628200 }, { code: 'KENALAN50K', count: 6, discount: 300000 }, { code: 'HEMAT20', count: 3, discount: 209400 }],
      credit_outstanding: 150000,
      settings: billingSettings,
    }),
    pa_promos_list: () => promos,
    pa_promo_upsert: (args) => {
      const row = {
        id: args.p_id || `p${promos.length + 1}`, code: args.p_code, description: args.p_description, kind: args.p_kind, value: args.p_value,
        plan_codes: args.p_plan_codes, min_months: args.p_min_months, first_payment_only: args.p_first_payment_only, max_redemptions: args.p_max_redemptions,
        per_cafe_limit: args.p_per_cafe_limit, valid_from: args.p_valid_from, valid_until: args.p_valid_until, is_active: args.p_is_active,
        used: 0, reserved: 0, discount_total: 0, state: args.p_is_active ? 'active' : 'inactive', created_at: new Date().toISOString(),
      }
      const existing = promos.find((promo) => promo.id === args.p_id)
      promos = existing ? promos.map((promo) => (promo.id === args.p_id ? { ...promo, ...row, used: promo.used, reserved: promo.reserved, discount_total: promo.discount_total } : promo)) : [row, ...promos]
      return row
    },
    pa_referrals_list: () => ({
      summary: { total: 3, pending: 1, rewarded: 2, reward_total: 100000, discount_total: 139600 },
      credit_outstanding: 150000,
      rows: [
        { id: 'r3', code: 'KOPI7H3K', status: 'pending', created_at: iso(-2), rewarded_at: null, reward_amount: 50000, discount_pct: 20, referrer_cafe_id: 'c1', referrer_name: 'Kopi Senja', referred_cafe_id: 'c4', referred_name: 'Kedai Pagi' },
        { id: 'r2', code: 'TERA4M2P', status: 'rewarded', created_at: iso(-40), rewarded_at: iso(-31), reward_amount: 50000, discount_pct: 20, referrer_cafe_id: 'c2', referrer_name: 'Teras Kopi Bandung', referred_cafe_id: 'c5', referred_name: 'Basecamp Coffee' },
        { id: 'r1', code: 'KOPI7H3K', status: 'rewarded', created_at: iso(-95), rewarded_at: iso(-88), reward_amount: 50000, discount_pct: 20, referrer_cafe_id: 'c1', referrer_name: 'Kopi Senja', referred_cafe_id: 'c3', referred_name: 'Ruang Seduh' },
      ],
    }),
    pa_cafe_billing: ({ p_cafe: cafeId }) => {
      const group = groupOf(cafeId)
      const cafe = cafes.find((row) => row.cafe_id === cafeId)
      return {
        referral_code: `${cafeName(cafeId).replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase()}7H3K`,
        suspended_kind: cafe?.state === 'suspended' ? 'billing' : null,
        suspend_at: cafe?.state === 'past_due' ? iso(11) : null,
        billing_pause_until: null,
        credit_balance: balance(cafeId), credit_available: balance(cafeId),
        ledger: ledgers[cafeId] || [],
        group: group ? { id: group.id, name: group.name } : null,
        branch_discount_pct: discountOf(cafeId),
        referred_by: cafeId === 'c4' ? { cafe_id: 'c1', name: 'Kopi Senja', status: 'pending' } : null,
        referrals_made: cafeId === 'c1' ? 2 : 0,
      }
    },
    pa_credit_adjust: ({ p_cafe: cafeId, p_amount: amount, p_note: note }) => {
      ledgers[cafeId] = [{ id: Date.now(), amount, kind: 'admin', note, created_at: new Date().toISOString() }, ...(ledgers[cafeId] || [])]
      return { balance: balance(cafeId), available: balance(cafeId) }
    },
    pa_billing_groups_list: () => ({
      default_pct: billingSettings.branch_discount_pct,
      groups: groups.map((group) => ({
        id: group.id, name: group.name, branch_discount_pct: group.branch_discount_pct, note: group.note, created_at: group.created_at,
        cafes: group.cafeIds.map((id) => {
          const cafe = cafes.find((row) => row.cafe_id === id)
          const pct = discountOf(id)
          return { id, name: cafe.name, discount_pct: pct, monthly_price: Math.round((cafe.monthly_price * (100 - pct)) / 100), plan_name: cafe.plan_name, state: cafe.state }
        }),
      })),
    }),
    pa_billing_group_upsert: ({ p_id: id, p_name: name, p_branch_discount_pct: pct, p_note: note }) => {
      const existing = groups.find((group) => group.id === id)
      if (existing) Object.assign(existing, { name, branch_discount_pct: pct, note })
      else groups = [...groups, { id: `g${groups.length + 1}`, name, branch_discount_pct: pct, note, created_at: new Date().toISOString(), cafeIds: [] }]
      return existing || groups.at(-1)
    },
    pa_billing_group_delete: ({ p_id: id }) => { groups = groups.filter((group) => group.id !== id); return null },
    pa_cafe_set_billing_group: ({ p_cafe: cafeId, p_group: groupId }) => {
      groups.forEach((group) => { group.cafeIds = group.cafeIds.filter((id) => id !== cafeId) })
      if (groupId) groups.find((group) => group.id === groupId)?.cafeIds.push(cafeId)
      const cafe = cafes.find((row) => row.cafe_id === cafeId)
      const pct = discountOf(cafeId)
      return { billing_group_id: groupId, branch_discount_pct: pct, monthly_price: Math.round((cafe.monthly_price * (100 - pct)) / 100) }
    },
    pa_billing_settings_update: ({ p_patch: patch }) => {
      billingSettings = { ...billingSettings, ...patch }
      return billingSettings
    },
  }
}

/** functions.invoke('subscription-billing', receipt) tiruan → Blob */
export function billingInvoke(name, body) {
  if (name === 'subscription-billing' && body?.action === 'receipt') {
    return { data: new Blob([`%PDF-1.4\n% Kuitansi tiruan ${body.invoice_id}\n`], { type: 'application/octet-stream' }), error: null }
  }
  return null
}
