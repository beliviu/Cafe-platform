// Salinan dari web-dashboard/src/lib/themeMode.js — sinkronkan manual bila aslinya berubah.
/*
 * Mode tampilan web: gelap, terang, atau ikuti perangkat. Pilihan per browser (bukan per kafe),
 * disimpan di localStorage. index.html memasang data-theme sebelum React jalan agar tidak berkedip.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'dailybrew.theme'
export const THEME_PREFERENCES = [
  { value: 'dark', label: 'Gelap' },
  { value: 'light', label: 'Terang' },
  { value: 'system', label: 'Ikuti perangkat' },
]

const listeners = new Set()
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

function readPreference() {
  try {
    const value = window.localStorage.getItem(KEY)
    if (THEME_PREFERENCES.some((item) => item.value === value)) return value
  } catch {
    // localStorage diblokir — pakai bawaan
  }
  return 'dark'
}

const resolve = (preference) => (preference === 'system' ? (media?.matches ? 'dark' : 'light') : preference)

let state = typeof window === 'undefined' ? { preference: 'dark', mode: 'dark' } : { preference: readPreference(), mode: resolve(readPreference()) }

function apply() {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = state.mode
}

function emit() {
  apply()
  listeners.forEach((listener) => listener())
}

media?.addEventListener?.('change', () => {
  if (state.preference !== 'system') return
  state = { ...state, mode: resolve('system') }
  emit()
})

export function setThemePreference(preference) {
  try {
    window.localStorage.setItem(KEY, preference)
  } catch {
    // abaikan
  }
  state = { preference, mode: resolve(preference) }
  emit()
}

export function toggleThemeMode() {
  setThemePreference(state.mode === 'dark' ? 'light' : 'dark')
}

const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
const snapshot = () => state

/** { preference, mode, setPreference, toggle } — ikut berubah saat mode diganti di mana pun. */
export function useThemeMode() {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot)
  return { ...current, setPreference: setThemePreference, toggle: toggleThemeMode }
}

apply()
