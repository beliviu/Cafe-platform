import { useEffect, useState } from 'react'
import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { OWNER_NAVIGATION } from '../config/ownerNavigation.js'
import { LoadingScreen } from './LoadingScreen.jsx'
import { AccessState } from './shell/AccessState.jsx'
import { AppShell } from './shell/AppShell.jsx'
import { cafeColumns, detectDbFeatures } from '../lib/db.js'

export function OwnerLayout() {
  const { session, supabase } = useAuth()
  const navigate = useNavigate()
  const [ownerData, setOwnerData] = useState(null)
  const [profileRole, setProfileRole] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [signOutError, setSignOutError] = useState('')
  const [loadingAttempt, setLoadingAttempt] = useState(0)

  useEffect(() => {
    if (!supabase || !session?.user?.id) return undefined

    let active = true

    async function loadOwnerCafe() {
      setLoading(true)
      setLoadError('')
      setOwnerData(null)
      setProfileRole(null)

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, phone, role, cafe_id')
        .eq('id', session.user.id)
        .maybeSingle()

      if (!active) return
      if (profileError) {
        setLoadError(`Profil owner tidak dapat dimuat: ${profileError.message}`)
        setLoading(false)
        return
      }
      setProfileRole(profile?.role || null)
      if (!profile || profile.role !== 'owner' || !profile.cafe_id) {
        setLoading(false)
        return
      }

      const features = await detectDbFeatures(supabase)
      if (!active) return
      const { data: cafe, error: cafeError } = await supabase
        .from('cafes')
        .select(cafeColumns(features))
        .eq('id', profile.cafe_id)
        .maybeSingle()

      if (!active) return
      if (cafeError) {
        setLoadError(`Data cafe tidak dapat dimuat: ${cafeError.message}`)
      } else if (cafe) {
        setOwnerData({ profile, cafe, features })
      } else {
        setLoadError('Cafe untuk akun owner ini tidak ditemukan.')
      }
      setLoading(false)
    }

    loadOwnerCafe()

    return () => {
      active = false
    }
  }, [loadingAttempt, session?.user?.id, supabase])

  function updateCafe(patch) {
    setOwnerData((current) => (current ? { ...current, cafe: { ...current.cafe, ...patch } } : current))
  }

  function updateProfile(patch) {
    setOwnerData((current) => (current ? { ...current, profile: { ...current.profile, ...patch } } : current))
  }

  async function handleSignOut() {
    setSignOutError('')
    const { error } = await supabase.auth.signOut()
    if (error) {
      setSignOutError(`Tidak dapat keluar: ${error.message}`)
      return
    }
    navigate('/login', { replace: true })
  }

  if (loading) return <LoadingScreen label="Memuat cafe Anda..." />
  if (profileRole === 'staff') return <Navigate to="/staff" replace />
  if (loadError) {
    return (
      <AccessState
        title="Data cafe belum tersedia"
        message={loadError}
        onRetry={() => setLoadingAttempt((attempt) => attempt + 1)}
      />
    )
  }
  if (!ownerData) {
    return (
      <AccessState
        title="Akses owner diperlukan"
        message="Akun ini belum terhubung sebagai owner ke sebuah cafe. Hubungi administrator untuk menyiapkan akses."
      />
    )
  }

  return (
    <AppShell
      navigation={OWNER_NAVIGATION}
      account={{ title: ownerData.cafe.name, subtitle: 'Owner', imageUrl: ownerData.cafe.logo_url, onSignOut: handleSignOut }}
      banner={signOutError && (
        <div className="shell-banner" role="alert">
          <span>{signOutError}</span>
          <button type="button" onClick={() => setSignOutError('')}>Tutup</button>
        </div>
      )}
    >
      <Outlet context={{ ...ownerData, updateCafe, updateProfile }} />
    </AppShell>
  )
}
