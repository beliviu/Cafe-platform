import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { NewCafeDialog } from '../components/NewCafeDialog.jsx'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, Select, SkeletonRows } from '../components/ui/index.js'
import { rpc, STATE_META, useLoader } from '../lib/api.js'
import { formatDate, formatRupiah } from '../lib/format.js'

const PAGE_SIZE = 25
const STATE_OPTIONS = [{ value: '', label: 'Semua status' }, ...Object.entries(STATE_META).map(([value, meta]) => ({ value, label: meta.label }))]

function endsAt(row) {
  if (row.state === 'trial' || (row.sub_status === 'trialing')) return row.trial_ends_at ? `Coba s/d ${formatDate(row.trial_ends_at)}` : 'Coba tanpa batas'
  if (row.current_period_end) return `s/d ${formatDate(row.current_period_end)}`
  return 'Tanpa batas'
}

export function CafesPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const state = params.get('status') || ''
  const plan = params.get('paket') || ''
  const page = Number(params.get('hal') || 1)
  const [search, setSearch] = useState(params.get('q') || '')
  const [query, setQuery] = useState(search)
  const [creating, setCreating] = useState(false)

  // Tunda pencarian sampai berhenti mengetik
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

  const load = useCallback(() => Promise.all([
    rpc('pa_cafes_list', { p_search: query || null, p_state: state || null, p_plan: plan || null, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE }),
    rpc('pa_plans_list'),
  ]), [page, plan, query, state])
  const { data, error, loading, reload } = useLoader(load)
  const [list, plans] = data || []

  return (
    <div className="page">
      <PageHeader eyebrow="Dailybrew" title="Kafe" description="Semua kafe yang terdaftar beserta paket dan status langganannya."
        actions={<Button icon={Plus} onClick={() => setCreating(true)} disabled={!plans}>Kafe baru</Button>} />

      <div className="toolbar">
        <SearchInput className="toolbar-search" value={search} onChange={setSearch} placeholder="Cari nama kafe, owner, atau email…" />
        <Select label="Status" hideLabel value={state} onChange={(event) => setParam('status', event.target.value)} options={STATE_OPTIONS} />
        <Select label="Paket" hideLabel value={plan} onChange={(event) => setParam('paket', event.target.value)}
          options={[{ value: '', label: 'Semua paket' }, ...(plans || []).map((item) => ({ value: item.code, label: item.name }))]} />
      </div>

      <Card padding="none">
        {error ? <ErrorState message={error} onRetry={reload} />
          : loading && !list ? <SkeletonRows rows={6} label="Memuat kafe" />
            : list.rows.length === 0 ? <EmptyState title="Tidak ada kafe" description={query || state || plan ? 'Coba ubah pencarian atau filter.' : 'Buat kafe pertama dengan tombol Kafe baru.'} />
              : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Kafe</th>
                        <th scope="col">Paket</th>
                        <th scope="col">Status</th>
                        <th scope="col">Berlaku</th>
                        <th scope="col" className="num">Biaya / bln</th>
                        <th scope="col">Terdaftar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.rows.map((row) => {
                        const meta = STATE_META[row.state] || STATE_META.active
                        const open = () => navigate(`/kafe/${row.cafe_id}`)
                        return (
                          <tr key={row.cafe_id} className="pa-row-link" tabIndex={0} onClick={open}
                            onKeyDown={(event) => { if (event.key === 'Enter') open() }}>
                            <td><span className="pa-cell-main"><strong>{row.name}</strong><small>{row.owner_name || 'Tanpa owner'}{row.owner_email ? ` · ${row.owner_email}` : ''}</small></span></td>
                            <td>{row.plan_name || '—'}</td>
                            <td><Badge tone={meta.tone}>{meta.label}</Badge></td>
                            <td className="tabular">{endsAt(row)}</td>
                            <td className="num tabular">{Number(row.monthly_price) ? formatRupiah(row.monthly_price) : '—'}{row.price_override != null && <small className="pa-muted"> · kustom</small>}</td>
                            <td className="tabular">{formatDate(row.created_at)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
        {list && <Pagination page={page} pageSize={PAGE_SIZE} total={list.total} onChange={(next) => setParam('hal', String(next))} itemLabel="kafe" />}
      </Card>

      {creating && plans && (
        <NewCafeDialog plans={plans} onClose={() => setCreating(false)} onCreated={(cafeId) => { setCreating(false); navigate(`/kafe/${cafeId}`) }} />
      )}
    </div>
  )
}
