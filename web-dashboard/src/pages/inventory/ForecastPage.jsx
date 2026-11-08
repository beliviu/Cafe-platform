/*
 * Tab Perkiraan & belanja: pemakaian rata-rata harian, perkiraan habis, saran beli (RPC inventory_forecast).
 * Server menolak menebak bila hari berjualan < 7 dalam rentang acuan.
 */
import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { Info, ShoppingCart, TrendingDown } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, SegmentedControl, SkeletonRows, useToast,
} from '../../components/ui/index.js'
import { formatDateShort, formatNumber, formatRupiah } from '../../lib/format.js'
import { callRpc, formatQty, inventoryError, useLoader, useOwnerBase } from '../../lib/inventory.js'

const LOOKBACKS = [
  { value: 14, label: '14 hari' },
  { value: 28, label: '28 hari' },
  { value: 56, label: '8 minggu' },
]

const BASIS_COPY = {
  aktual: { tone: 'green', label: 'Data aktual', text: 'Dihitung dari pemakaian bahan yang benar-benar tercatat (pesanan selesai dan pemakaian lain).' },
  estimasi: { tone: 'amber', label: 'Estimasi', text: 'Pelacakan stok belum berjalan sepanjang rentang ini, jadi pemakaian diperkirakan dari jumlah produk terjual × resep saat ini. Produk tanpa resep tidak terhitung.' },
  data_kurang: { tone: 'neutral', label: 'Data belum cukup', text: 'Butuh minimal 7 hari berjualan dalam rentang ini agar perkiraan bisa dipercaya. Saran beli di bawah hanya untuk mengembalikan stok ke batas minimum.' },
}

export function ForecastPage() {
  const { cafe, inventory } = useOutletContext()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const base = useOwnerBase()
  const [lookback, setLookback] = useState(28)
  const [excluded, setExcluded] = useState(() => new Set())
  const [confirm, setConfirm] = useState(false)
  const byId = useMemo(() => new Map(inventory.data.ingredients.map((item) => [item.id, item])), [inventory.data.ingredients])
  const supplierNames = useMemo(() => new Map(inventory.data.suppliers.filter((supplier) => supplier.is_active).map((supplier) => [supplier.id, supplier.name])), [inventory.data.suppliers])

  const load = useCallback(async () => {
    const [rows, catalog] = await Promise.all([
      callRpc(supabase, 'inventory_forecast', { p_cafe_id: cafe.id, p_lookback_days: lookback }),
      supabase.from('supplier_items').select('supplier_id, ingredient_id, unit_label, unit_size, last_price').eq('cafe_id', cafe.id),
    ])
    if (catalog.error) throw new Error(inventoryError(catalog.error))
    return { rows: rows || [], catalog: catalog.data || [] }
  }, [cafe.id, lookback, supabase])
  const { data, error, reload, loading } = useLoader(load)

  const rows = data?.rows || []
  const basis = rows[0]?.basis || 'data_kurang'
  const suggestions = rows.filter((row) => Number(row.suggested_quantity) > 0)

  // Draf PO per supplier utama dari saran yang dicentang
  const plan = useMemo(() => {
    const groups = new Map()
    const orphans = []
    for (const row of suggestions) {
      if (excluded.has(row.ingredient_id)) continue
      const item = byId.get(row.ingredient_id)
      const supplierId = item?.default_supplier_id
      if (!supplierId || !supplierNames.has(supplierId)) {
        orphans.push(row)
        continue
      }
      const catalogItem = data?.catalog.find((entry) => entry.supplier_id === supplierId && entry.ingredient_id === row.ingredient_id)
      const unitSize = Number(catalogItem?.unit_size || item.purchase_unit_size || 1)
      const unitLabel = catalogItem?.unit_label || item.purchase_unit || item.unit
      const quantity = Math.max(1, Math.ceil(Number(row.suggested_quantity) / unitSize))
      const unitPrice = Math.round(Number(catalogItem?.last_price) || (Number(item.last_purchase_cost || item.avg_cost) * unitSize))
      if (!groups.has(supplierId)) groups.set(supplierId, [])
      groups.get(supplierId).push({ ingredient_id: row.ingredient_id, name: row.name, quantity, unit_label: unitLabel, unit_size: unitSize, unit_price: unitPrice })
    }
    return { groups: [...groups.entries()], orphans }
  }, [byId, data, excluded, suggestions, supplierNames])

  async function createDrafts() {
    for (const [supplierId, items] of plan.groups) {
      await callRpc(supabase, 'purchase_order_save', {
        p_cafe_id: cafe.id, p_po_id: null, p_supplier_id: supplierId, p_order_date: null, p_expected_date: null,
        p_notes: 'Dibuat dari saran belanja', p_items: items.map(({ ingredient_id, quantity, unit_label, unit_size, unit_price }) => ({ ingredient_id, quantity, unit_label, unit_size, unit_price })),
      })
    }
    toast({ tone: 'success', title: `${plan.groups.length} draf PO dibuat`, description: 'Periksa harga & jumlah sebelum ditandai dipesan.' })
    navigate(`${base}/purchases`)
  }

  function toggle(id) {
    setExcluded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const copy = BASIS_COPY[basis]
  return (
    <div className="inv-page">
      <section className="toolbar" aria-label="Pengaturan perkiraan">
        <SegmentedControl label="Rentang acuan" value={lookback} onChange={(value) => { setLookback(value); setExcluded(new Set()) }} options={LOOKBACKS} />
        <Button icon={ShoppingCart} className="toolbar-end" disabled={!plan.groups.length} onClick={() => setConfirm(true)}>
          Buat draf PO{plan.groups.length ? ` (${plan.groups.length} supplier)` : ''}
        </Button>
      </section>

      {data && (
        <div className={`inv-basis is-${basis}`} role="note">
          <Info size={17} aria-hidden="true" />
          <div>
            <strong>{copy.label}</strong>
            {basis !== 'data_kurang' && <span className="text-muted"> · {formatNumber(rows[0]?.active_days || 0)} hari berjualan dalam {lookback} hari terakhir</span>}
            <p>{copy.text} Stok cadangan dihitung untuk waktu kirim supplier + {formatNumber(inventory.data.settings.reorder_cover_days ?? 7)} hari.</p>
          </div>
        </div>
      )}

      <Card padding="none" className={`table-card${loading && data ? ' is-refreshing' : ''}`}>
        {error ? <ErrorState message={error} onRetry={reload} />
          : !data ? <SkeletonRows rows={6} label="Menghitung perkiraan" />
            : !rows.length ? <EmptyState compact icon={TrendingDown} title="Belum ada bahan aktif" description="Tambahkan bahan dan resep untuk melihat perkiraan." />
              : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col"><span className="sr-only">Pilih</span></th>
                        <th scope="col">Bahan</th>
                        <th scope="col" className="num">Stok</th>
                        <th scope="col" className="num">Pemakaian / hari</th>
                        <th scope="col">Perkiraan habis</th>
                        <th scope="col" className="num">Saran beli</th>
                        <th scope="col">Supplier utama</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const item = byId.get(row.ingredient_id)
                        const suggested = Number(row.suggested_quantity) > 0
                        const daysLeft = row.days_left === null ? null : Number(row.days_left)
                        const urgent = daysLeft !== null && daysLeft <= Number(row.lead_time_days)
                        return (
                          <tr key={row.ingredient_id} className={suggested ? '' : 'is-muted'}>
                            <td className="cell-check">
                              {suggested && <input type="checkbox" aria-label={`Sertakan ${row.name} di draf PO`} checked={!excluded.has(row.ingredient_id)} onChange={() => toggle(row.ingredient_id)} />}
                            </td>
                            <td><strong>{row.name}</strong></td>
                            <td className="num tabular">{formatQty(row.on_hand, row.unit)}</td>
                            <td className="num tabular">{row.avg_daily_usage === null ? <span className="text-muted">—</span> : formatQty(row.avg_daily_usage, row.unit)}</td>
                            <td>
                              {daysLeft === null ? <span className="text-muted">{row.avg_daily_usage === null ? '—' : 'Tidak terpakai'}</span> : (
                                <span className="inv-expiry">
                                  <span className="tabular">{daysLeft < 1 ? 'Hari ini' : `${formatNumber(Math.floor(daysLeft))} hari`}</span>
                                  {row.depletion_date && <small className="text-muted tabular">{formatDateShort(`${row.depletion_date}T00:00:00+07:00`)}</small>}
                                  {urgent && <Badge tone="red" size="sm">Pesan sekarang</Badge>}
                                </span>
                              )}
                            </td>
                            <td className="num tabular">
                              {!suggested ? <span className="text-muted">Cukup</span> : (
                                <span className="inv-suggest">
                                  <strong>{formatQty(row.suggested_quantity, row.unit)}</strong>
                                  {row.purchase_unit && row.suggested_purchase_units && <small>≈ {formatNumber(row.suggested_purchase_units)} {row.purchase_unit}</small>}
                                </span>
                              )}
                            </td>
                            <td>{supplierNames.get(item?.default_supplier_id) || <span className="text-muted">Belum ada</span>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
      </Card>

      {confirm && (
        <ConfirmDialog tone="primary" title="Buat draf PO dari saran?" confirmLabel={`Buat ${plan.groups.length} draf`}
          onConfirm={createDrafts} onClose={() => setConfirm(false)}
          description="Satu draf per supplier utama. Jumlah dibulatkan ke kemasan beli; harga memakai harga beli terakhir. Draf bisa diubah sebelum dipesan.">
          <ul className="inv-plan">
            {plan.groups.map(([supplierId, items]) => (
              <li key={supplierId}>
                <strong>{supplierNames.get(supplierId)}</strong>
                <span>{items.map((line) => `${line.name} ${formatNumber(line.quantity)} ${line.unit_label}`).join(', ')}</span>
                <small className="tabular">± {formatRupiah(items.reduce((sum, line) => sum + line.quantity * line.unit_price, 0))}</small>
              </li>
            ))}
          </ul>
          {plan.orphans.length > 0 && <p className="ui-field-hint">Tanpa supplier utama, tidak dibuatkan PO: {plan.orphans.map((row) => row.name).join(', ')}.</p>}
        </ConfirmDialog>
      )}
    </div>
  )
}
