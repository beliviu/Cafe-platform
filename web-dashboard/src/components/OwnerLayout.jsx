import { useEffect, useState } from 'react'
import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { OWNER_NAVIGATION } from '../config/ownerNavigation.js'
import { LoadingScreen } from './LoadingScreen.jsx'
import { AccessState } from './shell/AccessState.jsx'
import { Button } from './ui/index.js'
import { AppShell } from './shell/AppShell.jsx'
import { PlatformBanner } from './shell/PlatformBanner.jsx'
import { cafeColumns, detectDbFeatures, setPlanBlockReporter } from '../lib/db.js'
import { brandOf, cacheBrand, useDocumentBranding } from '../lib/branding.js'
import { fetchCafeFlags } from '../lib/platformScale.js'

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
        // Feature flag per kafe (file 18): { kunci: true/false }, {} sebelum file 18
        const flags = await fetchCafeFlags(supabase, cafe.id)
        if (!active) return
        setOwnerData({ profile, cafe, features, flags })
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

  const brand = ownerData ? brandOf(ownerData.cafe) : null
  const brandKey = brand ? JSON.stringify(brand) : ''
  useDocumentBranding(brand, 'Owner')
  useEffect(() => {
    if (brandKey) cacheBrand(JSON.parse(brandKey))
  }, [brandKey])


  // Sinyal upgrade untuk admin platform saat terbentur batas/fitur paket (file 16; diam bila belum ada)
  const cafeIdForSignal = ownerData?.cafe?.id
  useEffect(() => {
    if (!supabase || !cafeIdForSignal) return undefined
    setPlanBlockReporter((kind, detail) => {
      supabase.rpc('owner_log_plan_block', { p_cafe: cafeIdForSignal, p_kind: kind, p_detail: detail }).then(() => {}, () => {})
    })
    return () => setPlanBlockReporter(null)
  }, [cafeIdForSignal, supabase])

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
    // Pelanggan yang baru klik link verifikasi email mendarat di sini (Site URL Supabase = web owner).
    // Tampilkan ucapan selamat, bukan "akses ditolak", supaya tidak salah paham.
    if (profileRole !== 'owner') {
      const customerAppUrl = import.meta.env.VITE_CUSTOMER_APP_URL
      return (
        <AccessState
          title="Selamat, email kamu sudah terverifikasi"
          message="Akun kamu sudah aktif. Kembali ke aplikasi kafe, lalu masuk dengan email dan password yang tadi kamu daftarkan. Halaman ini boleh ditutup."
          action={(
            <div className="access-v2-actions">
              {customerAppUrl && <Button onClick={() => window.location.assign(customerAppUrl)}>Buka aplikasi kafe</Button>}
              <Button variant="ghost" onClick={handleSignOut}>Tutup</Button>
            </div>
          )}
        />
      )
    }
    return (
      <AccessState
        title="Kafe belum terhubung"
        message="Akun owner ini sudah aktif, tetapi belum terhubung ke sebuah kafe. Hubungi administrator Dailybrew untuk menyelesaikan penyiapan."
      />
    )
  }

  return (
    <AppShell
      brand={brand}
      navigation={OWNER_NAVIGATION}
      account={{ title: ownerData.profile.full_name || ownerData.cafe.name, subtitle: `Owner · ${ownerData.cafe.name}`, onSignOut: handleSignOut }}
      banner={(
        <>
          <PlatformBanner supabase={supabase} cafeId={ownerData.cafe.id} cafeName={ownerData.cafe.name} isOwner={true} />
          {signOutError && (
            <div className="shell-banner" role="alert">
              <span>{signOutError}</span>
              <button type="button" onClick={() => setSignOutError('')}>Tutup</button>
            </div>
          )}
        </>
      )}
    >
      <Outlet context={{ ...ownerData, updateCafe, updateProfile }} />
    </AppShell>
  )
}
