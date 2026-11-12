/*
 * Sesi admin platform:
 *   session  → sudah login email + password?
 *   aal      → 'aal1' (baru password) | 'aal2' (sudah lolos 2FA TOTP)
 *   admin    → hasil pa_whoami(): { is_admin, full_name } — status diri sendiri saja
 * Semua halaman dashboard butuh session + aal2 + is_admin. Database juga memeriksa ulang di setiap fungsi.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AuthContext } from './AuthContext.js'
import { supabase, supabaseConfigError } from '../lib/supabase.js'
import { cacheTheme, readCachedTheme, useBrandTheme } from '../lib/brandTheme.js'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [aal, setAal] = useState(null)
  const [admin, setAdmin] = useState(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [authError, setAuthError] = useState(supabaseConfigError)
  // Warna tema platform (file 15). Cache dulu, lalu diperbarui dari database setelah login.
  const [theme, setThemeState] = useState(readCachedTheme)
  useBrandTheme(theme.color, theme.color2)

  const setTheme = useCallback((next) => {
    setThemeState(next)
    cacheTheme(next)
  }, [])

  const refresh = useCallback(async (nextSession) => {
    if (!supabase || !nextSession) {
      setAal(null)
      setAdmin(null)
      return
    }
    const [{ data: level }, { data: who, error: whoError }, { data: savedTheme }] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.rpc('pa_whoami'),
      supabase.rpc('pa_theme'), // null / error sebelum file 15 → tetap tema cache
    ])
    if (savedTheme?.color) setTheme({ color: savedTheme.color, color2: savedTheme.color2 || null })
    setAal(level?.currentLevel || 'aal1')
    if (whoError) {
      setAdmin({ is_admin: false, error: /could not find the function|schema cache/i.test(whoError.message)
        ? 'Fungsi database belum ada. Jalankan file SQL 14 di Supabase.'
        : whoError.message })
    } else {
      setAdmin(who)
    }
  }, [setTheme])

  useEffect(() => {
    if (!supabase) return undefined
    let active = true

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      setAuthError(null)
      // MFA_CHALLENGE_VERIFIED / TOKEN_REFRESHED mengubah aal → baca ulang (di luar callback auth)
      if (event !== 'INITIAL_SESSION') window.setTimeout(() => { if (active) refresh(nextSession) }, 0)
    })

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active) return
      if (error) setAuthError(`Sesi tidak dapat dimuat: ${error.message}`)
      setSession(data.session)
      await refresh(data.session)
      if (active) setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [refresh])

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut()
  }, [])

  const value = useMemo(
    () => ({ admin, aal, authError, loading, refresh: () => refresh(session), session, setTheme, signOut, supabase, theme }),
    [admin, aal, authError, loading, refresh, session, setTheme, signOut, theme],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
