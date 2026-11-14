/*
 * Fitur platform file SQL 18 di web owner/staff: status sistem & insiden, wizard setup, feature flag,
 * daftar sendiri (Edge Function self-signup + Cloudflare Turnstile). Semua aman sebelum file 18 dijalankan (→ null).
 */
import { useEffect, useState } from 'react'

const MISSING = /could not find the function|schema cache|does not exist/i

export const SERVICE_STATUS = {
  operational: { label: 'Normal', tone: 'green' },
  degraded: { label: 'Melambat', tone: 'amber' },
  partial_outage: { label: 'Gangguan sebagian', tone: 'amber' },
  major_outage: { label: 'Gangguan besar', tone: 'red' },
  maintenance: { label: 'Pemeliharaan', tone: 'blue' },
}
export const INCIDENT_STATUS = {
  investigating: { label: 'Sedang dicek', tone: 'amber' },
  identified: { label: 'Penyebab ditemukan', tone: 'amber' },
  monitoring: { label: 'Dipantau', tone: 'blue' },
  resolved: { label: 'Selesai', tone: 'green' },
}
export const OVERALL_TEXT = {
  operational: 'Semua layanan berjalan normal',
  degraded: 'Sebagian layanan melambat',
  partial_outage: 'Ada gangguan pada sebagian layanan',
  major_outage: 'Ada gangguan besar',
  maintenance: 'Sedang pemeliharaan terjadwal',
}

/** Status publik (boleh tanpa login). null bila file 18 belum dijalankan. */
export async function fetchPublicStatus(supabase) {
  const { data, error } = await supabase.rpc('public_status')
  if (error) {
    if (MISSING.test(error.message)) return null
    throw new Error(error.message)
  }
  return data
}

/** Insiden yang belum selesai, diperbarui tiap 5 menit (banner di web owner & staff). */
export function useActiveIncidents(supabase, enabled = true) {
  const [incidents, setIncidents] = useState([])
  useEffect(() => {
    if (!supabase || !enabled) return undefined
    let active = true
    const load = () => fetchPublicStatus(supabase)
      .then((data) => { if (active) setIncidents((data?.incidents || []).filter((item) => item.status !== 'resolved')) })
      .catch(() => {})
    load()
    const timer = window.setInterval(load, 5 * 60 * 1000)
    return () => { active = false; window.clearInterval(timer) }
  }, [enabled, supabase])
  return incidents
}

/** Flag fitur kafe ({ key: true/false }); {} bila file 18 belum dijalankan. */
export async function fetchCafeFlags(supabase, cafeId) {
  const { data, error } = await supabase.rpc('cafe_flags', { p_cafe_id: cafeId })
  if (error) return {}
  return data || {}
}

/** Progres 8 langkah setup (null bila file 16/18 belum ada). */
export async function fetchSetupProgress(supabase, cafeId) {
  const { data, error } = await supabase.rpc('owner_setup_progress', { p_cafe_id: cafeId })
  if (error) {
    if (MISSING.test(error.message)) return null
    throw new Error(error.message)
  }
  return data
}

/** Tujuan & penjelasan tiap langkah setup (kunci sama dengan pa_setup_steps di SQL). */
export const SETUP_STEPS = {
  identity: { to: '/settings', hint: 'Isi alamat dan unggah logo kafe.' },
  hours: { to: '/settings/operations', hint: 'Atur jam buka setiap hari.' },
  charges: { to: '/settings/charges', hint: 'Nyalakan pajak/service bila dipakai, lalu simpan.' },
  menu: { to: '/products', hint: 'Buat kategori dan minimal 3 produk.' },
  tables: { to: '/settings/tables', hint: 'Tambah meja lalu cetak QR-nya.' },
  staff: { to: '/team', hint: 'Undang minimal satu staff kasir.' },
  payment: { to: '/settings/payments', hint: 'Unggah QRIS statis atau nyalakan pembayaran online.' },
  receipt: { to: '/settings/receipt', hint: 'Atur kepala & kaki struk, lalu simpan.' },
}

/* ---------- Daftar sendiri ---------- */
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() || ''

let turnstileScript = null
/** Muat skrip Cloudflare Turnstile sekali (mode render manual). */
export function loadTurnstile() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Browser tidak tersedia'))
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!turnstileScript) {
    turnstileScript = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile tidak termuat')))
      script.onerror = () => { turnstileScript = null; reject(new Error('Verifikasi bot tidak bisa dimuat. Periksa koneksi lalu muat ulang.')) }
      document.head.append(script)
    })
  }
  return turnstileScript
}

/** Kirim pendaftaran ke Edge Function self-signup. Error membawa `field` bila salah satu isian bermasalah. */
export async function submitSignup(supabase, payload) {
  const { data, error } = await supabase.functions.invoke('self-signup', { body: payload })
  if (error) {
    let detail = null
    try { detail = await error.context?.json?.() } catch { /* bukan JSON */ }
    const failure = new Error(detail?.error || (/Failed to send|fetch/i.test(error.message || '') ? 'Pendaftaran belum tersedia. Hubungi Dailybrew lewat WhatsApp.' : error.message))
    failure.field = detail?.field
    throw failure
  }
  if (data?.error) {
    const failure = new Error(data.error)
    failure.field = data.field
    throw failure
  }
  return data
}

/** Awalan rute owner saat dibuka di pratinjau (/preview/owner) atau mode lihat-sebagai (/lihat-sebagai). */
export function ownerBase(pathname) {
  return pathname.match(/^\/(preview\/owner|lihat-sebagai)/)?.[0] ?? ''
}
