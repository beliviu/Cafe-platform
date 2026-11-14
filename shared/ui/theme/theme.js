/*
 * Mesin tema "Warm Luxury" — dipakai web owner, web staff, dan dashboard platform.
 *
 * Dasar (latar, sidebar, panel, garis, teks) mengikuti HUE warna pilihan (deriveBase); status tetap.
 * Yang berubah hanya AKSEN: dari satu warna pilihan (bawaan Terakota), dihitung otomatis
 *   accent       isian tombol utama (dijaga ≥ 3:1 terhadap panel agar tetap terlihat)
 *   accent-deep  versi lebih gelap (hover, ujung gradien kartu utama)
 *   accent-soft  14% alpha (latar chip, menu aktif)
 *   accent-mid   40% alpha (garis fokus, border tegas)
 *   accent-ink   versi teks yang lolos kontras 4,5:1 terhadap panel & latar lembut
 *   on-accent    teks di atas aksen: gelap atau terang, mana yang kontrasnya lebih tinggi
 *
 * Nama token lama (--surface-*, --brand-*, --status-*) tetap diisi agar halaman lama ikut tema baru.
 * Dokumentasi: DESIGN.md di root repo.
 */

export const DEFAULT_ACCENT = '#C8734A' // Terakota
/** @deprecated nama lama */
export const DEFAULT_THEME_COLOR = DEFAULT_ACCENT

// Preset versi awal + Hijau senja. Memilih preset mewarnai SELURUH tampilan (latar, sidebar, kartu, grafik), bukan hanya tombol.
export const ACCENT_PRESETS = [
  { color: '#C8734A', label: 'Terakota' },
  { color: '#B0805A', label: 'Espresso' },
  { color: '#C9963B', label: 'Emas' },
  { color: '#7F9A5E', label: 'Matcha' },
  { color: '#4F9A8A', label: 'Hijau senja' },
  { color: '#4F86C6', label: 'Samudra' },
  { color: '#7A78C4', label: 'Lavender' },
  { color: '#B0708C', label: 'Mawar' },
  { color: '#8C939C', label: 'Grafit' },
]
/** @deprecated nama lama */
export const THEME_PRESETS = ACCENT_PRESETS

/** Pasangan gradasi serumpun untuk isian tombol utama (opsional, fitur lama owner). */
export const THEME_GRADIENTS = [
  { from: '#C8734A', to: '#C9963B', label: 'Senja' },
  { from: '#C9963B', to: '#C8734A', label: 'Karamel' },
  { from: '#6E9A78', to: '#4F86C6', label: 'Daun teh' },
  { from: '#4F86C6', to: '#9A6BB5', label: 'Senja biru' },
  { from: '#9A6BB5', to: '#C8734A', label: 'Plum hangat' },
]

const HEX = /^#[0-9a-f]{6}$/i
export const isHex = (value) => typeof value === 'string' && HEX.test(value)

/* ---------- Palet dasar (tetap) ---------- */
export const BASE = {
  dark: {
    bg: '#120E0B', sidebar: '#17120F', panel: '#1D1714', panel2: '#272019',
    text: '#F4ECE1', text2: '#BCAB9B', text3: '#9C8A7A',
    hover: '#2C241D', sand: '#372E25', line: '#2B231D', lineDefault: '#3B3128', lineStrong: '#57493D',
    placeholder: '#857567',
    good: '#7FC79A', warn: '#E2B45A', bad: '#F08C7B', info: '#8DB7E6',
    danger: '#B4432F', dangerHover: '#C04A35',
  },
  light: {
    bg: '#F5EFE6', sidebar: '#EFE6DA', panel: '#FFFCF7', panel2: '#F3EADF',
    text: '#2A1E17', text2: '#5E4C3D', text3: '#74604E',
    hover: '#ECE2D4', sand: '#E6DACA', line: '#EBE1D3', lineDefault: '#DDD0BF', lineStrong: '#BBA994',
    placeholder: '#8D7A68',
    good: '#2E7A4A', warn: '#8E600F', bad: '#B4432F', info: '#2F5F96',
    danger: '#B4432F', dangerHover: '#9A3726',
  },
}
const INK_DARK = '#1A120D'
const INK_LIGHT = '#FFFCF7'

/* ---------- Konversi warna (sRGB ⇄ OKLab/OKLCH) ---------- */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}
const rgbToHex = (rgb) => `#${rgb.map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, '0')).join('')}`.toUpperCase()

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
  return rgbToHex(rgb.map((channel) => clamp(toGamma(clamp(channel, 0, 1)), 0, 1) * 255))
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((channel) => toLinear(channel / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Rasio kontras WCAG antara dua warna hex. */
export function contrast(hexA, hexB) {
  const [light, dark] = [luminance(hexA), luminance(hexB)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** Campur dua warna (sRGB). amount = porsi warna kedua, 0–1. Dipakai untuk "alpha di atas panel" versi solid. */
export function mix(hexA, hexB, amount) {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  return rgbToHex(a.map((channel, index) => channel + (b[index] - channel) * amount))
}

export const alpha = (hex, amount) => {
  const [r, g, b] = hexToRgb(hex)
  return `rgb(${r} ${g} ${b} / ${Math.round(amount * 100)}%)`
}

/** Geser lightness (hue & chroma tetap) sampai kontras dengan SEMUA warna `against` ≥ target. */
function towardContrast(hex, against, target, direction) {
  const list = Array.isArray(against) ? against : [against]
  const { l, c, h } = hexToOklch(hex)
  const passes = (color) => list.every((item) => contrast(color, item) >= target)
  let color = hex.toUpperCase()
  for (let step = 1; step <= 60 && !passes(color); step += 1) {
    color = oklch(l + direction * step * 0.0125, c, h)
  }
  return color
}

/** Teks di atas warna isian: gelap atau terang, mana yang kontrasnya lebih tinggi (dijamin ≥ 4,5:1). */
export function onColor(fill) {
  const warm = contrast(INK_DARK, fill) >= contrast(INK_LIGHT, fill) ? INK_DARK : INK_LIGHT
  if (contrast(warm, fill) >= 4.5) return warm
  return contrast('#000000', fill) >= contrast('#FFFFFF', fill) ? '#000000' : '#FFFFFF'
}

/* ---------- Palet dasar mengikuti warna pilihan ---------- */
const NEUTRAL_KEYS = ['bg', 'sidebar', 'panel', 'panel2', 'hover', 'sand', 'line', 'lineDefault', 'lineStrong', 'text', 'text2', 'text3', 'placeholder']
const TEXT_KEYS = new Set(['text', 'text2', 'text3', 'placeholder'])
const DEFAULT_CHROMA = hexToOklch(DEFAULT_ACCENT).c

/**
 * Latar, sidebar, panel, garis, dan teks memakai HUE warna pilihan (lightness tetap seperti palet dasar),
 * jadi memilih hijau membuat seluruh tampilan kehijauan — bukan hanya tombol & grafik.
 * Kekuatan tint mengikuti chroma warna pilihan: warna abu-abu → hampir netral, warna jenuh → tint lebih terasa.
 * Teks sekunder dijaga tetap ≥ 4,5:1 terhadap panel, latar, dan sidebar.
 */
export function deriveBase(color, mode = 'dark') {
  const dark = mode !== 'light'
  const base = BASE[dark ? 'dark' : 'light']
  const seed = isHex(color) ? color.toUpperCase() : DEFAULT_ACCENT
  const { c: seedChroma, h } = hexToOklch(seed)
  const strength = clamp(seedChroma / DEFAULT_CHROMA, 0.12, 1.6) * (dark ? 1.9 : 1.4)
  const out = { ...base }
  for (const key of NEUTRAL_KEYS) {
    const { l, c } = hexToOklch(base[key])
    out[key] = oklch(l, c * strength * (TEXT_KEYS.has(key) ? 0.75 : 1), h)
  }
  const surfaces = [out.panel, out.panel2, out.bg, out.sidebar]
  const direction = dark ? 1 : -1
  out.text = towardContrast(out.text, surfaces, 12, direction)
  out.text2 = towardContrast(out.text2, surfaces, 6, direction)
  out.text3 = towardContrast(out.text3, [...surfaces, out.hover], 4.5, direction)
  out.placeholder = towardContrast(out.placeholder, [out.panel, out.sidebar], 3.2, direction)
  return out
}

/**
 * Turunan aksen untuk satu mode.
 * Hasil: { accent, deep, soft, mid, ink, on, softSolid }
 */
export function deriveAccent(color, mode = 'dark') {
  const dark = mode !== 'light'
  const base = deriveBase(color, mode)
  const seed = isHex(color) ? color.toUpperCase() : DEFAULT_ACCENT
  // Isian harus tetap terlihat di atas panel (kontras non-teks ≥ 3:1)
  const accent = towardContrast(seed, base.panel, 3, dark ? 1 : -1)
  const { l, c, h } = hexToOklch(accent)
  const deep = oklch(l - 0.09, c, h)
  const softSolid = mix(base.panel, accent, 0.14)
  const ink = towardContrast(accent, [base.panel, base.panel2, softSolid], 4.5, dark ? 1 : -1)
  return { accent, deep, soft: alpha(accent, 0.14), mid: alpha(accent, 0.4), ink, on: onColor(accent), softSolid }
}

/**
 * Hitung semua token warna. mode: 'dark' | 'light'.
 * color2 (opsional) = ujung gradasi isian tombol utama (fitur brand owner yang sudah ada).
 * Hasil: { vars, accent, onAccent, chart, mode }
 */
export function buildTheme({ color, color2, mode = 'dark' } = {}) {
  const dark = mode !== 'light'
  const base = deriveBase(color, mode)
  const a = deriveAccent(color, mode)
  const second = isHex(color2) ? towardContrast(color2.toUpperCase(), base.panel, 3, dark ? 1 : -1) : null
  // Gradasi hanya dipakai bila teks di atasnya tetap terbaca di kedua ujung
  const gradientOk = second && contrast(a.on, second) >= 4.5
  const fill = gradientOk ? `linear-gradient(135deg, ${a.accent} 0%, ${second} 100%)` : a.accent
  const tint = (amount) => mix(base.panel, a.accent, amount)

  const status = {}
  for (const [legacy, key] of [['green', 'good'], ['amber', 'warn'], ['red', 'bad'], ['blue', 'info']]) {
    const bg = mix(base.panel, base[key], dark ? 0.15 : 0.12)
    status[legacy] = { bg, fg: towardContrast(base[key], [bg, base.panel], 4.5, dark ? 1 : -1), dot: base[key] }
  }
  status.neutral = { bg: base.panel2, fg: base.text2, dot: base.text3 }

  // Grafik: satu hue aksen, lightness berjenjang (urut dari paling menonjol)
  const { c: ac, h: ah } = hexToOklch(a.accent)
  const chroma = clamp(ac, 0.04, 0.14) * 0.9
  const chart = (dark ? [0.86, 0.76, 0.66, 0.56, 0.47] : [0.36, 0.46, 0.56, 0.66, 0.75]).map((L) => oklch(L, chroma, ah))

  // Latar halaman bergradasi (diagonal + cahaya dari beberapa sudut) dari warna utama, warna kedua (bila ada),
  // dan rona turunannya. Kekuatan diturunkan otomatis bila teks redup jadi kurang terbaca di titik terkuat.
  const { l: al, c: acc } = hexToOklch(a.accent)
  const glowA = a.accent
  const glowB = isHex(color2) ? color2.toUpperCase() : oklch(al, acc, (ah + 50) % 360)
  const glowC = oklch(al, acc * 0.9, (ah + 320) % 360)
  // Gradasi tegas; teks (utama, sekunder, redup) digeser lightness-nya sampai tetap lolos kontras AA di titik terkuat.
  const strength = dark ? 0.5 : 0.42
  const peaks = [glowA, glowB, glowC].map((glow) => mix(base.bg, glow, strength))
  const direction = dark ? 1 : -1
  base.text = towardContrast(base.text, [base.panel, base.panel2, ...peaks], 7, direction)
  base.text2 = towardContrast(base.text2, [base.panel, base.panel2, ...peaks], 4.5, direction)
  base.text3 = towardContrast(base.text3, [base.panel, base.panel2, base.hover, ...peaks], 4.5, direction)
  const s = (factor) => Math.round(strength * factor * 100) / 100
  const pageGradient = [
    `radial-gradient(70% 60% at 0% 0%, ${alpha(glowA, s(1))} 0%, transparent 70%)`,
    `radial-gradient(60% 55% at 100% 10%, ${alpha(glowB, s(0.85))} 0%, transparent 70%)`,
    `radial-gradient(75% 65% at 90% 100%, ${alpha(glowC, s(0.75))} 0%, transparent 72%)`,
    `radial-gradient(55% 50% at 5% 95%, ${alpha(glowB, s(0.5))} 0%, transparent 70%)`,
    `linear-gradient(155deg, ${mix(base.bg, glowA, s(0.35))} 0%, ${base.bg} 48%, ${mix(base.bg, glowB, s(0.3))} 100%)`,
  ].join(', ')

  const shadowInk = dark ? '#000000' : mix(base.text, '#000000', 0.2)
  const vars = {
    // ---- Token baru ----
    '--bg': base.bg,
    '--page-gradient': pageGradient,
    '--sidebar': base.sidebar,
    '--panel': base.panel,
    '--panel-2': base.panel2,
    '--text': base.text,
    '--text-2': base.text2,
    '--text-3': base.text3,
    '--line': base.line,
    '--line-strong': base.lineDefault,
    '--accent': a.accent,
    '--accent-deep': a.deep,
    '--accent-soft': a.soft,
    '--accent-mid': a.mid,
    '--accent-ink': a.ink,
    '--on-accent': a.on,
    '--accent-fill': fill,
    '--good': status.green.fg,
    '--warn': status.amber.fg,
    '--bad': status.red.fg,
    '--info': status.blue.fg,
    '--good-soft': status.green.bg,
    '--warn-soft': status.amber.bg,
    '--bad-soft': status.red.bg,
    '--info-soft': status.blue.bg,
    '--overlay': alpha(dark ? '#000000' : base.text, dark ? 0.48 : 0.34),
    '--shadow-hover': `0 10px 28px -12px ${alpha(shadowInk, dark ? 0.7 : 0.28)}`,
    '--shadow-overlay': `0 24px 60px -18px ${alpha(shadowInk, dark ? 0.8 : 0.34)}, 0 2px 8px ${alpha(shadowInk, dark ? 0.4 : 0.08)}`,

    // ---- Nama lama (halaman yang belum dimigrasi) ----
    '--surface-canvas': base.bg,
    '--surface-card': base.panel,
    '--surface-raised': dark ? base.panel2 : base.panel,
    '--surface-sunken': dark ? base.sidebar : base.panel2,
    '--surface-hover': base.hover,
    '--surface-sand': base.sand,
    '--surface-field': dark ? base.sidebar : base.panel,
    '--surface-overlay': alpha(dark ? '#000000' : base.text, dark ? 0.48 : 0.34),
    '--canvas-glow': 'transparent',
    '--nav-bg': base.sidebar,
    '--nav-panel': base.sidebar,
    '--nav-panel-top': base.sidebar,
    '--nav-text': base.text,
    '--nav-text-muted': base.text2,
    '--nav-hover': dark ? base.panel2 : base.hover,
    '--nav-active': a.soft,
    '--nav-border': base.line,
    '--nav-glow': 'transparent',
    '--nav-accent': a.ink,
    '--on-dark': '#F4ECE1',
    '--text-primary': base.text,
    '--text-secondary': base.text2,
    '--text-muted': base.text3,
    '--text-placeholder': base.placeholder,
    '--text-on-primary': a.on,
    '--on-brand-muted': alpha(a.on, 0.78),
    '--text-link': a.ink,
    '--border-subtle': base.line,
    '--border-default': base.lineDefault,
    '--border-strong': base.lineStrong,
    '--brand-fill': fill,
    '--brand-solid': a.accent,
    '--accent-100': status.amber.bg,
    '--accent-500': status.amber.dot,
    '--accent-700': status.amber.fg,
    '--danger': base.danger,
    '--danger-hover': base.dangerHover,
    '--danger-soft-hover': mix(base.panel, base.bad, dark ? 0.24 : 0.2),
    '--skeleton-shine': dark ? base.hover : base.panel,
    '--shadow-sm': 'none',
    '--shadow-md': `0 10px 28px -12px ${alpha(shadowInk, dark ? 0.7 : 0.28)}`,
    '--shadow-lg': `0 24px 60px -18px ${alpha(shadowInk, dark ? 0.8 : 0.34)}, 0 2px 8px ${alpha(shadowInk, dark ? 0.4 : 0.08)}`,
    '--ivory': '#F4ECE1',
    '--sand': dark ? base.text2 : base.sand,
    '--taupe': base.text3,
    '--walnut': a.accent,
    '--espresso': dark ? base.sidebar : mix(base.text, '#000000', 0.3),
    '--brand-50': tint(0.08),
    '--brand-100': a.softSolid,
    '--brand-200': tint(0.24),
    '--brand-300': tint(0.4),
    '--brand-400': tint(0.65),
    '--brand-500': a.accent,
    '--brand-600': a.accent,
    '--brand-700': a.ink,
    '--brand-800': mix(a.ink, base.text, 0.35),
    '--brand-900': mix(a.ink, base.text, 0.65),
  }
  for (const [key, value] of Object.entries(status)) {
    vars[`--status-${key}-bg`] = value.bg
    vars[`--status-${key}-fg`] = value.fg
    vars[`--status-${key}-dot`] = value.dot
  }
  chart.forEach((value, index) => { vars[`--chart-${index + 1}`] = value })
  return { vars, accent: a.accent, primary: a.accent, onAccent: a.on, onPrimary: a.on, secondStop: gradientOk ? second : null, chart, mode: dark ? 'dark' : 'light' }
}

/** Pasang token warna ke <html> (dipanggil saat aksen atau mode berubah). */
export function applyTheme({ color, color2, mode }) {
  if (typeof document === 'undefined') return null
  const theme = buildTheme({ color, color2, mode })
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme.vars)) root.style.setProperty(key, value)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.vars['--sidebar'])
  return theme
}
