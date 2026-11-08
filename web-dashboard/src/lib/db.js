/*
 * Akses data bersama + deteksi fitur database.
 *
 * Migrasi supabase/usulan/02-fitur-operasional.sql menambah kolom & fungsi
 * (queue_number, paid_at, staff_mark_order_paid, …). Sebelum migrasi itu
 * diterapkan, UI tetap jalan dengan fallback: fitur terkait disembunyikan.
 */

const BASE_ORDER_COLUMNS = 'id, cafe_id, order_number, customer_id, total_amount, order_status, payment_status, payment_method, notes, created_at'
const OPERATION_ORDER_COLUMNS = ', queue_number, paid_at, cancel_reason, cancelled_at'
const BASE_CAFE_COLUMNS = 'id, name, address, phone'
const OPERATION_CAFE_COLUMNS = ', description, opening_hours, accepted_payment_methods'
export const BRANDING_CAFE_COLUMNS = 'app_name, logo_url, tagline, brand_color'

export const ALL_PAYMENT_METHODS = ['cash', 'qris', 'bank_transfer', 'ewallet']
export const DB_UPDATE_REQUIRED = 'Fitur ini aktif setelah pembaruan database diterapkan.'

const featureCache = new WeakMap()

function probeColumns(supabase, table, columns) {
  return supabase
    .from(table)
    .select(columns)
    .limit(1)
    .then(({ error }) => !error)
    .catch(() => false)
}

/**
 * { operations, branding } — true bila migrasi 02 / 03 sudah diterapkan. Di-cache per klien.
 * Kolom yang belum ada membuat select gagal, jadi UI memilih kolom berdasarkan hasil ini.
 */
export function detectDbFeatures(supabase) {
  if (!featureCache.has(supabase)) {
    const probe = Promise.all([
      probeColumns(supabase, 'orders', 'queue_number, paid_at, cancel_reason, cancelled_at'),
      probeColumns(supabase, 'cafes', BRANDING_CAFE_COLUMNS),
    ]).then(([operations, branding]) => ({ operations, branding }))
    featureCache.set(supabase, probe)
  }
  return featureCache.get(supabase)
}

export function orderColumns(features) {
  return BASE_ORDER_COLUMNS + (features?.operations ? OPERATION_ORDER_COLUMNS : '')
}

export function cafeColumns(features) {
  return BASE_CAFE_COLUMNS
    + (features?.operations ? OPERATION_CAFE_COLUMNS : '')
    + (features?.branding ? `, ${BRANDING_CAFE_COLUMNS}` : '')
}

/** Metode bayar yang bisa dipilih staff saat menandai lunas. */
export function cafePaymentMethods(cafe) {
  const accepted = Array.isArray(cafe?.accepted_payment_methods) ? cafe.accepted_payment_methods : []
  const valid = accepted.filter((method) => ALL_PAYMENT_METHODS.includes(method))
  return valid.length ? valid : ALL_PAYMENT_METHODS
}

/** Ambil semua baris (melewati batas 1000 baris PostgREST). `build` = () => query builder baru. */
export async function fetchAllRows(build, { pageSize = 1000, maxRows = 20000 } = {}) {
  const rows = []
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1)
    if (error) return { data: rows, error }
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return { data: rows, error: null }
}

/** Map order_id → nama customer (RPC staff_order_customer_names; owner & staff boleh). */
export async function fetchCustomerNames(supabase, orderIds) {
  const names = new Map()
  const ids = [...new Set(orderIds.filter(Boolean))]
  for (let index = 0; index < ids.length; index += 150) {
    const { data, error } = await supabase.rpc('staff_order_customer_names', { p_order_ids: ids.slice(index, index + 150) })
    if (error) return { names, error }
    for (const row of data || []) names.set(row.order_id, row.customer_name?.trim() || '')
  }
  return { names, error: null }
}

/** Item pesanan dikelompokkan per order_id. */
export async function fetchOrderItems(supabase, orderIds) {
  const byOrder = new Map()
  const ids = [...new Set(orderIds.filter(Boolean))]
  for (let index = 0; index < ids.length; index += 150) {
    const { data, error } = await supabase
      .from('order_items')
      .select('id, order_id, product_id, product_name, price, quantity, subtotal, notes, created_at')
      .in('order_id', ids.slice(index, index + 150))
      .order('created_at', { ascending: true })
    if (error) return { byOrder, error }
    for (const item of data || []) {
      const list = byOrder.get(item.order_id) || []
      list.push(item)
      byOrder.set(item.order_id, list)
    }
  }
  return { byOrder, error: null }
}

export function customerLabel(order) {
  if (order?.customer_name) return order.customer_name
  if (!order?.customer_id) return 'Tanpa akun'
  return `Pelanggan ${String(order.customer_id).slice(0, 4).toUpperCase()}`
}

/** Pesan error yang ramah untuk ditampilkan. */
export function friendlyError(error, fallback = 'Terjadi kesalahan. Coba lagi.') {
  if (!error) return ''
  const message = String(error.message || '')
  if (error.code === 'PGRST202' || error.code === '42883') return DB_UPDATE_REQUIRED
  if (error.code === '42501' || /permission denied|row-level security/i.test(message)) return 'Akses ditolak untuk aksi ini.'
  if (/failed to fetch|network/i.test(message)) return 'Koneksi terputus. Periksa internet lalu coba lagi.'
  if (error.code === '23514' && /status/i.test(message)) return 'Status pesanan sudah berubah. Muat ulang lalu coba lagi.'
  return message || fallback
}
