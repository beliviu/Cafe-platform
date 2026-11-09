/*
 * Fitur customer fase 4 (file supabase/usulan/08-pelanggan-qr.sql).
 * Sebelum file 08 dijalankan, RPC-nya belum ada → fitur terkait disembunyikan,
 * pemesanan tetap lewat create_order (perilaku lama).
 */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth.js'
import { openStatus } from './cafeHours.js'

/** RPC belum ada di database (migrasi belum dijalankan). */
export function isMissingRpc(error) {
  return Boolean(error) && (error.code === 'PGRST202' || /could not find the function|schema cache/i.test(error.message || ''))
}

export async function rpc(supabase, name, args) {
  const { data, error } = await supabase.rpc(name, args)
  return { data, error, missing: isMissingRpc(error) }
}

export function newIdempotencyKey() {
  const random = Math.random().toString(36).slice(2, 10)
  return `app-${Date.now().toString(36)}-${random}`
}

const ERROR_HINTS = {
  cafe_closed: 'closed',
  ordering_paused: 'paused',
  scheduled_closed: 'schedule',
  scheduled_disabled: 'schedule',
  table_invalid: 'table',
  table_other_cafe: 'table',
  table_inactive: 'table',
  qr_disabled: 'table',
  voucher_invalid: 'voucher',
  product_unavailable: 'stock',
  option_unavailable: 'stock',
}

/** Pesan error checkout yang ramah + jenis masalah (untuk menyorot bagian form). */
export function checkoutError(error) {
  const message = (error?.message || 'Pesanan gagal dibuat.').replace(/^Stok tidak cukup/, 'Stok tidak cukup')
  return { message, kind: ERROR_HINTS[error?.hint] || null }
}

/**
 * Status kafe: buka/tutup, jeda, terjadwal, estimasi.
 * Pakai RPC cafe_status (file 08); bila belum ada, hitung dari jam buka di perangkat.
 */
export function useCafeStatus(cafe) {
  const { supabase } = useAuth()
  const [status, setStatus] = useState(null)
  const cafeId = cafe?.id
  const hours = cafe?.opening_hours

  const reload = useCallback(async () => {
    if (!supabase || !cafeId) return
    const { data, missing } = await rpc(supabase, 'cafe_status', { p_cafe_id: cafeId })
    if (data) {
      setStatus({ ...data, label: statusLabel(data), live: true })
      return
    }
    const local = openStatus(hours)
    setStatus({
      open: local ? local.open : true, accepting: local ? local.open : true, paused: false, scheduled_enabled: false,
      hours_set: Boolean(local), prep_minutes: null, label: local?.label || null, live: false, legacy: missing,
    })
  }, [cafeId, hours, supabase])

  useEffect(() => {
    const first = setTimeout(reload, 0)
    const timer = setInterval(reload, 60000)
    return () => { clearTimeout(first); clearInterval(timer) }
  }, [reload])

  return { status, reload }
}

function clock(iso) {
  if (!iso) return ''
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(':', '.')
}

export function statusLabel(status) {
  if (!status) return ''
  if (status.paused) return status.message ? `Pesanan dijeda · ${status.message}` : 'Pesanan app sedang dijeda'
  if (!status.open) return status.next_open ? `Tutup · buka ${clock(status.next_open)}` : 'Tutup'
  return status.prep_minutes ? `Buka · siap ±${status.prep_minutes} menit` : 'Buka'
}

/** Rating per produk { productId: { rating, reviews } } — kosong bila file 08 belum ada. */
export async function fetchRatings(supabase, cafeId) {
  const { data, error } = await supabase.rpc('product_rating_summary', { p_cafe_id: cafeId })
  if (error) return new Map()
  return new Map((data || []).map((row) => [row.product_id, { rating: Number(row.rating), reviews: row.reviews }]))
}

export const POINTS_KIND = {
  earn: 'Poin dari pesanan',
  redeem: 'Ditukar saat pesan',
  redeem_return: 'Dikembalikan (pesanan batal)',
  refund: 'Dikurangi (refund)',
  adjust: 'Penyesuaian kafe',
}

export const TICKET_STATUS = {
  open: { label: 'Menunggu kafe', tone: 'amber' },
  answered: { label: 'Dibalas', tone: 'green' },
  closed: { label: 'Selesai', tone: 'neutral' },
}
