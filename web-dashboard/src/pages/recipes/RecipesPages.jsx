/*
 * Resep & HPP: HPP per produk dari resep (RPC inventory_product_costing) dan
 * profit produk per rentang tanggal (RPC inventory_product_profitability).
 */
import { useCallback, useMemo, useState } from 'react'
import { NavLink, Outlet, useOutletContext } from 'react-router-dom'
import { BookOpen, ChefHat, CircleDollarSign, Download, FileSpreadsheet, FileText, Percent, TrendingUp } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import {
  Badge, Button, Card, CardHeader, DateRangePicker, EmptyState, ErrorState, Menu, PageHeader, SearchInput, SegmentedControl, Select,
  SkeletonRows, StatCard, useToast,
} from '../../components/ui/index.js'
import { RecipeDrawer } from '../../components/inventory/RecipeDrawer.jsx'
import { resolveRange } from '../../lib/dateRange.js'
import { INVENTORY_REQUIRED } from '../../lib/db.js'
import { formatNumber, formatRupiah } from '../../lib/format.js'
import { callRpc, exportRows, fetchIngredients, useLoader } from '../../lib/inventory.js'

const LOW_MARGIN = 60
const TABS = [
  { to: '.', label: 'HPP per produk', end: true },
  { to: 'profit', label: 'Profit produk' },
]
const percent = (value) => (value === null || value === undefined ? '—' : `${Number(value).toFixed(1).replace('.', ',')}%`)

export function RecipesLayout() {
  const context = useOutletContext()
  return (
    <div className="page page-wide">
      <PageHeader eyebrow="Inventori" title="Resep & HPP" description="Takaran bahan per produk, harga pokok, dan laba kotor yang sebenarnya." />
      <nav className="settings-tabs" aria-label="Bagian resep">
        {TABS.map((tab) => (
          <NavLink key={tab.label} to={tab.to} end={tab.end} className={({ isActive }) => `settings-tab${isActive ? ' is-active' : ''}`}>{tab.label}</NavLink>
        ))}
      </nav>
      {context.features?.inventory ? <Outlet context={context} /> : <Card><EmptyState title="Belum tersedia" description={INVENTORY_REQUIRED} /></Card>}
    </div>
  )
}

/* ====================================================================
 * HPP per produk
 * ==================================================================== */
export function ProductCostingPage() {
  const { cafe } = useOutletContext()
  const { supabase } = useAuth()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('name')
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    const [costing, ingredients, categoryResult] = await Promise.all([
      callRpc(supabase, 'inventory_product_costing', { p_cafe_id: cafe.id }),
      fetchIngredients(supabase, cafe.id),
      supabase.from('categories').select('id, name').eq('cafe_id', cafe.id),
    ])
    return { costing: costing || [], ingredients, categories: new Map((categoryResult.data || []).map((category) => [category.id, category.name])) }
  }, [cafe.id, supabase])
  const { data, error, loading, reload } = useLoader(load)

  const costing = useMemo(() => data?.costing || [], [data])
  const withRecipe = costing.filter((row) => row.recipe_lines > 0)
  const lowMargin = withRecipe.filter((row) => row.margin_pct !== null && Number(row.margin_pct) < LOW_MARGIN)
  const uncosted = withRecipe.filter((row) => row.uncosted_lines > 0)
  const averageMargin = withRecipe.length ? withRecipe.reduce((sum, row) => sum + Number(row.margin_pct || 0), 0) / withRecipe.length : null

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id')
    const list = costing.filter((row) => {
      if (filter === 'missing' && row.recipe_lines > 0) return false
      if (filter === 'low' && !(row.recipe_lines > 0 && Number(row.margin_pct) < LOW_MARGIN)) return false
      return !needle || row.product_name.toLocaleLowerCase('id').includes(needle)
    })
    const marginOf = (row) => (row.recipe_lines > 0 ? Number(row.margin_pct) : null)
    return [...list].sort((a, b) => {
      if (sort === 'margin-asc' || sort === 'margin-desc') {
        const ma = marginOf(a)
        const mb = marginOf(b)
        if (ma === null) return 1
        if (mb === null) return -1
        return sort === 'margin-asc' ? ma - mb : mb - ma
      }
      if (sort === 'cost') return Number(b.cost_per_portion || 0) - Number(a.cost_per_portion || 0)
      return a.product_name.localeCompare(b.product_name, 'id')
    })
  }, [costing, filter, query, sort])

  if (error) return <Card><ErrorState message={error} onRetry={reload} /></Card>
  if (!data) return <Card padding="none"><SkeletonRows rows={6} label="Menghitung HPP" /></Card>

  return (
    <div className="inv-page">
      <section className="dash-stats inv-stats" aria-label="Ringkasan HPP">
        <StatCard icon={Percent} label="Margin rata-rata" value={percent(averageMargin)} caption={`Dari ${withRecipe.length} produk berresep`} />
        <StatCard icon={BookOpen} tone="neutral" label="Sudah ada resep" value={`${formatNumber(withRecipe.length)} / ${formatNumber(costing.length)}`}
          caption={costing.length - withRecipe.length ? `${costing.length - withRecipe.length} produk belum` : 'Semua produk'} onClick={costing.length - withRecipe.length ? () => setFilter('missing') : undefined} />
        <StatCard icon={TrendingUp} tone="amber" label={`Margin < ${LOW_MARGIN}%`} value={formatNumber(lowMargin.length)}
          caption={lowMargin.length ? lowMargin.slice(0, 2).map((row) => row.product_name).join(', ') : 'Semua sehat'} onClick={lowMargin.length ? () => setFilter('low') : undefined} />
        <StatCard icon={CircleDollarSign} tone="neutral" label="Bahan tanpa harga" value={formatNumber(uncosted.length)} caption={uncosted.length ? 'HPP-nya terlalu rendah' : 'Semua bahan berharga'} />
      </section>

      <section className="toolbar" aria-label="Filter produk">
        <SearchInput value={query} onChange={setQuery} placeholder="Cari produk…" label="Cari produk" className="toolbar-search" />
        <SegmentedControl label="Filter" value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'Semua' },
          { value: 'missing', label: 'Tanpa resep', count: costing.length - withRecipe.length },
          { value: 'low', label: `Margin < ${LOW_MARGIN}%`, count: lowMargin.length },
        ]} />
        <Select hideLabel label="Urutkan" value={sort} onChange={(event) => setSort(event.target.value)} options={[
          { value: 'name', label: 'Nama A–Z' }, { value: 'margin-asc', label: 'Margin terendah' },
          { value: 'margin-desc', label: 'Margin tertinggi' }, { value: 'cost', label: 'HPP tertinggi' },
        ]} />
      </section>

      <Card padding="none" className={`table-card${loading ? ' is-refreshing' : ''}`}>
        {!costing.length ? <EmptyState compact icon={ChefHat} title="Belum ada produk" description="Tambahkan produk di Katalog dulu." />
          : !rows.length ? <EmptyState compact title="Tidak ada produk yang cocok" description="Ubah kata kunci atau filter." />
            : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Produk</th>
                      <th scope="col" className="num">Harga jual</th>
                      <th scope="col" className="num">HPP / porsi</th>
                      <th scope="col" className="num">Laba kotor</th>
                      <th scope="col" className="num">Margin</th>
                      <th scope="col" className="num">Bisa dibuat</th>
                      <th scope="col"><span className="sr-only">Resep</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const has = row.recipe_lines > 0
                      const low = has && Number(row.margin_pct) < LOW_MARGIN
                      return (
                        <tr key={row.product_id} className="is-clickable" onClick={() => setEditing(row)}>
                          <td>
                            <span className="inv-name">
                              <strong>{row.product_name}</strong>
                              <small>{data.categories.get(row.category_id) || 'Tanpa kategori'}{row.is_available ? '' : ' · nonaktif'}</small>
                            </span>
                          </td>
                          <td className="num tabular">{formatRupiah(row.price)}</td>
                          <td className="num tabular">{has ? formatRupiah(row.cost_per_portion) : <span className="text-muted">—</span>}
                            {row.uncosted_lines > 0 && <Badge tone="amber" size="sm" dot={false} className="inv-inline-badge">{row.uncosted_lines} tanpa harga</Badge>}
                          </td>
                          <td className="num tabular">{has ? formatRupiah(row.gross_profit) : <span className="text-muted">—</span>}</td>
                          <td className="num">
                            {has ? <span className={`inv-margin tabular${low ? ' is-low' : ''}`}><span className="inv-margin-bar" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, Number(row.margin_pct)))}%` }} /></span>{percent(row.margin_pct)}</span>
                              : <Badge tone="neutral" size="sm" dot={false}>Belum ada resep</Badge>}
                          </td>
                          <td className="num tabular">
                            {has ? (
                              <span className="inv-name is-right">
                                <strong>{formatNumber(row.portions_available || 0)} porsi</strong>
                                {row.limiting_ingredient && <small>dibatasi {row.limiting_ingredient}</small>}
                              </span>
                            ) : <span className="text-muted">—</span>}
                          </td>
                          <td className="cell-actions"><Button size="sm" variant={has ? 'ghost' : 'secondary'} onClick={(event) => { event.stopPropagation(); setEditing(row) }}>{has ? 'Ubah resep' : 'Buat resep'}</Button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
      </Card>

      {editing && (
        <RecipeDrawer product={{ id: editing.product_id, name: editing.product_name, price: editing.price }} ingredients={data.ingredients}
          onClose={() => setEditing(null)} onSaved={reload} />
      )}
    </div>
  )
}

/* ====================================================================
 * Profit produk
 * ==================================================================== */
export function ProfitabilityPage() {
  const { cafe } = useOutletContext()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [rangeValue, setRangeValue] = useState({ preset: '30d', custom: null })
  const [exporting, setExporting] = useState(false)
  const range = useMemo(() => resolveRange(rangeValue.preset, rangeValue.custom), [rangeValue])

  const load = useCallback(() => callRpc(supabase, 'inventory_product_profitability', {
    p_cafe_id: cafe.id, p_from: range.start.toISOString(), p_to: range.endExclusive.toISOString(),
  }), [cafe.id, range, supabase])
  const { data, error, loading, reload } = useLoader(load)

  const rows = useMemo(() => data || [], [data])
  const totals = rows.reduce((sum, row) => ({
    revenue: sum.revenue + Number(row.revenue),
    cost: sum.cost + Number(row.actual_cost) + Number(row.estimated_cost),
    estimated: sum.estimated + Number(row.estimated_cost),
    uncosted: sum.uncosted + Number(row.uncosted_quantity),
  }), { revenue: 0, cost: 0, estimated: 0, uncosted: 0 })
  const gross = totals.revenue - totals.cost
  const costed = rows.filter((row) => Number(row.uncosted_quantity) < Number(row.quantity_sold) && Number(row.revenue) > 0)
  const topProfit = [...costed].sort((a, b) => Number(b.gross_profit) - Number(a.gross_profit)).slice(0, 5)
  const lowMargin = [...costed].sort((a, b) => Number(a.margin_pct) - Number(b.margin_pct)).slice(0, 5)

  async function handleExport(format) {
    setExporting(true)
    try {
      await exportRows(rows.map((row) => ({
        product: row.product_name, sold: Number(row.quantity_sold), revenue: Number(row.revenue), actual: Number(row.actual_cost),
        estimated: Number(row.estimated_cost), uncosted: Number(row.uncosted_quantity), gross: Number(row.gross_profit), margin: row.margin_pct === null ? '' : Number(row.margin_pct),
      })), [
        { key: 'product', header: 'Produk', width: 28 },
        { key: 'sold', header: 'Terjual', number: true, width: 10 },
        { key: 'revenue', header: 'Pendapatan (Rp)', number: true, format: '#,##0', width: 16 },
        { key: 'actual', header: 'HPP aktual (Rp)', number: true, format: '#,##0', width: 16 },
        { key: 'estimated', header: 'HPP estimasi (Rp)', number: true, format: '#,##0', width: 16 },
        { key: 'uncosted', header: 'Porsi tanpa resep', number: true, width: 14 },
        { key: 'gross', header: 'Laba kotor (Rp)', number: true, format: '#,##0', width: 16 },
        { key: 'margin', header: 'Margin (%)', number: true, format: '0.0', width: 10 },
      ], `profit-produk-${range.startKey}_${range.endKey}`, format, 'Profit produk')
    } catch (caught) {
      toast({ tone: 'error', title: 'Ekspor gagal', description: caught.message })
    }
    setExporting(false)
  }

  return (
    <div className="inv-page">
      <section className="toolbar" aria-label="Rentang profit">
        <DateRangePicker value={rangeValue} onChange={setRangeValue} />
        <Menu
          label="Pilihan ekspor"
          trigger={({ props }) => <Button variant="secondary" icon={Download} loading={exporting} disabled={!rows.length} className="toolbar-end" {...props}>Ekspor</Button>}
          items={[
            { label: 'Excel (.xlsx)', icon: FileSpreadsheet, onSelect: () => handleExport('xlsx') },
            { label: 'CSV', icon: FileText, onSelect: () => handleExport('csv') },
          ]}
        />
      </section>

      {error ? <Card><ErrorState message={error} onRetry={reload} /></Card>
        : !data ? <Card padding="none"><SkeletonRows rows={6} label="Menghitung profit" /></Card>
          : (
            <div className={loading ? 'is-refreshing' : ''}>
              <section className="dash-stats inv-stats" aria-label="Ringkasan profit">
                <StatCard icon={TrendingUp} label="Laba kotor" value={formatRupiah(gross)} caption={totals.revenue ? `Margin ${percent((gross / totals.revenue) * 100)}` : 'Belum ada penjualan'} />
                <StatCard icon={CircleDollarSign} tone="neutral" label="Pendapatan produk" value={formatRupiah(totals.revenue)} caption="Pesanan selesai, sebelum pajak" />
                <StatCard icon={ChefHat} tone="neutral" label="HPP" value={formatRupiah(totals.cost)}
                  caption={totals.estimated ? `${formatRupiah(totals.estimated)} di antaranya estimasi` : 'Seluruhnya dari pemakaian tercatat'} />
                <StatCard icon={BookOpen} tone="amber" label="Porsi tanpa resep" value={formatNumber(totals.uncosted)} caption={totals.uncosted ? 'HPP-nya dianggap 0 — laba terlalu tinggi' : 'Semua porsi berbiaya'} />
              </section>

              <p className="inv-footnote">
                <strong>Aktual</strong> = bahan yang benar-benar terpotong saat pesanan selesai (pelacakan stok aktif).
                <strong> Estimasi</strong> = jumlah terjual × HPP resep saat ini, untuk pesanan sebelum pelacakan aktif. Pendapatan belum dikurangi diskon & pajak (menyusul bersama POS).
              </p>

              {!rows.length ? <Card><EmptyState compact icon={TrendingUp} title="Belum ada pesanan selesai" description="Pilih rentang tanggal yang lebih panjang." /></Card> : (
                <>
                  <div className="inv-rank-grid">
                    <RankCard title="Paling menguntungkan" description="Laba kotor terbesar" rows={topProfit} value={(row) => formatRupiah(row.gross_profit)} />
                    <RankCard title="Margin terendah" description="Kandidat naik harga atau ubah resep" rows={lowMargin} value={(row) => percent(row.margin_pct)} low />
                  </div>
                  <Card padding="none" className="table-card">
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th scope="col">Produk</th><th scope="col" className="num">Terjual</th><th scope="col" className="num">Pendapatan</th>
                            <th scope="col" className="num">HPP</th><th scope="col" className="num">Laba kotor</th><th scope="col" className="num">Margin</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => {
                            const cost = Number(row.actual_cost) + Number(row.estimated_cost)
                            const uncostedAll = Number(row.uncosted_quantity) >= Number(row.quantity_sold)
                            return (
                              <tr key={row.product_id || row.product_name}>
                                <td><strong>{row.product_name}</strong>{!row.product_id && <small className="text-muted"> · produk terhapus</small>}</td>
                                <td className="num tabular">{formatNumber(row.quantity_sold)}</td>
                                <td className="num tabular">{formatRupiah(row.revenue)}</td>
                                <td className="num tabular">
                                  {uncostedAll ? <Badge tone="neutral" size="sm" dot={false}>Tanpa resep</Badge> : formatRupiah(cost)}
                                  {!uncostedAll && Number(row.estimated_cost) > 0 && <Badge tone="amber" size="sm" dot={false} className="inv-inline-badge">{Number(row.actual_cost) > 0 ? 'sebagian estimasi' : 'estimasi'}</Badge>}
                                </td>
                                <td className="num tabular">{uncostedAll ? <span className="text-muted">—</span> : formatRupiah(row.gross_profit)}</td>
                                <td className="num tabular">{uncostedAll ? <span className="text-muted">—</span> : percent(row.margin_pct)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </>
              )}
            </div>
          )}
    </div>
  )
}

function RankCard({ title, description, rows, value, low = false }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {!rows.length ? <p className="text-muted">Belum ada produk berresep yang terjual.</p> : (
        <ol className="inv-rank">
          {rows.map((row, index) => (
            <li key={row.product_id || row.product_name}>
              <span className="inv-rank-index tabular">{index + 1}</span>
              <span className="inv-name"><strong>{row.product_name}</strong><small className="tabular">{formatNumber(row.quantity_sold)} terjual · {formatRupiah(row.revenue)}</small></span>
              <strong className={`tabular${low ? ' inv-low' : ''}`}>{value(row)}</strong>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
