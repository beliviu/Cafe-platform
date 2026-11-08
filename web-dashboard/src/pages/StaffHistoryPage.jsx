import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Ban, CheckCircle2, ChevronRight, CircleDollarSign, History, Wallet } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import { OrderDetailDrawer } from '../components/orders/OrderDetailDrawer.jsx'
import {
  Button, Card, DateRangePicker, EmptyState, ErrorState, IconButton, OrderStatusBadge, PageHeader, Pagination, PaymentBadge,
  SearchInput, Select, SkeletonRows, useToast,
} from '../components/ui/index.js'
import { resolveRange } from '../lib/dateRange.js'
import { customerLabel, fetchAllRows, fetchCustomerNames, friendlyError, orderColumns } from '../lib/db.js'
import { formatDateShort, formatNumber, formatQueueNumber, formatRupiah, formatTime } from '../lib/format.js'
import { printOrderLabel } from '../lib/printLabel.js'
import { paymentMethodLabel } from '../lib/status.js'

const PAGE_SIZE = 30
const STATUS_OPTIONS = [
  { value: 'all', label: 'Selesai & dibatalkan' },
  { value: 'completed', label: 'Selesai' },
  { value: 'cancelled', label: 'Dibatalkan' },
]
const PAYMENT_OPTIONS = [
  { value: 'all', label: 'Semua pembayaran' },
  { value: 'paid', label: 'Lunas' },
  { value: 'unpaid', label: 'Belum lunas' },
]

export function StaffHistoryPage() {
  const { cafe, features } = useOutletContext()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [rangeValue, setRangeValue] = useState({ preset: 'today', custom: null })
  const [status, setStatus] = useState('all')
  const [payment, setPayment] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [detailId, setDetailId] = useState(null)
  const requestId = useRef(0)
  const range = useMemo(() => resolveRange(rangeValue.preset, rangeValue.custom), [rangeValue])

  const load = useCallback(async () => {
    const current = ++requestId.current
    setLoading(true)
    setError('')
    const { data, error: fetchError } = await fetchAllRows(() => {
      let request = supabase.from('orders').select(orderColumns(features)).eq('cafe_id', cafe.id)
        .gte('created_at', range.start.toISOString()).lt('created_at', range.endExclusive.toISOString())
      request = status === 'all' ? request.in('order_status', ['completed', 'cancelled']) : request.eq('order_status', status)
      if (payment === 'paid') request = request.eq('payment_status', 'paid')
      if (payment === 'unpaid') request = request.neq('payment_status', 'paid')
      return request.order('created_at', { ascending: false }).order('id', { ascending: false })
    })
    if (current !== requestId.current) return
    if (fetchError) {
      setError(friendlyError(fetchError))
      setLoading(false)
      return
    }
    const { names } = await fetchCustomerNames(supabase, data.map((order) => order.id))
    if (current !== requestId.current) return
    setOrders(data.map((order) => ({ ...order, customer_name: names.get(order.id) || '' })))
    setLoading(false)
  }, [cafe.id, features, payment, range, status, supabase])

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => {
      window.clearTimeout(timer)
      requestId.current += 1
    }
  }, [attempt, load])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id').replace(/^#/, '')
    if (!needle) return orders
    return orders.filter((order) => [formatQueueNumber(order), order.customer_name, order.order_number]
      .filter(Boolean).join(' ').toLocaleLowerCase('id').includes(needle))
  }, [orders, query])

  const summary = useMemo(() => {
    const completed = filtered.filter((order) => order.order_status === 'completed')
    const unpaid = completed.filter((order) => order.payment_status !== 'paid')
    return {
      completed: completed.length,
      cancelled: filtered.filter((order) => order.order_status === 'cancelled').length,
      paid: completed.filter((order) => order.payment_status === 'paid').reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0),
      unpaid: unpaid.length,
      unpaidValue: unpaid.reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0),
    }
  }, [filtered])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const detail = orders.find((order) => order.id === detailId)
  const withReset = (setter) => (value) => { setter(value); setPage(1) }

  return (
    <div className="page">
      <PageHeader eyebrow={cafe.name} title="Riwayat" description="Pesanan yang sudah selesai atau dibatalkan." />

      <section className="toolbar" aria-label="Filter riwayat">
        <SearchInput value={query} onChange={withReset(setQuery)} placeholder="Cari nomor antrean atau nama…" label="Cari riwayat" className="toolbar-search" />
        <DateRangePicker value={rangeValue} onChange={withReset(setRangeValue)} />
        <Select hideLabel label="Status" value={status} onChange={(event) => withReset(setStatus)(event.target.value)} options={STATUS_OPTIONS} />
        <Select hideLabel label="Pembayaran" value={payment} onChange={(event) => withReset(setPayment)(event.target.value)} options={PAYMENT_OPTIONS} />
      </section>

      <section className="board-strip" aria-label="Ringkasan rentang ini">
        <span><CheckCircle2 size={15} aria-hidden="true" /> Selesai <strong className="tabular">{formatNumber(summary.completed)}</strong></span>
        <span><Ban size={15} aria-hidden="true" /> Dibatalkan <strong className="tabular">{formatNumber(summary.cancelled)}</strong></span>
        <span><CircleDollarSign size={15} aria-hidden="true" /> Total lunas <strong className="tabular">{formatRupiah(summary.paid)}</strong></span>
        <span className={summary.unpaid ? 'is-warn' : ''}>
          <Wallet size={15} aria-hidden="true" /> Selesai belum lunas <strong className="tabular">{formatNumber(summary.unpaid)}</strong>
          {summary.unpaid > 0 && <small className="tabular">({formatRupiah(summary.unpaidValue)})</small>}
        </span>
      </section>

      {error ? (
        <Card><ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /></Card>
      ) : loading && !orders.length ? (
        <Card padding="none"><SkeletonRows rows={8} label="Memuat riwayat" /></Card>
      ) : !filtered.length ? (
        <Card>
          <EmptyState
            icon={History}
            title={query ? 'Tidak ada yang cocok' : 'Belum ada riwayat di rentang ini'}
            description={query ? 'Coba kata kunci lain.' : 'Pilih rentang tanggal yang lebih panjang.'}
            action={!query && rangeValue.preset !== '7d' && <Button variant="secondary" size="sm" onClick={() => withReset(setRangeValue)({ preset: '7d', custom: null })}>Lihat 7 hari</Button>}
          />
        </Card>
      ) : (
        <Card padding="none" className={`table-card${loading ? ' is-refreshing' : ''}`}>
          <div className="table-scroll">
            <table className="data-table history-table">
              <thead>
                <tr>
                  <th scope="col">No. antrean</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Waktu</th>
                  <th scope="col">Status</th>
                  <th scope="col">Pembayaran</th>
                  <th scope="col" className="num-col">Total</th>
                  <th scope="col"><span className="sr-only">Detail</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((order) => (
                  <tr key={order.id} className={`is-clickable${order.order_status === 'cancelled' ? ' is-muted' : ''}`} onClick={() => setDetailId(order.id)}>
                    <td><strong className="cell-queue tabular">{formatQueueNumber(order)}</strong></td>
                    <td>{customerLabel(order)}</td>
                    <td className="tabular">{formatDateShort(order.created_at)} · {formatTime(order.created_at)}</td>
                    <td><OrderStatusBadge status={order.order_status} size="sm" /></td>
                    <td>
                      <PaymentBadge status={order.payment_status} size="sm" />
                      {order.payment_method && <small className="cell-sub">{paymentMethodLabel(order.payment_method)}</small>}
                    </td>
                    <td className="num-col tabular"><strong>{formatRupiah(order.total_amount)}</strong></td>
                    <td className="actions-col">
                      <IconButton icon={ChevronRight} size="sm" tooltip={false} label={`Detail ${formatQueueNumber(order)}`}
                        onClick={(event) => { event.stopPropagation(); setDetailId(order.id) }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} itemLabel="pesanan" />
        </Card>
      )}

      {detail && (
        <OrderDetailDrawer
          key={detail.id}
          order={detail}
          cafe={cafe}
          features={features}
          onClose={() => setDetailId(null)}
          onPrint={(order) => {
            if (!printOrderLabel(order, cafe.name)) toast({ tone: 'error', title: 'Jendela cetak diblokir', description: 'Izinkan pop-up untuk situs ini.' })
          }}
          onChanged={(updated, kind) => {
            setOrders((current) => current.map((order) => (order.id === updated.id ? { ...order, ...updated, customer_name: order.customer_name } : order)))
            toast({ title: kind === 'paid' ? `${formatQueueNumber(updated)} lunas` : `${formatQueueNumber(updated)} dibatalkan` })
          }}
        />
      )}
    </div>
  )
}
