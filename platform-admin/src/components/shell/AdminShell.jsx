/*
 * Kerangka dashboard platform = AppShell dari design system bersama, ditambah:
 * - breadcrumb tambahan dari halaman detail (useCrumbs),
 * - lonceng notifikasi di bar atas,
 * - pencarian kafe di palet perintah (Ctrl/Cmd+K).
 */
import { useCallback, useMemo, useState } from 'react'
import { Store } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../ui/index.js'
import { rpc } from '../../lib/api.js'
import { NotificationBell } from '../NotificationBell.jsx'
import { CrumbContext } from './crumbs.js'

export { BrandMark } from '../ui/index.js'

const BRAND = { name: 'Dailybrew', tagline: 'Platform' }

export function AdminShell({ sections, account, banner, children }) {
  const navigate = useNavigate()
  const [extraCrumbs, setExtraCrumbs] = useState([])

  const search = useCallback(async (query) => {
    const result = await rpc('pa_cafes_list', { p_search: query, p_limit: 6, p_offset: 0 })
    return (result?.rows || []).map((cafe) => ({
      key: `cafe:${cafe.cafe_id}`,
      label: cafe.name,
      hint: [cafe.owner_name, cafe.plan_name].filter(Boolean).join(' · '),
      group: 'Kafe',
      icon: Store,
      run: () => navigate(`/kafe/${cafe.cafe_id}`),
    }))
  }, [navigate])

  const shellAccount = useMemo(() => ({ title: account.name || 'Admin', subtitle: account.email || 'Admin platform', onSignOut: account.onSignOut }), [account])

  return (
    <CrumbContext.Provider value={setExtraCrumbs}>
      <AppShell
        brand={BRAND}
        navigation={sections}
        account={shellAccount}
        storageKey="dailybrew.platform.sidebar"
        crumbRoot="Dailybrew"
        extraCrumbs={extraCrumbs}
        actions={<NotificationBell />}
        search={search}
        searchLabel="Cari halaman atau kafe…"
        banner={banner}
      >
        {children}
      </AppShell>
    </CrumbContext.Provider>
  )
}
