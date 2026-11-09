/*
 * Design tokens — aplikasi customer (tipografi, ukuran, radius, jarak).
 * Palet: Warm Ivory #F2E9DC · Sand #D8C3A9 · Taupe #B69A7D · Walnut #75543D
 *        Espresso #38271E · Terracotta #B96843
 * Nilai identik dengan web-dashboard/src/styles/tokens.css. Ubah keduanya bersamaan.
 *
 * BRAND = bawaan Walnut. Warna brand pilihan owner (cafes.brand_color) dipakai
 * lewat useBrand() → brand.colors (lihat src/brand/).
 */

import { appTheme } from './palette.js'

/*
 * WARNA tidak lagi statis: dihitung dari warna brand owner + mode gelap/terang (palette.js → appTheme).
 * Di komponen pakai useTheme() / makeStyles() dari theme/useTheme.js.
 * Ekspor di bawah hanya cadangan (tema gelap warna bawaan) untuk kode lama.
 */
const fallback = appTheme({ mode: 'dark' })
export const { COLORS, STATUS_TONES, PALETTE, SHADOW } = fallback
export const BRAND = { 600: COLORS.primary, 700: COLORS.primaryPressed, 100: COLORS.primarySoft, 50: COLORS.primaryTint, 800: COLORS.primaryDeep }
/** @deprecated nama lama, sama dengan BRAND */
export const SAGE = BRAND

/** Nama keluarga font yang didaftarkan di app/_layout.jsx (pilih ketebalan via fontWeight). */
export const FONTS = {
  serif: 'Fraunces',
  sans: 'PlusJakartaSans',
}

export const TYPE = {
  xs: 12,
  sm: 13,
  base: 14,
  md: 15,
  lg: 17,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
}

export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 20, full: 999 }
export const SPACE = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 }
export const TAP_TARGET = 44

export const TABULAR = { fontVariant: ['tabular-nums'] }
