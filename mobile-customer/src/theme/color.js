/*
 * Utilitas warna brand (white-label).
 * Owner boleh memilih warna brand apa pun. Agar teks tetap terbaca (WCAG AA), warna itu
 * otomatis digelapkan sampai teks putih di atasnya mencapai kontras ≥ 4,5:1.
 * Salinan dari web-dashboard/src/lib/color.js — ubah keduanya bersamaan.
 */

export const DEFAULT_BRAND_COLOR = '#75543D' // Walnut

/** Pilihan cepat di Pengaturan → Brand. Semuanya lolos kontras dengan teks putih. */
export const BRAND_COLOR_PRESETS = [
  { value: '#75543D', label: 'Walnut' },
  { value: '#38271E', label: 'Espresso' },
  { value: '#9A5232', label: 'Terracotta' },
  { value: '#5C6B4E', label: 'Zaitun' },
  { value: '#3F5A66', label: 'Teal tua' },
  { value: '#6B3F4A', label: 'Anggur' },
]

const HEX = /^#[0-9a-f]{6}$/i

export function isHexColor(value) {
  return typeof value === 'string' && HEX.test(value)
}

function toRgb(hex) {
  const value = parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function toHex(rgb) {
  return `#${rgb.map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

/** Campur dua warna. amount = porsi warna kedua (0–1). */
export function mix(hexA, hexB, amount) {
  const a = toRgb(hexA)
  const b = toRgb(hexB)
  return toHex(a.map((channel, index) => channel + (b[index] - channel) * amount))
}

function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(hexA, hexB) {
  const [light, dark] = [luminance(hexA), luminance(hexB)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** Gelapkan warna sedikit demi sedikit sampai kontras dengan `against` ≥ `target`. */
export function ensureContrast(hex, against = '#FFFFFF', target = 4.5) {
  let color = isHexColor(hex) ? hex.toUpperCase() : DEFAULT_BRAND_COLOR
  for (let step = 0; step < 20 && contrastRatio(color, against) < target; step += 1) {
    color = mix(color, '#1A120D', 0.08)
  }
  return color
}

/**
 * Skala warna brand 50–900 dari satu warna. 600 = warna tombol utama (sudah lolos kontras).
 * Dipasang sebagai CSS variable --brand-50 … --brand-900.
 */
export function brandScale(hex) {
  const base = ensureContrast(hex)
  const ivory = '#FFFBF5'
  return {
    50: mix(base, ivory, 0.92),
    100: mix(base, ivory, 0.84),
    200: mix(base, ivory, 0.68),
    300: mix(base, ivory, 0.5),
    400: mix(base, ivory, 0.32),
    500: mix(base, ivory, 0.14),
    600: base,
    700: mix(base, '#140D09', 0.18),
    800: mix(base, '#140D09', 0.34),
    900: mix(base, '#140D09', 0.5),
  }
}

/** Info untuk ditampilkan di form: warna akhir & apakah digelapkan otomatis. */
export function describeBrandColor(hex) {
  if (!isHexColor(hex)) return null
  const adjusted = ensureContrast(hex)
  return { adjusted, changed: adjusted !== hex.toUpperCase(), ratio: contrastRatio(adjusted, '#FFFFFF') }
}

/**
 * Pasangan gradasi pilihan. Kedua ujung lolos kontras dengan teks putih,
 * dan pasangan dipilih yang serumpun agar tidak terlihat "pelangi".
 */
export const BRAND_GRADIENT_PRESETS = [
  { from: '#75543D', to: '#9A5232', label: 'Kayu senja' },
  { from: '#38271E', to: '#75543D', label: 'Espresso' },
  { from: '#9A5232', to: '#6B3F4A', label: 'Terakota anggur' },
  { from: '#5C6B4E', to: '#3F5A66', label: 'Hutan' },
  { from: '#38271E', to: '#3F5A66', label: 'Malam' },
]

/** Isian CSS untuk --brand-fill: solid (1 warna) atau gradasi diagonal (2 warna). */
export function brandFill(color, color2) {
  const from = ensureContrast(isHexColor(color) ? color : DEFAULT_BRAND_COLOR)
  if (!isHexColor(color2)) return from
  return `linear-gradient(135deg, ${from} 0%, ${ensureContrast(color2)} 100%)`
}
