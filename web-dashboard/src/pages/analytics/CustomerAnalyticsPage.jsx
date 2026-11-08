/*
 * Analitik → Analitik pelanggan (file 11: bi_customer_analytics). HANYA OWNER (dicek database).
 * Pelanggan = akun aplikasi. Pesanan kasir tanpa akun dihitung terpisah, tidak per orang.
 * Data pribadi: hanya nama (tanpa kontak) dan hanya untuk owner.
 */
import { useCallback, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Info, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, SkeletonRows, StatCard } from '../../components/ui/index.js'
import { PeriodPicker } from '../../components/finance/PeriodPicker.jsx'
import { BI_REQUIRED } from '../../lib/db.js'
import { periodFor, periodLabel } from '../../lib/finance.js'
import { formatDate, formatNumber, formatPercent, formatRupiah } from '../../lib/format.js'
import { useLoader } from '../../lib/inventory.js'
import { rpc } from '../../lib/pos.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const BUCKET_LABELS = { 1: '1 kali', '2-3': '2–3 kali', '4-9': '4–9 kali', '10+': '10 kali atau lebih' }

function cohortLevel(pct) {
  if (pct === null) return 0
  if (pct >= 60) return 4
  if (pct >= 40) return 3
  if (pct >= 20) return 2
  if (pct > 0) return 1
  return 0
}

export function CustomerAnalyticsPage() {
  const { cafe, features } = useOutletContext()
  const { supabase } = useAuth()
  const [period, setPeriod] = useState(() => ({ ...periodFor('this-month'), key: 'this-month' }))
  const load = useCallback(
    () => rpc(supabase, 'bi_customer_analytics', { p_cafe_id: cafe.id, p_from: period.from, p_to: period.to, p_include_people: true }),
    [cafe.id, period.from, period.to, supabase],
  )
  const { data, error, reload, loading } = useLoader(features?.bi ? load : null)

  if (!features?.bi) return <div className="page page-wide"><Header /><Card><EmptyState title="Belum tersedia" description={BI_REQUIRED} /></Card></div>

  const summary = data?.summary
  const accountShare = summary && summary.orders ? (summary.account_orders / summary.orders) * 100 : null
  const maxBucket = Math.max(1, ...(data?.frequency || []).map((row) => row.customers))
  const people = data?.inactive?.people || []

  return (
    <div className="page page-wide">
      <Header />
      <div className="bi-page">
        <section className="toolbar" aria-label="Periode">
          <PeriodPicker value={period} onChange={setPeriod} />
          <span className="bi-muted">{periodLabel(period)}</span>
        </section>
        {error ? <Card><ErrorState message={error} onRetry={reload} /></Card> : (
          <>
            {summary && accountShare !== null && accountShare < 100 && (
              <div className="bi-notice" role="note">
                <Info size={18} aria-hidden="true" />
                <div>
                  <strong>{formatPercent(accountShare, 1)} pesanan dari akun pelanggan</strong>
                  <p>{formatNumber(summary.guest_orders)} pesanan tanpa akun (kebanyakan kasir) dihitung di total & nilai rata-rata, tetapi tidak bisa dianalisis per pelanggan.</p>
                </div>
              </div>
            )}
            <section className={`dash-stats${loading && data ? ' is-refreshing' : ''}`} aria-label="Ringkasan pelanggan">
              <StatCard label="Pelanggan ber-akun" value={summary ? formatNumber(summary.customers) : '—'}
                caption={summary ? `${formatNumber(summary.new_customers)} baru · ${formatNumber(summary.returning_customers)} kembali` : ''} loading={!data} />
              <StatCard tone="neutral" label="Retensi" value={data?.retention?.rate_pct === null || !data ? '—' : formatPercent(data.retention.rate_pct, 1)}
                caption={data ? (data.retention.previous_customers ? `${formatNumber(data.retention.retained)} dari ${formatNumber(data.retention.previous_customers)} pelanggan periode lalu membeli lagi` : 'Belum ada pelanggan di periode lalu') : ''} loading={!data} />
              <StatCard tone="neutral" label="Nilai rata-rata pesanan" value={summary?.aov ? formatRupiah(summary.aov) : '—'}
                caption={summary ? `Akun ${summary.aov_account ? formatRupiah(summary.aov_account) : '—'} · tanpa akun ${summary.aov_guest ? formatRupiah(summary.aov_guest) : '—'}` : ''} loading={!data} />
              <StatCard tone="neutral" label="Jarak antar-pesanan" value={data?.interval?.median_days ? `${formatNumber(data.interval.median_days)} hari` : '—'}
                caption={data?.interval?.customers ? `Median dari ${formatNumber(data.interval.customers)} pelanggan (180 hari)` : 'Butuh pelanggan dengan ≥ 2 pesanan'} loading={!data} />
            </section>

            <div className="bi-grid">
              <Card>
                <CardHeader title="Frekuensi beli" description={summary ? `${formatNumber(summary.repeat_customers)} pelanggan membeli 2 kali atau lebih · rata-rata ${formatNumber(summary.orders_per_customer || 0)} pesanan per pelanggan` : 'Pesanan per pelanggan di periode ini'} />
                {!data ? <SkeletonRows rows={4} label="Memuat" /> : !summary.customers ? <EmptyState compact title="Belum ada pelanggan ber-akun" description="Muncul saat pelanggan memesan lewat aplikasi." /> : (
                  <ul className="fin-bars">
                    {data.frequency.map((row) => (
                      <li key={row.bucket}>
                        <span className="fin-bars-label"><span>{BUCKET_LABELS[row.bucket]}</span><span className="tabular">{formatNumber(row.customers)} pelanggan</span></span>
                        <span className="fin-bars-track" aria-hidden="true"><span style={{ width: `${Math.max((row.customers / maxBucket) * 100, row.customers ? 2 : 0)}%` }} /></span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card padding="none">
                <div className="table-card-head"><CardHeader title="Produk favorit pelanggan" description="Pesanan dari akun pelanggan" /></div>
                {!data ? <SkeletonRows rows={4} label="Memuat" /> : !data.products.length ? <EmptyState compact title="Belum ada data" /> : (
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead><tr><th scope="col">Produk</th><th scope="col" className="num">Terjual</th><th scope="col" className="num">Pembeli</th><th scope="col" className="num">Beli ulang</th></tr></thead>
                      <tbody>
                        {data.products.map((row) => (
                          <tr key={row.name}>
                            <td><strong>{row.name}</strong></td>
                            <td className="num tabular">{formatNumber(row.quantity)}</td>
                            <td className="num tabular">{formatNumber(row.buyers)}</td>
                            <td className="num tabular">{formatNumber(row.repeat_buyers)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>

            <Card padding="none">
              <div className="table-card-head"><CardHeader title="Retensi per bulan pertama" description="Dari pelanggan yang pertama kali membeli di bulan itu, berapa persen yang membeli lagi 1, 2, dan 3 bulan kemudian" /></div>
              {!data ? <SkeletonRows rows={4} label="Memuat" /> : !data.cohorts.length ? <EmptyState compact title="Belum ada pelanggan baru dalam 6 bulan terakhir" /> : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead><tr><th scope="col">Bulan pertama</th><th scope="col" className="num">Pelanggan baru</th><th scope="col" className="num">Bulan +1</th><th scope="col" className="num">Bulan +2</th><th scope="col" className="num">Bulan +3</th></tr></thead>
                    <tbody>
                      {data.cohorts.map((row) => {
                        const [year, month] = row.month.split('-').map(Number)
                        return (
                          <tr key={row.month}>
                            <td><strong>{MONTHS[month - 1]} {year}</strong></td>
                            <td className="num tabular">{formatNumber(row.size)}</td>
                            {['m1', 'm2', 'm3'].map((key) => {
                              const pct = row[key] === null ? null : (row[key] / row.size) * 100
                              return (
                                <td key={key} className="num">
                                  {pct === null ? <span className="bi-muted">Belum</span> : <span className={`cohort-cell cohort-l${cohortLevel(pct)}`} title={`${formatNumber(row[key])} dari ${formatNumber(row.size)} pelanggan`}>{formatPercent(pct)}</span>}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card padding="none">
              <div className="table-card-head">
                <CardHeader title="Pelanggan tidak aktif" description={data ? `Tidak membeli 30 hari atau lebih · 30–59 hari: ${formatNumber(data.inactive.d30_59)} · 60–89 hari: ${formatNumber(data.inactive.d60_89)} · 90+ hari: ${formatNumber(data.inactive.d90_plus)}` : 'Tidak membeli 30 hari atau lebih'} />
              </div>
              {!data ? <SkeletonRows rows={4} label="Memuat" /> : !people.length ? <EmptyState compact title="Tidak ada pelanggan tidak aktif" description="Semua pelanggan ber-akun membeli dalam 30 hari terakhir." /> : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead><tr><th scope="col">Pelanggan</th><th scope="col" className="num">Pesanan</th><th scope="col" className="num">Total belanja</th><th scope="col">Terakhir membeli</th></tr></thead>
                    <tbody>
                      {people.map((row) => (
                        <tr key={row.customer_id}>
                          <td><strong>{row.full_name || 'Tanpa nama'}</strong></td>
                          <td className="num tabular">{formatNumber(row.orders)}</td>
                          <td className="num tabular">{formatRupiah(row.lifetime_spend)}</td>
                          <td>{formatDate(row.last_order_at)}<small className="cell-sub">{formatNumber(row.days_since)} hari lalu</small></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {people.length > 0 && (
                <p className="bi-note bi-foot"><ShieldCheck size={13} aria-hidden="true" /> Hanya owner yang bisa melihat daftar ini. Kontak pelanggan tidak ditampilkan; untuk menyapa mereka kembali, buat voucher di Loyalti & voucher.</p>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

function Header() {
  return <PageHeader eyebrow="Analitik" title="Analitik pelanggan" description="Siapa yang kembali, seberapa sering, dan siapa yang mulai menghilang." />
}
