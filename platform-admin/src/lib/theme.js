// Salinan dari web-dashboard/src/lib/theme.js — sinkronkan manual bila aslinya berubah.
/*
 * Mesin tema white-label (OKLCH).
 * Dari SATU warna brand pilihan owner (+ warna kedua opsional untuk gradasi), seluruh palet dihitung:
 * rail & panel sidebar, latar, kartu, garis, teks, tombol, status, dan warna grafik — mode gelap & terang.
 * Semua turunan memakai hue yang sama dengan lightness berbeda, jadi tampak "beda warna" tapi serumpun.
 * Kontras teks dijaga otomatis (WCAG AA). Salinan logika ada di mobile-customer/src/theme/palette.js.
 */

export const DEFAULT_THEME_COLOR = '#B0805A' // karamel espresso
const HEX = /^#[0-9a-f]{6}$/i
export const isHex = (value) => typeof value === 'string' && HEX.test(value)

/* ---------- Konversi warna (sRGB ⇄ OKLab/OKLCH) ---------- */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

export function hexToOklch(hex) {
  const [r, g, b] = hexToRgb(hex).map((channel) => toLinear(channel / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 }
}

function oklchToLinear(L, C, H) {
  const a = C * Math.cos((H * Math.PI) / 180)
  const b = C * Math.sin((H * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ]
}

const inGamut = (rgb) => rgb.every((channel) => channel >= -0.0005 && channel <= 1.0005)

/** OKLCH → hex. Di luar gamut sRGB: chroma dikurangi (hue & lightness tetap). */
export function oklch(L, C, H) {
  const lightness = clamp(L, 0, 1)
  let chroma = Math.max(0, C)
  let rgb = oklchToLinear(lightness, chroma, H)
  if (!inGamut(rgb)) {
    let low = 0
    let high = chroma
    for (let step = 0; step < 18; step += 1) {
      chroma = (low + high) / 2
      if (inGamut(oklchToLinear(lightness, chroma, H))) low = chroma
      else high = chroma
    }
    rgb = oklchToLinear(lightness, low, H)
  }
  return `#${rgb.map((channel) => Math.round(clamp(toGamma(clamp(channel, 0, 1)), 0, 1) * 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((channel) => toLinear(channel / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(hexA, hexB) {
  const [light, dark] = [luminance(hexA), luminance(hexB)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** Geser lightness warna (hue & chroma tetap) sampai kontras dengan `against` ≥ target. */
function towardContrast(hex, against, target, direction) {
  const { l, c, h } = hexToOklch(hex)
  let color = hex.toUpperCase()
  for (let step = 1; step <= 40 && contrast(color, against) < target; step += 1) {
    color = oklch(l + direction * step * 0.0125, c, h)
  }
  return color
}

const alpha = (hex, amount) => {
  const [r, g, b] = hexToRgb(hex)
  return `rgb(${r} ${g} ${b} / ${Math.round(amount * 100)}%)`
}

/* ---------- Pilihan cepat di Pengaturan → Brand ---------- */
export const THEME_PRESETS = [
  { color: '#B0805A', label: 'Espresso' },
  { color: '#C0694A', label: 'Terakota' },
  { color: '#C2A04E', label: 'Emas' },
  { color: '#7F9A5E', label: 'Matcha' },
  { color: '#4F8AA8', label: 'Samudra' },
  { color: '#7A78C4', label: 'Lavender' },
  { color: '#B0708C', label: 'Mawar' },
  { color: '#8C939C', label: 'Grafit' },
]

/** Pasangan gradasi serumpun (hue berdekatan) — tidak terlihat "pelangi". */
export const THEME_GRADIENTS = [
  { from: '#B0805A', to: '#C0694A', label: 'Kopi senja' },
  { from: '#C2A04E', to: '#B0805A', label: 'Karamel emas' },
  { from: '#7F9A5E', to: '#4F9A8A', label: 'Daun teh' },
  { from: '#4F8AA8', to: '#7A78C4', label: 'Senja biru' },
  { from: '#B0708C', to: '#C0694A', label: 'Ros merah' },
]

const STATUS_HUES = { amber: 75, blue: 245, green: 150, red: 27 }
const LIGHT_STATUS = {
  amber: { bg: '#FBF0DC', fg: '#8A5A0B', dot: '#D99A2B' },
  blue: { bg: '#E5EEF7', fg: '#2F5D8A', dot: '#5B8BC0' },
  green: { bg: '#E3F1E5', fg: '#2E6B3D', dot: '#4C9A5F' },
  red: { bg: '#F9E7E3', fg: '#9B3B2C', dot: '#D0705F' },
}

/**
 * Hitung semua token warna. mode: 'dark' | 'light'.
 * Hasil: { vars: { '--surface-canvas': '#…', … }, primary, onPrimary, chart: [...] }
 */
export function buildTheme({ color, color2, mode = 'dark' } = {}) {
  const dark = mode !== 'light'
  const seed = isHex(color) ? color.toUpperCase() : DEFAULT_THEME_COLOR
  const base = hexToOklch(seed)
  const gray = base.c < 0.02
  const h = gray ? 60 : base.h
  const bc = gray ? 0.012 : clamp(base.c, 0.05, 0.15) // chroma skala brand
  const nc = gray ? 0.004 : clamp(base.c * 0.13, 0.006, 0.018) // chroma netral (latar & garis)
  const n = (L, k = 1) => oklch(L, nc * k, h)
  const t = (L, k) => oklch(L, bc * k, h)

  // Netral
  const surface = dark
    ? { canvas: n(0.165), card: n(0.205), raised: n(0.232), sunken: n(0.185), hover: n(0.245), sand: n(0.27) }
    : { canvas: n(0.962), card: n(0.99, 0.45), raised: n(0.995, 0.3), sunken: n(0.935), hover: n(0.945), sand: n(0.905) }
  const line = dark
    ? { subtle: n(0.252), default: n(0.3), strong: n(0.39) }
    : { subtle: n(0.905), default: n(0.87), strong: n(0.79) }
  const ink = dark ? n(0.955, 0.5) : n(0.24, 1.5)
  // Teks sekunder & redup: dijamin ≥ 4.6:1 di permukaan tergelap/terang yang dipakai
  const worst = dark ? surface.hover : surface.sunken
  const secondary = towardContrast(dark ? n(0.8, 0.7) : n(0.4, 1.2), worst, 7, dark ? 1 : -1)
  const muted = towardContrast(dark ? n(0.68, 0.7) : n(0.51, 1), worst, 4.6, dark ? 1 : -1)
  const placeholder = dark ? n(0.56, 0.6) : n(0.64, 0.8)

  // Sidebar: rail paling gelap, panel sedikit lebih terang — gelap di kedua mode
  const nav = dark
    ? { rail: n(0.13, 1.2), panel: n(0.18, 1.1), panelTop: t(0.225, 0.2), border: n(0.25), hover: n(0.235), active: t(0.28, 0.32) }
    : { rail: n(0.205, 1.6), panel: n(0.245, 1.5), panelTop: t(0.29, 0.25), border: n(0.33, 1.2), hover: n(0.3, 1.3), active: t(0.36, 0.38) }
  const navText = n(0.955, 0.4)
  const navMuted = towardContrast(n(0.72, 0.6), nav.active, 4.6, 1)

  // Warna utama: warna owner, disesuaikan agar menonjol & teksnya terbaca di mode ini
  const darkInk = n(0.17, 1.2)
  const adapt = (hex) => (dark ? towardContrast(hex, darkInk, 6.5, 1) : towardContrast(hex, '#FFFFFF', 4.6, -1))
  const primary = adapt(seed)
  const secondStop = isHex(color2) ? adapt(color2.toUpperCase()) : null
  const onPrimary = dark ? darkInk : n(0.995, 0.3)
  const fill = secondStop ? `linear-gradient(135deg, ${primary} 0%, ${secondStop} 100%)` : primary

  // Skala brand semantik: 50–300 = latar tint, 400–600 = isian, 700–900 = teks di atas tint
  const scale = dark
    ? { 50: t(0.215, 0.22), 100: t(0.25, 0.32), 200: t(0.31, 0.42), 300: t(0.4, 0.55), 400: t(0.52, 0.7), 500: t(0.63, 0.85), 600: primary, 700: t(0.8, 0.6), 800: t(0.86, 0.45), 900: t(0.92, 0.3) }
    : { 50: t(0.972, 0.12), 100: t(0.935, 0.22), 200: t(0.87, 0.35), 300: t(0.78, 0.5), 400: t(0.67, 0.65), 500: t(0.57, 0.8), 600: primary, 700: t(0.44, 0.75), 800: t(0.37, 0.6), 900: t(0.3, 0.45) }
  scale[700] = towardContrast(scale[700], scale[100], 4.6, dark ? 1 : -1)
  scale[800] = towardContrast(scale[800], scale[100], 6, dark ? 1 : -1)

  // Aksen: hue warna kedua, atau tetangga hangat dari hue brand
  const ah = isHex(color2) ? hexToOklch(color2).h : (h + 32) % 360
  const accent = dark
    ? { 100: oklch(0.27, 0.05, ah), 500: oklch(0.72, 0.13, ah), 700: oklch(0.84, 0.09, ah) }
    : { 100: oklch(0.93, 0.04, ah), 500: oklch(0.62, 0.14, ah), 700: oklch(0.47, 0.12, ah) }

  // Status (selalu hue tetap; mode gelap = latar gelap bernuansa, teks terang)
  const status = {}
  for (const [key, hue] of Object.entries(STATUS_HUES)) {
    status[key] = dark
      ? { bg: oklch(0.275, 0.045, hue), fg: oklch(0.85, 0.1, hue), dot: oklch(0.72, 0.14, hue) }
      : LIGHT_STATUS[key]
  }
  status.neutral = dark ? { bg: n(0.27), fg: n(0.84, 0.6), dot: n(0.62) } : { bg: n(0.925), fg: n(0.4, 1.2), dot: n(0.62) }
  const danger = dark ? oklch(0.56, 0.17, 27) : '#A5402F'
  const dangerHover = dark ? oklch(0.5, 0.16, 27) : '#8C3426'

  // Grafik: satu hue, lightness berjenjang (gelap→terang di mode terang, terang→gelap di mode gelap)
  const chartL = dark ? [0.87, 0.77, 0.67, 0.57, 0.48] : [0.35, 0.45, 0.55, 0.65, 0.74]
  const chart = chartL.map((L) => oklch(L, bc * 0.85, h))

  const shadowInk = dark ? '#000000' : n(0.2, 1.5)
  const vars = {
    '--surface-canvas': surface.canvas,
    '--surface-card': surface.card,
    '--surface-raised': surface.raised,
    '--surface-sunken': surface.sunken,
    '--surface-hover': surface.hover,
    '--surface-sand': surface.sand,
    '--surface-field': dark ? surface.sunken : surface.card,
    '--surface-overlay': alpha(dark ? '#000000' : n(0.18, 1.5), dark ? 0.62 : 0.46),
    '--canvas-glow': alpha(primary, dark ? 0.07 : 0.09),
    '--nav-bg': nav.rail,
    '--nav-panel': nav.panel,
    '--nav-panel-top': nav.panelTop,
    '--nav-text': navText,
    '--nav-text-muted': navMuted,
    '--nav-hover': nav.hover,
    '--nav-active': nav.active,
    '--nav-border': nav.border,
    '--nav-glow': alpha(primary, 0.22),
    '--nav-accent': t(0.84, 0.5),
    '--on-dark': navText,
    '--text-primary': ink,
    '--text-secondary': secondary,
    '--text-muted': muted,
    '--text-placeholder': placeholder,
    '--text-on-primary': onPrimary,
    '--on-brand-muted': alpha(onPrimary, 0.76),
    '--text-link': scale[700],
    '--border-subtle': line.subtle,
    '--border-default': line.default,
    '--border-strong': line.strong,
    '--brand-fill': fill,
    '--brand-solid': primary,
    '--accent-100': accent[100],
    '--accent-500': accent[500],
    '--accent-700': accent[700],
    '--danger': danger,
    '--danger-hover': dangerHover,
    '--danger-soft-hover': dark ? oklch(0.32, 0.06, 27) : '#F4D9D3',
    '--skeleton-shine': dark ? n(0.27) : n(0.975, 0.4),
    '--shadow-sm': `0 1px 2px ${alpha(shadowInk, dark ? 0.4 : 0.05)}`,
    '--shadow-md': `0 6px 18px ${alpha(shadowInk, dark ? 0.38 : 0.08)}`,
    '--shadow-lg': `0 20px 50px ${alpha(shadowInk, dark ? 0.55 : 0.16)}`,
    '--ivory': dark ? n(0.94, 0.6) : n(0.94, 1.2),
    '--sand': t(0.8, 0.35),
    '--taupe': t(0.68, 0.45),
    '--walnut': primary,
    '--espresso': n(0.18, 1.4),
  }
  for (const [step, value] of Object.entries(scale)) vars[`--brand-${step}`] = value
  for (const [key, value] of Object.entries(status)) {
    vars[`--status-${key}-bg`] = value.bg
    vars[`--status-${key}-fg`] = value.fg
    vars[`--status-${key}-dot`] = value.dot
  }
  chart.forEach((value, index) => { vars[`--chart-${index + 1}`] = value })
  return { vars, primary, onPrimary, secondStop, chart, mode: dark ? 'dark' : 'light' }
}
