/*
 * Kasir (POS): keranjang, perkiraan total, dan pemanggil RPC file 06.
 * Total di layar hanya perkiraan — angka final selalu dihitung ulang place_order di database.
 */
import { friendlyError } from './db.js'
import { computeCharges } from './pricing.js'

export async function rpc(supabase, name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(friendlyError(error))
  return data
}

/** Kunci anti-dobel per keranjang: klik ganda / jaringan putus tidak membuat pesanan dobel. */
export function newIdempotencyKey() {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `pos-${random}`
}

export function emptyCart(settings) {
  return {
    key: newIdempotencyKey(),
    lines: [],
    orderType: settings?.order_types?.[0] || 'takeaway',
    tableId: '',
    guestName: '',
    notes: '',
    discount: null, // { type: 'percent' | 'amount', value, reason }
    heldId: null,
  }
}

let lineSeed = 0
export function newLine(product, options, quantity = 1, notes = '') {
  lineSeed += 1
  return {
    id: `line-${Date.now()}-${lineSeed}`,
    productId: product.id,
    name: product.name,
    basePrice: Number(product.price) || 0,
    options: options.map((option) => ({ id: option.id, name: option.name, price: Number(option.price_delta) || 0 })),
    quantity,
    notes,
  }
}

export const lineUnitPrice = (line) => line.basePrice + line.options.reduce((sum, option) => sum + option.price, 0)
export const lineTotal = (line) => lineUnitPrice(line) * line.quantity
export const lineLabel = (line) => (line.options.length ? `${line.name} (${line.options.map((option) => option.name).join(', ')})` : line.name)

/** Sama dengan place_order: diskon dari subtotal, lalu service → pajak → pembulatan. */
export function cartTotals(cart, settings) {
  const subtotal = cart.lines.reduce((sum, line) => sum + lineTotal(line), 0)
  let discount = 0
  const value = Number(cart.discount?.value) || 0
  if (value > 0) discount = cart.discount.type === 'percent' ? Math.round((subtotal * value) / 100) : Math.round(value)
  discount = Math.min(discount, subtotal)
  const charges = computeCharges(subtotal - discount, settings)
  return { ...charges, subtotal, discount, itemCount: cart.lines.reduce((sum, line) => sum + line.quantity, 0) }
}

export function placeOrderPayload(cafeId, cart) {
  return {
    p_cafe_id: cafeId,
    p_items: cart.lines.map((line) => ({
      product_id: line.productId, quantity: line.quantity, option_ids: line.options.map((option) => option.id), notes: line.notes || null,
    })),
    p_source: 'pos',
    p_order_type: cart.orderType || null,
    p_table_id: cart.orderType === 'dine_in' && cart.tableId ? cart.tableId : null,
    p_guest_name: cart.guestName.trim() || null,
    p_notes: cart.notes.trim() || null,
    p_discount: cart.discount && Number(cart.discount.value) > 0 ? cart.discount : null,
    p_payment_method: null,
    p_idempotency_key: cart.key,
  }
}

/** Opsi varian per produk: Map product_id → [{ ...group, options: [...] }] */
export function groupOptions(groups, options) {
  const byGroup = new Map(groups.map((group) => [group.id, { ...group, options: [] }]))
  for (const option of options) byGroup.get(option.group_id)?.options.push(option)
  const byProduct = new Map()
  for (const group of [...byGroup.values()].sort((a, b) => a.sort_order - b.sort_order)) {
    group.options.sort((a, b) => a.sort_order - b.sort_order)
    if (!byProduct.has(group.product_id)) byProduct.set(group.product_id, [])
    byProduct.get(group.product_id).push(group)
  }
  return byProduct
}

/** Pilihan bawaan untuk grup wajib (sama dengan aturan place_order). */
export function defaultSelection(groups = []) {
  const selected = {}
  for (const group of groups) {
    const available = group.options.filter((option) => option.is_available)
    const pick = available.find((option) => option.is_default) || (group.is_required ? available[0] : null)
    selected[group.id] = pick ? [pick.id] : []
  }
  return selected
}

/** Sesi kasir terbuka milik pengguna ini (null bila belum buka). */
export async function fetchOpenSession(supabase, cafeId, userId) {
  const { data, error } = await supabase.from('cashier_sessions').select('*')
    .eq('cafe_id', cafeId).eq('opened_by', userId).eq('status', 'open').maybeSingle()
  if (error) throw new Error(friendlyError(error))
  return data
}

export const QUICK_CASH = [5000, 10000, 20000, 50000, 100000]

/** Nominal uang tunai yang umum diberikan untuk total ini (uang pas + pecahan di atasnya). */
export function cashSuggestions(total) {
  const options = new Set([total])
  for (const note of [10000, 20000, 50000, 100000]) {
    const rounded = Math.ceil(total / note) * note
    if (rounded > total) options.add(rounded)
  }
  return [...options].sort((a, b) => a - b).slice(0, 4)
}

export const REFUND_REASONS = ['Pesanan salah', 'Menu habis setelah dibayar', 'Kualitas tidak sesuai', 'Pembayaran dobel']
