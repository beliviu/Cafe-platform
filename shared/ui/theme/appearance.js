/*
 * Preferensi tampilan per browser (bukan per kafe): sudut kartu & animasi.
 *   <html data-radius="soft|sharp" data-motion="on|off">
 * - data-motion="off" mematikan SEMUA animasi & transisi (lihat styles/base.css).
 * - prefers-reduced-motion dari sistem selalu dihormati, apa pun pilihan di sini.
 * index.html memasang kedua atribut sebelum React jalan.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'dailybrew.appearance'
export const RADIUS_OPTIONS = [
  { value: 'soft', label: 'Lembut' },
  { value: 'sharp', label: 'Tegas' },
]

const listeners = new Set()
const reducedQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null

function read() {
  const fallback = { radius: 'soft', motion: true }
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) || 'null')
    if (!value) return fallback
    return { radius: value.radius === 'sharp' ? 'sharp' : 'soft', motion: value.motion !== false }
  } catch {
    return fallback
  }
}

let state = typeof window === 'undefined' ? { radius: 'soft', motion: true } : read()

function apply() {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.radius = state.radius
  document.documentElement.dataset.motion = state.motion ? 'on' : 'off'
}

export function setAppearance(patch) {
  state = { ...state, ...patch }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // abaikan — hanya kenyamanan
  }
  apply()
  listeners.forEach((listener) => listener())
}

/** Boleh menjalankan animasi berbasis JS (hitung naik, garis tergambar)? */
export function motionEnabled() {
  return state.motion && !reducedQuery?.matches
}

reducedQuery?.addEventListener?.('change', () => listeners.forEach((listener) => listener()))

const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
const snapshot = () => state

/** { radius, motion, animate, set } — animate = motion aktif DAN sistem tidak meminta kurangi gerakan. */
export function useAppearance() {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot)
  const systemReduced = useSyncExternalStore(subscribe, () => Boolean(reducedQuery?.matches), () => false)
  return { ...current, systemReduced, animate: current.motion && !systemReduced, set: setAppearance }
}

apply()
