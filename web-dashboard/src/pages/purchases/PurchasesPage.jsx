/*
 * Pembelian: daftar purchase order, utang supplier, jatuh tempo.
 */
import { useCallback, useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { AlarmClock, FilePlus2, Receipt, Truck, Wallet } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import {
  Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, Select, SkeletonRows, StatCard,
} from '../../components/ui/index.js'
import { PurchaseOrderDetailDrawer, PurchaseOrderFormDrawer } from '../../components/purchases/PurchaseDialogs.jsx'
import { fetchAllRows, INVENTORY_REQUIRED } from '../../lib/db.js'
import { formatNumber, formatRupiah, jakartaDateKey } from '../../lib/format.js'
import {
  dateOnly, daysUntil, fetchIngredients, fetchSuppliers, inventoryError, outstandingOf, PO_STATUS, useLoader,
} from '../../lib/inventory.js'

const PAGE_SIZE = 30

export function PurchasesPage() {
  const context = useOutletContext()
  return (
    <div className="page page-wide">
      <PageHeader eyebrow="Inventori" title="Pembelian" description="Purchase order ke supplier, penerimaan barang, dan utang yang harus dibayar." />
      {context.features?.inventory ? <PurchasesContent cafe={context.cafe} /> : <Card><EmptyState title="Belum tersedia" description={INVENTORY_REQUIRED} /></Card>}
    </div>
  )
}

function PurchasesContent({ cafe }) {
  const { supabase } = useAuth()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [supplierFilter, setSupplierFilter] = useState(params.get('supplier') || 'all')
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState(null)
  const today = jakartaDateKey()

  const load = useCallback(async () => {
    const [orders, suppliers, ingredients, catalogResult] = await Promise.all([
      fetchAllRows(() => supabase.from('purchase_orders')
        .select('id, supplier_id, po_number, status, order_date, expected_date, due_date, notes, total_amount, received_amount, paid_amount, closed_short, created_at, received_at')
        .eq('cafe_id', cafe.id).order('created_at', { ascending: false })),
      fetchSuppliers(supabase, cafe.id),
      fetchIngredients(supabase, cafe.id),
      supabase.from('supplier_items').select('supplier_id, ingredient_id, unit_label, unit_size, last_price').eq('cafe_id', cafe.id),
    ])
    if (orders.error) throw new Error(inventoryError(orders.error))
    if (catalogResult.error) throw new Error(inventoryError(catalogResult.error))
    return { orders: orders.data, suppliers, ingredients, catalog: catalogResult.data || [] }
  }, [cafe.id, supabase])
  const { data, error, loading, reload } = useLoader(load)

  const orders = useMemo(() => data?.orders || [], [data])
  const supplierNames = useMemo(() => new Map((data?.suppliers || []).map((supplier) => [supplier.id, supplier.name])), [data])
  const live = orders.filter((po) => po.status !== 'cancelled' && po.status !== 'draft')
  const payable = live.reduce((sum, po) => sum + Math.max(outstandingOf(po), 0), 0)
  const overdue = live.filter((po) => outstandingOf(po) > 0 && po.due_date && daysUntil(po.due_date, today) < 0)
  const dueSoon = live.filter((po) => outstandingOf(po) > 0 && po.due_date && daysUntil(po.due_date, today) >= 0 && daysUntil(po.due_date, today) <= 7)
  const waiting = orders.filter((po) => ['ordered', 'partial'].includes(po.status))
  const monthKey = today.slice(0, 7)
  const monthSpend = live.filter((po) => po.received_at && jakartaDateKey(po.received_at).startsWith(monthKey)).reduce((sum, po) => sum + Number(po.received_amount), 0)

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id')
    return orders.filter((po) => {
      if (status === 'unpaid' ? !(po.status !== 'cancelled' && outstandingOf(po) > 0) : status !== 'all' && po.status !== status) return false
      if (supplierFilter !== 'all' && po.supplier_id !== supplierFilter) return false
      return !needle || `${po.po_number} ${supplierNames.get(po.supplier_id) || ''}`.toLocaleLowerCase('id').includes(needle)
    })
  }, [orders, query, status, supplierFilter, supplierNames])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  if (error) return <Card><ErrorState message={error} onRetry={reload} /></Card>
  if (!data) return <Card padding="none"><SkeletonRows rows={6} label="Memuat pembelian" /></Card>

  const hasSuppliers = data.suppliers.some((supplier) => supplier.is_active)
  return (
    <div className="inv-page">
      <section className="dash-stats inv-stats" aria-label="Ringkasan pembelian">
        <StatCard icon={Wallet} label="Utang ke supplier" value={formatRupiah(payable)} caption={`${formatNumber(live.filter((po) => outstandingOf(po) > 0).length)} PO belum lunas`}
          onClick={payable ? () => { setStatus('unpaid'); setPage(1) } : undefined} />
        <StatCard icon={AlarmClock} tone="amber" label="Lewat jatuh tempo" value={formatRupiah(overdue.reduce((sum, po) => sum + outstandingOf(po), 0))}
          caption={overdue.length ? `${overdue.length} PO · ${dueSoon.length} jatuh tempo ≤ 7 hari` : dueSoon.length ? `${dueSoon.length} jatuh tempo ≤ 7 hari` : 'Tidak ada'} />
        <StatCard icon={Truck} tone="blue" label="Menunggu barang" value={formatNumber(waiting.length)} caption={waiting.length ? `${formatRupiah(waiting.reduce((sum, po) => sum + Number(po.total_amount) - Number(po.received_amount), 0))} belum datang` : 'Semua PO sudah datang'}
          onClick={waiting.length ? () => { setStatus('ordered'); setPage(1) } : undefined} />
        <StatCard icon={Receipt} tone="neutral" label="Barang diterima bulan ini" value={formatRupiah(monthSpend)} caption="Nilai dari PO" />
      </section>

      <section className="toolbar" aria-label="Filter pembelian">
        <SearchInput value={query} onChange={(value) => { setQuery(value); setPage(1) }} placeholder="Cari no. PO atau supplier…" label="Cari PO" className="toolbar-search" />
        <Select hideLabel label="Status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}
          options={[{ value: 'all', label: 'Semua status' }, { value: 'unpaid', label: 'Belum lunas' }, ...Object.entries(PO_STATUS).map(([value, meta]) => ({ value, label: meta.label }))]} />
        <Select hideLabel label="Supplier" value={supplierFilter} onChange={(event) => {
          setSupplierFilter(event.target.value)
          setPage(1)
          setParams((current) => {
            const next = new URLSearchParams(current)
            if (event.target.value === 'all') next.delete('supplier')
            else next.set('supplier', event.target.value)
            return next
          }, { replace: true })
        }}
          options={[{ value: 'all', label: 'Semua supplier' }, ...data.suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))]} />
        <Button icon={FilePlus2} className="toolbar-end" disabled={!hasSuppliers} title={hasSuppliers ? undefined : 'Tambahkan supplier dulu'} onClick={() => setDialog({ type: 'form' })}>Buat PO</Button>
      </section>

      <Card padding="none" className={`table-card${loading ? ' is-refreshing' : ''}`}>
        {!orders.length ? (
          <EmptyState icon={Truck} title="Belum ada purchase order"
            description={hasSuppliers ? 'Buat PO untuk belanja ke supplier. Stok bertambah saat barang diterima, dan sisa tagihan tercatat sebagai utang.' : 'Tambahkan supplier dulu di menu Supplier, lalu buat PO.'}
            action={hasSuppliers && <Button icon={FilePlus2} onClick={() => setDialog({ type: 'form' })}>Buat PO pertama</Button>} />
        ) : !filtered.length ? (
          <EmptyState compact title="Tidak ada PO yang cocok" description="Ubah kata kunci atau filter." />
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">No. PO</th><th scope="col">Supplier</th><th scope="col">Tanggal</th><th scope="col">Status</th>
                    <th scope="col" className="num">Total</th><th scope="col" className="num">Sisa utang</th><th scope="col">Jatuh tempo</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((po) => {
                    const meta = PO_STATUS[po.status]
                    const outstanding = po.status === 'cancelled' ? 0 : outstandingOf(po)
                    const dueDays = po.due_date ? daysUntil(po.due_date, today) : null
                    return (
                      <tr key={po.id} className={`is-clickable${po.status === 'cancelled' ? ' is-muted' : ''}`} onClick={() => setDialog({ type: 'detail', id: po.id })}>
                        <td><strong className="tabular">{po.po_number}</strong></td>
                        <td>{supplierNames.get(po.supplier_id) || '—'}</td>
                        <td className="tabular">{dateOnly(po.order_date)}</td>
                        <td><Badge tone={meta.tone}>{meta.label}</Badge></td>
                        <td className="num tabular">{formatRupiah(po.total_amount)}</td>
                        <td className="num tabular">
                          {outstanding > 0 ? <strong>{formatRupiah(outstanding)}</strong>
                            : outstanding < 0 ? <span className="text-muted">uang muka {formatRupiah(-outstanding)}</span>
                              : Number(po.received_amount) > 0 ? <span className="text-muted">Lunas</span> : <span className="text-muted">—</span>}
                        </td>
                        <td>
                          {outstanding > 0 && po.due_date ? (
                            <span className="inv-expiry">
                              <span className="tabular">{dateOnly(po.due_date)}</span>
                              {dueDays < 0 ? <Badge tone="red" size="sm">Lewat {Math.abs(dueDays)} hari</Badge> : dueDays <= 7 ? <Badge tone="amber" size="sm">{dueDays === 0 ? 'Hari ini' : `${dueDays} hari`}</Badge> : null}
                            </span>
                          ) : <span className="text-muted">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} itemLabel="PO" />
          </>
        )}
      </Card>

      {dialog?.type === 'form' && (
        <PurchaseOrderFormDrawer cafeId={cafe.id} po={dialog.po || null} suppliers={data.suppliers} ingredients={data.ingredients} catalog={data.catalog}
          onClose={() => setDialog(dialog.po ? { type: 'detail', id: dialog.po.id } : null)}
          onSaved={(id) => { reload(); if (!dialog.po) window.setTimeout(() => setDialog({ type: 'detail', id }), 0) }} />
      )}
      {dialog?.type === 'detail' && (
        <PurchaseOrderDetailDrawer key={dialog.id} poId={dialog.id} cafe={cafe} suppliers={data.suppliers} ingredients={data.ingredients}
          onClose={() => setDialog(null)} onChanged={reload} onEdit={(po) => setDialog({ type: 'form', po })} />
      )}
    </div>
  )
}
