/*
 * KHUSUS DEV: data & RPC kasir tiruan untuk /preview/staff dan /preview/owner.
 * Meniru supabase/usulan/06-pesanan-v2-pos.sql secara ringkas.
 */
import { computeCharges } from '../lib/pricing.js'

let seq = 5000
const uid = (prefix) => `${prefix}-${(seq += 1)}`
const fail = (message) => ({ data: null, error: { message } })
const DAY = 86400000

export function createPosFixtures({ cafeId, orders, now = new Date() }) {
  for (const order of orders) {
    Object.assign(order, {
      source: 'app', order_type: null, table_label: null, guest_name: null, subtotal_amount: null, discount_amount: 0, discount_reason: null,
      service_charge_amount: 0, tax_amount: 0, tax_inclusive: false, rounding_amount: 0,
      paid_amount: order.payment_status === 'paid' ? order.total_amount : 0, refunded_amount: 0, pricing_version: 1, cashier_session_id: null, idempotency_key: null,
    })
  }
  const at = (days, hour) => {
    const date = new Date(now.getTime() - days * DAY)
    date.setUTCHours(hour - 7, 0, 0, 0)
    return date.toISOString()
  }
  const cashier_sessions = [
    { id: 'sess-1', cafe_id: cafeId, opened_by: 'staff-1', opened_at: at(1, 7), opening_cash: 300000, opening_note: null, status: 'closed', closed_at: at(1, 15), closed_by: 'staff-1',
      counted_cash: 1248000, expected_cash: 1250000, difference: -2000, closing_note: 'Kurang kembalian 2rb', handover_to: 'staff-2', handover_note: 'Meja 4 belum bayar, cup tinggal 1 slop', active_orders_at_close: 1 },
    { id: 'sess-2', cafe_id: cafeId, opened_by: 'staff-2', opened_at: at(1, 15), opening_cash: 1248000, opening_note: 'dari serah terima', status: 'closed', closed_at: at(1, 22), closed_by: 'staff-2',
      counted_cash: 1890000, expected_cash: 1890000, difference: 0, closing_note: null, handover_to: null, handover_note: null, active_orders_at_close: 0 },
    { id: 'sess-3', cafe_id: cafeId, opened_by: 'staff-2', opened_at: at(0, 7), opening_cash: 300000, opening_note: null, status: 'open', closed_at: null, closed_by: null,
      counted_cash: null, expected_cash: null, difference: null, closing_note: null, handover_to: null, handover_note: null, active_orders_at_close: null },
  ]
  const cash_movements = [
    { id: 'cm-1', cafe_id: cafeId, session_id: 'sess-1', direction: 'out', amount: 25000, reason: 'Beli es batu', created_by: 'staff-1', created_at: at(1, 10) },
  ]
  const paidOrder = [...orders].reverse().find((order) => order.payment_status === 'paid' && order.order_status === 'completed')
  const refunds = paidOrder ? [{
    id: 'ref-1', cafe_id: cafeId, order_id: paidOrder.id, amount: Math.min(18000, paidOrder.total_amount), method: 'cash', reason: 'Minuman tumpah',
    restock: false, items: [], status: 'requested', requested_by: 'staff-1', requested_at: at(0, 9), decided_by: null, decided_at: null, decision_note: null, cashier_session_id: null,
  }] : []
  const pos_held_orders = [{
    id: 'held-1', cafe_id: cafeId, label: 'Meja 3', created_by: 'staff-1', created_at: at(0, 9), updated_at: new Date(now.getTime() - 25 * 60000).toISOString(),
    cart: { key: 'pos-held-demo-1', lines: [{ id: 'l1', productId: 'p1', name: 'Es Kopi Susu Gula Aren', basePrice: 24000, options: [], quantity: 2, notes: '' }], orderType: 'dine_in', tableId: 'table-2', guestName: '', notes: '', discount: null },
  }]
  return { cashier_sessions, cash_movements, refunds, pos_held_orders, order_item_options: [], stock_reservations: [] }
}

function openSessionOf(store, userId) {
  return store.cashier_sessions.find((session) => session.opened_by === userId && session.status === 'open') || null
}

function summary(store, sessionId) {
  const session = store.cashier_sessions.find((row) => row.id === sessionId)
  const pays = store.payments.filter((payment) => payment.cashier_session_id === sessionId)
  const sum = (list) => list.reduce((total, row) => total + Number(row.amount), 0)
  const cashSales = sum(pays.filter((payment) => payment.method === 'cash' && payment.status === 'paid'))
  const cashRefunds = sum(pays.filter((payment) => payment.method === 'cash' && payment.status === 'refunded'))
  const moves = store.cash_movements.filter((move) => move.session_id === sessionId)
  const cashIn = sum(moves.filter((move) => move.direction === 'in'))
  const cashOut = sum(moves.filter((move) => move.direction === 'out'))
  const byMethod = {}
  for (const payment of pays.filter((row) => row.status === 'paid')) byMethod[payment.method] = (byMethod[payment.method] || 0) + Number(payment.amount)
  const sessionOrders = store.orders.filter((order) => order.cashier_session_id === sessionId && order.order_status !== 'cancelled')
  const fakeSales = session.status === 'closed' && !pays.length ? Number(session.expected_cash) - Number(session.opening_cash) + cashOut : 0
  return {
    session_id: sessionId, status: session.status, opening_cash: session.opening_cash, cash_sales: cashSales + fakeSales, cash_refunds: cashRefunds,
    cash_in: cashIn, cash_out: cashOut, expected_cash: Number(session.opening_cash) + cashSales + fakeSales + cashIn - cashOut - cashRefunds,
    by_method: fakeSales ? { cash: fakeSales, qris: 420000 } : byMethod, orders: sessionOrders.length || (fakeSales ? 31 : 0),
    discounts: sessionOrders.reduce((total, order) => total + Number(order.discount_amount || 0), 0),
    active_orders: store.orders.filter((order) => ['pending', 'confirmed', 'preparing', 'ready'].includes(order.order_status)).length,
    counted_cash: session.counted_cash, difference: session.difference,
  }
}

/** { data, error } bila RPC kasir, undefined bila bukan. userId = pengguna pratinjau. */
export function posRpc(store, name, args, userId) {
  const settings = store.cafe_settings[0]
  switch (name) {
    case 'product_availability': {
      const tracking = settings.inventory_tracking
      return {
        data: store.products.map((product) => {
          const lines = tracking ? store.recipe_items.filter((row) => row.product_id === product.id && !row.option_id) : []
          const portions = lines.length ? Math.min(...lines.map((row) => {
            const item = store.ingredients.find((ingredient) => ingredient.id === row.ingredient_id)
            return Math.floor(Math.max(Number(item.on_hand) - Number(item.reserved || 0), 0) / row.quantity)
          })) : null
          const available = product.is_available && (portions === null || portions >= 1)
          return { product_id: product.id, available, reason: !product.is_available ? 'manual' : available ? null : 'stock', portions }
        }),
        error: null,
      }
    }
    case 'place_order': {
      const existing = args.p_idempotency_key && store.orders.find((order) => order.idempotency_key === args.p_idempotency_key)
      if (existing) return { data: existing.id, error: null }
      const id = uid('order')
      const items = []
      let subtotal = 0
      for (const line of args.p_items) {
        const product = store.products.find((row) => row.id === line.product_id)
        if (!product?.is_available) return fail(`${product?.name || 'Menu'} sedang habis`)
        const options = store.product_options.filter((option) => (line.option_ids || []).includes(option.id))
        const unit = Number(product.price) + options.reduce((sum, option) => sum + Number(option.price_delta), 0)
        subtotal += unit * line.quantity
        items.push({
          id: uid('item'), order_id: id, cafe_id: product.cafe_id, product_id: product.id, quantity: line.quantity, notes: line.notes || null,
          product_name: options.length ? `${product.name} (${options.map((option) => option.name).join(', ')})` : product.name,
          price: unit, subtotal: unit * line.quantity, created_at: new Date().toISOString(),
        })
      }
      let discount = 0
      if (args.p_discount) {
        discount = args.p_discount.type === 'percent' ? Math.round((subtotal * args.p_discount.value) / 100) : Math.round(args.p_discount.value)
        discount = Math.min(discount, subtotal)
        if (userId !== 'owner-1' && (discount / subtotal) * 100 > Number(settings.staff_max_discount_pct) + 0.001) return fail(`Diskon melebihi batas staff (${settings.staff_max_discount_pct} persen). Minta owner.`)
      }
      const charges = computeCharges(subtotal - discount, settings)
      const today = new Date().toISOString().slice(0, 10)
      const queue = Math.max(0, ...store.orders.filter((order) => order.created_at.slice(0, 10) === today).map((order) => order.queue_number || 0)) + 1
      const table = store.cafe_tables.find((row) => row.id === args.p_table_id)
      store.order_items.push(...items)
      store.orders.push({
        id, cafe_id: args.p_cafe_id, order_number: id, customer_id: null, total_amount: charges.total, order_status: 'preparing', payment_status: 'unpaid', payment_method: null,
        notes: args.p_notes, created_at: new Date().toISOString(), queue_number: queue, paid_at: null, cancel_reason: null, cancelled_at: null,
        source: 'pos', order_type: table ? 'dine_in' : args.p_order_type, table_label: table?.label || null, guest_name: args.p_guest_name, subtotal_amount: subtotal,
        discount_amount: discount, discount_reason: args.p_discount?.reason || null, service_charge_amount: charges.service, tax_amount: charges.tax,
        tax_inclusive: charges.taxInclusive, rounding_amount: charges.rounding, paid_amount: 0, refunded_amount: 0, pricing_version: 2,
        cashier_session_id: openSessionOf(store, userId)?.id || null, idempotency_key: args.p_idempotency_key,
      })
      return { data: id, error: null }
    }
    case 'pos_record_payments': {
      const order = store.orders.find((row) => row.id === args.p_order_id)
      if (order.payment_status === 'paid') return { data: order, error: null }
      const session = openSessionOf(store, userId)
      const total = args.p_payments.reduce((sum, payment) => sum + Number(payment.amount), 0)
      if (args.p_payments.some((payment) => payment.method === 'cash') && !session) return fail('Buka sesi kasir dulu untuk menerima tunai')
      if (order.paid_amount + total > order.total_amount + 0.005) return fail('Total pembayaran melebihi sisa tagihan')
      for (const payment of args.p_payments) {
        store.payments.push({
          id: uid('pay'), order_id: order.id, method: payment.method, payment_method: payment.method, status: 'paid', payment_status: 'paid', amount: payment.amount,
          paid_at: new Date().toISOString(), created_at: new Date().toISOString(), reference: payment.reference, recorded_by: userId, cashier_session_id: session?.id || null,
          tendered_amount: payment.tendered, change_amount: payment.tendered ? payment.tendered - payment.amount : 0, refund_id: null,
        })
      }
      const methods = new Set(store.payments.filter((payment) => payment.order_id === order.id && payment.status === 'paid').map((payment) => payment.method))
      order.paid_amount += total
      if (order.paid_amount >= order.total_amount - 0.005) Object.assign(order, { payment_status: 'paid', paid_at: new Date().toISOString() })
      order.payment_method = methods.size > 1 ? 'split' : [...methods][0]
      return { data: { ...order }, error: null }
    }
    case 'cashier_open': {
      if (openSessionOf(store, userId)) return fail('Anda masih punya sesi kasir yang terbuka.')
      const id = uid('sess')
      store.cashier_sessions.unshift({ id, cafe_id: args.p_cafe_id, opened_by: userId, opened_at: new Date().toISOString(), opening_cash: args.p_opening_cash, opening_note: args.p_note, status: 'open',
        closed_at: null, closed_by: null, counted_cash: null, expected_cash: null, difference: null, closing_note: null, handover_to: null, handover_note: null, active_orders_at_close: null })
      return { data: id, error: null }
    }
    case 'cashier_cash_move':
      store.cash_movements.unshift({ id: uid('cm'), cafe_id: 'cafe-1', session_id: args.p_session_id, direction: args.p_direction, amount: args.p_amount, reason: args.p_reason, created_by: userId, created_at: new Date().toISOString() })
      return { data: 'ok', error: null }
    case 'cashier_summary':
      return { data: summary(store, args.p_session_id), error: null }
    case 'cashier_close': {
      const session = store.cashier_sessions.find((row) => row.id === args.p_session_id)
      const result = summary(store, session.id)
      const difference = args.p_counted_cash - result.expected_cash
      if (Math.abs(difference) >= 1 && !(args.p_note || '').trim()) return fail('Ada selisih kas. Tulis penjelasannya sebelum menutup.')
      Object.assign(session, { status: 'closed', closed_at: new Date().toISOString(), closed_by: userId, counted_cash: args.p_counted_cash, expected_cash: result.expected_cash,
        difference, closing_note: args.p_note, handover_to: args.p_handover_to, handover_note: args.p_handover_note, active_orders_at_close: result.active_orders })
      return { data: summary(store, session.id), error: null }
    }
    case 'refund_request': {
      const order = store.orders.find((row) => row.id === args.p_order_id)
      const refund = { id: uid('ref'), cafe_id: order.cafe_id, order_id: order.id, amount: args.p_amount, method: args.p_method, reason: args.p_reason, restock: args.p_restock,
        items: args.p_items || [], status: 'requested', requested_by: userId, requested_at: new Date().toISOString(), decided_by: null, decided_at: null, decision_note: null, cashier_session_id: null }
      store.refunds.unshift(refund)
      if (userId === 'owner-1') return posRpc(store, 'refund_decide', { p_refund_id: refund.id, p_approve: true }, userId)
      return { data: refund, error: null }
    }
    case 'refund_decide': {
      const refund = store.refunds.find((row) => row.id === args.p_refund_id)
      if (!args.p_approve) {
        Object.assign(refund, { status: 'rejected', decided_by: userId, decided_at: new Date().toISOString(), decision_note: args.p_note })
        return { data: refund, error: null }
      }
      const order = store.orders.find((row) => row.id === refund.order_id)
      Object.assign(refund, { status: 'approved', decided_by: userId, decided_at: new Date().toISOString(), decision_note: args.p_note || null })
      order.refunded_amount = Number(order.refunded_amount || 0) + Number(refund.amount)
      if (order.refunded_amount >= order.paid_amount - 0.005) order.payment_status = 'refunded'
      store.payments.push({ id: uid('pay'), order_id: order.id, method: refund.method, payment_method: refund.method, status: 'refunded', payment_status: 'refunded', amount: refund.amount,
        paid_at: new Date().toISOString(), created_at: new Date().toISOString(), refund_id: refund.id, reference: 'refund', cashier_session_id: openSessionOf(store, userId)?.id || null })
      return { data: refund, error: null }
    }
    default:
      return undefined
  }
}
