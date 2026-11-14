/*
 * KHUSUS DEV: /preview/staff — halaman staff asli dengan data tiruan (lihat mockSupabase.js).
 * Di konsol: window.__dailybrewMock.addOrder('Nama') untuk simulasi pesanan baru,
 * window.__dailybrewMock.setRealtime('CHANNEL_ERROR' | 'SUBSCRIBED') untuk simulasi koneksi.
 */
import { useMemo, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { AuthContext } from '../auth/AuthContext.js'
import { AppShell } from '../components/shell/AppShell.jsx'
import { brandOf, useDocumentBranding } from '../lib/branding.js'
import { staffNavigation } from '../config/staffNavigation.js'
import { createFixtures, createMockSupabase } from './mockSupabase.js'

const PREFIX = '/preview/staff'

export function StaffPreview() {
  const [fixtures] = useState(() => createFixtures())
  const [supabase] = useState(() => createMockSupabase(fixtures, { userId: 'staff-1' }))
  const [pendingCount, setPendingCount] = useState(0)
  const auth = useMemo(() => ({ authError: null, loading: false, session: { user: { id: 'staff-1' } }, supabase }), [supabase])
  const navigation = staffNavigation(pendingCount).map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item, to: item.to.replace('/staff', PREFIX) })),
  }))

  useDocumentBranding(brandOf(fixtures.cafe), 'Staff')

  return (
    <AuthContext.Provider value={auth}>
      <AppShell brand={brandOf(fixtures.cafe)} homeTo={PREFIX} grouped={false} mobileNav="bottom" className="is-staff" storageKey="dailybrew.staff.sidebar" defaultCollapsed navigation={navigation} account={{ title: 'Nadia Barista', subtitle: `Staff · ${fixtures.cafe.name}`, onSignOut: () => {} }}>
        <Outlet
          context={{
            cafe: fixtures.cafe,
            profile: { id: 'staff-1', full_name: 'Nadia Barista', role: 'staff', cafe_id: fixtures.cafe.id },
            // ?izin=terbatas → staff hanya boleh mengatur menu habis (uji gerbang izin)
            permissions: new URLSearchParams(window.location.search).get('izin') === 'terbatas' ? ['menu.availability'] : null,
            features: { operations: true, branding: true, phase3: true, inventory: true, pos: true, finance: true, customer: true, payments: true, security: true, bi: true },
            setPendingCount,
          }}
        />
      </AppShell>
    </AuthContext.Provider>
  )
}
