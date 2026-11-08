/*
 * Jam buka kafe (kolom cafes.opening_hours, jsonb). Salinan identik nanti dipakai app customer.
 * Bentuk: { mon: { closed: false, open: '08:00', close: '22:00' }, tue: …, sun: … }
 * close < open berarti tutup lewat tengah malam (mis. 17:00–01:00).
 */
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export const DAY_LABELS = {
  mon: 'Senin', tue: 'Selasa', wed: 'Rabu', thu: 'Kamis', fri: 'Jumat', sat: 'Sabtu', sun: 'Minggu',
}

export const DEFAULT_DAY = { closed: false, open: '08:00', close: '22:00' }

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

function normalizeDay(value) {
  if (!value || typeof value !== 'object') return { ...DEFAULT_DAY }
  return {
    closed: Boolean(value.closed),
    open: TIME_PATTERN.test(value.open) ? value.open : DEFAULT_DAY.open,
    close: TIME_PATTERN.test(value.close) ? value.close : DEFAULT_DAY.close,
  }
}

/** Selalu mengembalikan 7 hari lengkap; null jika kafe belum mengatur jam buka. */
export function normalizeOpeningHours(raw) {
  if (!raw || typeof raw !== 'object') return null
  return Object.fromEntries(DAY_KEYS.map((key) => [key, normalizeDay(raw[key])]))
}

export function defaultOpeningHours() {
  return Object.fromEntries(DAY_KEYS.map((key) => [key, { ...DEFAULT_DAY }]))
}

const toMinutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

export function formatHourRange(day) {
  if (!day || day.closed) return 'Tutup'
  return `${day.open.replace(':', '.')}–${day.close.replace(':', '.')}`
}

export function validateOpeningHours(hours) {
  for (const key of DAY_KEYS) {
    const day = hours[key]
    if (day.closed) continue
    if (!TIME_PATTERN.test(day.open) || !TIME_PATTERN.test(day.close)) return `Jam ${DAY_LABELS[key]} belum lengkap.`
    if (day.open === day.close) return `Jam buka dan tutup ${DAY_LABELS[key]} tidak boleh sama.`
  }
  return ''
}

/**
 * Status saat ini (WIB): { open: boolean, label: 'Buka · tutup 22.00' | 'Tutup · buka 08.00' }
 * null bila jam buka belum diatur.
 */
export function openStatus(rawHours, now = new Date()) {
  const hours = normalizeOpeningHours(rawHours)
  if (!hours) return null
  const local = new Date(now.getTime() + JAKARTA_OFFSET_MS)
  const dayIndex = (local.getUTCDay() + 6) % 7
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes()
  const today = hours[DAY_KEYS[dayIndex]]
  const yesterday = hours[DAY_KEYS[(dayIndex + 6) % 7]]

  // Sisa jam dari kemarin yang lewat tengah malam
  if (!yesterday.closed && toMinutes(yesterday.close) < toMinutes(yesterday.open) && minutes < toMinutes(yesterday.close)) {
    return { open: true, label: `Buka · tutup ${yesterday.close.replace(':', '.')}` }
  }
  if (!today.closed) {
    const open = toMinutes(today.open)
    const close = toMinutes(today.close)
    const overnight = close < open
    if (minutes >= open && (overnight || minutes < close)) return { open: true, label: `Buka · tutup ${today.close.replace(':', '.')}` }
    if (minutes < open) return { open: false, label: `Tutup · buka ${today.open.replace(':', '.')}` }
  }
  for (let offset = 1; offset <= 7; offset += 1) {
    const key = DAY_KEYS[(dayIndex + offset) % 7]
    if (!hours[key].closed) {
      return { open: false, label: `Tutup · buka ${offset === 1 ? 'besok' : DAY_LABELS[key]} ${hours[key].open.replace(':', '.')}` }
    }
  }
  return { open: false, label: 'Tutup' }
}
