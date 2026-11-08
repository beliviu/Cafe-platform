/*
 * Penjualan → Pembayaran online (file 09): tagihan QRIS dinamis, status dari gateway,
 * pengecekan ulang (rekonsiliasi), tagihan yang perlu ditinjau, dan refund lewat gateway.
 */
import { useCallback, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { AlertTriangle, Download, RefreshCw, RotateCcw, ScanLine } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import {
  Badge, Button, Card, Dialog, EmptyState, ErrorState, PageHeader, Pagination, RupiahInput, Select, SkeletonRows, StatCard, TextField, useToast,
} from '../../components/ui/index.js'
import { PeriodPicker } from '../../components/finance/PeriodPicker.jsx'
import { fetchAllRows, friendlyError } from '../../lib/db.js'
import { formatDateTime, formatNumber, formatQueueNumber, formatRelative, formatRupiah } from '../../lib/format.js'
import { periodFor } from '../../lib/finance.js'
import { exportRows, useLoader, useOwnerBase } from '../../lib/inventory.js'
import { callPayments, INTENT_STATUS, PAYMENTS_REQUIRED } from '../../lib/payments.js'

const PAGE_SIZE = 30
const FILTERS = [
  { value: 'all', label: 'Semua status' },
  { value: 'review', label: 'Perlu ditinjau' },
  { value: 'paid', label: 'Lunas' },
  { value: 'pending', label: 'Menunggu bayar' },
  { value: 'expired', label: 'Kedaluwarsa / batal' },
  { value: 'failed', label: 'Gagal' },
]

export function OnlinePaymentsPage() {
  const { cafe, features } = useOutletContext()
  return (
    <div className="page page-wide">
      <PageHeader eyebrow="Penjualan" title="Pembayaran online" description="QRIS dinamis lewat gateway. Pesanan hanya lunas setelah gateway mengonfirmasi — bukan dari aplikasi." />
      {features?.payments ? <OnlinePayments cafe={cafe} /> : <Card><EmptyState icon={ScanLine} title="Belum tersedia" description={PAYMENTS_REQUIRED} /></Card>}
    </div>
  )
}

function OnlinePayments({ cafe }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const base = useOwnerBase()
  const [period, setPeriod] = useState(() => ({ ...periodFor('this-month'), key: 'this-month' }))
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [syncing, setSyncing] = useState(false)
  const [refunding, setRefunding] = useState(null)

  const load = useCallback(async () => {
    const from = new Date(`${period.from}T00:00:00+07:00`).toISOString()
    const to = new Date(new Date(`${period.to}T00:00:00+07:00`).getTime() + 86400000).toISOString()
    const [intents, summary, settings] = await Promise.all([
      fetchAllRows(() => supabase.from('payment_intents')
        .select('id, order_id, provider_order_id, provider_transaction_id, amount, paid_amount, status, review_reason, failure_message, source, expires_at, paid_at, created_at')
        .eq('cafe_id', cafe.id).gte('created_at', from).lt('created_at', to).order('created_at', { ascending: false })),
      supabase.rpc('payment_gateway_summary', { p_cafe_id: cafe.id, p_from: period.from, p_to: period.to }),
      supabase.from('cafe_settings').select('payment_gateway_enabled').eq('cafe_id', cafe.id).maybeSingle(),
    ])
    const failure = intents.error || summary.error
    if (failure) throw new Error(friendlyError(failure))
    const orderIds = [...new Set(intents.data.map((row) => row.order_id))]
    const orders = orderIds.length ? (await supabase.from('orders').select('id, queue_number, order_number, total_amount, paid_amount, refunded_amount, order_status').in('id', orderIds)).data || [] : []
    const refunds = intents.data.length ? (await supabase.from('payment_refunds').select('intent_id, amount, status').in('intent_id', intents.data.map((row) => row.id))).data || [] : []
    const refunded = new Map()
    for (const row of refunds.filter((item) => item.status === 'succeeded')) refunded.set(row.intent_id, (refunded.get(row.intent_id) || 0) + Number(row.amount))
    return { intents: intents.data, summary: summary.data, enabled: Boolean(settings.data?.payment_gateway_enabled), orders: new Map(orders.map((order) => [order.id, order])), refunded }
  }, [cafe.id, period.from, period.to, supabase])
  const { data, error, reload, loading } = useLoader(load)

  const rows = useMemo(() => (data?.intents || []).filter((row) => filter === 'all'
    || (filter === 'review' ? Boolean(row.review_reason) : filter === 'pending' ? ['creating', 'pending'].includes(row.status)
      : filter === 'expired' ? ['expired', 'cancelled'].includes(row.status) : row.status === filter)), [data, filter])
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const visible = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  async function syncAll() {
    setSyncing(true)
    try {
      const result = await callPayments(supabase, { action: 'reconcile', cafe_id: cafe.id })
      toast({ tone: 'success', title: `${formatNumber(result.checked)} tagihan dicek ke gateway`, description: result.changed ? `${result.changed} berubah status` : 'Tidak ada perubahan' })
      reload()
    } catch (caught) {
      toast({ tone: 'error', title: 'Gagal mengecek gateway', description: caught.message })
    }
    setSyncing(false)
  }

  async function checkOne(row) {
    try {
      const result = await callPayments(supabase, { action: 'status', order_id: row.order_id })
      toast({ tone: result.changed ? 'success' : 'info', title: result.changed ? 'Status diperbarui' : 'Belum ada perubahan dari gateway' })
      reload()
    } catch (caught) {
      toast({ tone: 'error', title: 'Gagal mengecek', description: caught.message })
    }
  }

  async function handleExport() {
    try {
      await exportRows(rows.map((row) => {
        const order = data.orders.get(row.order_id)
        return {
          created: formatDateTime(row.created_at), order: order ? formatQueueNumber(order) : '', gateway_id: row.provider_order_id, transaction: row.provider_transaction_id || '',
          amount: Number(row.amount), paid: row.paid_amount === null ? null : Number(row.paid_amount), status: INTENT_STATUS[row.status]?.label || row.status,
          refunded: data.refunded.get(row.id) || null, note: row.review_reason || row.failure_message || '',
        }
      }), [
        { key: 'created', header: 'Dibuat', width: 18 }, { key: 'order', header: 'Pesanan', width: 10 }, { key: 'gateway_id', header: 'ID gateway', width: 22 },
        { key: 'transaction', header: 'ID transaksi', width: 30 }, { key: 'amount', header: 'Tagihan', number: true, format: '#,##0', width: 14 },
        { key: 'paid', header: 'Diterima', number: true, format: '#,##0', width: 14 }, { key: 'status', header: 'Status', width: 16 },
        { key: 'refunded', header: 'Refund', number: true, format: '#,##0', width: 12 }, { key: 'note', header: 'Keterangan', width: 40 },
      ], `pembayaran-online-${period.from}_${period.to}`, 'xlsx', 'Pembayaran online')
    } catch (caught) {
      toast({ tone: 'error', title: 'Ekspor gagal', description: caught.message })
    }
  }

  if (error && !data) return <Card><ErrorState message={error} onRetry={reload} /></Card>
  const summary = data?.summary
  return (
    <div className="inv-page">
      {data && !data.enabled && (
        <div className="inv-alert" role="status">
          <ScanLine size={18} aria-hidden="true" />
          <div><strong>QRIS online belum dinyalakan</strong><p>Pelanggan & kasir belum bisa membuat QR dinamis. Nyalakan di <Link to={`${base}/settings/payments`}>Pengaturan → Pembayaran</Link>.</p></div>
        </div>
      )}
      {summary?.review_count > 0 && (
        <div className="inv-alert" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div><strong>{summary.review_count} pembayaran perlu ditinjau</strong><p>Dana diterima gateway tetapi pesanan sudah lunas/dibatalkan atau nominal berbeda, jadi tidak dicatat sebagai pembayaran. Kembalikan dana pelanggan lewat dashboard Midtrans (Transactions → Refund).</p></div>
        </div>
      )}
      <section className="toolbar" aria-label="Periode">
        <PeriodPicker value={period} onChange={(next) => { setPeriod(next); setPage(1) }} />
        <Select hideLabel label="Status" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1) }} options={FILTERS} />
        <span className="toolbar-end fin-actions">
          <Button variant="secondary" icon={Download} disabled={!rows.length} onClick={handleExport}>Excel</Button>
          <Button icon={RefreshCw} loading={syncing} onClick={syncAll}>Cek yang menunggu</Button>
        </span>
      </section>
      <section className="dash-stats inv-stats" aria-label="Ringkasan pembayaran online">
        <StatCard label="Diterima lewat QRIS" value={formatRupiah(summary?.paid_amount || 0)} caption={`${formatNumber(summary?.paid_count || 0)} pembayaran lunas`} loading={!data} />
        <StatCard tone="amber" label="Menunggu bayar" value={formatNumber(summary?.pending_count || 0)} caption={`${formatNumber(summary?.expired_count || 0)} kedaluwarsa · ${formatNumber(summary?.failed_count || 0)} gagal`} loading={!data}
          onClick={() => setFilter('pending')} />
        <StatCard tone="neutral" label="Refund lewat gateway" value={formatRupiah(summary?.refunded_amount || 0)} caption="Dikembalikan ke pelanggan" loading={!data} />
        <StatCard tone="neutral" label="Webhook terakhir" value={summary?.last_webhook_at ? formatRelative(summary.last_webhook_at) : 'Belum ada'} caption="Notifikasi dari Midtrans" loading={!data} />
      </section>
      <Card padding="none" className={`table-card${loading && data ? ' is-refreshing' : ''}`}>
        {!data ? <SkeletonRows rows={6} label="Memuat pembayaran" /> : !rows.length ? (
          <EmptyState icon={ScanLine} compact title={data.intents.length ? 'Tidak ada yang cocok' : 'Belum ada pembayaran online di periode ini'} description="Tagihan muncul saat pelanggan atau kasir memilih QRIS otomatis." />
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th scope="col">Dibuat</th><th scope="col">Pesanan</th><th scope="col">ID gateway</th><th scope="col" className="num">Nominal</th><th scope="col">Status</th><th scope="col">Keterangan</th><th scope="col"><span className="sr-only">Aksi</span></th></tr></thead>
                <tbody>
                  {visible.map((row) => {
                    const order = data.orders.get(row.order_id)
                    const status = INTENT_STATUS[row.status] || { label: row.status, tone: 'neutral' }
                    const refunded = data.refunded.get(row.id) || 0
                    return (
                      <tr key={row.id} className={row.review_reason ? 'is-warning' : ''}>
                        <td className="nowrap tabular">{formatDateTime(row.created_at)}<small className="cell-sub">{row.source === 'pos' ? 'Kasir' : 'Aplikasi'}</small></td>
                        <td className="tabular"><strong>{order ? formatQueueNumber(order) : '—'}</strong></td>
                        <td className="tabular"><span className="pay-id">{row.provider_order_id}</span></td>
                        <td className="num tabular">{formatRupiah(row.paid_amount ?? row.amount)}{refunded ? <small className="cell-sub">refund {formatRupiah(refunded)}</small> : null}</td>
                        <td><Badge tone={row.review_reason ? 'red' : status.tone} size="sm">{row.review_reason ? 'Perlu ditinjau' : status.label}</Badge></td>
                        <td className="pay-note">{row.review_reason || row.failure_message || (row.paid_at ? `Lunas ${formatDateTime(row.paid_at)}` : '')}</td>
                        <td className="cell-actions">
                          {['creating', 'pending'].includes(row.status) && <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => checkOne(row)}>Cek</Button>}
                          {row.status === 'paid' && !row.review_reason && Number(row.paid_amount) - refunded > 0 && (
                            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setRefunding({ row, order, max: Number(row.paid_amount) - refunded })}>Refund</Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={safePage} pageSize={PAGE_SIZE} total={rows.length} onChange={setPage} itemLabel="tagihan" />
          </>
        )}
      </Card>
      {refunding && <GatewayRefundDialog target={refunding} onClose={() => setRefunding(null)} onDone={reload} />}
    </div>
  )
}

function GatewayRefundDialog({ target, onClose, onDone }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [amount, setAmount] = useState(target.max)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!(Number(amount) > 0) || Number(amount) > target.max) return setError(`Nominal 1 – ${formatRupiah(target.max)}`)
    if (reason.trim().length < 3) return setError('Tulis alasan refund')
    setBusy(true)
    try {
      await callPayments(supabase, { action: 'refund', order_id: target.row.order_id, amount: Number(amount), reason: reason.trim() })
      toast({ tone: 'success', title: `Refund ${formatRupiah(amount)} dikirim`, description: 'Dana kembali ke pelanggan sesuai bank/e-wallet penerbit.' })
      onDone()
      onClose()
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
    return undefined
  }

  return (
    <Dialog size="sm" title={`Refund pesanan ${target.order ? formatQueueNumber(target.order) : ''}`}
      description="Dana dikembalikan otomatis lewat gateway ke rekening/e-wallet pelanggan. Tercatat di Kasir & refund dan jurnal."
      onClose={busy ? undefined : onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button variant="danger" onClick={submit} loading={busy}>Kirim refund</Button></>}>
      <div className="inv-form">
        <RupiahInput label="Nominal" value={amount} onChange={(value) => { setAmount(value); setError('') }} hint={`Maksimal ${formatRupiah(target.max)}`} />
        <TextField label="Alasan" value={reason} maxLength={255} onChange={(event) => { setReason(event.target.value); setError('') }} placeholder="Mis. menu habis setelah dibayar" />
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}

