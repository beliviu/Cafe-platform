import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { InvoiceTable } from '../components/InvoiceTable.jsx'
import { Card, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, SegmentedControl, SkeletonRows, StatCard } from '../components/ui/index.js'
import { rpc, useLoader } from '../lib/api.js'
import { formatNumber, formatRupiah } from '../lib/format.js'

const PAGE_SIZE = 25
const FILTERS = [
  { value: '', label: 'Semua' },
  { value: 'pending', label: 'Menunggu' },
  { value: 'overdue', label: 'Telat' },
  { value: 'paid', label: 'Lunas' },
  { value: 'void', label: 'Batal' },
]

export function InvoicesPage() {
  const [params, setParams] = useSearchParams()
  const state = params.get('status') || ''
  const page = Number(params.get('hal') || 1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  function setParam(key, value) {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      if (key !== 'hal') next.delete('hal')
      return next
    }, { replace: true })
  }

  const load = useCallback(() => rpc('pa_invoices_list', {
    p_state: state || null, p_search: query || null, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE,
  }), [page, query, state])
  const { data, error, loading, reload } = useLoader(load)
  const summary = data?.summary

  return (
    <div className="page pa-stack">
      <PageHeader eyebrow="Dailybrew" title="Tagihan"
        description="Tagihan langganan semua kafe. Transfer bank: tandai lunas manual. Pembayaran Midtrans lunas otomatis." />

      <div className="pa-stats">
        <StatCard label="Menunggu" loading={!summary} value={formatRupiah(summary?.pending_amount)} tone="blue" caption={`${formatNumber(summary?.pending)} tagihan`} onClick={() => setParam('status', 'pending')} />
        <StatCard label="Telat" loading={!summary} value={formatRupiah(summary?.overdue_amount)} tone="amber" caption={`${formatNumber(summary?.overdue)} tagihan`} onClick={() => setParam('status', 'overdue')} />
        <StatCard label="Lunas (sepanjang waktu)" loading={!summary} value={formatRupiah(summary?.paid_amount)} tone="green" caption={`${formatNumber(summary?.paid)} tagihan`} onClick={() => setParam('status', 'paid')} />
      </div>

      <div className="toolbar is-tight">
        <SegmentedControl label="Status tagihan" options={FILTERS} value={state} onChange={(value) => setParam('status', value)} />
        <SearchInput className="toolbar-search" value={search} onChange={setSearch} placeholder="Cari nomor tagihan atau kafe…" />
      </div>

      <Card padding="none">
        {error ? <ErrorState message={error} onRetry={reload} />
          : loading && !data ? <SkeletonRows rows={6} label="Memuat tagihan" />
            : data.rows.length === 0 ? <EmptyState title="Tidak ada tagihan" description="Tagihan dibuat dari detail kafe, otomatis oleh sistem, atau diminta owner." />
              : <InvoiceTable rows={data.rows} onChanged={reload} />}
        {data && <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onChange={(next) => setParam('hal', String(next))} itemLabel="tagihan" />}
      </Card>
    </div>
  )
}
