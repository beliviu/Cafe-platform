import { useCallback, useMemo, useState } from 'react'
import { ArrowRight, CircleAlert, CircleCheck, HeartPulse, ListChecks, Store, TrendingUp } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { HealthBadge } from '../components/Health.jsx'
import { ActionList } from '../components/ActionList.jsx'
import { WhatsAppButton } from '../components/WhatsAppButton.jsx'
import {
  Badge, Button, Card, CardHeader, DonutChart, EmptyState, ErrorState, KpiCard, LineChart, PageHeader, Progress, SegmentedControl, Skeleton, SkeletonRows,
} from '../components/ui/index.js'
import { useAuth } from '../auth/useAuth.js'
import { percentChange, rpc, useLoader } from '../lib/api.js'
import { formatNumber, formatRupiah, formatRupiahCompact } from '../lib/format.js'

const MONTH = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const MONTH_SHORT = new Intl.DateTimeFormat('id-ID', { month: 'short', timeZone: 'UTC' })
const TODAY = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jakarta' })
const MISSING = /belum ada|SQL 1[4-9]/i
/** Fungsi dari file SQL yang mungkin belum dijalankan: kembalikan null, jangan gagalkan seluruh halaman. */
const optional = (promise) => promise.catch((error) => (MISSING.test(error.message) ? null : Promise.reject(error)))

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
const HEALTH = {
  healthy: { tone: 'green', label: 'Sehat' },
  watch: { tone: 'amber', label: 'Pantau' },
  risk: { tone: 'red', label: 'Berisiko' },
}
const PLAN_COLORS = ['var(--chart-1)', 'var(--chart-3)', 'var(--chart-5)', 'var(--chart-2)', 'var(--chart-4)']

export function OverviewPage() {
  const navigate = useNavigate()
  const { admin } = useAuth()
  const [chart, setChart] = useState('mrr')
  const [now] = useState(() => new Date())
  const load = useCallback(async () => {
    const [overview, plans, actions, setup, health] = await Promise.all([
      rpc('pa_overview'),
      rpc('pa_plans_list'),
      optional(rpc('pa_action_items', { p_limit: 30 })),
      optional(rpc('pa_setup_progress', { p_limit: 5 })),
      optional(rpc('pa_health_overview', { p_limit: 5 })),
    ])
    return { overview, plans, actions, setup, health }
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

  const pending = loading && !overview
  const mrrDelta = overview ? percentChange(overview.mrr, overview.mrr_prev) : null
  const revenueDelta = overview ? percentChange(overview.revenue_month, overview.revenue_prev) : null
  const planName = (code) => plans?.find((plan) => plan.code === code)?.name || code
  const points = series[chart]
  const enoughHistory = chart === 'revenue' ? points.some((point) => point.value > 0) : points.length >= 2
  const firstName = (admin?.full_name || '').split(' ')[0]
  const planEntries = Object.entries(overview?.by_plan || {}).sort((a, b) => b[1] - a[1])
  const planTotal = planEntries.reduce((sum, [, count]) => sum + Number(count), 0)

  return (
    <div className="page page-wide ov">
      <PageHeader hero eyebrow={TODAY.format(now)} title={`${greeting(now)}${firstName ? `, ${firstName}` : ''}`}
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

      <div className="ui-kpi-grid">
        <KpiCard hero label="MRR" loading={pending} value={overview ? Number(overview.mrr) || 0 : undefined} format={formatRupiah} delta={mrrDelta} deltaLabel="vs bulan lalu"
          caption={overview?.mrr_prev == null ? 'Perbandingan muncul bulan depan' : undefined}
          trend={series.mrr.length > 1 ? series.mrr.map((point) => point.value) : undefined} />
        <KpiCard label="Kafe aktif" loading={pending} value={overview ? Number(overview.active) || 0 : undefined}
          caption={overview?.past_due ? `${formatNumber(overview.past_due)} dalam masa tenggang` : overview?.active ? 'Semua lancar' : 'Belum ada kafe berbayar'}
          onClick={() => navigate('/kafe?status=active')} />
        <KpiCard label="Masa coba" loading={pending} value={overview ? Number(overview.trial) || 0 : undefined}
          caption={overview?.trial ? `Potensi ${formatRupiah(overview.trial_potential)}/bln` : 'Tidak ada yang sedang mencoba'}
          onClick={() => navigate('/kafe?status=trial')} />
        <KpiCard label="Pendapatan bulan ini" loading={pending} value={overview ? Number(overview.revenue_month) || 0 : undefined} format={formatRupiah} delta={revenueDelta} deltaLabel="vs bulan lalu"
          caption={overview?.invoice_count ? undefined : 'Belum ada tagihan'}
          onClick={() => navigate('/tagihan?status=paid')} />
      </div>

      <div className="ov-substats">
        <SubStat label="Tagihan telat" value={overview?.overdue_count} alert={Boolean(overview?.overdue_count)}
          detail={overview?.overdue_count ? formatRupiah(overview.overdue_amount) : 'Tidak ada yang telat'} to="/tagihan?status=overdue" />
        <SubStat label="Menunggu bayar" value={overview?.pending_count}
          detail={overview?.pending_count ? 'Belum jatuh tempo' : overview?.invoice_count ? 'Tidak ada' : 'Buat tagihan pertama'} to={overview?.invoice_count ? '/tagihan?status=pending' : '/kafe'} />
        <SubStat label="Nonaktif & habis" value={overview?.inactive}
          detail={overview?.inactive ? `${formatNumber(overview.suspended)} dinonaktifkan · ${formatNumber(overview.expired)} habis` : 'Tidak ada'} to="/kafe?status=expired" />
        <SubStat label="Kafe baru 30 hari" value={overview?.new_cafes_30d}
          detail={overview?.new_cafes_30d ? `Total ${formatNumber(overview.total)} kafe` : 'Tambah kafe baru'} to="/kafe" />
      </div>

      <div className="ov-grid">
        <Card className="ov-span-7" padding="none">
          <div className="ov-card-head">
            <CardHeader title="Perlu tindakan" description={data?.actions?.length ? 'Diurutkan dari yang paling mendesak' : undefined}
              actions={data?.actions?.length ? <Badge tone="amber" dot={false}>{formatNumber(data.actions.length)} hal</Badge> : null} />
          </div>
          <div className="ov-card-body">
            {!data ? <SkeletonRows rows={4} label="Memuat daftar tindakan" />
              : data.actions === null ? <EmptyState compact icon={ListChecks} title="Belum aktif" description="Daftar ini muncul setelah file SQL 15 dijalankan." />
                : data.actions.length === 0 ? <EmptyState compact tone="green" icon={CircleCheck} title="Semua aman" description="Tidak ada tagihan telat, masa coba yang mau habis, atau kafe sepi." />
                  : <ActionList items={data.actions} limit={6} />}
            {data?.actions?.length > 6 && <p className="ov-more">+{data.actions.length - 6} lainnya</p>}
          </div>
        </Card>

        <Card className="ov-span-5">
          <CardHeader title="Kafe per paket" description="Aktif, telat bayar, dan masa coba" />
          {!overview ? <PlanSkeleton /> : planEntries.length === 0 ? (
            <EmptyState compact icon={Store} title="Belum ada kafe" description="Kafe yang berlangganan akan terbagi per paket di sini."
              action={<Button as={Link} to="/kafe" size="sm" variant="secondary">Buat kafe pertama</Button>} />
          ) : (
            <>
              <DonutChart ariaLabel="Jumlah kafe per paket" centerValue={formatNumber(planTotal)} centerLabel="kafe"
                formatValue={(value) => `${formatNumber(value)} kafe`}
                segments={planEntries.map(([code, count], index) => ({ key: code, label: planName(code), value: Number(count), color: PLAN_COLORS[index % PLAN_COLORS.length] }))} />
              <dl className="ov-fact">
                <dt>Rata-rata per kafe berbayar</dt>
                <dd className="tabular">{overview.active ? formatRupiah(overview.mrr / overview.active) : '—'}</dd>
              </dl>
            </>
          )}
        </Card>

        <Card className="ov-span-12">
          <CardHeader title="12 bulan terakhir" description={chart === 'revenue' ? 'Pendapatan diterima dari tagihan lunas' : chart === 'mrr' ? 'MRR di akhir tiap bulan' : 'Jumlah kafe berbayar di akhir tiap bulan'}
            actions={<SegmentedControl label="Pilih grafik" options={CHARTS} value={chart} onChange={setChart} size="sm" />} />
          {!overview ? <Skeleton height={240} radius={12} /> : enoughHistory ? (
            <LineChart key={chart} points={points} label={CHARTS.find((item) => item.value === chart).label}
              format={chart === 'paying' ? (value) => `${formatNumber(value)} kafe` : formatRupiah}
              formatAxis={chart === 'paying' ? formatNumber : formatRupiahCompact} />
          ) : (
            <EmptyState icon={TrendingUp} title="Data belum cukup"
              description={chart === 'revenue' ? 'Belum ada tagihan lunas. Grafik muncul setelah pembayaran pertama.' : 'Riwayat dicatat otomatis tiap bulan. Grafik muncul setelah ada 2 bulan data.'}
              action={chart === 'revenue' ? <Button as={Link} to="/kafe" size="sm" variant="secondary">Buat tagihan pertama</Button> : null} />
          )}
        </Card>

        <Card className="ov-span-7" padding="none">
          <div className="ov-card-head">
            <CardHeader title="Progres setup kafe masa coba" description="8 langkah sampai kafe siap berjualan" />
          </div>
          <div className="ov-card-body">
            {!data ? <SkeletonRows rows={3} label="Memuat progres setup" />
              : data.setup === null ? <EmptyState compact icon={ListChecks} title="Belum aktif" description="Progres setup muncul setelah file SQL 16 dijalankan." />
                : data.setup.length === 0 ? <EmptyState compact tone="green" icon={CircleCheck} title="Tidak ada yang tertahan" description="Semua kafe masa coba sudah menyelesaikan setup." />
                  : <SetupList rows={data.setup} />}
          </div>
        </Card>

        <Card className="ov-span-5" padding="none">
          <div className="ov-card-head">
            <CardHeader title="Kesehatan kafe" description="Skor 0–100 dari pesanan, login owner, modul, dan riwayat bayar" />
          </div>
          <div className="ov-card-body">
            {!data ? <SkeletonRows rows={3} label="Memuat skor kesehatan" />
              : data.health === null ? <EmptyState compact icon={HeartPulse} title="Belum aktif" description="Skor kesehatan dihitung harian setelah file SQL 16 dijalankan." />
                : <HealthPanel health={data.health} />}
          </div>
        </Card>
      </div>
    </div>
  )
}

function SubStat({ label, value, detail, alert, to }) {
  return (
    <Link to={to} className="ov-substat">
      <span className="ov-substat-label">{label}{alert && <Badge tone="red" size="sm">Perlu dicek</Badge>}</span>
      <strong className="tabular">{value == null ? '—' : formatNumber(value)}</strong>
      <span className="ov-substat-detail">{detail}<ArrowRight size={13} aria-hidden="true" /></span>
    </Link>
  )
}

function PlanSkeleton() {
  return (
    <div className="ov-plan-skeleton" role="status" aria-label="Memuat kafe per paket">
      <Skeleton width={148} height={148} radius={999} />
      <span><Skeleton width="80%" /><Skeleton width="60%" /><Skeleton width="70%" /></span>
    </div>
  )
}

function SetupList({ rows }) {
  return (
    <ul className="ov-list">
      {rows.map((row) => {
        const percent = Math.round((row.done / row.total) * 100)
        return (
          <li key={row.cafe_id} className="ov-setup">
            <span className="ov-setup-main">
              <Link to={`/kafe/${row.cafe_id}`}><strong>{row.cafe_name}</strong></Link>
              <span className="ov-setup-meta">
                {row.stuck_step
                  ? <>Tertahan di <b>{row.stuck_step}</b>{row.stuck_days ? ` · ${formatNumber(row.stuck_days)} hari` : ''}</>
                  : 'Semua langkah selesai'}
              </span>
              <span className="ov-setup-bar">
                <Progress value={percent} tone={percent >= 75 ? 'good' : percent >= 40 ? 'accent' : 'warn'} label={`Setup ${row.cafe_name}: ${row.done} dari ${row.total} langkah`} />
                <span className="tabular">{row.done}/{row.total}</span>
              </span>
            </span>
            <WhatsAppButton size="sm" variant="ghost" label="Kirim panduan" defaultTemplate="setup"
              ctx={{ cafeId: row.cafe_id, cafeName: row.cafe_name, ownerName: row.owner_name, phone: row.owner_whatsapp, stuckStep: row.stuck_step, setupDone: row.done }} />
          </li>
        )
      })}
    </ul>
  )
}

function HealthPanel({ health }) {
  const counts = health.counts || {}
  const rows = health.rows || []
  return (
    <>
      <ul className="ov-health-counts">
        {Object.entries(HEALTH).map(([key, meta]) => (
          <li key={key}><strong className="tabular">{formatNumber(counts[key] || 0)}</strong><Badge tone={meta.tone}>{meta.label}</Badge></li>
        ))}
      </ul>
      {rows.length === 0
        ? <EmptyState compact tone="green" icon={CircleCheck} title="Tidak ada kafe berisiko" description="Semua kafe berbayar dalam kondisi baik." />
        : (
          <ul className="ov-list">
            {rows.map((row) => {
              return (
                <li key={row.cafe_id} className="ov-health">
                  <span className="ov-health-text">
                    <Link to={`/kafe/${row.cafe_id}`}><strong>{row.cafe_name}</strong></Link>
                    <span>{row.reason}</span>
                  </span>
                  <HealthBadge score={row.score} label={row.label} size="sm" />
                </li>
              )
            })}
          </ul>
        )}
    </>
  )
}
