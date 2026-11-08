/*
 * KHUSUS DEV: /preview/owner — halaman owner asli dengan data tiruan (lihat mockSupabase.js).
 * Tidak login, tidak menyentuh database. Hanya dirender saat import.meta.env.DEV.
 */
import { useMemo, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { AuthContext } from '../auth/AuthContext.js'
import { AppShell } from '../components/shell/AppShell.jsx'
import { OWNER_NAVIGATION } from '../config/ownerNavigation.js'
import { brandOf, useDocumentBranding } from '../lib/branding.js'
import { createFixtures, createMockSupabase } from './mockSupabase.js'

const PREFIX = '/preview/owner'

export function OwnerPreview() {
  const [fixtures] = useState(() => createFixtures())
  const [supabase] = useState(() => createMockSupabase(fixtures))
  const [cafe, setCafe] = useState(fixtures.cafe)
  const [profile, setProfile] = useState(fixtures.profile)
  const auth = useMemo(() => ({ authError: null, loading: false, session: { user: { id: profile.id } }, supabase }), [profile.id, supabase])
  const navigation = OWNER_NAVIGATION.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item, to: item.to === '/' ? PREFIX : `${PREFIX}${item.to}` })),
  }))

  useDocumentBranding(brandOf(cafe), 'Owner')

  return (
    <AuthContext.Provider value={auth}>
      <AppShell brand={brandOf(cafe)} navigation={navigation} account={{ title: profile.full_name, subtitle: `Owner · ${cafe.name} (pratinjau)`, onSignOut: () => {} }}>
        <Outlet
          context={{
            cafe,
            profile,
            features: { operations: true, branding: true, phase3: true, inventory: true, pos: true, finance: true },
            updateCafe: (patch) => setCafe((current) => ({ ...current, ...patch })),
            updateProfile: (patch) => setProfile((current) => ({ ...current, ...patch })),
          }}
        />
      </AppShell>
    </AuthContext.Provider>
  )
}
