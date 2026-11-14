import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { ChevronRight, Download, FileSpreadsheet, FileText, ReceiptText } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import { OrderDetailDrawer } from '../components/orders/OrderDetailDrawer.jsx'
import {
  Button, Card, DateRangePicker, EmptyState, ErrorState, IconButton, Menu, OrderStatusBadge, PageHeader, Pagination,
  PaymentBadge, SearchInput, Select, SkeletonRows, useToast,
} from '../components/ui/index.js'
import { isCancelled, isPaid } from '../lib/analytics.js'
import { resolveRange } from '../lib/dateRange.js'
import { customerLabel, fetchAllRows, fetchCustomerNames, fetchOrderItems, friendlyError, orderColumns } from '../lib/db.js'
import { buildExportRows, exportCsv, exportXlsx } from '../lib/exportOrders.js'
import {
  formatDateShort, formatNumber, formatOrderReference, formatQueueNumber, formatRupiah, formatTime, summarizeItems,
} from '../lib/format.js'
import { ORDER_STATUS, paymentMethodLabel } from '../lib/status.js'

const PAGE_SIZE = 25
const STATUS_OPTIONS = [{ value: 'all', label: 'Semua status' }, ...Object.entries(ORDER_STATUS).map(([value, meta]) => ({ value, label: meta.label }))]
const PAYMENT_OPTIONS = [
  { value: 'all', label: 'Semua pembayaran' },
  { value: 'paid', label: 'Lunas' },
  { value: 'unpaid', label: 'Belum lunas' },
]

function searchText(order) {
  return [formatQueueNumber(order), order.customer_name, order.order_number, order.id]
    .filter(Boolean).join(' ').toLocaleLowerCase('id')
}

export function OrdersPage() {
  const { cafe, features } = useOutletContext()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [searchParams] = useSearchParams()
  const [rangeValue, setRangeValue] = useState({ preset: '30d', custom: null })
  const [statusFilter, setStatusFilter] = useState(() => (ORDER_STATUS[searchParams.get('status')] ? searchParams.get('status') : 'all'))
  const [paymentFilter, setPaymentFilter] = useState(() => (['paid', 'unpaid'].includes(searchParams.get('payment')) ? searchParams.get('payment') : 'all'))
  const [sourceFilter, setSourceFilter] = useState('all')
  // ?q=… dari palet perintah (Ctrl/Cmd+K) mengisi kotak cari; berubah lagi bila palet dipakai saat halaman ini terbuka
  const urlQuery = searchParams.get('q') || ''
  const [query, setQuery] = useState(urlQuery)
  const [seenUrlQuery, setSeenUrlQuery] = useState(urlQuery)
  if (urlQuery !== seenUrlQuery) {
    setSeenUrlQuery(urlQuery)
    setQuery(urlQuery)
  }
  const [page, setPage] = useState(1)
  const [orders, setOrders] = useState([])
  const [itemsByOrder, setItemsByOrder] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [exporting, setExporting] = useState(false)
  const requestId = useRef(0)

  const range = useMemo(() => (rangeValue.preset === 'all' ? null : resolveRange(rangeValue.preset, rangeValue.custom)), [rangeValue])

  const loadOrders = useCallback(async () => {
    const current = ++requestId.current
    setLoading(true)
    setLoadError('')
    const { data, error } = await fetchAllRows(() => {
      let request = supabase.from('orders').select(orderColumns(features)).eq('cafe_id', cafe.id)
      if (range) request = request.gte('created_at', range.start.toISOString()).lt('created_at', range.endExclusive.toISOString())
      if (statusFilter !== 'all') request = request.eq('order_status', statusFilter)
      if (paymentFilter === 'paid') request = request.eq('payment_status', 'paid')
      if (paymentFilter === 'unpaid') request = request.neq('payment_status', 'paid')
      if (features?.pos && sourceFilter !== 'all') request = request.eq('source', sourceFilter)
      return request.order('created_at', { ascending: false }).order('id', { ascending: false })
    })
    if (current !== requestId.current) return
    if (error) {
      setLoadError(friendlyError(error))
      setLoading(false)
      return
    }
    const { names } = await fetchCustomerNames(supabase, data.map((order) => order.id))
    if (current !== requestId.current) return
    setOrders(data.map((order) => ({ ...order, customer_name: names.get(order.id) || '' })))
    setItemsByOrder(new Map())
    setLoading(false)
  }, [cafe.id, features, paymentFilter, range, sourceFilter, statusFilter, supabase])

  useEffect(() => {
    const timer = window.setTimeout(loadOrders, 0)
    return () => {
      window.clearTimeout(timer)
      requestId.current += 1
    }
  }, [attempt, loadOrders])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id').replace(/^#/, '')
    return needle ? orders.filter((order) => searchText(order).includes(needle)) : orders
  }, [orders, query])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const pageIdsKey = pageRows.map((order) => order.id).join(',')

  // Item ringkas hanya untuk baris di halaman ini.
  useEffect(() => {
    const missing = pageIdsKey.split(',').filter((id) => id && !itemsByOrder.has(id))
    if (!missing.length) return undefined
    let active = true
    fetchOrderItems(supabase, missing).then(({ byOrder }) => {
      if (!active) return
      setItemsByOrder((current) => {
        const next = new Map(current)
        missing.forEach((id) => next.set(id, byOrder.get(id) || []))
        return next
      })
    })
    return () => { active = false }
  }, [itemsByOrder, pageIdsKey, supabase])

  const totals = useMemo(() => {
    const active = filtered.filter((order) => !isCancelled(order))
    return {
      count: filtered.length,
      value: active.reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0),
      paid: filtered.filter(isPaid).reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0),
      paidCount: filtered.filter(isPaid).length,
    }
  }, [filtered])

  function resetPage(setter) {
    return (value) => {
      setter(value)
      setPage(1)
    }
  }

  async function handleExport(format) {
    if (!filtered.length) return
    setExporting(true)
    try {
      const missing = filtered.map((order) => order.id).filter((id) => !itemsByOrder.has(id))
      const { byOrder, error } = await fetchOrderItems(supabase, missing)
      if (error) throw new Error(friendlyError(error))
      const allItems = new Map([...itemsByOrder, ...byOrder])
      const rows = buildExportRows(filtered, allItems)
      const stamp = range ? `${range.startKey}_${range.endKey}` : 'semua'
      const fileName = `transaksi-${cafe.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${stamp}`
      if (format === 'xlsx') await exportXlsx(rows, fileName)
      else exportCsv(rows, fileName)
      toast({ title: `${formatNumber(rows.length)} transaksi diekspor`, description: format === 'xlsx' ? 'File Excel (.xlsx) diunduh.' : 'File CSV diunduh.' })
    } catch (caught) {
      toast({ tone: 'error', title: 'Ekspor gagal', description: caught.message })
    }
    setExporting(false)
  }

  function handleChanged(updated, kind) {
    setOrders((current) => current.map((order) => (order.id === updated.id ? { ...order, ...updated, customer_name: order.customer_name } : order)))
    toast({
      title: kind === 'paid' ? `${formatQueueNumber(updated)} lunas` : `${formatQueueNumber(updated)} dibatalkan`,
      description: kind === 'paid' ? `${formatRupiah(updated.total_amount)} · ${paymentMethodLabel(updated.payment_method)}` : updated.cancel_reason,
    })
  }

  const selected = orders.find((order) => order.id === selectedId)
  const filtersActive = query || statusFilter !== 'all' || paymentFilter !== 'all' || sourceFilter !== 'all'

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operasional"
        title="Transaksi"
        description="Cari, saring, dan ekspor pesanan. Klik baris untuk detail dan linimasa."
        actions={(
          <Menu
            label="Pilihan ekspor"
            trigger={({ props }) => (
              <Button variant="secondary" icon={Download} loading={exporting} disabled={!filtered.length || loading} {...props}>Ekspor</Button>
            )}
            items={[
              { label: 'Excel (.xlsx)', icon: FileSpreadsheet, hint: `${formatNumber(filtered.length)} baris`, onSelect: () => handleExport('xlsx') },
              { label: 'CSV', icon: FileText, hint: `${formatNumber(filtered.length)} baris`, onSelect: () => handleExport('csv') },
            ]}
          />
        )}
      />

      <section className="toolbar" aria-label="Filter transaksi">
        <SearchInput value={query} onChange={resetPage(setQuery)} placeholder="Cari nomor antrean atau nama customer…" label="Cari transaksi" className="toolbar-search" />
        <DateRangePicker value={rangeValue} onChange={resetPage(setRangeValue)} allowAll />
        <Select hideLabel label="Status pesanan" value={statusFilter} onChange={(event) => resetPage(setStatusFilter)(event.target.value)} options={STATUS_OPTIONS} />
        <Select hideLabel label="Status pembayaran" value={paymentFilter} onChange={(event) => resetPage(setPaymentFilter)(event.target.value)} options={PAYMENT_OPTIONS} />
        {features?.pos && (
          <Select hideLabel label="Sumber pesanan" value={sourceFilter} onChange={(event) => resetPage(setSourceFilter)(event.target.value)}
            options={[{ value: 'all', label: 'Semua sumber' }, { value: 'app', label: 'Aplikasi' }, { value: 'pos', label: 'Kasir' }]} />
        )}
      </section>

      {loadError ? (
        <Card><ErrorState message={loadError} onRetry={() => setAttempt((value) => value + 1)} /></Card>
      ) : loading && !orders.length ? (
        <Card padding="none"><SkeletonRows rows={8} label="Memuat transaksi" /></Card>
      ) : !filtered.length ? (
        <Card>
          <EmptyState
            icon={ReceiptText}
            title={filtersActive ? 'Tidak ada transaksi yang cocok' : 'Belum ada transaksi pada rentang ini'}
            description={filtersActive ? 'Coba kata kunci lain atau ubah filter.' : 'Pilih rentang tanggal lain, atau tunggu pesanan dari customer.'}
            action={filtersActive && (
              <Button variant="secondary" onClick={() => { setQuery(''); setStatusFilter('all'); setPaymentFilter('all'); setSourceFilter('all'); setPage(1) }}>Hapus filter</Button>
            )}
          />
        </Card>
      ) : (
        <Card padding="none" className={`table-card${loading ? ' is-refreshing' : ''}`}>
          <div className="table-scroll">
            <table className="data-table orders-table">
              <thead>
                <tr>
                  <th scope="col">No. antrean</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Waktu</th>
                  <th scope="col" className="col-items">Item</th>
                  <th scope="col">Status</th>
                  <th scope="col">Pembayaran</th>
                  <th scope="col" className="num-col">Total</th>
                  <th scope="col"><span className="sr-only">Aksi</span></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((order) => {
                  const items = itemsByOrder.get(order.id)
                  return (
                    <tr key={order.id} className={`is-clickable${isCancelled(order) ? ' is-muted' : ''}`} onClick={() => setSelectedId(order.id)}>
                      <td>
                        <strong className="cell-queue tabular">{formatQueueNumber(order)}</strong>
                        <small className="cell-sub tabular">{formatOrderReference(order)}</small>
                      </td>
                      <td>{customerLabel(order)}{order.source === 'pos' && <small className="cell-sub">Kasir{order.table_label ? ` · Meja ${order.table_label}` : ''}</small>}</td>
                      <td className="tabular">{formatDateShort(order.created_at)}<small className="cell-sub">{formatTime(order.created_at)} WIB</small></td>
                      <td className="col-items cell-muted">{items ? summarizeItems(items) : <span className="cell-loading">Memuat…</span>}</td>
                      <td><OrderStatusBadge status={order.order_status} size="sm" /></td>
                      <td>
                        <PaymentBadge status={order.payment_status} size="sm" />
                        {order.payment_method && <small className="cell-sub">{paymentMethodLabel(order.payment_method)}</small>}
                      </td>
                      <td className="num-col tabular"><strong>{formatRupiah(order.total_amount)}</strong></td>
                      <td className="actions-col">
                        <IconButton
                          icon={ChevronRight}
                          size="sm"
                          label={`Detail ${formatQueueNumber(order)}`}
                          tooltip={false}
                          onClick={(event) => { event.stopPropagation(); setSelectedId(order.id) }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}>
                    <span className="tfoot-label">{formatNumber(totals.count)} transaksi terfilter</span>
                    <span className="tfoot-sub">Lunas {formatNumber(totals.paidCount)} · nilai tanpa yang dibatalkan {formatRupiah(totals.value)}</span>
                  </td>
                  <td className="num-col tabular" colSpan={2}>
                    <span className="tfoot-sub">Pendapatan lunas</span>
                    <strong className="tfoot-total">{formatRupiah(totals.paid)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <Pagination page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} itemLabel="transaksi" />
        </Card>
      )}

      {selected && (
        <OrderDetailDrawer
          key={selected.id}
          order={selected}
          cafe={cafe}
          features={features}
          onClose={() => setSelectedId(null)}
          onChanged={handleChanged}
        />
      )}
    </div>
  )
}
