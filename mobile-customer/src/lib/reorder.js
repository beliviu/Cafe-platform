/*
 * Pesan ulang: ambil item pesanan lama beserta harga & ketersediaan TERKINI dari database
 * (RPC customer_reorder_items, file 08), lalu susun baris keranjang. Menu habis dilewati.
 */
import { makeLine } from '../cart/CartProvider.jsx'
import { formatRupiah } from './format.js'

export async function buildReorder(supabase, orderId, cafeName) {
  const { data: rows, error } = await supabase.rpc('customer_reorder_items', { p_order_id: orderId })
  if (error) throw new Error(error.message)
  const available = rows.filter((row) => row.available)
  const productIds = [...new Set(available.map((row) => row.product_id))]
  const optionIds = [...new Set(available.flatMap((row) => row.option_ids || []))]
  const [products, options] = await Promise.all([
    productIds.length ? supabase.from('products').select('id, cafe_id, name, price, image_url, is_available').in('id', productIds) : { data: [] },
    optionIds.length ? supabase.from('product_options').select('id, name, price_delta').in('id', optionIds) : { data: [] },
  ])
  const productMap = new Map((products.data || []).map((product) => [product.id, product]))
  const optionMap = new Map((options.data || []).map((option) => [option.id, option]))
  const lines = []
  const changes = []
  for (const row of rows) {
    const product = productMap.get(row.product_id)
    if (!row.available || !product) {
      changes.push(`${row.name}: ${row.note || 'tidak tersedia'}`)
      continue
    }
    lines.push(makeLine(product, { name: cafeName }, { quantity: row.quantity, options: (row.option_ids || []).map((id) => optionMap.get(id)).filter(Boolean) }))
    if (row.note === 'Harga berubah') changes.push(`${row.name}: ${formatRupiah(row.old_unit_price)} → ${formatRupiah(row.unit_price)}`)
    else if (row.note) changes.push(`${row.name}: ${row.note.toLowerCase()}`)
  }
  return { lines, changes, skipped: rows.length - lines.length }
}
