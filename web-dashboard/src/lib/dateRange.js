/*
 * Rentang tanggal dalam zona WIB, selalu INKLUSIF hari ini.
 * Semua batas berupa instan awal hari lokal (00.00 WIB) → aman dipakai untuk query timestamptz.
 */
import { addDaysToKey, formatDate, formatDateShort, jakartaDateKey, startOfJakartaDay } from './format.js'

export const RANGE_PRESETS = [
  { value: 'today', label: 'Hari ini' },
  { value: '7d', label: '7 hari' },
  { value: '30d', label: '30 hari' },
  { value: 'month', label: 'Bulan ini' },
]

export const MAX_RANGE_DAYS = 92

function daysBetween(startKey, endKey) {
  return Math.round((new Date(`${endKey}T12:00:00Z`) - new Date(`${startKey}T12:00:00Z`)) / 86400000) + 1
}

function buildWindow(startKey, endKey) {
  return {
    startKey,
    endKey,
    days: daysBetween(startKey, endKey),
    start: startOfJakartaDay(startKey),
    endExclusive: startOfJakartaDay(addDaysToKey(endKey, 1)),
  }
}

/** Daftar kunci tanggal dari start sampai end (inklusif). */
export function dateKeysBetween(startKey, endKey) {
  const keys = []
  for (let key = startKey; key <= endKey; key = addDaysToKey(key, 1)) keys.push(key)
  return keys
}

/**
 * preset: today | 7d | 30d | month | custom
 * custom: { startKey, endKey } (YYYY-MM-DD)
 * Mengembalikan rentang + periode sebelumnya dengan panjang sama (untuk perbandingan).
 */
export function resolveRange(preset, custom, now = new Date()) {
  const todayKey = jakartaDateKey(now)
  let startKey = todayKey
  let endKey = todayKey

  if (preset === '7d') startKey = addDaysToKey(todayKey, -6)
  else if (preset === '30d') startKey = addDaysToKey(todayKey, -29)
  else if (preset === 'month') startKey = `${todayKey.slice(0, 7)}-01`
  else if (preset === 'custom' && custom?.startKey && custom?.endKey) {
    startKey = custom.startKey <= custom.endKey ? custom.startKey : custom.endKey
    endKey = custom.startKey <= custom.endKey ? custom.endKey : custom.startKey
    if (endKey > todayKey) endKey = todayKey
    if (daysBetween(startKey, endKey) > MAX_RANGE_DAYS) startKey = addDaysToKey(endKey, -(MAX_RANGE_DAYS - 1))
  }

  const current = buildWindow(startKey, endKey)
  const previous = buildWindow(addDaysToKey(startKey, -current.days), addDaysToKey(startKey, -1))
  return { preset, todayKey, ...current, previous, label: rangeLabel(current, todayKey) }
}

export function rangeLabel({ startKey, endKey }, todayKey = jakartaDateKey()) {
  const end = startOfJakartaDay(endKey)
  if (startKey === endKey) return `${startKey === todayKey ? 'Hari ini, ' : ''}${formatDate(end)}`
  return `${formatDateShort(startOfJakartaDay(startKey))} — ${formatDate(end)}`
}

export function previousRangeLabel(range) {
  if (range.preset === 'today') return 'vs kemarin'
  return `vs ${range.days} hari sebelumnya`
}
