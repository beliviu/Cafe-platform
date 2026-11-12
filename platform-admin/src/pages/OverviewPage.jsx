import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardHeader, ErrorState, PageHeader, StatCard } from '../components/ui/index.js'
import { percentChange, rpc, useLoader } from '../lib/api.js'
import { formatNumber, formatRupiah } from '../lib/format.js'

export function OverviewPage() {
  const navigate = useNavigate()
  const load = useCallback(() => Promise.all([rpc('pa_overview'), rpc('pa_plans_list')]), [])
  const { data, error, loading, reload } = useLoader(load)
  const [overview, plans] = data || []

  if (error) return <div className="page"><PageHeader title="Ringkasan" /><ErrorState message={error} onRetry={reload} /></div>

  const mrrDelta = overview ? percentChange(overview.mrr, overview.mrr_prev) : null
  const revenueDelta = overview ? percentChange(overview.revenue_month, overview.revenue_prev) : null
  const planName = (code) => plans?.find((plan) => plan.code === code)?.name || code

  return (
    <div className="page pa-stack">
      <PageHeader eyebrow="Dailybrew" title="Ringkasan" description="Kondisi semua kafe yang berlangganan bulan ini." />

      <div className="pa-stats">
        <StatCard label="Kafe aktif" loading={loading} value={formatNumber(overview?.active)}
          caption={overview?.past_due ? `${formatNumber(overview.past_due)} telat bayar (masa tenggang)` : 'Berbayar & berjalan'}
          onClick={() => navigate('/kafe?status=active')} />
        <StatCard label="Masa coba" loading={loading} value={formatNumber(overview?.trial)} tone="blue"
          caption={overview ? `Potensi ${formatRupiah(overview.trial_potential)}/bln` : ''} onClick={() => navigate('/kafe?status=trial')} />
        <StatCard label="Nonaktif & habis" loading={loading} value={formatNumber(overview?.inactive)} tone="neutral"
          caption={overview ? `${formatNumber(overview.suspended)} dinonaktifkan · ${formatNumber(overview.expired)} habis` : ''}
          onClick={() => navigate('/kafe?status=expired')} />
        <StatCard label="MRR" loading={loading} value={formatRupiah(overview?.mrr)} delta={mrrDelta} deltaLabel="vs bulan lalu"
          caption={overview?.mrr_prev == null ? 'Data bulan lalu belum ada' : `Bulan lalu ${formatRupiah(overview.mrr_prev)}`}
          trend={overview?.history?.length > 1 ? overview.history.map((row) => Number(row.mrr)) : undefined} />
        <StatCard label="Pendapatan diterima" loading={loading} value={formatRupiah(overview?.revenue_month)} delta={revenueDelta} deltaLabel="vs bulan lalu"
          caption={overview ? `Bulan lalu ${formatRupiah(overview.revenue_prev)}` : ''} onClick={() => navigate('/tagihan?status=paid')} />
        <StatCard label="Tagihan telat" loading={loading} value={formatNumber(overview?.overdue_count)} tone={overview?.overdue_count ? 'amber' : 'neutral'}
          caption={overview ? `${formatRupiah(overview.overdue_amount)} · ${formatNumber(overview.pending_count)} menunggu` : ''}
          onClick={() => navigate('/tagihan?status=overdue')} />
      </div>

      <div className="fin-grid">
        <Card>
          <CardHeader title="Kafe per paket" description="Aktif, telat bayar, dan masa coba" />
          {overview && (
            Object.keys(overview.by_plan || {}).length === 0
              ? <p className="pa-muted">Belum ada kafe.</p>
              : (
                <ul className="pa-plan-list">
                  {Object.entries(overview.by_plan).sort((a, b) => b[1] - a[1]).map(([code, count]) => (
                    <li key={code}><span>{planName(code)}</span><strong className="tabular">{formatNumber(count)}</strong></li>
                  ))}
                </ul>
              )
          )}
        </Card>
        <Card>
          <CardHeader title="Pertumbuhan" />
          {overview && (
            <dl className="fin-position">
              <div><dt>Total kafe</dt><dd className="tabular">{formatNumber(overview.total)}</dd></div>
              <div><dt>Kafe baru 30 hari</dt><dd className="tabular">{formatNumber(overview.new_cafes_30d)}</dd></div>
              <div><dt>Rata-rata per kafe berbayar</dt><dd className="tabular">{overview.active ? formatRupiah(overview.mrr / overview.active) : '—'}</dd></div>
            </dl>
          )}
        </Card>
      </div>
    </div>
  )
}
