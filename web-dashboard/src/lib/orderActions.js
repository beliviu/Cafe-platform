/*
 * Aksi yang MENULIS data pesanan. Semuanya memakai jalur yang diizinkan database:
 * - advanceOrderStatus → UPDATE orders.order_status (sudah diizinkan untuk owner/staff)
 * - markOrderPaid      → RPC staff_mark_order_paid (migrasi 02): isi payments + orders.payment_status/paid_at
 * - cancelOrder        → RPC staff_cancel_order (migrasi 02): order_status = cancelled + alasan
 * Semua melempar Error dengan pesan Bahasa Indonesia.
 */
import { friendlyError } from './db.js'
import { NEXT_ORDER_STATUS } from './status.js'

export async function advanceOrderStatus(supabase, order) {
  const nextStatus = NEXT_ORDER_STATUS[order.order_status]
  if (!nextStatus) throw new Error('Pesanan ini sudah di tahap akhir.')
  const { data, error } = await supabase
    .from('orders')
    .update({ order_status: nextStatus })
    .eq('id', order.id)
    .eq('order_status', order.order_status) // cegah dobel klik / dua staff bersamaan
    .select('id, order_status')
    .maybeSingle()
  if (error) throw new Error(friendlyError(error))
  if (!data) throw new Error('Status pesanan sudah berubah. Muat ulang lalu coba lagi.')
  return data
}

export async function markOrderPaid(supabase, orderId, method) {
  const { data, error } = await supabase.rpc('staff_mark_order_paid', { p_order_id: orderId, p_method: method })
  if (error) throw new Error(friendlyError(error))
  return data
}

export async function cancelOrder(supabase, orderId, reason) {
  const { data, error } = await supabase.rpc('staff_cancel_order', { p_order_id: orderId, p_reason: reason })
  if (error) throw new Error(friendlyError(error))
  return data
}

/**
 * Majukan pesanan sampai status `target`, satu langkah per update (urutan dijaga trigger database).
 * Mis. "Konfirmasi" di papan staff: pending → confirmed → preparing.
 * Hanya menulis kolom orders.order_status. Mengembalikan status terakhir yang berhasil.
 */
export async function advanceOrderTo(supabase, order, target) {
  let current = order
  for (let guard = 0; guard < 4 && current.order_status !== target; guard += 1) {
    if (!NEXT_ORDER_STATUS[current.order_status]) break
    const data = await advanceOrderStatus(supabase, current)
    current = { ...current, order_status: data.order_status }
  }
  return current
}

/** Toggle "Produk habis" untuk staff — RPC staff_set_product_availability (hanya kolom is_available). */
export async function setProductAvailability(supabase, productId, isAvailable) {
  const { data, error } = await supabase.rpc('staff_set_product_availability', { p_product_id: productId, p_is_available: isAvailable })
  if (error) throw new Error(friendlyError(error))
  return data
}
