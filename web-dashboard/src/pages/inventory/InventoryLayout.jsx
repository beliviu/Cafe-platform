/*
 * Stok bahan: tab Bahan, Mutasi, Opname, Perkiraan. Data bersama (bahan, supplier,
 * pengaturan pelacakan) dimuat sekali di sini dan diteruskan lewat outlet context.
 */
import { useCallback } from 'react'
import { NavLink, Outlet, useOutletContext } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth.js'
import { Card, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui/index.js'
import { INVENTORY_REQUIRED } from '../../lib/db.js'
import { fetchIngredients, fetchSuppliers, inventoryError, useLoader } from '../../lib/inventory.js'

const TABS = [
  { to: '.', label: 'Bahan', end: true },
  { to: 'movements', label: 'Mutasi stok' },
  { to: 'counts', label: 'Stok opname' },
  { to: 'forecast', label: 'Perkiraan & belanja' },
]

export function InventoryLayout() {
  const context = useOutletContext()
  const enabled = Boolean(context.features?.inventory)
  return (
    <div className="page page-wide">
      <PageHeader eyebrow="Inventori" title="Stok bahan" description="Bahan baku, mutasi, hitung fisik, dan saran belanja." />
      <nav className="settings-tabs" aria-label="Bagian stok">
        {TABS.map((tab) => (
          <NavLink key={tab.label} to={tab.to} end={tab.end} className={({ isActive }) => `settings-tab${isActive ? ' is-active' : ''}`}>{tab.label}</NavLink>
        ))}
      </nav>
      {enabled ? <InventoryData context={context} /> : <Card><EmptyState title="Belum tersedia" description={INVENTORY_REQUIRED} /></Card>}
    </div>
  )
}

function InventoryData({ context }) {
  const { supabase } = useAuth()
  const cafeId = context.cafe.id
  const load = useCallback(async () => {
    const [ingredients, suppliers, settingsResult, issuesResult, batchResult] = await Promise.all([
      fetchIngredients(supabase, cafeId),
      fetchSuppliers(supabase, cafeId),
      supabase.from('cafe_settings').select('inventory_tracking, inventory_started_at, expiry_alert_days, reorder_cover_days').eq('cafe_id', cafeId).maybeSingle(),
      supabase.from('inventory_sync_issues').select('id, order_id, message, created_at, resolved_at').eq('cafe_id', cafeId).order('created_at', { ascending: false }).limit(50),
      supabase.from('ingredient_batches').select('id, ingredient_id, expires_at, remaining').eq('cafe_id', cafeId).gt('remaining', 0).order('expires_at'),
    ])
    if (settingsResult.error) throw new Error(inventoryError(settingsResult.error))
    if (issuesResult.error) throw new Error(inventoryError(issuesResult.error))
    if (batchResult.error) throw new Error(inventoryError(batchResult.error))
    return {
      ingredients,
      suppliers,
      settings: settingsResult.data || { inventory_tracking: false, inventory_started_at: null, expiry_alert_days: 3, reorder_cover_days: 7 },
      issues: (issuesResult.data || []).filter((issue) => !issue.resolved_at),
      batches: batchResult.data || [],
    }
  }, [cafeId, supabase])
  const inventory = useLoader(load)

  if (inventory.loading && !inventory.data) return <Card padding="none"><SkeletonRows rows={6} label="Memuat stok" /></Card>
  if (inventory.error && !inventory.data) return <Card><ErrorState message={inventory.error} onRetry={inventory.reload} /></Card>
  return <Outlet context={{ ...context, inventory }} />
}
