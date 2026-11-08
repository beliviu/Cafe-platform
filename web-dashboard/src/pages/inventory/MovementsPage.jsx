/*
 * Tab Mutasi stok: buku besar stok per rentang tanggal, ringkasan per jenis, dan ekspor.
 */
import { useCallback, useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { Download, FileSpreadsheet, FileText, History } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import {
  Badge, Button, Card, DateRangePicker, EmptyState, ErrorState, Menu, Pagination, Select, SkeletonRows, useToast,
} from '../../components/ui/index.js'
import { resolveRange } from '../../lib/dateRange.js'
import { fetchAllRows } from '../../lib/db.js'
import { formatDateTime, formatNumber, formatRupiah } from '../../lib/format.js'
import { exportRows, formatQty, formatUnitCost, inventoryError, MOVEMENT_TYPES, useLoader } from '../../lib/inventory.js'

const PAGE_SIZE = 50
const GROUPS = [
  { key: 'in', label: 'Masuk (beli & stok awal)', types: ['purchase', 'opening'] },
  { key: 'sale', label: 'Terpakai untuk penjualan', types: ['sale'] },
  { key: 'loss', label: 'Terbuang, rusak, kedaluwarsa', types: ['waste', 'damaged', 'expired'] },
  { key: 'diff', label: 'Selisih opname & penyesuaian', types: ['opname', 'adjustment'] },
]

export function MovementsPage() {
  const { cafe, inventory } = useOutletContext()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const [rangeValue, setRangeValue] = useState({ preset: '30d', custom: null })
  const [type, setType] = useState('all')
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)
  const ingredientId = params.get('ingredient') || 'all'
  const range = useMemo(() => resolveRange(rangeValue.preset, rangeValue.custom), [rangeValue])
  const ingredients = inventory.data.ingredients
  const byId = useMemo(() => new Map(ingredients.map((item) => [item.id, item])), [ingredients])
  const supplierNames = useMemo(() => new Map(inventory.data.suppliers.map((supplier) => [supplier.id, supplier.name])), [inventory.data.suppliers])

  const load = useCallback(async () => {
    const { data, error } = await fetchAllRows(() => {
      let request = supabase.from('stock_movements')
        .select('id, ingredient_id, movement_type, quantity, unit_cost, total_cost, balance_after, supplier_id, purchase_order_id, order_id, note, occurred_at')
        .eq('cafe_id', cafe.id)
        .gte('occurred_at', range.start.toISOString())
        .lt('occurred_at', range.endExclusive.toISOString())
      if (ingredientId !== 'all') request = request.eq('ingredient_id', ingredientId)
      return request.order('occurred_at', { ascending: false }).order('id', { ascending: false })
    })
    if (error) throw new Error(inventoryError(error))
    return data
  }, [cafe.id, ingredientId, range, supabase])
  const { data: movements, loading, error, reload } = useLoader(load)

  const filtered = useMemo(() => (movements || []).filter((move) => type === 'all' || move.movement_type === type), [movements, type])
  const summary = useMemo(() => GROUPS.map((group) => {
    const list = (movements || []).filter((move) => group.types.includes(move.movement_type))
    return { ...group, count: list.length, value: list.reduce((sum, move) => sum + Number(move.total_cost || 0), 0) }
  }), [movements])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function setIngredient(value) {
    setPage(1)
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value === 'all') next.delete('ingredient')
      else next.set('ingredient', value)
      return next
    }, { replace: true })
  }

  async function handleExport(format) {
    setExporting(true)
    try {
      const data = filtered.map((move) => {
        const item = byId.get(move.ingredient_id)
        return {
          time: formatDateTime(move.occurred_at),
          ingredient: item?.name || '—',
          type: MOVEMENT_TYPES[move.movement_type]?.label || move.movement_type,
          quantity: Number(move.quantity),
          unit: item?.unit || '',
          unit_cost: Number(move.unit_cost),
          value: Number(move.total_cost),
          balance: Number(move.balance_after),
          supplier: supplierNames.get(move.supplier_id) || '',
          note: move.note || '',
        }
      })
      await exportRows(data, [
        { key: 'time', header: 'Waktu (WIB)', width: 18 },
        { key: 'ingredient', header: 'Bahan', width: 26 },
        { key: 'type', header: 'Jenis', width: 16 },
        { key: 'quantity', header: 'Jumlah', number: true, width: 12 },
        { key: 'unit', header: 'Satuan', width: 8 },
        { key: 'unit_cost', header: 'Harga per satuan', number: true, format: '#,##0.00', width: 16 },
        { key: 'value', header: 'Nilai (Rp)', number: true, format: '#,##0', width: 14 },
        { key: 'balance', header: 'Saldo setelah', number: true, width: 14 },
        { key: 'supplier', header: 'Supplier', width: 20 },
        { key: 'note', header: 'Catatan', width: 30 },
      ], `mutasi-stok-${range.startKey}_${range.endKey}`, format, 'Mutasi stok')
    } catch (caught) {
      toast({ tone: 'error', title: 'Ekspor gagal', description: caught.message })
    }
    setExporting(false)
  }

  return (
    <div className="inv-page">
      <section className="toolbar" aria-label="Filter mutasi">
        <DateRangePicker value={rangeValue} onChange={(value) => { setRangeValue(value); setPage(1) }} />
        <Select hideLabel label="Bahan" value={ingredientId} onChange={(event) => setIngredient(event.target.value)}
          options={[{ value: 'all', label: 'Semua bahan' }, ...ingredients.map((item) => ({ value: item.id, label: item.name }))]} />
        <Select hideLabel label="Jenis mutasi" value={type} onChange={(event) => { setType(event.target.value); setPage(1) }}
          options={[{ value: 'all', label: 'Semua jenis' }, ...Object.entries(MOVEMENT_TYPES).map(([value, meta]) => ({ value, label: meta.label }))]} />
        <Menu
          label="Pilihan ekspor"
          trigger={({ props }) => <Button variant="secondary" icon={Download} loading={exporting} disabled={!filtered.length} className="toolbar-end" {...props}>Ekspor</Button>}
          items={[
            { label: 'Excel (.xlsx)', icon: FileSpreadsheet, hint: `${formatNumber(filtered.length)} baris`, onSelect: () => handleExport('xlsx') },
            { label: 'CSV', icon: FileText, hint: `${formatNumber(filtered.length)} baris`, onSelect: () => handleExport('csv') },
          ]}
        />
      </section>

      <section className="inv-summary" aria-label="Ringkasan nilai mutasi">
        {summary.map((group) => (
          <div key={group.key} className={`inv-summary-item is-${group.key}`}>
            <span>{group.label}</span>
            <strong className="tabular">{formatRupiah(Math.abs(group.value))}</strong>
            <small className="tabular">{formatNumber(group.count)} mutasi{group.key === 'diff' && group.value !== 0 ? ` · ${group.value > 0 ? 'lebih' : 'kurang'}` : ''}</small>
          </div>
        ))}
      </section>

      <Card padding="none" className={`table-card${loading && movements ? ' is-refreshing' : ''}`}>
        {error ? <ErrorState message={error} onRetry={reload} />
          : !movements ? <SkeletonRows rows={8} label="Memuat mutasi" />
            : !filtered.length ? (
              <EmptyState compact icon={History} title="Belum ada mutasi di rentang ini" description="Mutasi tercatat saat stok masuk, pesanan selesai, opname, atau barang PO diterima." />
            ) : (
              <>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Waktu</th>
                        <th scope="col">Bahan</th>
                        <th scope="col">Jenis</th>
                        <th scope="col" className="num">Jumlah</th>
                        <th scope="col" className="num">Harga satuan</th>
                        <th scope="col" className="num">Nilai</th>
                        <th scope="col" className="num">Saldo</th>
                        <th scope="col">Keterangan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((move) => {
                        const item = byId.get(move.ingredient_id)
                        const meta = MOVEMENT_TYPES[move.movement_type] || { label: move.movement_type, tone: 'neutral' }
                        const unit = item?.unit || ''
                        return (
                          <tr key={move.id}>
                            <td className="tabular nowrap">{formatDateTime(move.occurred_at)}</td>
                            <td>{item?.name || '—'}</td>
                            <td><Badge tone={meta.tone} size="sm" dot={false}>{meta.label}</Badge></td>
                            <td className={`num tabular inv-qty${Number(move.quantity) < 0 ? ' is-out' : ''}`}>{formatQty(move.quantity, unit, { signed: true })}</td>
                            <td className="num tabular">{formatUnitCost(move.unit_cost, unit)}</td>
                            <td className="num tabular">{formatRupiah(move.total_cost)}</td>
                            <td className="num tabular">{formatQty(move.balance_after, unit)}</td>
                            <td className="inv-note">{[supplierNames.get(move.supplier_id), move.note, move.order_id && !move.note ? 'Pesanan selesai' : null].filter(Boolean).join(' · ') || <span className="text-muted">—</span>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} itemLabel="mutasi" />
              </>
            )}
      </Card>
    </div>
  )
}
