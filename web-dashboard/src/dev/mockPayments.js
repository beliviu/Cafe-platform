/*
 * KHUSUS DEV: pembayaran QRIS online tiruan (file 09 + Edge Function payments) untuk pratinjau.
 * Kendali QA: window.__dailybrewMock.payIntent() → tagihan menunggu terbaru jadi lunas (seperti webhook).
 */
let seq = 8000
const uid = (prefix) => `${prefix}-${(seq += 1)}`
const MIN = 60000

export function createPaymentFixtures({ cafeId, orders, now = new Date() }) {
  const t = now.getTime()
  const paidOrders = orders.filter((order) => order.payment_status === 'paid').slice(-4)
  const intents = paidOrders.map((order, index) => ({
    id: `pi-${index}`, cafe_id: cafeId, order_id: order.id, provider: 'midtrans', provider_order_id: `DB2611${String(index).padStart(2, '0')}-A1B2C3D4E5F${index}`,
    provider_transaction_id: `tx-${index}-9f2c`, amount: order.total_amount, paid_amount: order.total_amount, status: 'paid', review_reason: null,
    failure_message: null, source: index % 2 ? 'pos' : 'app', expires_at: new Date(t - (index + 1) * 60 * MIN).toISOString(),
    paid_at: new Date(t - (index + 1) * 70 * MIN).toISOString(), created_at: new Date(t - (index + 1) * 72 * MIN).toISOString(), payment_id: `pay-${order.id}`,
  }))
  if (intents[0]) Object.assign(intents[0], { review_reason: 'Pesanan sudah dibayar dengan cara lain — kembalikan dana kelebihan', payment_id: null })
  intents.push({
    id: 'pi-expired', cafe_id: cafeId, order_id: orders[0].id, provider: 'midtrans', provider_order_id: 'DB261108-EXPIRED0001', provider_transaction_id: null,
    amount: orders[0].total_amount, paid_amount: null, status: 'expired', review_reason: null, failure_message: null, source: 'app',
    expires_at: new Date(t - 30 * MIN).toISOString(), paid_at: null, created_at: new Date(t - 45 * MIN).toISOString(), payment_id: null,
  })
  return {
    settings: { payment_gateway_enabled: true, payment_gateway_provider: 'midtrans', payment_qris_expiry_minutes: 15 },
    tables: { payment_intents: intents, payment_refunds: [], payment_events: [] },
  }
}

export function paymentRpc(store, name) {
  if (name !== 'payment_gateway_summary') return null
  const intents = store.payment_intents
  return {
    data: {
      paid_count: intents.filter((row) => row.status === 'paid').length,
      paid_amount: intents.filter((row) => row.status === 'paid').reduce((sum, row) => sum + Number(row.paid_amount), 0),
      pending_count: intents.filter((row) => row.status === 'pending').length,
      expired_count: intents.filter((row) => row.status === 'expired').length,
      failed_count: 0,
      review_count: intents.filter((row) => row.review_reason).length,
      refunded_amount: store.payment_refunds.filter((row) => row.status === 'succeeded').reduce((sum, row) => sum + Number(row.amount), 0),
      last_webhook_at: new Date(Date.now() - 12 * MIN).toISOString(),
    },
    error: null,
  }
}

/** functions.invoke('payments', { body }) tiruan */
export function paymentInvoke(store, body, userId) {
  const fail = (message) => ({ data: { error: message }, error: null })
  if (body.action === 'create') {
    const order = store.orders.find((row) => row.id === body.order_id)
    if (!order) return fail('Pesanan tidak ditemukan')
    if (order.payment_status === 'paid') return fail('Pesanan sudah lunas')
    const amount = Math.ceil(Number(order.total_amount) - Number(order.paid_amount || 0))
    const active = store.payment_intents.find((row) => row.order_id === order.id && row.status === 'pending')
    if (active && Number(active.amount) === amount && Date.parse(active.expires_at) > Date.now() + 30000) return { data: { intent: active, reused: true }, error: null }
    if (active) active.status = 'expired'
    const intent = {
      id: uid('pi'), cafe_id: order.cafe_id, order_id: order.id, provider: 'midtrans', provider_order_id: `DB261109-${uid('MOCK').toUpperCase()}`,
      provider_transaction_id: uid('tx'), amount, paid_amount: null, status: 'pending', review_reason: null, failure_message: null, source: body.source || 'app',
      qr_string: `00020101021226670016COM.MOCK.QRIS${order.id}5204581253033605802ID5909KOPISENJA6007BANTUL6304ABCD`, qr_url: null,
      expires_at: new Date(Date.now() + 15 * MIN).toISOString(), paid_at: null, created_at: new Date().toISOString(), created_by: userId, payment_id: null,
    }
    store.payment_intents.push(intent)
    return { data: { intent }, error: null }
  }
  if (body.action === 'status' || body.action === 'reconcile') {
    const targets = store.payment_intents.filter((row) => row.status === 'pending' && (body.action === 'reconcile' || row.order_id === body.order_id))
    return { data: { checked: targets.length, changed: 0 }, error: null }
  }
  if (body.action === 'refund') {
    const orderId = body.order_id || store.refunds.find((row) => row.id === body.refund_id)?.order_id
    const intent = store.payment_intents.find((row) => row.order_id === orderId && row.status === 'paid' && row.payment_id)
    if (!intent) return fail('Pesanan ini tidak dibayar lewat QRIS online')
    const order = store.orders.find((row) => row.id === orderId)
    let refund = body.refund_id ? store.refunds.find((row) => row.id === body.refund_id) : null
    const amount = refund ? Number(refund.amount) : Number(body.amount)
    if (!refund) {
      refund = { id: uid('ref'), cafe_id: order.cafe_id, order_id: orderId, amount, method: 'qris', reason: body.reason, restock: false, items: [], status: 'requested', requested_by: userId, requested_at: new Date().toISOString() }
      store.refunds.push(refund)
    }
    Object.assign(refund, { status: 'approved', method: 'qris', decided_by: userId, decided_at: new Date().toISOString(), decision_note: 'Dikembalikan lewat gateway QRIS' })
    order.refunded_amount = Number(order.refunded_amount || 0) + amount
    store.payment_refunds.push({ id: uid('pr'), cafe_id: order.cafe_id, refund_id: refund.id, intent_id: intent.id, amount, status: 'succeeded', created_at: new Date().toISOString() })
    return { data: { status: 'succeeded', refund_id: refund.id }, error: null }
  }
  return fail('Aksi tidak dikenal')
}

/** Simulasi webhook lunas untuk tagihan menunggu terbaru. */
export function payLatestIntent(store) {
  const intent = [...store.payment_intents].reverse().find((row) => row.status === 'pending')
  if (!intent) return null
  const order = store.orders.find((row) => row.id === intent.order_id)
  Object.assign(intent, { status: 'paid', paid_amount: intent.amount, paid_at: new Date().toISOString(), payment_id: uid('pay') })
  Object.assign(order, { payment_status: 'paid', paid_amount: Number(order.paid_amount || 0) + Number(intent.amount), paid_at: new Date().toISOString(), payment_method: 'qris' })
  store.payments.push({ id: intent.payment_id, order_id: order.id, method: 'qris', payment_method: 'qris', status: 'paid', payment_status: 'paid', amount: intent.amount, paid_at: new Date().toISOString(), verification: 'gateway', created_at: new Date().toISOString() })
  return intent
}
