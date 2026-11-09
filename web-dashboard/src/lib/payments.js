/*
 * Pembayaran QRIS online (file SQL 09 + Edge Function "payments").
 * Web tidak pernah menandai lunas sendiri: status lunas hanya datang dari gateway.
 */
export const QRIS_REQUIRED = 'QRIS kafe aktif setelah file supabase/usulan/12-qris-statis.sql dijalankan.'

/** Gambar QRIS statis kafe (file 12), null bila belum dipasang / kolom belum ada. */
export async function fetchStaticQris(supabase, cafeId) {
  const { data, error } = await supabase.from('cafe_settings').select('qris_image_url').eq('cafe_id', cafeId).maybeSingle()
  return error ? null : data?.qris_image_url || null
}

export const PAYMENTS_REQUIRED = 'Pembayaran QRIS online aktif setelah file supabase/usulan/09-payment-gateway.sql dijalankan dan Edge Function "payments" di-deploy.'

export async function callPayments(supabase, body) {
  const { data, error } = await supabase.functions.invoke('payments', { body })
  if (error) {
    let message = error.message
    try {
      const detail = await error.context?.json?.()
      if (detail?.error) message = detail.error
    } catch {
      // badan respons bukan JSON
    }
    throw new Error(/Failed to send|fetch/i.test(message || '') ? 'Layanan pembayaran belum terpasang (Edge Function "payments").' : message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export const INTENT_STATUS = {
  creating: { label: 'Menyiapkan', tone: 'neutral' },
  pending: { label: 'Menunggu bayar', tone: 'amber' },
  paid: { label: 'Lunas', tone: 'green' },
  expired: { label: 'Kedaluwarsa', tone: 'neutral' },
  failed: { label: 'Gagal', tone: 'red' },
  cancelled: { label: 'Dibatalkan', tone: 'neutral' },
}

/** Pengaturan gateway kafe (null bila file 09 belum dijalankan). */
export async function fetchGatewaySettings(supabase, cafeId) {
  const { data, error } = await supabase.from('cafe_settings').select('payment_gateway_enabled, payment_gateway_provider, payment_qris_expiry_minutes').eq('cafe_id', cafeId).maybeSingle()
  if (error) return null
  return data
}
