import { useCallback, useMemo, useState } from 'react'
import { ArrowRight, CircleAlert } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { ActionList } from '../components/ActionList.jsx'
import { LineChart } from '../components/charts/LineChart.jsx'
import { Card, CardHeader, ErrorState, PageHeader, SegmentedControl, SkeletonRows, StatCard } from '../components/ui/index.js'
import { useAuth } from '../auth/useAuth.js'
import { percentChange, rpc, useLoader } from '../lib/api.js'
import { formatNumber, formatRupiah, formatRupiahCompact } from '../lib/format.js'

const MONTH = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const MONTH_SHORT = new Intl.DateTimeFormat('id-ID', { month: 'short', timeZone: 'UTC' })
const TODAY = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jakarta' })
const MISSING = /belum ada|SQL 1[45]/i

function greeting(now) {
  const hour = Number(new Intl.DateTimeFormat('id-ID', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Jakarta' }).format(now))
  return hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 19 ? 'Selamat sore' : 'Selamat malam'
}

function toPoints(rows, key) {
  return (rows || []).map((row) => {
    const date = new Date(`${row.month}T00:00:00Z`)
    return { label: MONTH.format(date), short: MONTH_SHORT.format(date), value: Number(row[key]) || 0 }
  })
}

const CHARTS = [
  { value: 'mrr', label: 'MRR' },
  { value: 'paying', label: 'Kafe aktif' },
  { value: 'revenue', label: 'Pendapatan' },
]

export function OverviewPage() {
  const navigate = useNavigate()
  const { admin } = useAuth()
  const [chart, setChart] = useState('mrr')
  const [now] = useState(() => new Date())
  const load = useCallback(async () => {
    const [overview, plans, actions] = await Promise.all([
      rpc('pa_overview'),
      rpc('pa_plans_list'),
      rpc('pa_action_items', { p_limit: 30 }).catch((error) => (MISSING.test(error.message) ? null : Promise.reject(error))),
    ])
    return { overview, plans, actions }
  }, [])
  const { data, error, loading, reload } = useLoader(load)
  const overview = data?.overview
  const plans = data?.plans

  const series = useMemo(() => ({
    mrr: toPoints(overview?.history, 'mrr'),
    paying: toPoints(overview?.history, 'paying'),
    revenue: toPoints(overview?.revenue_history, 'amount'),
  }), [overview])

  if (error) return <div className="page"><PageHeader title="Ringkasan" /><ErrorState message={error} onRetry={reload} /></div>

  const mrrDelta = overview ? percentChange(overview.mrr, overview.mrr_prev) : null
  const revenueDelta = overview ? percentChange(overview.revenue_month, overview.revenue_prev) : null
  const planName = (code) => plans?.find((plan) => plan.code === code)?.name || code
  const points = series[chart]
  const enoughHistory = chart === 'revenue' ? points.some((point) => point.value > 0) : points.length >= 2
  const firstName = (admin?.full_name || '').split(' ')[0]

  return (
    <div className="page pa-stack">
      <PageHeader eyebrow={TODAY.format(now)} title={`${greeting(now)}${firstName ? `, ${firstName}` : ''}`}
        description="Kondisi semua kafe yang berlangganan Dailybrew bulan ini" />

      {overview?.unpriced?.length > 0 && (
        <div className="pa-notice" role="status">
          <CircleAlert size={18} aria-hidden="true" />
          <span>
            <strong>{formatNumber(overview.unpriced.length)} kafe {overview.unpriced[0].plan_name} belum diberi harga</strong>, jadi belum ikut dihitung di MRR:{' '}
            {overview.unpriced.slice(0, 4).map((cafe, index) => (
              <span key={cafe.cafe_id}>{index ? ', ' : ''}<Link to={`/kafe/${cafe.cafe_id}`}>{cafe.name}</Link></span>
            ))}
            {overview.unpriced.length > 4 ? ` +${overview.unpriced.length - 4} lainnya` : ''}. Isi lewat Ganti paket → Harga kustom.
          </span>
        </div>
      )}

      <div className="dash-stats pa-kpis">
        <StatCard label="MRR" loading={loading && !overview} value={formatRupiah(overview?.mrr)} delta={mrrDelta} deltaLabel="vs bulan lalu"
          caption={overview?.mrr_prev == null ? 'Perbandingan muncul bulan depan' : `Bulan lalu ${formatRupiah(overview.mrr_prev)}`}
          trend={series.mrr.length > 1 ? series.mrr.map((point) => point.value) : undefined} />
        <StatCard label="Kafe aktif" loading={loading && !overview} value={formatNumber(overview?.active)}
          caption={overview?.past_due ? `${formatNumber(overview.past_due)} dalam masa tenggang` : overview?.active ? 'Semua lancar' : 'Belum ada kafe berbayar'}
          onClick={() => navigate('/kafe?status=active')} />
        <StatCard label="Masa coba" loading={loading && !overview} value={formatNumber(overview?.trial)}
          caption={overview?.trial ? `Potensi ${formatRupiah(overview.trial_potential)}/bln` : 'Tidak ada yang sedang mencoba'}
          onClick={() => navigate('/kafe?status=trial')} />
        <StatCard label="Pendapatan bulan ini" loading={loading && !overview} value={formatRupiah(overview?.revenue_month)} delta={revenueDelta} deltaLabel="vs bulan lalu"
          caption={overview?.invoice_count ? `Bulan lalu ${formatRupiah(overview.revenue_prev)}` : 'Belum ada tagihan'}
          onClick={() => navigate('/tagihan?status=paid')} />
      </div>

      <div className="pa-substats">
        <SubStat label="Tagihan telat" value={overview?.overdue_count} tone={overview?.overdue_count ? 'red' : undefined}
          detail={overview?.overdue_count ? formatRupiah(overview.overdue_amount) : 'Tidak ada yang telat'} to="/tagihan?status=overdue" />
        <SubStat label="Menunggu bayar" value={overview?.pending_count}
          detail={overview?.pending_count ? 'Belum jatuh tempo' : overview?.invoice_count ? 'Tidak ada' : 'Buat tagihan pertama'} to={overview?.invoice_count ? '/tagihan?status=pending' : '/kafe'} />
        <SubStat label="Nonaktif & habis" value={overview?.inactive}
          detail={overview?.inactive ? `${formatNumber(overview.suspended)} dinonaktifkan · ${formatNumber(overview.expired)} habis` : 'Tidak ada'} to="/kafe?status=expired" />
        <SubStat label="Kafe baru 30 hari" value={overview?.new_cafes_30d}
          detail={overview?.new_cafes_30d ? `Total ${formatNumber(overview.total)} kafe` : 'Tambah kafe baru'} to="/kafe" />
      </div>

      <div className="dash-grid">
        <Card className="pa-span-7" padding="none">
          <div className="table-card-head">
            <CardHeader title="Perlu tindakan" description={data?.actions ? 'Diurutkan dari yang paling mendesak' : undefined} />
          </div>
          <div className="pa-card-body">
            {!data ? <SkeletonRows rows={4} label="Memuat" />
              : data.actions === null ? <p className="pa-empty">Aktif setelah file SQL 15 dijalankan.</p>
                : data.actions.length === 0 ? <p className="pa-empty">Semua aman. Tidak ada tagihan telat, masa coba yang mau habis, atau kafe sepi.</p>
                  : <ActionList items={data.actions} limit={8} />}
            {data?.actions?.length > 8 && <p className="pa-more">+{data.actions.length - 8} lainnya</p>}
          </div>
        </Card>

        <Card className="pa-span-5">
          <CardHeader title="Kafe per paket" description="Aktif, telat bayar & masa coba" />
          {overview && (Object.keys(overview.by_plan || {}).length === 0
            ? <p className="pa-empty">Belum ada kafe · <Link to="/kafe">Buat kafe pertama →</Link></p>
            : (
              <ul className="pa-plan-bars">
                {Object.entries(overview.by_plan).sort((a, b) => b[1] - a[1]).map(([code, count]) => {
                  const total = Object.values(overview.by_plan).reduce((sum, value) => sum + Number(value), 0)
                  return (
                    <li key={code}>
                      <span className="fin-bars-label"><span>{planName(code)}</span><span className="tabular">{formatNumber(count)}</span></span>
                      <span className="fin-bars-track" aria-hidden="true"><span style={{ width: `${Math.max((count / total) * 100, 3)}%` }} /></span>
                    </li>
                  )
                })}
              </ul>
            ))}
          {overview && (
            <dl className="fin-position pa-avg">
              <div><dt>Rata-rata per kafe berbayar</dt><dd className="tabular">{overview.active ? formatRupiah(overview.mrr / overview.active) : '—'}</dd></div>
            </dl>
          )}
        </Card>

        <Card className="pa-span-12">
          <CardHeader title="12 bulan terakhir" description={chart === 'revenue' ? 'Pendapatan diterima dari tagihan lunas' : chart === 'mrr' ? 'MRR di akhir tiap bulan' : 'Jumlah kafe berbayar di akhir tiap bulan'}
            actions={<SegmentedControl label="Pilih grafik" options={CHARTS} value={chart} onChange={setChart} size="sm" />} />
          {!overview ? <SkeletonRows rows={3} /> : enoughHistory ? (
            <LineChart points={points} label={CHARTS.find((item) => item.value === chart).label}
              format={chart === 'paying' ? (value) => `${formatNumber(value)} kafe` : formatRupiah}
              formatAxis={chart === 'paying' ? formatNumber : formatRupiahCompact} />
          ) : (
            <p className="pa-empty pa-chart-empty">
              {chart === 'revenue'
                ? <>Belum ada tagihan lunas. <Link to="/kafe">Buat tagihan pertama →</Link></>
                : 'Riwayat dicatat otomatis tiap bulan sejak dashboard ini dipakai. Grafik muncul setelah ada 2 bulan data.'}
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}

function SubStat({ label, value, detail, tone, to }) {
  return (
    <Link to={to} className={`pa-substat${tone ? ` is-${tone}` : ''}`}>
      <span className="pa-substat-label">{label}</span>
      <strong className="tabular">{value == null ? '—' : formatNumber(value)}</strong>
      <span className="pa-substat-detail">{detail}<ArrowRight size={13} aria-hidden="true" /></span>
    </Link>
  )
}
