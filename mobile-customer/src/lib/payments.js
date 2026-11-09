/*
 * Pembayaran QRIS online (file SQL 09 + Edge Function "payments").
 * Aplikasi TIDAK pernah menandai lunas sendiri: status lunas hanya datang dari gateway
 * (webhook terverifikasi) dan dibaca dari tabel payment_intents.
 */
import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth.js'

/** Apakah kafe menerima QRIS online (pengaturan publik di cafe_settings). */
export function useGatewayEnabled(cafeId) {
  const { supabase } = useAuth()
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    if (!supabase || !cafeId) return
    supabase.from('cafe_settings').select('payment_gateway_enabled').eq('cafe_id', cafeId).maybeSingle()
      .then(({ data, error }) => setEnabled(!error && Boolean(data?.payment_gateway_enabled)))
  }, [cafeId, supabase])
  return enabled
}

/** Gambar QRIS statis kafe (file 12). null = belum dipasang / database belum diperbarui. */
export function useStaticQris(cafeId) {
  const { supabase } = useAuth()
  const [url, setUrl] = useState(undefined) // undefined = masih memuat
  useEffect(() => {
    if (!supabase || !cafeId) return
    supabase.from('cafe_settings').select('qris_image_url').eq('cafe_id', cafeId).maybeSingle()
      .then(({ data, error }) => setUrl(!error && data?.qris_image_url ? data.qris_image_url : null))
  }, [cafeId, supabase])
  return url
}

/** Panggil Edge Function payments; pesan error dari server diteruskan apa adanya. */
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
    throw new Error(message || 'Layanan pembayaran tidak dapat dihubungi')
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export const INTENT_STATUS = {
  creating: { label: 'Menyiapkan QR…', tone: 'neutral' },
  pending: { label: 'Menunggu pembayaran', tone: 'amber' },
  paid: { label: 'Lunas', tone: 'green' },
  expired: { label: 'QR kedaluwarsa', tone: 'neutral' },
  failed: { label: 'Gagal dibuat', tone: 'red' },
  cancelled: { label: 'Dibatalkan', tone: 'neutral' },
}
