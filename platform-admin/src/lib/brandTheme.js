/*
 * Tema dashboard platform: satu warna (+ warna kedua opsional) → semua token warna (lib/theme.js),
 * sama seperti web owner & app customer. Warna disimpan di platform_settings (berlaku untuk semua admin)
 * dan disalin ke localStorage agar layar pertama langsung berwarna benar (tanpa kedip).
 */
import { useEffect } from 'react'
import { applyTheme, DEFAULT_THEME_COLOR, isHex } from './theme.js'
import { useThemeMode } from './themeMode.js'

const CACHE_KEY = 'dailybrew.platform.brand'

export function readCachedTheme() {
  try {
    const value = JSON.parse(window.localStorage.getItem(CACHE_KEY) || 'null')
    if (value && isHex(value.color)) return { color: value.color, color2: isHex(value.color2) ? value.color2 : null }
  } catch {
    // localStorage diblokir / rusak — pakai bawaan
  }
  return { color: DEFAULT_THEME_COLOR, color2: null }
}

export function cacheTheme(theme) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ color: theme.color, color2: theme.color2 || null }))
  } catch {
    // abaikan — hanya kenyamanan
  }
}

/** Pasang token warna ke <html>; ikut berubah saat mode gelap/terang diganti. */
export function useBrandTheme(color, color2) {
  const { mode } = useThemeMode()
  useEffect(() => {
    applyTheme({ color: isHex(color) ? color : DEFAULT_THEME_COLOR, color2: isHex(color2) ? color2 : undefined, mode })
  }, [color, color2, mode])
}
