/*
 * Analitik pendapatan (file 16). Semua angka dihitung di SQL (pa_analytics_*); halaman ini hanya menampilkan.
 * Bila data belum cukup, tampil keterangan — bukan grafik kosong.
 */
import { useCallback } from 'react'
import { CircleAlert, Grid3x3, TrendingUp } from 'lucide-react'
import { Card, CardHeader, EmptyState, ErrorState, KpiCard, PageHeader, Skeleton, StackedBarChart } from '../components/ui/index.js'
import { optional, rpc, useLoader } from '../lib/api.js'
import { formatNumber, formatRupiah, formatRupiahCompact } from '../lib/format.js'

const MONTH = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const MONTH_SHORT = new Intl.DateTimeFormat('id-ID', { month: 'short', timeZone: 'UTC' })
const MONTH_COHORT = new Intl.DateTimeFormat('id-ID', { month: 'short', year: '2-digit', timeZone: 'UTC' })
const toDate = (value) => new Date(`${String(value).slice(0, 10)}T00:00:00Z`)

// Empat hue berbeda (aksen, biru, kuning, merah) agar tiap seri mudah dibedakan. Legenda + tooltip selalu menyebut nama seri.
const SERIES = [
  { key: 'new', label: 'Baru', color: 'var(--accent)' },
  { key: 'expansion', label: 'Upgrade', color: 'var(--info)' },
  { key: 'contraction', label: 'Downgrade', color: 'var(--warn)' },
  { key: 'churn', label: 'Berhenti', color: 'var(--bad)' },
]
const signed = (value) => `${Number(value) > 0 ? '+' : Number(value) < 0 ? '−' : ''}${formatRupiah(Math.abs(Number(value) || 0))}`
const percent = (value) => `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value)}%`

export function AnalyticsPage() {
  const load = useCallback(() => Promise.all([
    optional(rpc('pa_analytics_summary')),
    optional(rpc('pa_analytics_mrr', { p_months: 12 })),
    optional(rpc('pa_analytics_cohort', { p_months: 12 })),
  ]), [])
  const { data, error, loading, reload } = useLoader(load)

  if (error) return <div className="page"><PageHeader title="Analitik" /><ErrorState message={error} onRetry={reload} /></div>
  const [summary, mrr, cohort] = data || []
  const pending = loading && !data
  const missing = data && summary === null

  return (
    <div className="page page-wide pa-stack">
      <PageHeader eyebrow="Pendapatan" title="Analitik" description="Pergerakan MRR, retensi per bulan daftar, dan nilai pelanggan. Dihitung dari langganan yang tercatat." />

      {missing ? (
        <Card><EmptyState icon={TrendingUp} title="Belum aktif" description="Halaman ini aktif setelah file SQL 16 dijalankan di Supabase." /></Card>
      ) : (
        <>
          {summary && !summary.enough && (
            <div className="pa-notice" role="status">
              <CircleAlert size={18} aria-hidden="true" />
              <span>Data baru {formatNumber(summary.months_with_data)} bulan penuh. Angka berhenti dan nilai seumur hidup lebih bisa dipercaya setelah 3 bulan.</span>
            </div>
          )}

          <div className="ui-kpi-grid">
            <KpiCard hero label="MRR bulan ini" loading={pending} value={summary ? Number(summary.mrr) || 0 : undefined} format={formatRupiah}
              caption={summary ? `${formatNumber(summary.paying)} kafe berbayar` : undefined} />
            <KpiCard label="Rata-rata per kafe" loading={pending} value={summary?.arpa != null ? Number(summary.arpa) : summary ? '—' : undefined} format={formatRupiah}
              caption="MRR dibagi kafe berbayar" />
            <KpiCard label="Berhenti per bulan" loading={pending}
              value={summary?.churn_rate != null ? percent(Number(summary.churn_rate) * 100) : summary ? '—' : undefined}
              caption={summary?.churn_months ? `Rata-rata ${formatNumber(summary.churn_months)} bulan terakhir` : 'Butuh 1 bulan penuh'} />
            <KpiCard label="Perkiraan nilai seumur hidup" loading={pending}
              value={summary?.ltv != null ? Number(summary.ltv) : summary ? '—' : undefined} format={formatRupiah}
              caption={summary?.ltv_note || 'Rata-rata per kafe ÷ tingkat berhenti'} />
          </div>

          <Card>
            <CardHeader title="Pergerakan MRR" description="Per bulan: kafe baru, upgrade, downgrade, dan berhenti" />
            {pending ? <Skeleton height={260} radius={12} /> : !mrr?.enough ? (
              <EmptyState icon={TrendingUp} title="Data belum cukup"
                description={`Baru ${formatNumber(mrr?.months_with_data || 0)} bulan tercatat. Grafik muncul setelah ada 2 bulan data MRR (dicatat otomatis setiap hari).`} />
            ) : (
              <>
                <StackedBarChart
                  ariaLabel="Pergerakan MRR per bulan"
                  series={SERIES}
                  data={mrr.months.map((month) => ({
                    key: month.month, label: MONTH_SHORT.format(toDate(month.month)), tooltipLabel: MONTH.format(toDate(month.month)),
                    values: { new: Number(month.new), expansion: Number(month.expansion), contraction: Number(month.contraction), churn: Number(month.churn) },
                  }))}
                  formatValue={signed} formatTick={formatRupiahCompact} />
                <MovementSummary month={mrr.months.at(-1)} />
              </>
            )}
          </Card>

          <Card padding="none">
            <div className="ov-card-head"><CardHeader title="Retensi per bulan daftar" description="Persen kafe yang masih membayar N bulan setelah pertama kali membayar" /></div>
            <div className="ov-card-body">
              {pending ? <Skeleton height={200} radius={12} /> : !cohort?.cohorts?.length ? (
                <EmptyState compact icon={Grid3x3} title="Data belum cukup" description="Tabel retensi muncul setelah ada kafe yang membayar." />
              ) : <CohortTable cohorts={cohort.cohorts} />}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

function MovementSummary({ month }) {
  if (!month) return null
  const items = [
    ['Awal bulan', formatRupiah(month.start_mrr)],
    ['Baru', signed(month.new)],
    ['Upgrade', signed(month.expansion)],
    ['Downgrade', signed(month.contraction)],
    ['Berhenti', signed(month.churn)],
    ['Akhir bulan', formatRupiah(month.end_mrr)],
  ]
  return (
    <dl className="an-movement" aria-label={`Ringkasan ${MONTH.format(toDate(month.month))}`}>
      {items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="tabular">{value}</dd></div>)}
    </dl>
  )
}

function CohortTable({ cohorts }) {
  const width = Math.max(...cohorts.map((row) => row.cells.length))
  return (
    <div className="table-scroll">
      <table className="data-table an-cohort">
        <caption className="sr-only">Retensi kafe per bulan daftar</caption>
        <thead>
          <tr>
            <th scope="col">Bulan daftar</th>
            <th scope="col" className="num">Kafe</th>
            {Array.from({ length: width }, (_, index) => <th key={index} scope="col" className="num">{index === 0 ? 'Bln 0' : `+${index}`}</th>)}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((row) => (
            <tr key={row.month}>
              <th scope="row">{MONTH_COHORT.format(toDate(row.month))}</th>
              <td className="num tabular">{formatNumber(row.size)}</td>
              {Array.from({ length: width }, (_, index) => {
                const cell = row.cells.find((item) => item.offset === index)
                if (!cell) return <td key={index} aria-hidden="true" />
                // Intensitas warna = persen bertahan (dibatasi agar teks tetap terbaca di kedua mode)
                return (
                  <td key={index} className="num tabular an-cell" style={{ '--intensity': `${Math.round(Number(cell.pct) * 0.55)}%` }}
                    title={`${formatNumber(cell.retained)} dari ${formatNumber(row.size)} kafe`}>
                    {formatNumber(cell.pct)}%
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
