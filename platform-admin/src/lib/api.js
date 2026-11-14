/*
 * Akses data dashboard platform.
 * - Baca & ubah: fungsi SQL pa_* (file 14). Database sendiri yang memeriksa admin + 2FA (aal2).
 * - Aksi butuh service-role (buat akun owner, reset password): Edge Function "platform-admin".
 */
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'

export function friendlyError(error) {
  const message = String(error?.message || error || '')
  const hint = error?.hint || ''
  if (hint === 'mfa_required' || /2FA/.test(message)) return 'Sesi belum terverifikasi 2FA. Masuk ulang.'
  if (hint === 'platform_admin_only') return 'Akun ini bukan admin platform.'
  if (/could not find the function|schema cache/i.test(message)) return 'Fungsi database belum ada. Jalankan file SQL terbaru (14–16) di Supabase.'
  if (/failed to fetch|network|load failed/i.test(message)) return 'Koneksi terputus. Periksa internet lalu coba lagi.'
  return message || 'Terjadi kesalahan. Coba lagi.'
}

export async function rpc(name, args = {}) {
  if (!supabase) throw new Error('Koneksi ke server belum tersedia.')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(friendlyError(error))
  return data
}

/** Panggil Edge Function platform-admin; pesan error dari fungsi diteruskan apa adanya. */
export async function platformAction(action, payload = {}) {
  if (!supabase) throw new Error('Koneksi ke server belum tersedia.')
  const { data, error } = await supabase.functions.invoke('platform-admin', { body: { action, ...payload } })
  if (error) {
    let message = error.message
    try {
      const body = await error.context?.json?.()
      if (body?.error) message = body.error
    } catch {
      // badan respons bukan JSON
    }
    if (/failed to send a request|not found/i.test(message)) message = 'Edge Function platform-admin belum di-deploy.'
    throw new Error(message)
  }
  return data
}

/** Muat data dari fungsi async; ulangi saat `load` berubah atau reload() dipanggil. */
export function useLoader(load) {
  const [attempt, setAttempt] = useState(0)
  // `for` = permintaan yang menghasilkan data ini; selama berbeda dengan permintaan sekarang → memuat
  const [state, setState] = useState({ data: null, error: '', for: null })

  useEffect(() => {
    let active = true
    const key = { load, attempt }
    load()
      .then((data) => { if (active) setState({ data, error: '', for: key }) })
      .catch((error) => { if (active) setState((current) => ({ ...current, error: friendlyError(error), for: key })) })
    return () => { active = false }
  }, [load, attempt])

  const loading = state.for?.load !== load || state.for?.attempt !== attempt
  const reload = useCallback(() => setAttempt((value) => value + 1), [])
  return { data: state.data, error: loading ? '' : state.error, loading, reload }
}

export const STATE_META = {
  active: { label: 'Aktif', tone: 'green' },
  past_due: { label: 'Telat bayar', tone: 'amber' },
  trial: { label: 'Masa coba', tone: 'blue' },
  expired: { label: 'Habis', tone: 'neutral' },
  suspended: { label: 'Nonaktif', tone: 'red' },
}

export const INVOICE_META = {
  pending: { label: 'Menunggu', tone: 'blue' },
  overdue: { label: 'Telat', tone: 'amber' },
  paid: { label: 'Lunas', tone: 'green' },
  void: { label: 'Batal', tone: 'neutral' },
}

export const FEATURES = [
  { key: 'inventory', label: 'Inventori, resep & pembelian' },
  { key: 'finance', label: 'Keuangan & akuntansi' },
  { key: 'loyalty', label: 'Poin & member' },
  { key: 'qr_ordering', label: 'Pesan dari QR meja' },
  { key: 'payment_gateway', label: 'QRIS online (gateway)' },
  { key: 'ai_advisor', label: 'Tanya AI di Advisor' },
]

export const LIMITS = [
  { key: 'staff', label: 'Staff aktif' },
  { key: 'tables', label: 'Meja' },
  { key: 'products', label: 'Menu' },
]

export const ACTION_LABELS = {
  'cafe.create': 'Kafe dibuat',
  'cafe.suspend': 'Kafe dinonaktifkan',
  'cafe.unsuspend': 'Kafe diaktifkan',
  'plan.create': 'Paket dibuat',
  'plan.update': 'Paket diubah',
  'subscription.plan': 'Paket kafe diganti',
  'subscription.extend': 'Langganan diperpanjang',
  'subscription.trial': 'Masa coba diberikan',
  'invoice.create': 'Tagihan dibuat',
  'invoice.paid': 'Tagihan lunas',
  'invoice.void': 'Tagihan dibatalkan',
  'invoice.underpaid': 'Pembayaran kurang',
  'invoice.paid_after_void': 'Dibayar setelah batal',
  'account.reset_password': 'Password direset',
  'cafe.owner_whatsapp': 'WA owner diubah',
  'whatsapp.open': 'Chat WA dibuka',
  'settings.update': 'Pengaturan diubah',
  'announcement.create': 'Pengumuman dikirim',
  'cafe.note': 'Catatan internal',
  'ticket.reply': 'Tiket dibalas',
  'ticket.update': 'Tiket diubah',
}

/** Label skor kesehatan (file 16). Selalu tampil sebagai kata, bukan warna saja. */
export const HEALTH_META = {
  healthy: { label: 'Sehat', tone: 'green' },
  watch: { label: 'Pantau', tone: 'amber' },
  risk: { label: 'Berisiko', tone: 'red' },
}

export const TICKET_STATUS = {
  new: { label: 'Baru', tone: 'blue' },
  in_progress: { label: 'Diproses', tone: 'amber' },
  resolved: { label: 'Selesai', tone: 'green' },
}
export const TICKET_PRIORITY = {
  urgent: { label: 'Mendesak', tone: 'red' },
  high: { label: 'Tinggi', tone: 'amber' },
  normal: { label: 'Normal', tone: 'neutral' },
  low: { label: 'Rendah', tone: 'neutral' },
}
export const TICKET_CATEGORY = {
  akun: 'Akun & login', tagihan: 'Tagihan & langganan', pesanan: 'Pesanan', menu: 'Menu & produk',
  pembayaran: 'Pembayaran', aplikasi: 'Aplikasi customer', lainnya: 'Lainnya',
}

const MISSING_FUNCTION = /belum ada|SQL 1[4-9]/i
/** Fungsi dari file SQL yang mungkin belum dijalankan: hasil null (bukan error) agar halaman tetap tampil. */
export function optional(promise) {
  return promise.catch((error) => (MISSING_FUNCTION.test(error.message) ? null : Promise.reject(error)))
}

/** Persen perubahan (null bila pembanding kosong/0). */
export function percentChange(current, previous) {
  const now = Number(current)
  const before = Number(previous)
  if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) return null
  return ((now - before) / before) * 100
}
