/*
 * KHUSUS DEV: data & RPC inventori tiruan untuk /preview/owner.
 * Logika meniru supabase/usulan/05-inventori-supplier.sql secara ringkas (harga rata-rata
 * tertimbang, batch FEFO, PO, pembayaran, HPP, perkiraan) agar QA visual realistis.
 */

const DAY = 86400000
const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits
const isoDaysAgo = (now, days, hour = 9) => {
  const date = new Date(now.getTime() - days * DAY)
  date.setUTCHours(hour - 7, 15, 0, 0)
  return date.toISOString()
}
const dateKey = (now, offsetDays) => new Date(now.getTime() + offsetDays * DAY + 7 * 3600000).toISOString().slice(0, 10)
let seq = 1000
const uid = (prefix) => `${prefix}-${(seq += 1)}`

export function createInventoryFixtures({ cafeId, orders, items, now = new Date() }) {
  const suppliers = [
    { id: 'sup-roast', cafe_id: cafeId, name: 'Roastery Gunung Kawi', contact_name: 'Pak Bayu', phone: '0812 7788 1200', email: 'order@gunungkawi.id', address: 'Jl. Raya Kawi 12, Malang', payment_terms_days: 7, notes: 'Roasting tiap Selasa, kirim Rabu', is_active: true, created_at: '2026-10-01T00:00:00Z' },
    { id: 'sup-milk', cafe_id: cafeId, name: 'Susu Segar Jaya', contact_name: 'Bu Ratna', phone: '0813 2244 5566', email: null, address: 'Sleman', payment_terms_days: 14, notes: 'Minimal order 2 karton', is_active: true, created_at: '2026-10-01T00:00:00Z' },
    { id: 'sup-pack', cafe_id: cafeId, name: 'Kemasan Jaya Abadi', contact_name: 'Koh Hendra', phone: '0274 556677', email: 'sales@kemasanjaya.id', address: 'Jl. Magelang Km 4', payment_terms_days: 7, notes: null, is_active: true, created_at: '2026-10-02T00:00:00Z' },
    { id: 'sup-bake', cafe_id: cafeId, name: 'Bahan Kue Sentosa', contact_name: null, phone: '0811 2600 400', email: null, address: null, payment_terms_days: 0, notes: null, is_active: true, created_at: '2026-10-02T00:00:00Z' },
    { id: 'sup-old', cafe_id: cafeId, name: 'Toko Grosir Lama', contact_name: null, phone: null, email: null, address: null, payment_terms_days: 0, notes: 'Tidak dipakai lagi', is_active: false, created_at: '2026-09-20T00:00:00Z' },
  ]
  const ing = (id, name, category, unit, min, cost, supplier, packLabel, packSize, lead = 2, extra = {}) => ({
    id, cafe_id: cafeId, name, sku: null, category, unit, min_stock: min, on_hand: 0, avg_cost: 0, last_purchase_cost: null,
    default_supplier_id: supplier, purchase_unit: packLabel, purchase_unit_size: packSize, lead_time_days: lead, is_active: true,
    updated_at: now.toISOString(), _cost: cost, ...extra,
  })
  const ingredients = [
    ing('ing-kopi', 'Biji kopi house blend', 'Kopi', 'g', 1000, 280, 'sup-roast', 'pak', 1000, 3, { sku: 'KP-HB-1K' }),
    ing('ing-susu', 'Susu segar full cream', 'Susu', 'ml', 6000, 18.5, 'sup-milk', 'karton', 12000, 2),
    ing('ing-aren', 'Gula aren cair', 'Pemanis', 'ml', 1500, 45, 'sup-bake', 'botol', 1000, 1),
    ing('ing-vanila', 'Sirup vanila', 'Pemanis', 'ml', 300, 160, 'sup-bake', 'botol', 750, 2),
    ing('ing-matcha', 'Bubuk matcha', 'Bubuk', 'g', 200, 900, 'sup-bake', 'pak', 500, 4),
    ing('ing-coklat', 'Cokelat bubuk', 'Bubuk', 'g', 300, 120, 'sup-bake', 'pak', 1000, 2),
    ing('ing-croissant', 'Croissant beku', 'Pastry', 'pcs', 10, 9000, 'sup-bake', 'box', 20, 2),
    ing('ing-cup', 'Cup 16oz + tutup', 'Kemasan', 'pcs', 200, 1100, 'sup-pack', 'slop', 50, 3, { sku: 'CUP-16' }),
    ing('ing-es', 'Es batu kristal', 'Lainnya', 'g', 5000, 1.2, null, 'karung', 10000, 0),
    ing('ing-oat', 'Oat milk', 'Susu', 'ml', 1000, 0, 'sup-milk', 'karton', 12000, 2),
    ing('ing-kayu', 'Pengaduk kayu', 'Kemasan', 'pcs', 100, 150, 'sup-pack', 'pak', 1000, 3, { is_active: false }),
  ]
  const byId = new Map(ingredients.map((item) => [item.id, item]))
  const recipeSpec = {
    p1: [['ing-kopi', 18], ['ing-susu', 150], ['ing-aren', 25], ['ing-es', 150], ['ing-cup', 1]],
    p2: [['ing-kopi', 18], ['ing-susu', 180], ['ing-vanila', 20], ['ing-cup', 1]],
    p3: [['ing-kopi', 18], ['ing-susu', 170], ['ing-cup', 1]],
    p4: [['ing-kopi', 15], ['ing-cup', 1]],
    p5: [['ing-matcha', 6], ['ing-susu', 180], ['ing-es', 120], ['ing-cup', 1]],
    p6: [['ing-coklat', 25], ['ing-susu', 200], ['ing-cup', 1]],
    p7: [['ing-croissant', 1]],
  }
  const recipe_items = Object.entries(recipeSpec).flatMap(([productId, lines]) => lines.map(([ingredientId, quantity]) => ({
    id: uid('rcp'), cafe_id: cafeId, product_id: productId, option_id: null, ingredient_id: ingredientId, quantity, created_at: '2026-10-20T00:00:00Z',
  })))
  // Varian Large Vanilla Latte: tambahan susu & sirup
  recipe_items.push(
    { id: uid('rcp'), cafe_id: cafeId, product_id: 'p2', option_id: 'opt-large', ingredient_id: 'ing-susu', quantity: 60, created_at: '2026-10-20T00:00:00Z' },
    { id: uid('rcp'), cafe_id: cafeId, product_id: 'p2', option_id: 'opt-large', ingredient_id: 'ing-vanila', quantity: 5, created_at: '2026-10-20T00:00:00Z' },
  )

  const stock_movements = []
  const ingredient_batches = []
  const store = { ingredients, ingredient_batches, stock_movements }
  const at = (days, hour) => isoDaysAgo(now, days, hour)

  // Stok awal 21 hari lalu (oat milk tanpa harga — contoh bahan yang HPP-nya belum akurat)
  const opening = { 'ing-kopi': 4000, 'ing-susu': 30000, 'ing-aren': 3000, 'ing-vanila': 1500, 'ing-matcha': 500, 'ing-coklat': 800, 'ing-croissant': 30, 'ing-cup': 600, 'ing-es': 60000, 'ing-oat': 1000, 'ing-kayu': 200 }
  for (const item of ingredients) {
    applyMovement(store, item.id, 'opening', opening[item.id], item._cost, null, 'Stok awal', {}, false, at(21, 8))
  }
  // Pembelian lewat PO (diterima)
  applyMovement(store, 'ing-cup', 'purchase', 200, 1100, null, 'PO-2026-0005', { supplier_id: 'sup-pack', purchase_order_id: 'po-5' }, false, at(18, 10))
  applyMovement(store, 'ing-kopi', 'purchase', 2000, 285, null, 'PO-2026-0006', { supplier_id: 'sup-roast', purchase_order_id: 'po-6' }, false, at(17, 10))
  applyMovement(store, 'ing-susu', 'purchase', 24000, 18.5, dateKey(now, 2), 'PO-2026-0007', { supplier_id: 'sup-milk', purchase_order_id: 'po-7' }, false, at(5, 10))
  applyMovement(store, 'ing-croissant', 'purchase', 40, 9250, null, 'PO-2026-0010', { supplier_id: 'sup-bake', purchase_order_id: 'po-10' }, false, at(3, 11))
  applyMovement(store, 'ing-vanila', 'purchase', 750, 165, dateKey(now, -1), 'beli toko', {}, false, at(12, 13))
  applyMovement(store, 'ing-susu', 'purchase', 12000, 19, dateKey(now, 9), 'beli langsung', { supplier_id: 'sup-milk' }, false, at(1, 9))

  // Pemakaian dari pesanan selesai sejak pelacakan aktif (14 hari lalu)
  const trackingStart = now.getTime() - 14 * DAY
  const itemsByOrder = new Map()
  for (const line of items) itemsByOrder.set(line.order_id, [...(itemsByOrder.get(line.order_id) || []), line])
  const completed = orders.filter((order) => order.order_status === 'completed' && Date.parse(order.created_at) >= trackingStart)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  for (const order of completed) {
    for (const line of itemsByOrder.get(order.id) || []) {
      for (const [ingredientId, quantity] of recipeSpec[line.product_id] || []) {
        applyMovement(store, ingredientId, 'sale', -quantity * line.quantity, null, null, null,
          { order_id: order.id, order_item_id: line.id, product_id: line.product_id }, true, new Date(Date.parse(order.created_at) + 15 * 60000).toISOString())
      }
    }
  }
  applyMovement(store, 'ing-susu', 'waste', -500, null, null, 'Tumpah saat steaming', {}, true, at(6, 15))
  applyMovement(store, 'ing-croissant', 'expired', -2, null, null, 'Lewat 3 hari', {}, true, at(4, 20))
  applyMovement(store, 'ing-es', 'usage', -3000, null, null, 'Es untuk display', {}, true, at(2, 8))

  // Opname 2 hari lalu: samakan dengan hitungan fisik (contoh selisih)
  const countId = 'count-1'
  const targets = { 'ing-aren': 1180, 'ing-matcha': 190, 'ing-coklat': 0, 'ing-cup': Math.round(byId.get('ing-cup').on_hand) - 6 }
  const stock_count_lines = []
  let differenceValue = 0
  for (const [ingredientId, counted] of Object.entries(targets)) {
    const item = byId.get(ingredientId)
    const system = item.on_hand
    stock_count_lines.push({ id: uid('scl'), cafe_id: cafeId, stock_count_id: countId, ingredient_id: ingredientId, system_qty: system, counted_qty: counted, difference: round(counted - system), unit_cost: item.avg_cost })
    if (Math.abs(counted - system) > 0.0005) {
      differenceValue += (counted - system) * item.avg_cost
      applyMovement(store, ingredientId, 'opname', round(counted - system), null, null, 'Opname mingguan', { stock_count_id: countId }, true, at(2, 21))
    }
  }
  const stock_counts = [{ id: countId, cafe_id: cafeId, note: 'Opname mingguan', line_count: stock_count_lines.length, difference_value: Math.round(differenceValue), created_at: at(2, 21) }]

  // Batch kedaluwarsa yang terlihat
  const vanilaBatch = ingredient_batches.find((batch) => batch.ingredient_id === 'ing-vanila')
  if (vanilaBatch) vanilaBatch.remaining = Math.min(vanilaBatch.remaining, 150)

  const purchase_orders = [
    po('po-5', 'sup-pack', 'PO-2026-0005', 'received', 20, { total: 220000, received: 220000, paid: 0, received_at: at(18, 10), due: dateKey(now, -11) }),
    po('po-6', 'sup-roast', 'PO-2026-0006', 'received', 19, { total: 570000, received: 570000, paid: 570000, received_at: at(17, 10), due: dateKey(now, -10) }),
    po('po-7', 'sup-milk', 'PO-2026-0007', 'received', 6, { total: 444000, received: 444000, paid: 0, received_at: at(5, 10), due: dateKey(now, 9) }),
    po('po-8', 'sup-roast', 'PO-2026-0008', 'ordered', 1, { total: 570000, received: 0, paid: 200000, expected: dateKey(now, 1) }),
    po('po-9', 'sup-milk', 'PO-2026-0009', 'draft', 0, { total: 444000, received: 0, paid: 0, notes: 'Dibuat dari saran belanja' }),
    po('po-10', 'sup-bake', 'PO-2026-0010', 'partial', 4, { total: 555000, received: 370000, paid: 370000, received_at: at(3, 11), due: dateKey(now, -3), expected: dateKey(now, -2) }),
  ]
  function po(id, supplierId, number, status, daysAgo, { total, received, paid, received_at = null, due = null, expected = null, notes = null }) {
    return {
      id, cafe_id: cafeId, supplier_id: supplierId, po_number: number, status, order_date: dateKey(now, -daysAgo), expected_date: expected, due_date: due,
      notes, total_amount: total, received_amount: received, paid_amount: paid, closed_short: false, cancel_reason: null,
      created_at: at(daysAgo, 9), updated_at: at(daysAgo, 9), ordered_at: status === 'draft' ? null : at(daysAgo, 9), received_at, cancelled_at: null,
    }
  }
  const poi = (poId, ingredientId, quantity, label, size, price, received) => ({
    id: uid('poi'), cafe_id: cafeId, purchase_order_id: poId, ingredient_id: ingredientId, quantity, unit_label: label, unit_size: size, unit_price: price,
    received_quantity: received, line_total: quantity * price, sort_order: 0,
  })
  const purchase_order_items = [
    poi('po-5', 'ing-cup', 4, 'slop', 50, 55000, 4),
    poi('po-6', 'ing-kopi', 2, 'pak', 1000, 285000, 2),
    poi('po-7', 'ing-susu', 2, 'karton', 12000, 222000, 2),
    poi('po-8', 'ing-kopi', 2, 'pak', 1000, 285000, 0),
    poi('po-9', 'ing-susu', 2, 'karton', 12000, 222000, 0),
    poi('po-10', 'ing-croissant', 3, 'box', 20, 185000, 2),
  ]
  const supplier_payments = [
    { id: 'pay-6', cafe_id: cafeId, purchase_order_id: 'po-6', supplier_id: 'sup-roast', amount: 570000, method: 'bank_transfer', paid_on: dateKey(now, -12), reference: 'BCA 8812', note: null, created_at: at(12, 14), voided_at: null, void_reason: null },
    { id: 'pay-8', cafe_id: cafeId, purchase_order_id: 'po-8', supplier_id: 'sup-roast', amount: 200000, method: 'bank_transfer', paid_on: dateKey(now, -1), reference: 'DP', note: 'Uang muka', created_at: at(1, 10), voided_at: null, void_reason: null },
    { id: 'pay-10', cafe_id: cafeId, purchase_order_id: 'po-10', supplier_id: 'sup-bake', amount: 370000, method: 'cash', paid_on: dateKey(now, -3), reference: null, note: null, created_at: at(3, 11), voided_at: null, void_reason: null },
  ]
  const supplier_items = [
    { id: uid('si'), cafe_id: cafeId, supplier_id: 'sup-roast', ingredient_id: 'ing-kopi', supplier_sku: 'HB-1K', unit_label: 'pak', unit_size: 1000, last_price: 285000, last_purchased_at: at(17, 10), created_at: at(20) },
    { id: uid('si'), cafe_id: cafeId, supplier_id: 'sup-milk', ingredient_id: 'ing-susu', supplier_sku: null, unit_label: 'karton', unit_size: 12000, last_price: 222000, last_purchased_at: at(5, 10), created_at: at(20) },
    { id: uid('si'), cafe_id: cafeId, supplier_id: 'sup-pack', ingredient_id: 'ing-cup', supplier_sku: 'CUP16-50', unit_label: 'slop', unit_size: 50, last_price: 55000, last_purchased_at: at(18, 10), created_at: at(20) },
    { id: uid('si'), cafe_id: cafeId, supplier_id: 'sup-bake', ingredient_id: 'ing-croissant', supplier_sku: null, unit_label: 'box', unit_size: 20, last_price: 185000, last_purchased_at: at(3, 11), created_at: at(20) },
  ]
  const lastSale = stock_movements.filter((move) => move.movement_type === 'sale').at(-1)
  const inventory_sync_issues = lastSale ? [{ id: 1, cafe_id: cafeId, order_id: lastSale.order_id, message: 'Bahan tidak ditemukan', created_at: at(1, 16), resolved_at: null }] : []

  for (const item of ingredients) delete item._cost
  return {
    suppliers, ingredients, ingredient_batches, supplier_items, recipe_items, stock_movements, stock_counts, stock_count_lines,
    purchase_orders, purchase_order_items, supplier_payments, inventory_sync_issues, document_counters: [{ cafe_id: cafeId, value: 10 }],
    settings: { inventory_tracking: true, inventory_started_at: new Date(trackingStart).toISOString(), expiry_alert_days: 3, reorder_cover_days: 7 },
  }
}

function applyMovement(store, ingredientId, type, quantity, unitCost, expiresAt, note, refs = {}, allowNegative = false, occurredAt = new Date().toISOString()) {
  const item = store.ingredients.find((row) => row.id === ingredientId)
  if (!item) throw new Error('Bahan tidak ditemukan')
  if (!quantity) throw new Error('Jumlah tidak boleh nol')
  const nextQty = round(Number(item.on_hand) + quantity)
  let cost = Number(item.avg_cost)
  let nextAvg = cost
  if (type === 'opening' || type === 'purchase') {
    if (unitCost === null || unitCost === undefined || unitCost < 0) throw new Error('Harga per satuan wajib diisi')
    cost = unitCost
    nextAvg = Number(item.on_hand) <= 0 ? unitCost : round((item.on_hand * item.avg_cost + quantity * unitCost) / nextQty, 4)
    item.last_purchase_cost = unitCost
  } else if (quantity > 0 && !cost && unitCost) {
    cost = unitCost
    nextAvg = unitCost
  }
  if (nextQty < 0 && !allowNegative) throw new Error(`Stok ${item.name} tidak cukup: tersedia ${item.on_hand} ${item.unit}`)
  let batchId = refs.batch_id || null
  if (quantity > 0 && expiresAt) {
    batchId = uid('batch')
    store.ingredient_batches.push({ id: batchId, cafe_id: item.cafe_id, ingredient_id: item.id, expires_at: expiresAt, quantity, remaining: quantity, received_at: occurredAt })
  }
  if (quantity < 0) {
    let left = -quantity
    const open = store.ingredient_batches.filter((batch) => batch.ingredient_id === item.id && batch.remaining > 0)
      .sort((a, b) => (b.id === refs.batch_id) - (a.id === refs.batch_id) || a.expires_at.localeCompare(b.expires_at))
    for (const batch of open) {
      if (left <= 0) break
      const take = Math.min(left, batch.remaining)
      batch.remaining = round(batch.remaining - take)
      left -= take
    }
  }
  const movement = {
    id: store.stock_movements.length + 1, cafe_id: item.cafe_id, ingredient_id: item.id, movement_type: type, quantity: round(quantity), unit_cost: cost,
    total_cost: Math.round(quantity * cost * 100) / 100, balance_after: nextQty, avg_cost_after: nextAvg, batch_id: batchId,
    supplier_id: refs.supplier_id || null, purchase_order_id: refs.purchase_order_id || null, stock_count_id: refs.stock_count_id || null,
    order_id: refs.order_id || null, order_item_id: refs.order_item_id || null, product_id: refs.product_id || null, note: note || null, created_by: 'owner-1', occurred_at: occurredAt,
  }
  store.stock_movements.push(movement)
  item.on_hand = nextQty
  item.avg_cost = nextAvg
  item.updated_at = occurredAt
  return movement.id
}

const fail = (message) => ({ data: null, error: { message } })

/** Kembalikan { data, error } bila RPC inventori, atau undefined bila bukan. */
export function inventoryRpc(store, name, args) {
  try {
    switch (name) {
      case 'inventory_set_tracking': {
        const settings = store.cafe_settings[0]
        settings.inventory_tracking = args.p_enabled
        settings.inventory_started_at = args.p_enabled ? settings.inventory_started_at || new Date().toISOString() : null
        return { data: settings.inventory_started_at, error: null }
      }
      case 'inventory_stock_in':
        return { data: applyMovement(store, args.p_ingredient_id, args.p_is_opening ? 'opening' : 'purchase', args.p_quantity, args.p_unit_cost, args.p_expires_at, args.p_note, { supplier_id: args.p_supplier_id }), error: null }
      case 'inventory_stock_out':
        return { data: applyMovement(store, args.p_ingredient_id, args.p_reason, -args.p_quantity, null, null, args.p_note, { batch_id: args.p_batch_id }), error: null }
      case 'inventory_adjust': {
        if (!args.p_note || args.p_note.trim().length < 3) return fail('Tulis alasan penyesuaian (minimal 3 huruf)')
        const item = store.ingredients.find((row) => row.id === args.p_ingredient_id)
        return { data: applyMovement(store, item.id, 'adjustment', round(args.p_new_quantity - item.on_hand), args.p_unit_cost, null, args.p_note), error: null }
      }
      case 'inventory_post_count': {
        const id = uid('count')
        let value = 0
        for (const line of args.p_lines) {
          const item = store.ingredients.find((row) => row.id === line.ingredient_id)
          const diff = round(line.counted - item.on_hand)
          store.stock_count_lines.push({ id: uid('scl'), cafe_id: item.cafe_id, stock_count_id: id, ingredient_id: item.id, system_qty: item.on_hand, counted_qty: line.counted, difference: diff, unit_cost: item.avg_cost })
          if (Math.abs(diff) > 0.0005) {
            value += diff * item.avg_cost
            applyMovement(store, item.id, 'opname', diff, null, null, args.p_note, { stock_count_id: id })
          }
        }
        store.stock_counts.unshift({ id, cafe_id: store.ingredients[0]?.cafe_id, note: args.p_note, line_count: args.p_lines.length, difference_value: Math.round(value), created_at: new Date().toISOString() })
        return { data: id, error: null }
      }
      case 'recipe_save': {
        store.recipe_items = store.recipe_items.filter((row) => row.product_id !== args.p_product_id)
        for (const line of args.p_items) store.recipe_items.push({ id: uid('rcp'), cafe_id: 'cafe-1', product_id: args.p_product_id, option_id: line.option_id || null, ingredient_id: line.ingredient_id, quantity: line.quantity, created_at: new Date().toISOString() })
        return { data: args.p_items.length, error: null }
      }
      case 'inventory_product_costing':
        return { data: costing(store), error: null }
      case 'inventory_product_profitability':
        return { data: profitability(store, args), error: null }
      case 'inventory_forecast':
        return { data: forecast(store, args), error: null }
      case 'purchase_order_save': {
        let po = args.p_po_id && store.purchase_orders.find((row) => row.id === args.p_po_id)
        if (!po) {
          const counter = store.document_counters[0]
          counter.value += 1
          po = { id: uid('po'), cafe_id: args.p_cafe_id, status: 'draft', po_number: `PO-2026-${String(counter.value).padStart(4, '0')}`, received_amount: 0, paid_amount: 0, closed_short: false, created_at: new Date().toISOString(), due_date: null, received_at: null }
          store.purchase_orders.unshift(po)
        }
        Object.assign(po, { supplier_id: args.p_supplier_id, order_date: args.p_order_date || new Date().toISOString().slice(0, 10), expected_date: args.p_expected_date, notes: args.p_notes })
        store.purchase_order_items = store.purchase_order_items.filter((row) => row.purchase_order_id !== po.id)
        args.p_items.forEach((line, index) => store.purchase_order_items.push({ id: uid('poi'), cafe_id: po.cafe_id, purchase_order_id: po.id, ...line, received_quantity: 0, line_total: line.quantity * line.unit_price, sort_order: index }))
        po.total_amount = args.p_items.reduce((sum, line) => sum + line.quantity * line.unit_price, 0)
        return { data: po.id, error: null }
      }
      case 'purchase_order_transition': {
        const po = store.purchase_orders.find((row) => row.id === args.p_po_id)
        if (args.p_action === 'order') Object.assign(po, { status: 'ordered', ordered_at: new Date().toISOString() })
        if (args.p_action === 'delete') store.purchase_orders = store.purchase_orders.filter((row) => row.id !== po.id)
        if (args.p_action === 'cancel') Object.assign(po, { status: 'cancelled', cancel_reason: args.p_reason })
        if (args.p_action === 'close') Object.assign(po, { status: 'received', closed_short: true, cancel_reason: args.p_reason })
        return { data: po.status, error: null }
      }
      case 'purchase_order_receive': {
        const po = store.purchase_orders.find((row) => row.id === args.p_po_id)
        const supplier = store.suppliers.find((row) => row.id === po.supplier_id)
        for (const line of args.p_lines) {
          const item = store.purchase_order_items.find((row) => row.id === line.item_id)
          if (line.quantity > item.quantity - item.received_quantity + 0.0005) return fail('Jumlah diterima melebihi sisa pesanan')
          applyMovement(store, item.ingredient_id, 'purchase', line.quantity * item.unit_size, item.unit_price / item.unit_size, line.expires_at, `${po.po_number} ${args.p_note || ''}`.trim(), { supplier_id: po.supplier_id, purchase_order_id: po.id })
          item.received_quantity += line.quantity
          po.received_amount += line.quantity * item.unit_price
        }
        const open = store.purchase_order_items.some((row) => row.purchase_order_id === po.id && row.received_quantity < row.quantity)
        const today = new Date(Date.now() + 7 * 3600000)
        Object.assign(po, {
          status: open ? 'partial' : 'received', received_at: new Date().toISOString(),
          due_date: po.due_date || new Date(today.getTime() + (supplier?.payment_terms_days || 0) * DAY).toISOString().slice(0, 10),
        })
        return { data: po.status, error: null }
      }
      case 'purchase_order_pay': {
        const po = store.purchase_orders.find((row) => row.id === args.p_po_id)
        const limit = (po.status === 'ordered' ? po.total_amount : po.received_amount) - po.paid_amount
        if (args.p_amount > limit + 0.005) return fail(`Nominal melebihi sisa tagihan (Rp ${limit})`)
        store.supplier_payments.push({ id: uid('pay'), cafe_id: po.cafe_id, purchase_order_id: po.id, supplier_id: po.supplier_id, amount: args.p_amount, method: args.p_method, paid_on: args.p_paid_on, reference: args.p_reference, note: args.p_note, created_at: new Date().toISOString(), voided_at: null, void_reason: null })
        po.paid_amount += args.p_amount
        return { data: 'ok', error: null }
      }
      case 'supplier_payment_void': {
        const payment = store.supplier_payments.find((row) => row.id === args.p_payment_id)
        Object.assign(payment, { voided_at: new Date().toISOString(), void_reason: args.p_reason })
        store.purchase_orders.find((row) => row.id === payment.purchase_order_id).paid_amount -= payment.amount
        return { data: null, error: null }
      }
      default:
        return undefined
    }
  } catch (error) {
    return fail(error.message)
  }
}

function costing(store) {
  return store.products.map((product) => {
    const lines = store.recipe_items.filter((row) => row.product_id === product.id && !row.option_id)
      .map((row) => ({ ...row, item: store.ingredients.find((item) => item.id === row.ingredient_id) }))
    if (!lines.length) {
      return { product_id: product.id, product_name: product.name, category_id: product.category_id, price: product.price, is_available: product.is_available, recipe_lines: 0, uncosted_lines: 0, cost_per_portion: null, gross_profit: null, margin_pct: null, portions_available: null, limiting_ingredient: null }
    }
    const cost = lines.reduce((sum, row) => sum + row.quantity * row.item.avg_cost, 0)
    const portions = lines.map((row) => ({ name: row.item.name, value: Math.floor(Math.max(row.item.on_hand, 0) / row.quantity) })).sort((a, b) => a.value - b.value)
    return {
      product_id: product.id, product_name: product.name, category_id: product.category_id, price: product.price, is_available: product.is_available,
      recipe_lines: lines.length, uncosted_lines: lines.filter((row) => !row.item.avg_cost).length,
      cost_per_portion: Math.round(cost * 100) / 100, gross_profit: Math.round((product.price - cost) * 100) / 100,
      margin_pct: product.price > 0 ? Math.round(((product.price - cost) / product.price) * 1000) / 10 : null,
      portions_available: portions[0].value, limiting_ingredient: portions[0].name,
    }
  }).sort((a, b) => a.product_name.localeCompare(b.product_name))
}

function profitability(store, args) {
  const unitCost = new Map(costing(store).filter((row) => row.recipe_lines).map((row) => [row.product_id, row.cost_per_portion]))
  const orders = new Set(store.orders.filter((order) => order.order_status === 'completed' && order.created_at >= args.p_from && order.created_at < args.p_to).map((order) => order.id))
  const actualByItem = new Map()
  for (const move of store.stock_movements) if (move.movement_type === 'sale') actualByItem.set(move.order_item_id, (actualByItem.get(move.order_item_id) || 0) - move.total_cost)
  const rows = new Map()
  for (const line of store.order_items) {
    if (!orders.has(line.order_id)) continue
    const row = rows.get(line.product_id) || { product_id: line.product_id, product_name: line.product_name, quantity_sold: 0, revenue: 0, actual_cost: 0, estimated_cost: 0, uncosted_quantity: 0 }
    row.quantity_sold += line.quantity
    row.revenue += line.subtotal
    if (actualByItem.has(line.id)) row.actual_cost += actualByItem.get(line.id)
    else if (unitCost.has(line.product_id)) row.estimated_cost += line.quantity * unitCost.get(line.product_id)
    else row.uncosted_quantity += line.quantity
    rows.set(line.product_id, row)
  }
  return [...rows.values()].map((row) => {
    const gross = row.revenue - row.actual_cost - row.estimated_cost
    return { ...row, actual_cost: Math.round(row.actual_cost), estimated_cost: Math.round(row.estimated_cost), gross_profit: Math.round(gross), margin_pct: row.revenue ? Math.round((gross / row.revenue) * 1000) / 10 : null }
  }).sort((a, b) => b.revenue - a.revenue)
}

function forecast(store, args) {
  const days = Math.min(Math.max(args.p_lookback_days || 28, 7), 90)
  const startToday = new Date(Date.now() + 7 * 3600000)
  startToday.setUTCHours(0, 0, 0, 0)
  const from = startToday.getTime() - 7 * 3600000 - (days - 1) * DAY
  const settings = store.cafe_settings[0]
  const completed = store.orders.filter((order) => order.order_status === 'completed' && Date.parse(order.created_at) >= from)
  const active = new Set(completed.map((order) => order.created_at.slice(0, 10))).size
  const basis = active < 7 ? 'data_kurang' : settings.inventory_tracking && Date.parse(settings.inventory_started_at) <= from ? 'aktual' : 'estimasi'
  const usage = new Map()
  if (basis === 'aktual') {
    for (const move of store.stock_movements) if (['sale', 'usage'].includes(move.movement_type) && Date.parse(move.occurred_at) >= from) usage.set(move.ingredient_id, (usage.get(move.ingredient_id) || 0) - move.quantity)
  } else if (basis === 'estimasi') {
    const ids = new Set(completed.map((order) => order.id))
    for (const line of store.order_items) {
      if (!ids.has(line.order_id)) continue
      for (const row of store.recipe_items.filter((recipe) => recipe.product_id === line.product_id && !recipe.option_id)) usage.set(row.ingredient_id, (usage.get(row.ingredient_id) || 0) + row.quantity * line.quantity)
    }
  }
  const today = new Date(Date.now() + 7 * 3600000)
  return store.ingredients.filter((item) => item.is_active).map((item) => {
    const daily = basis === 'data_kurang' ? null : (usage.get(item.id) || 0) / days
    const stock = Math.max(item.on_hand, 0)
    const need = daily === null ? Math.max(item.min_stock - stock, 0) : Math.max(daily * (item.lead_time_days + settings.reorder_cover_days) + item.min_stock - stock, 0)
    const daysLeft = daily > 0 ? Math.round((stock / daily) * 10) / 10 : null
    return {
      ingredient_id: item.id, name: item.name, unit: item.unit, on_hand: item.on_hand, min_stock: item.min_stock, basis, active_days: active,
      avg_daily_usage: daily === null ? null : round(daily), days_left: daysLeft,
      depletion_date: daysLeft === null ? null : new Date(today.getTime() + Math.floor(daysLeft) * DAY).toISOString().slice(0, 10),
      lead_time_days: item.lead_time_days, suggested_quantity: Math.ceil(need), purchase_unit: item.purchase_unit, purchase_unit_size: item.purchase_unit_size,
      suggested_purchase_units: item.purchase_unit_size ? Math.ceil(need / item.purchase_unit_size) : null,
    }
  }).sort((a, b) => (a.days_left ?? Infinity) - (b.days_left ?? Infinity) || a.name.localeCompare(b.name))
}
