/*
 * Ringkasan keuangan (dari jurnal) + wizard "Mulai pembukuan" (tanggal go-live & saldo awal).
 */
import { useCallback, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { BookOpenCheck, CircleDollarSign, Landmark, RefreshCw, TrendingUp, TriangleAlert, Wallet } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, ErrorState, RupiahInput, SkeletonRows, StatCard, TextField, useToast,
} from '../../components/ui/index.js'
import { PeriodPicker } from '../../components/finance/PeriodPicker.jsx'
import { friendlyError } from '../../lib/db.js'
import { formatDate, formatNumber, formatRupiah, jakartaDateKey } from '../../lib/format.js'
import { percentLabel, periodFor, periodLabel } from '../../lib/finance.js'
import { useLoader, useOwnerBase } from '../../lib/inventory.js'
import { rpc } from '../../lib/pos.js'

export function FinanceOverviewPage() {
  const { cafe, finance } = useOutletContext()
  if (!finance.goLive) return <SetupWizard cafe={cafe} onDone={finance.reload} />
  return <Overview cafe={cafe} goLive={finance.goLive} />
}

function Overview({ cafe, goLive }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const base = useOwnerBase()
  const [period, setPeriod] = useState(() => ({ ...periodFor('this-month'), key: 'this-month' }))
  const [syncing, setSyncing] = useState(false)
  const from = period.from < goLive ? goLive : period.from
  const load = useCallback(() => rpc(supabase, 'acc_overview', { p_cafe_id: cafe.id, p_from: from, p_to: period.to }), [cafe.id, from, period.to, supabase])
  const { data, error, reload, loading } = useLoader(load)

  async function sync() {
    setSyncing(true)
    try {
      const result = await rpc(supabase, 'acc_backfill', { p_cafe_id: cafe.id })
      toast({ tone: result.failed ? 'info' : 'success', title: 'Sinkronisasi selesai', description: `${formatNumber(result.checked)} kejadian diperiksa${result.failed ? ` · ${result.failed} masih gagal` : ''}` })
      reload()
    } catch (caught) {
      toast({ tone: 'error', title: 'Sinkronisasi gagal', description: caught.message })
    }
    setSyncing(false)
  }

  if (error) return <Card><ErrorState message={error} onRetry={reload} /></Card>
  if (!data) return <Card padding="none"><SkeletonRows rows={6} label="Menghitung" /></Card>
  const margin = data.net_revenue ? data.net_profit / data.net_revenue : null
  const position = [
    ['Kas di laci', data.cash], ['Saldo QRIS & e-wallet', data.wallet], ['Bank', data.bank],
    ['Piutang & uang muka pesanan', data.receivable], ['Persediaan bahan', data.inventory],
    ['Utang supplier', data.payable], ['Utang pajak', data.tax_payable],
  ]

  return (
    <div className={`inv-page${loading ? ' is-refreshing' : ''}`}>
      <section className="toolbar" aria-label="Periode">
        <PeriodPicker value={period} onChange={setPeriod} minDate={goLive} />
        <span className="text-muted">{periodLabel({ from, to: period.to })} · pembukuan sejak {formatDate(`${goLive}T00:00:00+07:00`)}</span>
        <Button variant="secondary" icon={RefreshCw} loading={syncing} onClick={sync} className="toolbar-end">Sinkronkan</Button>
      </section>

      {Number(data.issues) > 0 && (
        <div className="inv-alert" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <div>
            <strong>{formatNumber(data.issues)} kejadian belum masuk jurnal</strong>
            <p>Transaksinya tetap tersimpan. Biasanya karena periode sudah ditutup atau akun nonaktif. Perbaiki penyebabnya lalu tekan Sinkronkan.</p>
          </div>
        </div>
      )}

      <section className="dash-stats inv-stats" aria-label="Laba rugi periode">
        <StatCard icon={TrendingUp} label="Laba bersih" value={formatRupiah(data.net_profit)} caption={margin === null ? 'Belum ada pendapatan' : `Margin bersih ${percentLabel(margin)}`} />
        <StatCard icon={CircleDollarSign} tone="neutral" label="Pendapatan bersih" value={formatRupiah(data.net_revenue)}
          caption={Number(data.contra_revenue) ? `Setelah diskon & refund ${formatRupiah(data.contra_revenue)}` : 'Penjualan + service'} />
        <StatCard icon={BookOpenCheck} tone="green" label="Laba kotor" value={formatRupiah(data.gross_profit)} caption={`HPP ${formatRupiah(data.cogs)}${data.net_revenue ? ` · ${percentLabel(data.gross_profit / data.net_revenue)}` : ''}`} />
        <StatCard icon={Wallet} tone="amber" label="Beban operasional" value={formatRupiah(data.expenses)} caption={Number(data.other) ? `Lain-lain ${formatRupiah(data.other)}` : 'Gaji, sewa, listrik, dll.'} />
      </section>

      <div className="fin-grid">
        <Card>
          <CardHeader title="Posisi keuangan" description={`Per ${formatDate(`${period.to}T00:00:00+07:00`)}`} />
          <dl className="fin-position">
            {position.map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd className={`tabular${Number(value) < 0 ? ' inv-low' : ''}`}>{formatRupiah(value)}</dd></div>
            ))}
          </dl>
        </Card>
        <Card>
          <CardHeader title="Neraca ringkas" description="Aset = kewajiban + ekuitas" actions={<Link to={`${base}/finance/reports?report=balance`} className="fin-link">Lihat neraca</Link>} />
          <dl className="fin-position is-strong">
            <div><dt>Total aset</dt><dd className="tabular">{formatRupiah(data.assets)}</dd></div>
            <div><dt>Total kewajiban</dt><dd className="tabular">{formatRupiah(data.liabilities)}</dd></div>
            <div><dt>Total ekuitas (termasuk laba berjalan)</dt><dd className="tabular">{formatRupiah(data.equity)}</dd></div>
          </dl>
          {Math.abs(Number(data.assets) - Number(data.liabilities) - Number(data.equity)) < 0.5
            ? <Badge tone="green" dot={false}>Seimbang</Badge>
            : <Badge tone="red" dot={false}>Tidak seimbang — hubungi developer</Badge>}
        </Card>
      </div>

      <p className="inv-footnote">
        Penjualan diakui saat pesanan <strong>selesai</strong>; pembayaran yang masuk lebih dulu dicatat sebagai uang muka. HPP dari bahan yang benar-benar terpakai.
        Pembayaran QRIS masuk ke "Saldo QRIS & e-wallet" — catat pencairan ke bank lewat jurnal manual.
      </p>
    </div>
  )
}

/* ====================================================================
 * Wizard mulai pembukuan
 * ==================================================================== */
const ASSET_FIELDS = [
  { code: '1-1100', label: 'Uang tunai di laci & brankas' },
  { code: '1-1200', label: 'Saldo rekening bank' },
  { code: '1-1150', label: 'Saldo QRIS / e-wallet belum cair' },
  { code: '1-1400', label: 'Persediaan bahan', suggest: 'inventory' },
  { code: '1-1300', label: 'Piutang pesanan', suggest: 'receivable' },
  { code: '1-2100', label: 'Peralatan (mesin kopi, grinder, furnitur) — nilai saat ini' },
]
const LIABILITY_FIELDS = [
  { code: '2-1100', label: 'Utang ke supplier', suggest: 'payable' },
  { code: '2-1200', label: 'Pajak yang sudah dipungut tapi belum disetor' },
  { code: '2-2100', label: 'Pinjaman (bank, keluarga, dll.)' },
  { code: '3-1000', label: 'Modal yang sudah disetor pemilik' },
]

function SetupWizard({ cafe, onDone }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const today = jakartaDateKey()
  const [goLive, setGoLive] = useState(today)
  const [values, setValues] = useState({})
  const [confirm, setConfirm] = useState(false)
  const loadSuggest = useCallback(() => rpc(supabase, 'acc_opening_suggestions', { p_cafe_id: cafe.id, p_date: goLive }), [cafe.id, goLive, supabase])
  const { data: suggest, error, reload } = useLoader(loadSuggest)

  const valueOf = useCallback((field) => {
    if (values[field.code] !== undefined && values[field.code] !== '') return Number(values[field.code]) || 0
    return field.suggest && suggest ? Math.max(Number(suggest[field.suggest]) || 0, 0) : 0
  }, [suggest, values])
  const totals = useMemo(() => {
    const assets = ASSET_FIELDS.reduce((sum, field) => sum + valueOf(field), 0)
    const claims = LIABILITY_FIELDS.reduce((sum, field) => sum + valueOf(field), 0)
    return { assets, claims, balancing: assets - claims }
  }, [valueOf])

  async function submit() {
    const lines = [...ASSET_FIELDS, ...LIABILITY_FIELDS].map((field) => ({ code: field.code, amount: valueOf(field) })).filter((line) => line.amount)
    const result = await rpc(supabase, 'acc_setup', { p_cafe_id: cafe.id, p_go_live: goLive, p_lines: lines })
    toast({ tone: 'success', title: 'Pembukuan dimulai', description: `${formatNumber(result.backfill?.checked || 0)} kejadian sejak go-live sudah dijurnal.` })
    setConfirm(false)
    onDone()
  }

  const field = (item) => (
    <RupiahInput key={item.code} label={item.label} value={values[item.code] ?? (item.suggest && suggest ? Math.max(Number(suggest[item.suggest]) || 0, 0) : '')}
      onChange={(value) => setValues((current) => ({ ...current, [item.code]: value }))}
      hint={item.suggest && suggest ? `Saran dari data: ${formatRupiah(Math.max(Number(suggest[item.suggest]) || 0, 0))}` : undefined} />
  )

  return (
    <div className="inv-page fin-setup">
      <Card>
        <CardHeader title="Mulai pembukuan" description="Pilih tanggal mulai dan isi posisi keuangan kafe pada tanggal itu. Transaksi sejak tanggal itu otomatis dijurnal; sebelum itu tidak dijurnal (tidak ada angka karangan)." />
        <div className="inv-form-row">
          <TextField label="Tanggal mulai (go-live)" type="date" value={goLive} max={today} onChange={(event) => event.target.value && setGoLive(event.target.value)}
            hint="Paling mudah: hari ini atau tanggal 1 bulan ini. Maksimal 1 tahun ke belakang." />
        </div>
      </Card>
      {error ? <Card><ErrorState compact message={friendlyError({ message: error })} onRetry={reload} /></Card> : (
        <div className="fin-grid">
          <Card>
            <CardHeader title="Yang dimiliki kafe (aset)" description={`Per ${formatDate(`${goLive}T00:00:00+07:00`)}`} />
            <div className="inv-form">{ASSET_FIELDS.map(field)}</div>
          </Card>
          <Card>
            <CardHeader title="Kewajiban & modal" description="Utang yang belum dibayar dan modal pemilik" />
            <div className="inv-form">{LIABILITY_FIELDS.map(field)}</div>
            <dl className="fin-position is-strong">
              <div><dt>Total aset</dt><dd className="tabular">{formatRupiah(totals.assets)}</dd></div>
              <div><dt>Kewajiban + modal disetor</dt><dd className="tabular">{formatRupiah(totals.claims)}</dd></div>
              <div><dt>Ekuitas saldo awal (penyeimbang)</dt><dd className={`tabular${totals.balancing < 0 ? ' inv-low' : ''}`}>{formatRupiah(totals.balancing)}</dd></div>
            </dl>
            <p className="ui-field-hint">Selisih aset dengan kewajiban + modal otomatis menjadi "Ekuitas saldo awal" sehingga neraca seimbang. Saldo awal bisa dikoreksi nanti lewat jurnal manual.</p>
            <Button icon={BookOpenCheck} onClick={() => setConfirm(true)}>Mulai pembukuan</Button>
          </Card>
        </div>
      )}
      {confirm && (
        <ConfirmDialog tone="primary" title="Mulai pembukuan?" confirmLabel="Mulai"
          description={`Tanggal mulai ${formatDate(`${goLive}T00:00:00+07:00`)} tidak bisa diubah setelah ini. Total aset awal ${formatRupiah(totals.assets)}. Transaksi sejak tanggal itu langsung dijurnal.`}
          onConfirm={submit} onClose={() => setConfirm(false)} />
      )}
      <Card className="fin-explain">
        <CardHeader title="Yang terjadi setelah dimulai" />
        <ul>
          <li><Landmark size={15} aria-hidden="true" /> Bagan akun kafe dibuat otomatis (kas, bank, persediaan, penjualan, HPP, beban, dll.) — nama akun bisa diubah.</li>
          <li><BookOpenCheck size={15} aria-hidden="true" /> Pesanan selesai, pembayaran, refund, stok, PO, kas kasir, dan beban otomatis menjadi jurnal yang seimbang.</li>
          <li><Wallet size={15} aria-hidden="true" /> Laporan laba rugi, neraca, arus kas, dan perubahan ekuitas langsung tersedia dan bisa diunduh Excel/PDF.</li>
        </ul>
      </Card>
    </div>
  )
}
