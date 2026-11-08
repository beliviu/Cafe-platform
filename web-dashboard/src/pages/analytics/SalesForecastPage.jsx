/*
 * Analitik → Prediksi penjualan (file 11: bi_sales_forecast, bi_product_demand).
 * Semua angka dari database. Perkiraan selalu ditandai & disertai rentang; database menolak menebak
 * bila riwayat < 14 hari atau < 10 hari berjualan.
 */
import { useCallback, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Info } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui/index.js'
import { ForecastChart } from '../../components/charts/ForecastChart.jsx'
import { BI_REQUIRED } from '../../lib/db.js'
import { dateKeyLabel, signedPercent } from '../../lib/bi.js'
import { formatDateShort, formatNumber, formatPercent, formatRupiah, formatRupiahCompact, formatWeekday } from '../../lib/format.js'
import { useLoader } from '../../lib/inventory.js'
import { rpc } from '../../lib/pos.js'

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const COMPARISON_LABELS = {
  last_7: '7 hari terakhir vs 7 hari sebelumnya',
  last_28: '28 hari terakhir vs 28 hari sebelumnya',
  month_to_date: 'Bulan ini (s.d. kemarin) vs tanggal yang sama bulan lalu',
  month_to_date_last_year: 'Bulan ini (s.d. kemarin) vs tanggal yang sama tahun lalu',
}
const keyDate = (key) => `${key}T00:00:00+07:00`
const monthLabel = (key) => { const [year, month] = key.split('-').map(Number); return `${MONTHS[month - 1]} ${year}` }

export function SalesForecastPage() {
  const { cafe, features } = useOutletContext()
  const { supabase } = useAuth()
  const load = useCallback(async () => {
    const [forecast, demand] = await Promise.all([
      rpc(supabase, 'bi_sales_forecast', { p_cafe_id: cafe.id, p_horizon: 14 }),
      rpc(supabase, 'bi_product_demand', { p_cafe_id: cafe.id, p_days: 7 }),
    ])
    return { forecast, demand: demand || [] }
  }, [cafe.id, supabase])
  const { data, error, reload } = useLoader(features?.bi ? load : null)

  const chartData = useMemo(() => {
    if (!data) return []
    const fc = data.forecast
    const byDay = new Map((fc.daily || []).map((row) => [row.day, row]))
    const rows = (fc.history || []).filter((row) => row.day !== fc.today).map((row) => ({ key: row.day, label: formatDateShort(keyDate(row.day)), tooltipLabel: `${formatWeekday(keyDate(row.day))}, ${dateKeyLabel(row.day)}`, actual: Number(row.revenue), forecast: null }))
    for (const row of fc.daily || []) {
      rows.push({
        key: row.day, label: formatDateShort(keyDate(row.day)), tooltipLabel: `${formatWeekday(keyDate(row.day))}, ${dateKeyLabel(row.day)}${row.day === fc.today ? ' (hari ini)' : ''}`,
        actual: row.actual === null || row.actual === undefined ? null : Number(row.actual), forecast: Number(row.revenue), low: Number(row.low), high: Number(row.high),
      })
    }
    if (!byDay.size) {
      const today = (fc.history || []).find((row) => row.day === fc.today)
      if (today) rows.push({ key: today.day, label: formatDateShort(keyDate(today.day)), tooltipLabel: `${dateKeyLabel(today.day)} (hari ini)`, actual: Number(today.revenue), forecast: null })
    }
    return rows
  }, [data])

  if (!features?.bi) {
    return <div className="page page-wide"><Header /><Card><EmptyState title="Belum tersedia" description={BI_REQUIRED} /></Card></div>
  }
  if (error) return <div className="page page-wide"><Header /><Card><ErrorState message={error} onRetry={reload} /></Card></div>

  const fc = data?.forecast
  const ok = fc?.basis === 'ok'
  const next7 = ok ? fc.daily.slice(0, 7).reduce((sum, row) => sum + Number(row.revenue), 0) : null
  const next7Low = ok ? fc.daily.slice(0, 7).reduce((sum, row) => sum + Number(row.low), 0) : null
  const next7High = ok ? fc.daily.slice(0, 7).reduce((sum, row) => sum + Number(row.high), 0) : null
  const thisMonth = ok ? fc.monthly[0] : null
  const nextMonth = ok ? fc.monthly[1] : null

  return (
    <div className="page page-wide">
      <Header />
      <div className="bi-page">
        {fc && !ok && (
          <div className="bi-notice" role="status">
            <Info size={18} aria-hidden="true" />
            <div><strong>Data belum cukup untuk prediksi</strong><p>{fc.reason} Perbandingan historis di bawah tetap memakai data aktual.</p></div>
          </div>
        )}
        <section className="dash-stats" aria-label="Ringkasan prediksi">
          <StatCard label="Perkiraan 7 hari ke depan" value={ok ? formatRupiah(next7) : '—'} caption={ok ? `Rentang ${formatRupiahCompact(next7Low)}–${formatRupiahCompact(next7High)}` : 'Menunggu riwayat cukup'} loading={!data} />
          <StatCard tone="neutral" label={thisMonth ? `Proyeksi ${monthLabel(thisMonth.month)}` : 'Proyeksi bulan ini'} value={thisMonth ? formatRupiah(thisMonth.projection) : '—'}
            caption={thisMonth ? `Aktual ${formatRupiahCompact(thisMonth.actual)} + perkiraan sisa ${formatRupiahCompact(thisMonth.forecast_rest)}` : 'Menunggu riwayat cukup'} loading={!data} />
          <StatCard tone="neutral" label={nextMonth ? `Perkiraan ${monthLabel(nextMonth.month)}` : 'Perkiraan bulan depan'} value={nextMonth ? formatRupiah(nextMonth.projection) : '—'}
            caption={nextMonth ? `Rentang ${formatRupiahCompact(nextMonth.low)}–${formatRupiahCompact(nextMonth.high)}` : 'Menunggu riwayat cukup'} loading={!data} />
          <StatCard tone="neutral" label="Ketepatan model" value={ok && fc.backtest_wape !== null ? `±${formatPercent(fc.backtest_wape, 1)}` : '—'}
            caption={ok && fc.backtest_wape !== null ? 'Rata-rata meleset saat diuji pada 14 hari terakhir' : 'Uji mundur butuh 6 minggu riwayat'} loading={!data} />
        </section>

        <Card>
          <CardHeader title="Penjualan harian" description="28 hari terakhir (aktual) dan 14 hari ke depan (perkiraan)" />
          {!data ? <SkeletonRows rows={4} label="Memuat grafik" /> : (
            <ForecastChart data={chartData} formatValue={formatRupiah} formatTick={formatRupiahCompact} ariaLabel="Grafik penjualan aktual dan perkiraan per hari" />
          )}
        </Card>

        <div className="bi-grid">
          <Card padding="none">
            <div className="table-card-head"><CardHeader title="Per minggu" description="Senin–Minggu. Hari yang sudah lewat memakai data aktual." /></div>
            {!data ? <SkeletonRows rows={4} label="Memuat" /> : !ok ? <EmptyState compact title="Belum ada prediksi" description="Muncul setelah riwayat cukup." /> : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th scope="col">Minggu</th><th scope="col" className="num">Proyeksi</th><th scope="col" className="num">Rentang 80%</th><th scope="col" className="num">Minggu sebelumnya</th></tr></thead>
                  <tbody>
                    {fc.weekly.map((week, index) => (
                      <tr key={week.week_start}>
                        <td><strong>{formatDateShort(keyDate(week.week_start))} – {formatDateShort(keyDate(week.week_end))}</strong>
                          <small className="cell-sub">{index === 0 ? `Aktual ${formatRupiah(week.actual)} + perkiraan ${formatRupiah(week.forecast_rest)}` : 'Perkiraan'}</small></td>
                        <td className="num tabular">{formatRupiah(week.projection)}</td>
                        <td className="num tabular bi-muted">{formatRupiahCompact(week.low)}–{formatRupiahCompact(week.high)}</td>
                        <td className="num tabular">{week.previous_actual === null || week.previous_actual === undefined ? '—' : formatRupiah(week.previous_actual)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card padding="none">
            <div className="table-card-head"><CardHeader title="Per bulan" /></div>
            {!data ? <SkeletonRows rows={2} label="Memuat" /> : !ok ? <EmptyState compact title="Belum ada prediksi" description="Muncul setelah riwayat cukup." /> : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th scope="col">Bulan</th><th scope="col" className="num">Proyeksi</th><th scope="col" className="num">Bulan lalu</th><th scope="col" className="num">Tahun lalu</th></tr></thead>
                  <tbody>
                    {fc.monthly.map((month, index) => (
                      <tr key={month.month}>
                        <td><strong>{monthLabel(month.month)}</strong>
                          <small className="cell-sub">{index === 0 ? `Aktual ${formatRupiah(month.actual)} + perkiraan sisa` : 'Perkiraan'} · rentang {formatRupiahCompact(month.low)}–{formatRupiahCompact(month.high)}</small></td>
                        <td className="num tabular">{formatRupiah(month.projection)}</td>
                        <td className="num tabular">{month.previous_month_actual === null ? '—' : formatRupiah(month.previous_month_actual)}</td>
                        <td className="num tabular">{month.last_year_actual === null ? '—' : formatRupiah(month.last_year_actual)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <Card padding="none">
          <div className="table-card-head"><CardHeader title="Perbandingan historis" description="Data aktual, pesanan lunas" /></div>
          {!data ? <SkeletonRows rows={3} label="Memuat" /> : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th scope="col">Rentang</th><th scope="col" className="num">Sekarang</th><th scope="col" className="num">Pembanding</th><th scope="col" className="num">Perubahan</th></tr></thead>
                <tbody>
                  {fc.comparisons.map((row) => (
                    <tr key={row.key}>
                      <td>{COMPARISON_LABELS[row.key] || row.key}<small className="cell-sub">{formatNumber(row.orders)} vs {formatNumber(row.previous_orders)} pesanan</small></td>
                      <td className="num tabular">{formatRupiah(row.revenue)}</td>
                      <td className="num tabular">{formatRupiah(row.previous_revenue)}</td>
                      <td className={`num tabular ${Number(row.change_pct) > 0 ? 'bi-up' : Number(row.change_pct) < 0 ? 'bi-down' : ''}`}>{row.change_pct === null ? 'Belum ada data' : signedPercent(row.change_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card padding="none">
          <div className="table-card-head"><CardHeader title="Permintaan produk 7 hari ke depan" description="Jumlah terjual 28 hari terakhir, disesuaikan pola hari. Stok dari resep bila pelacakan aktif." /></div>
          {!data ? <SkeletonRows rows={5} label="Memuat" /> : !data.demand.length ? <EmptyState compact title="Belum ada produk terjual" /> : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th scope="col">Produk</th><th scope="col" className="num">Terjual 28 hari</th><th scope="col" className="num">Tren</th><th scope="col" className="num">Perkiraan 7 hari</th><th scope="col" className="num">Stok cukup</th></tr></thead>
                <tbody>
                  {data.demand.map((row) => (
                    <tr key={row.product_id}>
                      <td><strong>{row.name}</strong>{!row.is_available && <> <Badge tone="neutral">Nonaktif</Badge></>}</td>
                      <td className="num tabular">{formatNumber(row.quantity_28)}</td>
                      <td className={`num tabular ${Number(row.trend_pct) > 0 ? 'bi-up' : Number(row.trend_pct) < 0 ? 'bi-down' : ''}`}>{row.trend_pct === null ? '—' : signedPercent(row.trend_pct)}</td>
                      <td className="num tabular">{row.forecast_quantity === null ? '—' : `≈ ${formatNumber(Math.round(Number(row.forecast_quantity)))}`}</td>
                      <td className="num tabular">{row.portions === null ? <span className="bi-muted">Tidak dilacak</span>
                        : row.days_cover === null ? `${formatNumber(row.portions)} porsi`
                          : <span className={Number(row.days_cover) < 2 ? 'bi-down' : ''}>{formatNumber(row.portions)} porsi · {formatNumber(row.days_cover)} hari</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {ok && (
          <Card>
            <CardHeader title="Cara menghitung" />
            <p className="bi-note">{fc.method}</p>
            <p className="bi-note">Riwayat dipakai: {formatNumber(fc.history_days)} hari ({formatNumber(fc.active_days)} hari berjualan). Rentang menunjukkan kisaran yang wajar (80%) berdasarkan seberapa jauh penjualan harian biasanya menyimpang dari pola. Penjualan = pesanan lunas yang tidak dibatalkan; refund tidak dikurangkan.</p>
          </Card>
        )}
      </div>
    </div>
  )
}

function Header() {
  return <PageHeader eyebrow="Analitik" title="Prediksi penjualan" description="Perkiraan harian, mingguan, dan bulanan dari pola penjualanmu sendiri." />
}
