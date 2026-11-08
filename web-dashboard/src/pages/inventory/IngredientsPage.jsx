/*
 * Tab Bahan: status pelacakan stok, ringkasan nilai persediaan, peringatan, dan daftar bahan.
 */
import { useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, CalendarClock, CircleDollarSign, History, MoreHorizontal, PackagePlus,
  Pencil, PowerOff, SlidersHorizontal, Trash2, TriangleAlert,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, IconButton, Menu, SearchInput, SegmentedControl, Select, StatCard, useToast,
} from '../../components/ui/index.js'
import { IngredientDetailDrawer, IngredientFormDrawer, StockMoveDialog } from '../../components/inventory/IngredientDialogs.jsx'
import { formatDateShort, formatDateTime, formatNumber, formatRupiah, jakartaDateKey } from '../../lib/format.js'
import {
  callRpc, daysUntil, formatQty, formatUnitCost, inventoryError, STOCK_STATUS, stockStatus, stockValue, useOwnerBase,
} from '../../lib/inventory.js'

const FILTERS = [
  { value: 'all', label: 'Semua' },
  { value: 'attention', label: 'Perlu dibeli' },
  { value: 'expiring', label: 'Kedaluwarsa' },
  { value: 'inactive', label: 'Nonaktif' },
]

export function IngredientsPage() {
  const { cafe, inventory } = useOutletContext()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const base = useOwnerBase()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const filter = FILTERS.some((item) => item.value === params.get('filter')) ? params.get('filter') : 'all'
  const [dialog, setDialog] = useState(null)
  const { ingredients, suppliers, settings, issues, batches } = inventory.data
  const today = jakartaDateKey()
  const alertDays = settings.expiry_alert_days ?? 3

  const supplierNames = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier.name])), [suppliers])
  const categories = useMemo(() => [...new Set(ingredients.map((item) => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id')), [ingredients])
  const nearestExpiry = useMemo(() => {
    const map = new Map()
    for (const batch of batches) if (!map.has(batch.ingredient_id)) map.set(batch.ingredient_id, batch)
    return map
  }, [batches])
  const expiringBatches = batches.filter((batch) => daysUntil(batch.expires_at, today) <= alertDays)

  const active = ingredients.filter((item) => item.is_active)
  const needBuy = active.filter((item) => ['minus', 'empty', 'low'].includes(stockStatus(item)))
  const totalValue = active.reduce((sum, item) => sum + stockValue(item), 0)
  const uncosted = active.filter((item) => Number(item.on_hand) > 0 && !Number(item.avg_cost))

  const needle = query.trim().toLocaleLowerCase('id')
  const rows = ingredients.filter((item) => {
    if (filter === 'inactive' ? item.is_active : !item.is_active) return false
    if (filter === 'attention' && !['minus', 'empty', 'low'].includes(stockStatus(item))) return false
    if (filter === 'expiring' && !(nearestExpiry.has(item.id) && daysUntil(nearestExpiry.get(item.id).expires_at, today) <= alertDays)) return false
    if (category !== 'all' && (item.category || '') !== category) return false
    return !needle || [item.name, item.sku, item.category].filter(Boolean).join(' ').toLocaleLowerCase('id').includes(needle)
  })

  function setFilter(value) {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value === 'all') next.delete('filter')
      else next.set('filter', value)
      return next
    }, { replace: true })
  }

  const detail = dialog?.type === 'detail' ? ingredients.find((item) => item.id === dialog.id) : null
  const target = dialog?.id ? ingredients.find((item) => item.id === dialog.id) : null

  async function resolveIssues() {
    const { error } = await supabase.from('inventory_sync_issues').update({ resolved_at: new Date().toISOString() }).in('id', issues.map((issue) => issue.id))
    if (error) throw new Error(inventoryError(error))
    toast({ tone: 'success', title: 'Ditandai sudah ditinjau' })
    setDialog(null)
    inventory.reload()
  }

  async function removeIngredient(item) {
    const { error } = await supabase.from('ingredients').delete().eq('id', item.id)
    if (error) throw new Error(inventoryError(error))
    toast({ title: `${item.name} dihapus` })
    setDialog(null)
    inventory.reload()
  }

  async function deactivate(item) {
    const { error } = await supabase.from('ingredients').update({ is_active: false }).eq('id', item.id)
    if (error) throw new Error(inventoryError(error))
    toast({ title: `${item.name} dinonaktifkan` })
    inventory.reload()
  }

  return (
    <div className="inv-page">
      <TrackingCard cafeId={cafe.id} settings={settings} hasStock={ingredients.some((item) => Number(item.on_hand) !== 0)} onChanged={inventory.reload} />

      {issues.length > 0 && (
        <div className="inv-alert" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <div>
            <strong>{formatNumber(issues.length)} pesanan selesai gagal mengurangi stok</strong>
            <p>Pesanan tetap selesai. Stok bahan untuk pesanan ini belum terpotong — sesuaikan lewat opname. Terakhir: {formatDateTime(issues[0].created_at)} · {issues[0].message}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setDialog({ type: 'resolve' })}>Tandai sudah ditinjau</Button>
        </div>
      )}

      <section className="dash-stats inv-stats" aria-label="Ringkasan persediaan">
        <StatCard icon={CircleDollarSign} label="Nilai persediaan" value={formatRupiah(totalValue)}
          caption={uncosted.length ? `${uncosted.length} bahan belum punya harga` : 'Stok × harga rata-rata'} />
        <StatCard icon={Boxes} tone="neutral" label="Bahan aktif" value={formatNumber(active.length)} caption={`${categories.length} kategori`} />
        <StatCard icon={AlertTriangle} tone="amber" label="Perlu dibeli" value={formatNumber(needBuy.length)}
          caption={needBuy.length ? needBuy.slice(0, 2).map((item) => item.name).join(', ') + (needBuy.length > 2 ? ', …' : '') : 'Semua di atas minimum'}
          onClick={needBuy.length ? () => setFilter('attention') : undefined} />
        <StatCard icon={CalendarClock} tone="amber" label={`Kedaluwarsa ≤ ${alertDays} hari`} value={formatNumber(expiringBatches.length)}
          caption={expiringBatches.length ? `${formatNumber(expiringBatches.filter((batch) => daysUntil(batch.expires_at, today) < 0).length)} sudah lewat` : 'Tidak ada batch mendekati'}
          onClick={expiringBatches.length ? () => setFilter('expiring') : undefined} />
      </section>

      <section className="toolbar" aria-label="Filter bahan">
        <SearchInput value={query} onChange={setQuery} placeholder="Cari nama, kode, kategori…" label="Cari bahan" className="toolbar-search" />
        {categories.length > 0 && (
          <Select hideLabel label="Kategori" value={category} onChange={(event) => setCategory(event.target.value)}
            options={[{ value: 'all', label: 'Semua kategori' }, ...categories.map((value) => ({ value, label: value }))]} />
        )}
        <SegmentedControl label="Filter status" value={filter} onChange={setFilter} options={FILTERS.map((item) => ({
          ...item,
          count: item.value === 'attention' ? needBuy.length : item.value === 'expiring' ? new Set(expiringBatches.map((batch) => batch.ingredient_id)).size : undefined,
        }))} />
      </section>

      <Card padding="none" className={`table-card${inventory.loading ? ' is-refreshing' : ''}`}>
        {ingredients.length > 0 && (
          <div className="table-card-head">
            <CardHeader
              title="Daftar bahan"
              description={rows.length === ingredients.length ? `${formatNumber(ingredients.length)} bahan` : `${formatNumber(rows.length)} dari ${formatNumber(ingredients.length)} bahan`}
              actions={<Button icon={PackagePlus} onClick={() => setDialog({ type: 'form' })}>Tambah bahan</Button>}
            />
          </div>
        )}
        {!ingredients.length ? (
          <EmptyState icon={Boxes} title="Belum ada bahan" description="Mulai dari bahan utama: biji kopi, susu, gula, sirup, cup. Isi stok awal sekalian agar HPP langsung terhitung."
            action={<Button icon={PackagePlus} onClick={() => setDialog({ type: 'form' })}>Tambah bahan pertama</Button>} />
        ) : !rows.length ? (
          <EmptyState compact title="Tidak ada bahan yang cocok" description="Ubah kata kunci atau filter." />
        ) : (
          <div className="table-scroll">
            <table className="data-table inv-table">
              <thead>
                <tr>
                  <th scope="col">Bahan</th>
                  <th scope="col" className="num">Stok</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Harga rata-rata</th>
                  <th scope="col" className="num">Nilai</th>
                  <th scope="col">Kedaluwarsa terdekat</th>
                  <th scope="col"><span className="sr-only">Aksi</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const status = STOCK_STATUS[stockStatus(item)]
                  const batch = nearestExpiry.get(item.id)
                  const days = batch ? daysUntil(batch.expires_at, today) : null
                  const min = Number(item.min_stock) || 0
                  const ratio = min > 0 ? Math.max(0, Math.min(1, Number(item.on_hand) / (min * 2))) : null
                  return (
                    <tr key={item.id} className={`is-clickable${item.is_active ? '' : ' is-muted'}`} onClick={() => setDialog({ type: 'detail', id: item.id })}>
                      <td>
                        <span className="inv-name"><strong>{item.name}</strong><small>{[item.category, item.sku].filter(Boolean).join(' · ') || '—'}</small></span>
                      </td>
                      <td className="num">
                        <span className="inv-stock">
                          <strong className="tabular">{formatQty(item.on_hand, item.unit)}</strong>
                          {ratio !== null && <span className={`inv-meter is-${stockStatus(item)}`} aria-hidden="true"><span style={{ width: `${ratio * 100}%` }} /></span>}
                          <small className="tabular">min {formatQty(min, item.unit)}</small>
                        </span>
                      </td>
                      <td><Badge tone={status.tone}>{status.label}</Badge></td>
                      <td className="num tabular">{Number(item.avg_cost) ? formatUnitCost(item.avg_cost, item.unit) : <span className="text-muted">Belum ada</span>}</td>
                      <td className="num tabular">{formatRupiah(stockValue(item))}</td>
                      <td>
                        {!batch ? <span className="text-muted">—</span> : (
                          <span className="inv-expiry">
                            <span className="tabular">{formatDateShort(`${batch.expires_at}T00:00:00+07:00`)}</span>
                            {days < 0 ? <Badge tone="red" size="sm">Lewat</Badge> : days <= alertDays ? <Badge tone="amber" size="sm">{days === 0 ? 'Hari ini' : `${days} hari`}</Badge> : null}
                          </span>
                        )}
                      </td>
                      <td className="cell-actions" onClick={(event) => event.stopPropagation()}>
                        <Menu
                          label={`Aksi ${item.name}`}
                          trigger={({ props }) => <IconButton icon={MoreHorizontal} label={`Aksi ${item.name}`} size="sm" {...props} />}
                          items={[
                            { label: 'Stok masuk', icon: ArrowDownToLine, onSelect: () => setDialog({ type: 'in', id: item.id }) },
                            { label: 'Stok keluar', icon: ArrowUpFromLine, onSelect: () => setDialog({ type: 'out', id: item.id }) },
                            { label: 'Sesuaikan stok', icon: SlidersHorizontal, onSelect: () => setDialog({ type: 'adjust', id: item.id }) },
                            { label: 'Riwayat & detail', icon: History, onSelect: () => setDialog({ type: 'detail', id: item.id }) },
                            { label: 'Ubah data bahan', icon: Pencil, onSelect: () => setDialog({ type: 'form', id: item.id }) },
                            item.is_active
                              ? { label: 'Nonaktifkan', icon: PowerOff, onSelect: () => deactivate(item).catch((error) => toast({ tone: 'error', title: 'Gagal', description: error.message })) }
                              : { label: 'Hapus', icon: Trash2, tone: 'danger', onSelect: () => setDialog({ type: 'delete', id: item.id }) },
                          ]}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dialog?.type === 'form' && (
        <IngredientFormDrawer ingredient={target} cafeId={cafe.id} suppliers={suppliers} categories={categories}
          onClose={() => setDialog(null)} onSaved={inventory.reload} />
      )}
      {['in', 'out', 'adjust'].includes(dialog?.type) && target && (
        <StockMoveDialog mode={dialog.type} ingredient={target} suppliers={suppliers}
          batches={dialog.batches || batches.filter((batch) => batch.ingredient_id === target.id)}
          onClose={() => setDialog(dialog.from === 'detail' ? { type: 'detail', id: target.id } : null)} onDone={inventory.reload} />
      )}
      {detail && (
        <IngredientDetailDrawer ingredient={detail} supplierName={supplierNames.get(detail.default_supplier_id)} expiryAlertDays={alertDays} basePath={base}
          onClose={() => setDialog(null)}
          onAction={(action, detailBatches) => setDialog(action === 'edit' ? { type: 'form', id: detail.id } : { type: action, id: detail.id, batches: detailBatches, from: 'detail' })} />
      )}
      {dialog?.type === 'delete' && target && (
        <ConfirmDialog title={`Hapus ${target.name}?`} description="Hanya bahan tanpa riwayat stok dan tidak dipakai di resep yang bisa dihapus." confirmLabel="Hapus bahan"
          onConfirm={() => removeIngredient(target)} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'resolve' && (
        <ConfirmDialog tone="primary" title="Tandai sudah ditinjau?" confirmLabel="Tandai"
          description="Pastikan stok bahan yang terdampak sudah disesuaikan (lewat opname atau Sesuaikan stok). Catatan ini akan disembunyikan."
          onConfirm={resolveIssues} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}

function TrackingCard({ cafeId, settings, hasStock, onChanged }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [confirm, setConfirm] = useState(null)

  async function setTracking(enabled) {
    await callRpc(supabase, 'inventory_set_tracking', { p_cafe_id: cafeId, p_enabled: enabled })
    toast({ tone: 'success', title: enabled ? 'Pelacakan stok aktif' : 'Pelacakan stok dimatikan' })
    setConfirm(null)
    onChanged()
  }

  return (
    <Card className={`inv-tracking${settings.inventory_tracking ? ' is-on' : ''}`}>
      <CardHeader
        title={settings.inventory_tracking ? 'Stok berkurang otomatis' : 'Pelacakan stok belum aktif'}
        description={settings.inventory_tracking
          ? `Sejak ${formatDateTime(settings.inventory_started_at)}. Setiap pesanan selesai memotong bahan sesuai resep.`
          : 'Isi stok awal dan resep dulu. Setelah aktif, setiap pesanan yang selesai memotong bahan sesuai resep.'}
        actions={settings.inventory_tracking
          ? <Button variant="ghost" size="sm" onClick={() => setConfirm('off')}>Matikan</Button>
          : <Button size="sm" onClick={() => setConfirm('on')}>Aktifkan pelacakan</Button>}
      />
      {confirm === 'on' && (
        <ConfirmDialog tone="primary" title="Aktifkan pelacakan stok?" confirmLabel="Aktifkan"
          description={hasStock
            ? 'Mulai sekarang, pesanan yang ditandai selesai akan mengurangi stok bahan sesuai resep. Produk tanpa resep tidak memotong stok. Pesanan tidak pernah tertahan karena stok — bila stok kurang, saldo menjadi minus sebagai tanda perlu opname.'
            : 'Belum ada stok yang dicatat. Kalau diaktifkan sekarang, saldo bahan akan langsung minus saat pesanan selesai. Sebaiknya isi stok awal dulu.'}
          onConfirm={() => setTracking(true)} onClose={() => setConfirm(null)} />
      )}
      {confirm === 'off' && (
        <ConfirmDialog title="Matikan pelacakan stok?" confirmLabel="Matikan"
          description="Pesanan berikutnya tidak lagi memotong stok, sehingga saldo bahan tidak akurat sampai diaktifkan dan diopname ulang. Riwayat yang sudah tercatat tetap ada."
          onConfirm={() => setTracking(false)} onClose={() => setConfirm(null)} />
      )}
    </Card>
  )
}
