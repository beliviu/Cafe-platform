/* Preferensi papan staff (per perangkat, disimpan di browser). */
const KEY = 'dailybrew.staff.prefs'

export const DEFAULT_STAFF_PREFS = { warnMinutes: 5, lateMinutes: 10, sound: true }

export function loadStaffPrefs() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) || '{}')
    const prefs = { ...DEFAULT_STAFF_PREFS, ...stored }
    prefs.warnMinutes = Math.min(60, Math.max(1, Number(prefs.warnMinutes) || DEFAULT_STAFF_PREFS.warnMinutes))
    prefs.lateMinutes = Math.min(120, Math.max(prefs.warnMinutes + 1, Number(prefs.lateMinutes) || DEFAULT_STAFF_PREFS.lateMinutes))
    prefs.sound = prefs.sound !== false
    return prefs
  } catch {
    return { ...DEFAULT_STAFF_PREFS }
  }
}

export function saveStaffPrefs(prefs) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // abaikan (mode privat)
  }
}

/** normal | warn | late */
export function waitTone(minutes, prefs) {
  if (minutes >= prefs.lateMinutes) return 'late'
  if (minutes >= prefs.warnMinutes) return 'warn'
  return 'normal'
}
