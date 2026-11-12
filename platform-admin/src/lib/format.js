// Salinan dari web-dashboard/src/lib/format.js — sinkronkan manual bila aslinya berubah.
/*
 * Helper format bersama. Salinan identik ada di mobile-customer/src/lib/format.js.
 * Semua waktu ditampilkan dalam zona Asia/Jakarta (WIB, UTC+7, tanpa DST).
 */

export const CAFE_TIME_ZONE = 'Asia/Jakarta'
const JAKARTA_OFFSET = '+07:00'
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000
const NBSP = ' '

const numberFormatter = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 })

/** Rp 12.000 — dibulatkan ke rupiah terdekat, spasi tak terputus supaya tidak pecah baris. */
export function formatRupiah(value) {
  const amount = Math.round(Number(value) || 0)
  const formatted = `Rp${NBSP}${numberFormatter.format(Math.abs(amount))}`
  return amount < 0 ? `−${formatted}` : formatted
}

/** Versi ringkas untuk sumbu grafik: Rp 1,2 jt / Rp 850 rb. */
export function formatRupiahCompact(value) {
  const amount = Number(value) || 0
  const abs = Math.abs(amount)
  if (abs >= 1_000_000) return `Rp${NBSP}${(amount / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })}${NBSP}jt`
  if (abs >= 1_000) return `Rp${NBSP}${Math.round(amount / 1_000).toLocaleString('id-ID')}${NBSP}rb`
  return formatRupiah(amount)
}

/** Ambil angka bulat dari ketikan ("Rp 28.000" → 28000). Kosong → ''. */
export function parseRupiah(text, max = 999_999_999) {
  const digits = String(text ?? '').replace(/\D/g, '')
  if (!digits) return ''
  return Math.min(Number(digits), max)
}

export function formatNumber(value) {
  return numberFormatter.format(Number(value) || 0)
}

export function formatPercent(value, fractionDigits = 0) {
  return `${(Number(value) || 0).toLocaleString('id-ID', { maximumFractionDigits: fractionDigits })}%`
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const formatters = {
  date: new Intl.DateTimeFormat('id-ID', { timeZone: CAFE_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' }),
  dateShort: new Intl.DateTimeFormat('id-ID', { timeZone: CAFE_TIME_ZONE, day: 'numeric', month: 'short' }),
  time: new Intl.DateTimeFormat('id-ID', { timeZone: CAFE_TIME_ZONE, hour: '2-digit', minute: '2-digit' }),
  dateTime: new Intl.DateTimeFormat('id-ID', {
    timeZone: CAFE_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }),
  weekday: new Intl.DateTimeFormat('id-ID', { timeZone: CAFE_TIME_ZONE, weekday: 'short' }),
}

export function formatDate(value) {
  const date = toDate(value)
  return date ? formatters.date.format(date) : '—'
}
export function formatDateShort(value) {
  const date = toDate(value)
  return date ? formatters.dateShort.format(date) : '—'
}
export function formatTime(value) {
  const date = toDate(value)
  return date ? formatters.time.format(date) : '—'
}
export function formatDateTime(value) {
  const date = toDate(value)
  return date ? formatters.dateTime.format(date) : '—'
}
export function formatWeekday(value) {
  const date = toDate(value)
  return date ? formatters.weekday.format(date) : ''
}

/** Jam lokal WIB 0–23. */
export function jakartaHour(value) {
  const date = toDate(value)
  return date ? new Date(date.getTime() + JAKARTA_OFFSET_MS).getUTCHours() : null
}

/** Kunci tanggal lokal WIB, format YYYY-MM-DD. */
export function jakartaDateKey(value = new Date()) {
  const date = toDate(value)
  return date ? new Date(date.getTime() + JAKARTA_OFFSET_MS).toISOString().slice(0, 10) : ''
}

/** Awal hari lokal WIB (instan UTC) untuk sebuah kunci tanggal. */
export function startOfJakartaDay(dateKey) {
  return new Date(`${dateKey}T00:00:00${JAKARTA_OFFSET}`)
}

/** Geser kunci tanggal sejumlah hari (boleh negatif). */
export function addDaysToKey(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** "baru saja", "5 menit lalu", "2 jam lalu". */
export function formatRelative(value, now = Date.now()) {
  const date = toDate(value)
  if (!date) return '—'
  const minutes = Math.floor((now - date.getTime()) / 60000)
  if (minutes < 1) return 'baru saja'
  if (minutes < 60) return `${minutes} menit lalu`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} jam lalu`
  return formatDateShort(date)
}

export function minutesSince(value, now = Date.now()) {
  const date = toDate(value)
  return date ? Math.max(0, Math.floor((now - date.getTime()) / 60000)) : 0
}

/** Sapaan sesuai jam WIB. */
export function greetingForNow(now = new Date()) {
  const hour = jakartaHour(now)
  if (hour < 11) return 'Selamat pagi'
  if (hour < 15) return 'Selamat siang'
  if (hour < 18) return 'Selamat sore'
  return 'Selamat malam'
}

/**
 * Nomor antrean manusiawi.
 * - Jika kolom `queue_number` sudah tersedia (lihat USULAN-DATABASE.md): A-012, reset harian.
 * - Fallback deterministik dari order_number / id: #4821 — identik di ketiga aplikasi.
 */
export function formatQueueNumber(order) {
  if (!order) return '—'
  const queue = Number(order.queue_number)
  if (Number.isInteger(queue) && queue > 0) return `A-${String(queue).padStart(3, '0')}`

  const digits = String(order.order_number ?? '').replace(/\D/g, '')
  if (digits) return `#${digits.slice(-4).padStart(3, '0')}`

  const raw = String(order.order_number || order.id || '').replace(/[^0-9a-z]/gi, '')
  return raw ? `#${raw.slice(-4).toUpperCase()}` : '—'
}

/** ID panjang untuk teks sekunder. */
export function formatOrderReference(order) {
  const value = String(order?.order_number ?? order?.id ?? '')
  if (!value) return ''
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value
}

/** "Vanilla Latte ×1 +1 lainnya" */
export function summarizeItems(items = [], maxShown = 1) {
  if (!items.length) return 'Tidak ada item'
  const shown = items.slice(0, maxShown).map((item) => `${item.product_name} ×${item.quantity}`)
  const rest = items.length - maxShown
  return rest > 0 ? `${shown.join(', ')} +${rest} lainnya` : shown.join(', ')
}

export function initials(name = '') {
  return String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase() || '?'
}
