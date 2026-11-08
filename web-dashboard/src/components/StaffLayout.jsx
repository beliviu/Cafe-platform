import { useEffect, useState } from 'react'
import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { LoadingScreen } from './LoadingScreen.jsx'
import { AccessState } from './shell/AccessState.jsx'
import { AppShell } from './shell/AppShell.jsx'
import { staffNavigation } from '../config/staffNavigation.js'
import { cafeColumns, detectDbFeatures } from '../lib/db.js'
import { brandOf, cacheBrand, useDocumentBranding } from '../lib/branding.js'

export function StaffLayout() {
  const { session, supabase } = useAuth()
  const navigate = useNavigate()
  const [staffData, setStaffData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [signOutError, setSignOutError] = useState('')
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    if (!supabase || !session?.user?.id) return undefined

    let active = true
    async function loadStaffCafe() {
      setLoading(true)
      setLoadError('')
      setStaffData(null)
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, role, cafe_id')
        .eq('id', session.user.id)
        .maybeSingle()

      if (!active) return
      if (profileError) {
        setLoadError(`Profil staff tidak dapat dimuat: ${profileError.message}`)
        setLoading(false)
        return
      }
      if (!profile || profile.role !== 'staff' || !profile.cafe_id) {
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
        setStaffData({ profile, cafe, features })
      } else {
        setLoadError('Cafe yang ditugaskan ke akun staff ini tidak ditemukan.')
      }
      setLoading(false)
    }

    loadStaffCafe()
    return () => { active = false }
  }, [attempt, session?.user?.id, supabase])

  async function handleSignOut() {
    setSignOutError('')
    const { error } = await supabase.auth.signOut()
    if (error) {
      setSignOutError(`Tidak dapat keluar: ${error.message}`)
      return
    }
    navigate('/login', { replace: true })
  }

  const brand = staffData ? brandOf(staffData.cafe) : null
  const brandKey = brand ? JSON.stringify(brand) : ''
  useDocumentBranding(brand, 'Staff')
  useEffect(() => {
    if (brandKey) cacheBrand(JSON.parse(brandKey))
  }, [brandKey])

  if (loading) return <LoadingScreen label="Memeriksa akses staff..." />
  if (loadError) {
    return <AccessState title="Halaman staff belum tersedia" message={loadError} onRetry={() => setAttempt((value) => value + 1)} />
  }
  if (!staffData) return <Navigate to="/" replace />

  return (
    <AppShell
      brand={brand}
      homeTo="/staff"
      navigation={staffNavigation(pendingCount)}
      account={{ title: staffData.profile.full_name || staffData.cafe.name, subtitle: `Staff · ${staffData.cafe.name}`, onSignOut: handleSignOut }}
      banner={signOutError && (
        <div className="shell-banner" role="alert">
          <span>{signOutError}</span>
          <button type="button" onClick={() => setSignOutError('')}>Tutup</button>
        </div>
      )}
    >
      <Outlet context={{ ...staffData, setPendingCount }} />
    </AppShell>
  )
}
