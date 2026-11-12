import { useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AuditTable } from '../components/AuditTable.jsx'
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Select, SkeletonRows } from '../components/ui/index.js'
import { rpc, useLoader } from '../lib/api.js'

const PAGE_SIZE = 50
const GROUPS = { cafe: 'Kafe', plan: 'Paket', subscription: 'Langganan', invoice: 'Tagihan', account: 'Akun' }

export function AuditPage() {
  const [params, setParams] = useSearchParams()
  const action = params.get('aksi') || ''
  const cafe = params.get('kafe') || ''
  const page = Number(params.get('hal') || 1)

  function setParam(key, value) {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      if (key !== 'hal') next.delete('hal')
      return next
    }, { replace: true })
  }

  const load = useCallback(() => rpc('pa_audit_list', {
    p_cafe: cafe || null, p_action: action ? `${action}.` : null, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE,
  }), [action, cafe, page])
  const { data, error, loading, reload } = useLoader(load)

  return (
    <div className="page">
      <PageHeader eyebrow="Dailybrew" title="Log audit" description="Setiap aksi admin, owner (tagihan), sistem, dan Midtrans: siapa, kapan, apa, nilai sebelum & sesudah." />
      <div className="toolbar">
        <Select label="Jenis aksi" hideLabel value={action} onChange={(event) => setParam('aksi', event.target.value)}
          options={[{ value: '', label: 'Semua aksi' }, ...Object.entries(GROUPS).map(([value, label]) => ({ value, label }))]} />
        {cafe && <Link to="/audit" className="link-button" onClick={() => setParam('kafe', '')}>Hapus filter kafe</Link>}
      </div>
      <Card padding="none">
        {error ? <ErrorState message={error} onRetry={reload} />
          : loading && !data ? <SkeletonRows rows={8} label="Memuat log" />
            : data.rows.length === 0 ? <EmptyState title="Belum ada aksi" />
              : <AuditTable rows={data.rows} />}
        {data && <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onChange={(next) => setParam('hal', String(next))} itemLabel="aksi" />}
      </Card>
    </div>
  )
}
