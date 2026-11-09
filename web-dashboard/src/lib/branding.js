/*
 * Branding kafe (white-label): nama tampilan, logo, tagline, warna brand.
 * Kolom ada di tabel cafes setelah supabase/usulan/03-branding-kafe.sql.
 * Logo disimpan di bucket storage 'cafe-assets' pada folder <cafe_id>/.
 */
import { useEffect, useState } from 'react'
import { PLATFORM_NAME, TENANT_CAFE_ID } from '../config/platform.js'
import { buildTheme } from './theme.js'
import { useThemeMode } from './themeMode.js'
import { BRANDING_CAFE_COLUMNS, friendlyError } from './db.js'

const BUCKET = 'cafe-assets'
const CACHE_KEY = 'dailybrew.brand'
const DEFAULT_FAVICON = '/favicon.svg'

/** Bentuk branding yang dipakai UI. Selalu punya `name`. */
export function brandOf(cafe) {
  const name = cafe?.app_name?.trim() || cafe?.name?.trim() || PLATFORM_NAME
  return {
    name,
    businessName: cafe?.name?.trim() || name,
    logoUrl: cafe?.logo_url || null,
    tagline: cafe?.tagline?.trim() || '',
    color: cafe?.brand_color || null,
    color2: cafe?.brand_color_2 || null,
  }
}

/* ---------- Cache per browser: login page bisa tampil dengan logo terakhir ---------- */

export function readCachedBrand() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function cacheBrand(brand) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(brand))
  } catch {
    // localStorage bisa diblokir — abaikan, hanya kenyamanan.
  }
}

/* ---------- Judul tab & favicon ---------- */

function setFavicon(href) {
  let link = document.querySelector('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.type = href === DEFAULT_FAVICON ? 'image/svg+xml' : ''
  link.href = href
}

/**
 * Warna brand owner + mode (gelap/terang) → seluruh token warna di <html> (lib/theme.js).
 * Tanpa warna kustom: tema bawaan "Espresso". Saat dilepas, kembali ke nilai statis tokens.css.
 */
export function useBrandTheme(color, color2) {
  const { mode } = useThemeMode()
  useEffect(() => {
    const root = document.documentElement
    const { vars, primary } = buildTheme({ color, color2, mode })
    for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--nav-bg'] || primary)
    return () => {
      for (const key of Object.keys(vars)) root.style.removeProperty(key)
    }
  }, [color, color2, mode])
}

/** Pasang judul tab, favicon, dan warna brand. `section` mis. "Owner" atau "Staff". */
export function useDocumentBranding(brand, section) {
  const name = brand?.name
  const logoUrl = brand?.logoUrl
  useBrandTheme(brand?.color, brand?.color2)
  useEffect(() => {
    if (!name) return undefined
    const previousTitle = document.title
    document.title = section ? `${name} · ${section}` : name
    setFavicon(logoUrl || DEFAULT_FAVICON)
    return () => {
      document.title = previousTitle
      setFavicon(DEFAULT_FAVICON)
    }
  }, [logoUrl, name, section])
}

/**
 * Branding untuk halaman publik (login) sebelum ada sesi.
 * Urutan: kafe dari VITE_CAFE_ID → cache browser → nama platform.
 */
export function usePublicBrand(supabase) {
  const [brand, setBrand] = useState(() => readCachedBrand() || brandOf(null))

  useEffect(() => {
    if (!supabase || !TENANT_CAFE_ID) return undefined
    let active = true
    supabase
      .from('cafes')
      .select(`id, name, ${BRANDING_CAFE_COLUMNS}`)
      .eq('id', TENANT_CAFE_ID)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (!active) return
        if (!error) {
          if (data) setBrand(brandOf(data))
          return
        }
        // Kolom branding belum ada (file 03 belum dijalankan) → cukup nama kafe.
        const fallback = await supabase.from('cafes').select('id, name').eq('id', TENANT_CAFE_ID).maybeSingle()
        if (active && fallback.data) setBrand(brandOf(fallback.data))
      })
    return () => { active = false }
  }, [supabase])

  return brand
}

/* ---------- Tulis (owner) ---------- */

export function cafeAssetPath(url) {
  if (!url) return null
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const index = url.indexOf(marker)
  return index < 0 ? null : decodeURIComponent(url.slice(index + marker.length))
}

/** Unggah logo (sudah di-crop persegi). Mengembalikan URL publik. */
export function uploadCafeLogo(supabase, cafeId, file) {
  return uploadCafeAsset(supabase, cafeId, file, 'logo')
}

/** Unggah gambar kafe (logo, QRIS, ...) ke cafe-assets/<cafe_id>/<prefix>-<uuid>. */
export async function uploadCafeAsset(supabase, cafeId, file, prefix) {
  const extension = file.type === 'image/webp' ? 'webp' : file.type === 'image/png' ? 'png' : 'jpg'
  const path = `${cafeId}/${prefix}-${crypto.randomUUID()}.${extension}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '31536000',
    contentType: file.type,
    upsert: false,
  })
  if (error) throw new Error(`Gambar gagal diunggah: ${friendlyError(error)}`)
  return { path, url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl }
}

export async function removeCafeAsset(supabase, url) {
  const path = cafeAssetPath(url)
  if (!path) return null
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  return error
}
