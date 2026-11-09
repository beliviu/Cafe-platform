/*
 * Kafe & branding aplikasi (white-label).
 * - Kafe dipilih dari EXPO_PUBLIC_CAFE_ID (satu build = satu kafe).
 *   Kalau kosong, aplikasi memakai kafe pertama (perilaku lama) — isi variabel ini
 *   sebelum ada lebih dari satu kafe di database.
 * - Nama tampilan, logo, tagline, dan warna brand diambil dari tabel cafes
 *   (kolom dari supabase/usulan/03-branding-kafe.sql). Owner mengubahnya di web.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useAuth } from '../auth/useAuth.js'
import { appTheme } from '../theme/palette.js'
import { ThemeContext } from '../theme/ThemeContext.js'
import { BrandContext } from './BrandContext.js'

const THEME_KEY = 'dailybrew.theme'
export const THEME_PREFERENCES = [
  { value: 'dark', label: 'Gelap' },
  { value: 'light', label: 'Terang' },
  { value: 'system', label: 'Ikuti HP' },
]

const TENANT_CAFE_ID = process.env.EXPO_PUBLIC_CAFE_ID?.trim() || null
const PLATFORM_NAME = process.env.EXPO_PUBLIC_PLATFORM_NAME?.trim() || 'dailybrew'
const BASE_COLUMNS = 'id, name, description, address, phone'
// Dicoba berurutan: kolom terbaru dulu, mundur bila migrasi belum dijalankan.
const COLUMN_SETS = [
  `${BASE_COLUMNS}, opening_hours, app_name, logo_url, tagline, brand_color, brand_color_2`, // file 04
  `${BASE_COLUMNS}, opening_hours, app_name, logo_url, tagline, brand_color`, // file 03
  BASE_COLUMNS,
]

async function fetchCafe(supabase, columns) {
  let query = supabase.from('cafes').select(columns)
  query = TENANT_CAFE_ID ? query.eq('id', TENANT_CAFE_ID) : query.order('name').limit(1)
  return query.maybeSingle()
}

/** Branding + warna dari tema aktif (appTheme). `theme` opsional: tanpa itu tema gelap bawaan. */
export function brandFromCafe(cafe, theme = appTheme({ color: cafe?.brand_color, color2: cafe?.brand_color_2 })) {
  const name = cafe?.app_name?.trim() || cafe?.name?.trim() || PLATFORM_NAME
  const { COLORS } = theme
  return {
    name,
    businessName: cafe?.name?.trim() || name,
    logoUrl: cafe?.logo_url || null,
    tagline: cafe?.tagline?.trim() || '',
    gradient: theme.gradient,
    isGradient: theme.isGradient,
    colors: {
      primary: COLORS.primary,
      primaryPressed: COLORS.primaryPressed,
      primarySoft: COLORS.primarySoft,
      primaryTint: COLORS.primaryTint,
      primaryDeep: COLORS.primaryDeep,
    },
  }
}

export function BrandProvider({ children }) {
  const { supabase } = useAuth()
  const [cafe, setCafe] = useState(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [error, setError] = useState(supabase ? '' : 'Konfigurasi Supabase belum tersedia.')

  const reload = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setError('')
    let result
    for (const columns of COLUMN_SETS) {
      result = await fetchCafe(supabase, columns)
      if (!result.error) break
    }
    if (result.error) setError(`Data kafe gagal dimuat: ${result.error.message}`)
    else setCafe(result.data || null)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    const timer = setTimeout(reload, 0)
    return () => clearTimeout(timer)
  }, [reload])

  // Mode tampilan (per perangkat): gelap bawaan, bisa diganti di Profil
  const scheme = useColorScheme()
  const [preference, setPreferenceState] = useState('dark')
  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((stored) => {
      if (THEME_PREFERENCES.some((item) => item.value === stored)) setPreferenceState(stored)
    }).catch(() => {})
  }, [])
  const setPreference = useCallback((next) => {
    setPreferenceState(next)
    AsyncStorage.setItem(THEME_KEY, next).catch(() => {})
  }, [])
  const mode = preference === 'system' ? (scheme === 'light' ? 'light' : 'dark') : preference
  const theme = useMemo(
    () => ({ ...appTheme({ color: cafe?.brand_color, color2: cafe?.brand_color_2, mode }), preference, setPreference }),
    [cafe?.brand_color, cafe?.brand_color_2, mode, preference, setPreference],
  )

  const value = useMemo(() => ({ cafe, brand: brandFromCafe(cafe, theme), loading, error, reload }), [cafe, error, loading, reload, theme])
  return (
    <ThemeContext.Provider value={theme}>
      <BrandContext.Provider value={value}>{children}</BrandContext.Provider>
    </ThemeContext.Provider>
  )
}
