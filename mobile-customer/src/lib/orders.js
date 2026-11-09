/*
 * Kolom pesanan tambahan (queue_number, cancel_reason, paid_at) baru ada setelah
 * migrasi supabase/usulan/02-fitur-operasional.sql. Sebelum itu, app tetap jalan
 * dan nomor antrean memakai fallback #xxxx (lihat formatQueueNumber).
 */
const EXTRA_COLUMNS = ', queue_number, cancel_reason, paid_at'
const cache = new WeakMap()

function hasExtraColumns(supabase) {
  if (!cache.has(supabase)) {
    cache.set(supabase, supabase
      .from('orders')
      .select('queue_number, cancel_reason, paid_at')
      .limit(1)
      .then(({ error }) => !error)
      .catch(() => false))
  }
  return cache.get(supabase)
}

/** Kolom select untuk tabel orders, ditambah kolom baru jika sudah tersedia. */
export async function orderSelect(supabase, baseColumns) {
  return (await hasExtraColumns(supabase)) ? baseColumns + EXTRA_COLUMNS : baseColumns
}

/*
 * Kolom fase 4 (file 08 + 06): rincian harga, meja, jadwal, estimasi, pembatal.
 * Bila file 08 belum dijalankan, select memakai kolom lama saja.
 */
const PHASE4_COLUMNS = ', subtotal_amount, discount_amount, discount_reason, voucher_code, voucher_discount, points_redeemed, points_discount, '
  + 'tax_amount, service_charge_amount, rounding_amount, table_label, order_type, scheduled_for, estimated_ready_at, cancelled_by, cancelled_at, paid_amount, refunded_amount'
const phase4Cache = new WeakMap()

export function hasPhase4Columns(supabase) {
  if (!phase4Cache.has(supabase)) {
    phase4Cache.set(supabase, supabase.from('orders').select('scheduled_for, estimated_ready_at, cancelled_by').limit(1)
      .then(({ error }) => !error).catch(() => false))
  }
  return phase4Cache.get(supabase)
}

export async function orderDetailSelect(supabase, baseColumns) {
  const base = await orderSelect(supabase, baseColumns)
  return (await hasPhase4Columns(supabase)) ? base + PHASE4_COLUMNS : base
}
