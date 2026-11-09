import { useEffect, useMemo, useState } from 'react'
import { AppState } from 'react-native'
import { AuthContext } from './AuthContext.js'
import { supabase, supabaseConfigError } from '../lib/supabase.js'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [error, setError] = useState(supabaseConfigError)

  useEffect(() => {
    if (!supabase) return undefined

    let active = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      setError(null)
    })

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setError(`Sesi tidak dapat dimuat: ${sessionError.message}`)
      else setSession(data.session)
      setLoading(false)
    })

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') supabase.auth.startAutoRefresh()
      else supabase.auth.stopAutoRefresh()
    })

    return () => {
      active = false
      subscription.unsubscribe()
      appStateSubscription.remove()
    }
  }, [])

  const value = useMemo(() => ({ error, loading, session, supabase }), [error, loading, session])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
