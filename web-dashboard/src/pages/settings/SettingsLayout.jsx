import { NavLink, Outlet, useOutletContext } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth.js'
import { PageHeader } from '../../components/ui/index.js'
import { useCafeSettings } from '../../lib/cafeSettings.js'

const TABS = [
  { to: '.', label: 'Umum', end: true },
  { to: 'operations', label: 'Operasional' },
  { to: 'charges', label: 'Pajak & biaya' },
  { to: 'ordering', label: 'Pesanan app' },
  { to: 'payments', label: 'Pembayaran' },
  { to: 'tables', label: 'Meja' },
  { to: 'receipt', label: 'Struk' },
  { to: 'appearance', label: 'Tampilan' },
  { to: 'subscription', label: 'Langganan' },
]

/** Kerangka Pengaturan: judul + tab. cafe_settings dimuat sekali dan dibagikan ke semua tab. */
export function SettingsLayout() {
  const context = useOutletContext()
  const { supabase } = useAuth()
  const settingsState = useCafeSettings(supabase, context.cafe.id, Boolean(context.features?.phase3))

  return (
    <div className="page">
      <PageHeader eyebrow="Pengaturan" title="Pengaturan kafe" description="Identitas brand, operasional, biaya, pesanan app, meja, dan struk." />
      <nav className="settings-tabs" aria-label="Bagian pengaturan">
        {TABS.map((tab) => (
          <NavLink key={tab.label} to={tab.to} end={tab.end} className={({ isActive }) => `settings-tab${isActive ? ' is-active' : ''}`}>
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet context={{ ...context, settingsState }} />
    </div>
  )
}
