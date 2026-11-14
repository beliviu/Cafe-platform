/*
 * KHUSUS DEV: tagihan langganan Dailybrew (file 14 + 17) untuk /preview/owner/settings/subscription.
 * Bentuk data = keluaran fungsi SQL owner_invoices / owner_invoice_apply_promo / owner_referral_* .
 * ?mock_billing=suspended → kafe tampil nonaktif karena tagihan; ?mock_billing=warning → peringatan nonaktif.
 */
const day = 86400000
const iso = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString()
const PROMOS = { HEMAT20: { kind: 'percent', value: 20 }, PERTAMA50K: { kind: 'amount', value: 50000 } }
let seq = 31

export function createBillingFixtures(cafeId) {
  const invoices = [
    {
      id: 'inv-pending', number: 'INV-2611-00031', cafe_id: cafeId, plan_code: 'pro', plan_name: 'Pro', months: 1,
      period_start: iso(4), period_end: iso(34), list_amount: 349000, promo_code: null, promo_discount: 0, referral_discount: 0, credit_amount: 50000,
      amount: 299000, status: 'pending', state: 'pending', due_at: iso(4), source: 'system', created_at: iso(-3),
    },
    {
      id: 'inv-paid-1', number: 'INV-2610-00018', cafe_id: cafeId, plan_code: 'pro', plan_name: 'Pro', months: 1,
      period_start: iso(-26), period_end: iso(4), list_amount: 349000, promo_code: 'HEMAT20', promo_discount: 69800, referral_discount: 0, credit_amount: 0,
      amount: 279200, status: 'paid', state: 'paid', due_at: iso(-26), paid_at: iso(-27), method: 'gateway', created_at: iso(-33),
    },
    {
      id: 'inv-paid-0', number: 'INV-2609-00007', cafe_id: cafeId, plan_code: 'pro', plan_name: 'Pro', months: 1,
      period_start: iso(-56), period_end: iso(-26), list_amount: 349000, promo_code: null, promo_discount: 0, referral_discount: 69800, credit_amount: 0,
      amount: 279200, status: 'paid', state: 'paid', due_at: iso(-56), paid_at: iso(-57), method: 'manual_transfer', created_at: iso(-63),
    },
  ]
  const referral = {
    code: 'KOPI7H3K', reward_amount: 50000, discount_pct: 20, credit_balance: 50000, credit_available: 0, earned_total: 100000,
    referrals: [
      { cafe_name: 'Kedai Senja', status: 'rewarded', created_at: iso(-40), rewarded_at: iso(-30), reward_amount: 50000 },
      { cafe_name: 'Kopi Pagi', status: 'rewarded', created_at: iso(-20), rewarded_at: iso(-12), reward_amount: 50000 },
      { cafe_name: 'Warung Seduh', status: 'pending', created_at: iso(-2), rewarded_at: null, reward_amount: 50000 },
    ],
    ledger: [
      { amount: 50000, kind: 'referral', note: 'Referral: Kopi Pagi', created_at: iso(-12) },
      { amount: -50000, kind: 'invoice', note: 'Dipakai untuk INV-2610-00018', created_at: iso(-27) },
      { amount: 50000, kind: 'referral', note: 'Referral: Kedai Senja', created_at: iso(-30) },
    ],
    claimed: { code: 'DAILY9X2M', status: 'rewarded', discount_pct: 20, referrer_name: 'Kopi Tetangga' },
    can_claim: false, claim_until: iso(-30),
  }
  return { invoices, referral }
}

function recalc(invoice) {
  const promo = invoice.promo_code ? PROMOS[invoice.promo_code] : null
  invoice.promo_discount = !promo ? 0 : promo.kind === 'percent' ? Math.round((invoice.list_amount * promo.value) / 100) : Math.min(promo.value, invoice.list_amount)
  invoice.amount = Math.max(invoice.list_amount - invoice.promo_discount - invoice.referral_discount - invoice.credit_amount, 0)
}

function platformStatus() {
  const mode = new URLSearchParams(window.location.search).get('mock_billing')
  if (mode === 'suspended') {
    return { suspended: true, suspended_kind: 'billing', suspended_at: iso(-1), suspended_reason: 'Langganan belum dibayar 14 hari setelah masa berlaku habis', status: 'past_due', pending_invoices: 1 }
  }
  if (mode === 'warning') {
    return { suspended: false, status: 'past_due', current_period_end: iso(-12), grace_until: iso(-5), in_grace: false, suspend_at: iso(2), pending_invoices: 1 }
  }
  return null
}

export function billingRpc(billing, name, args) {
  const ok = (data) => ({ data, error: null })
  switch (name) {
    case 'owner_invoices':
      return ok(billing.invoices.filter((invoice) => invoice.status !== 'void'))
    case 'cafe_platform_status': {
      const status = platformStatus()
      return status ? ok(status) : { data: null, error: { message: 'mock: status normal' } }
    }
    case 'owner_invoice_request': {
      seq += 1
      const price = args.p_plan === 'basic' ? 149000 : 349000
      const invoice = {
        id: `inv-${seq}`, number: `INV-2611-000${seq}`, cafe_id: args.p_cafe_id, plan_code: args.p_plan, plan_name: args.p_plan === 'basic' ? 'Basic' : 'Pro',
        months: args.p_months, period_start: iso(4), period_end: iso(4 + 30 * args.p_months), list_amount: price * args.p_months,
        promo_code: null, promo_discount: 0, referral_discount: 0, credit_amount: 0, status: 'pending', state: 'pending', due_at: iso(3), source: 'owner', created_at: iso(0),
      }
      recalc(invoice)
      billing.invoices.unshift(invoice)
      return ok(invoice)
    }
    case 'owner_invoice_apply_promo': {
      const invoice = billing.invoices.find((item) => item.id === args.p_invoice)
      const code = String(args.p_code || '').trim().toUpperCase()
      if (code && !PROMOS[code]) return ok({ ok: false, error: 'Kode promo tidak dikenal' })
      invoice.promo_code = code || null
      recalc(invoice)
      return ok({ ok: true, invoice })
    }
    case 'owner_referral_info':
      return ok(billing.referral)
    case 'owner_referral_claim':
      return ok({ ok: false, error: 'Kafe ini sudah memakai kode referral' })
    default:
      return null
  }
}

/** functions.invoke('subscription-billing') tiruan: kuitansi = Blob kecil, bayar = pesan pratinjau. */
export function billingInvoke(body) {
  if (body.action === 'receipt') {
    const text = `%PDF-1.4\n% Kuitansi tiruan untuk ${body.invoice_id}\n`
    return { data: new Blob([text], { type: 'application/octet-stream' }), error: null }
  }
  return { data: { error: 'Pratinjau: halaman bayar Midtrans tidak dibuka.' }, error: null }
}
