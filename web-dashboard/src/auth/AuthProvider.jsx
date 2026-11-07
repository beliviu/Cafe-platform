import { useEffect, useMemo, useState } from 'react'
import { AuthContext } from './AuthContext.js'
import { supabase, supabaseConfigError } from '../lib/supabase.js'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [authError, setAuthError] = useState(supabaseConfigError)

  useEffect(() => {
    if (!supabase) return undefined

    let active = true
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        setSession(nextSession)
        setAuthError(null)
      }
    })

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) {
        setAuthError(`Sesi tidak dapat dimuat: ${error.message}`)
      } else {
        setSession(data.session)
      }
      setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const value = useMemo(
    () => ({ authError, loading, session, supabase }),
    [authError, loading, session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
