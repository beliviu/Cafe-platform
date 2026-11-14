/*
 * Keuangan platform (file 17): kas masuk, piutang & umur piutang, perkiraan 30 hari, ketepatan bayar,
 * kafe nonaktif karena tagihan, kode promo, referral & kredit, grup multi-cabang, pengaturan penagihan.
 * Semua angka dihitung di SQL (pa_finance_overview, pa_promos_list, …); halaman ini hanya menampilkan.
 */
import { useCallback, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Ban, Gift, Pencil, Plus, Receipt, Save, Store, TicketPercent, Trash2, UsersRound } from 'lucide-react'
import {
  BarChart, Badge, Button, Card, CardHeader, ConfirmDialog, Dialog, EmptyState, ErrorState, IconButton, KpiCard, PageHeader, Progress,
  RupiahInput, SegmentedControl, Select, Skeleton, SkeletonRows, Switch, TextField, useToast,
} from '../components/ui/index.js'
import { optional, percentChange, rpc, STATE_META, useLoader } from '../lib/api.js'
import { formatDate, formatNumber, formatRupiah, formatRupiahCompact } from '../lib/format.js'

const TABS = [
  { value: 'ringkasan', label: 'Ringkasan' },
  { value: 'promo', label: 'Kode promo' },
  { value: 'referral', label: 'Referral' },
  { value: 'cabang', label: 'Multi-cabang' },
  { value: 'pengaturan', label: 'Pengaturan' },
]
const MONTH = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const MONTH_SHORT = new Intl.DateTimeFormat('id-ID', { month: 'short', timeZone: 'UTC' })
const toDate = (value) => new Date(`${String(value).slice(0, 10)}T00:00:00Z`)
const METHOD = { gateway: 'Midtrans (online)', manual_transfer: 'Transfer manual', credit: 'Kredit / diskon' }
const PROMO_STATE = {
  active: { label: 'Aktif', tone: 'green' },
  scheduled: { label: 'Terjadwal', tone: 'blue' },
  expired: { label: 'Berakhir', tone: 'neutral' },
  exhausted: { label: 'Kuota habis', tone: 'amber' },
  inactive: { label: 'Nonaktif', tone: 'neutral' },
}
const REFERRAL_STATE = {
  pending: { label: 'Menunggu bayar', tone: 'blue' },
  rewarded: { label: 'Kredit diberikan', tone: 'green' },
  cancelled: { label: 'Batal', tone: 'neutral' },
}

export function FinancePage() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((item) => item.value === params.get('tab')) ? params.get('tab') : 'ringkasan'
  return (
    <div className="page page-wide pa-stack">
      <PageHeader eyebrow="Pendapatan" title="Keuangan platform"
        description="Kas masuk, piutang, promo, referral, harga multi-cabang, dan aturan penagihan otomatis." />
      <SegmentedControl variant="tabs" label="Bagian keuangan" options={TABS} value={tab}
        onChange={(value) => setParams(value === 'ringkasan' ? {} : { tab: value }, { replace: true })} />
      {tab === 'ringkasan' && <SummaryTab />}
      {tab === 'promo' && <PromoTab />}
      {tab === 'referral' && <ReferralTab />}
      {tab === 'cabang' && <BranchTab />}
      {tab === 'pengaturan' && <SettingsTab />}
    </div>
  )
}

function MissingFile() {
  return <Card><EmptyState icon={Receipt} title="Belum aktif" description="Bagian ini aktif setelah file SQL 17 dijalankan di Supabase." /></Card>
}

/* ---------------- Ringkasan ---------------- */
function SummaryTab() {
  const load = useCallback(() => optional(rpc('pa_finance_overview', { p_months: 12 })), [])
  const { data, error, loading, reload } = useLoader(load)
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (data === null && !loading) return <MissingFile />
  const pending = loading && !data
  const overdue = data ? ['d1_7', 'd8_30', 'd31'].reduce((sum, key) => sum + Number(data.aging[key].amount), 0) : 0
  const overdueCount = data ? ['d1_7', 'd8_30', 'd31'].reduce((sum, key) => sum + Number(data.aging[key].count), 0) : 0
  const forecast = data ? Number(data.forecast_30.invoiced) + Number(data.forecast_30.renewals) : 0
  const onTime = data?.on_time?.paid ? (Number(data.on_time.on_time) / Number(data.on_time.paid)) * 100 : null

  return (
    <>
      <div className="ui-kpi-grid">
        <KpiCard hero label="Kas masuk bulan ini" loading={pending} value={data ? Number(data.collected_month) : undefined} format={formatRupiah}
          delta={data ? percentChange(Number(data.collected_month), Number(data.collected_prev)) : null} deltaLabel="vs bulan lalu" />
        <KpiCard label="Piutang" loading={pending} value={data ? Number(data.outstanding.amount) : undefined} format={formatRupiah}
          caption={data ? `${formatNumber(data.outstanding.count)} tagihan menunggu` : undefined} />
        <KpiCard label="Lewat jatuh tempo" loading={pending} value={data ? overdue : undefined} format={formatRupiah}
          caption={data ? `${formatNumber(overdueCount)} tagihan telat` : undefined} />
        <KpiCard label="Perkiraan 30 hari" loading={pending} value={data ? forecast : undefined} format={formatRupiah}
          caption={data ? `Tagihan menunggu + ${formatNumber(data.forecast_30.renewal_count)} perpanjangan` : undefined} />
      </div>

      <Card>
        <CardHeader title="Kas masuk per bulan" description="Tagihan lunas menurut tanggal bayar (setelah diskon & kredit)" />
        {pending ? <Skeleton height={228} radius={12} /> : data.months.every((month) => Number(month.collected) === 0) ? (
          <EmptyState icon={Receipt} title="Belum ada pembayaran" description="Grafik terisi begitu ada tagihan yang lunas." />
        ) : (
          <BarChart ariaLabel="Kas masuk per bulan" valueLabel="Kas masuk" formatValue={formatRupiah} formatTick={formatRupiahCompact}
            data={data.months.map((month) => ({
              key: month.month, label: MONTH_SHORT.format(toDate(month.month)), tooltipLabel: MONTH.format(toDate(month.month)), value: Number(month.collected),
            }))} />
        )}
        {data && <MonthFoot month={data.months.at(-1)} />}
      </Card>

      <div className="fin-grid-2">
        <Card>
          <CardHeader title="Umur piutang" description="Tagihan menunggu menurut lama telat" />
          {pending ? <SkeletonRows rows={4} /> : <Aging aging={data.aging} />}
        </Card>
        <Card>
          <CardHeader title="Ketepatan bayar" description="Tagihan lunas 90 hari terakhir yang dibayar sebelum jatuh tempo" />
          {pending ? <SkeletonRows rows={3} /> : onTime === null ? (
            <EmptyState compact icon={Receipt} title="Belum ada data" description="Muncul setelah ada tagihan lunas." />
          ) : (
            <div className="fin-ontime">
              <strong className="fin-big tabular">{formatNumber(Math.round(onTime))}%</strong>
              <Progress value={onTime} tone={onTime >= 80 ? 'good' : onTime >= 50 ? 'warn' : 'bad'} label="Persen dibayar tepat waktu" />
              <small>{formatNumber(data.on_time.on_time)} dari {formatNumber(data.on_time.paid)} tagihan tepat waktu</small>
            </div>
          )}
          {data?.methods?.length > 0 && (
            <dl className="fin-list">
              {data.methods.map((row) => (
                <div key={row.method}><dt>{METHOD[row.method] || row.method}<small>{formatNumber(row.count)} tagihan</small></dt><dd className="tabular">{formatRupiah(row.amount)}</dd></div>
              ))}
            </dl>
          )}
        </Card>
      </div>

      <div className="fin-grid-2">
        <Card>
          <CardHeader title="Nonaktif karena tagihan" description="Aktif lagi otomatis begitu tagihan lunas" />
          {pending ? <SkeletonRows rows={2} /> : (
            <CafeRows empty="Tidak ada kafe yang nonaktif karena tagihan"
              rows={[
                ...data.suspended.map((row) => ({ id: row.cafe_id, name: row.name, tone: 'red', badge: 'Nonaktif', detail: `Sejak ${formatDate(row.since)} · menunggu ${formatRupiah(row.pending_amount)}` })),
                ...data.at_risk.map((row) => ({ id: row.cafe_id, name: row.name, tone: 'amber', badge: 'Akan nonaktif', detail: `Otomatis ${formatDate(row.suspend_at)}` })),
              ]} />
          )}
          {data && !data.settings.billing_suspend_enabled && (
            <p className="ui-field-hint">Nonaktif otomatis sedang dimatikan. Nyalakan di tab Pengaturan.</p>
          )}
        </Card>
        <Card>
          <CardHeader title="Promo & kredit" description="Diskon yang diberikan dan saldo kredit kafe" />
          {pending ? <SkeletonRows rows={3} /> : (
            <dl className="fin-list">
              <div><dt>Kredit beredar<small>Saldo semua kafe, memotong tagihan berikutnya</small></dt><dd className="tabular">{formatRupiah(data.credit_outstanding)}</dd></div>
              {data.promos.length === 0 ? (
                <div><dt>Kode promo<small>Belum ada promo yang terpakai</small></dt><dd>—</dd></div>
              ) : data.promos.map((row) => (
                <div key={row.code}><dt><span className="tabular">{row.code}</span><small>{formatNumber(row.count)} kali dipakai</small></dt><dd className="tabular">−{formatRupiah(row.discount)}</dd></div>
              ))}
            </dl>
          )}
        </Card>
      </div>
    </>
  )
}

function MonthFoot({ month }) {
  if (!month) return null
  return (
    <dl className="an-movement fin-month-foot" aria-label={`Ringkasan ${MONTH.format(toDate(month.month))}`}>
      <div><dt>Tagihan lunas</dt><dd className="tabular">{formatNumber(month.invoices)}</dd></div>
      <div><dt>Kas masuk</dt><dd className="tabular">{formatRupiah(month.collected)}</dd></div>
      <div><dt>Diskon diberikan</dt><dd className="tabular">{formatRupiah(month.discounts)}</dd></div>
      <div><dt>Kredit dipakai</dt><dd className="tabular">{formatRupiah(month.credits)}</dd></div>
    </dl>
  )
}

function Aging({ aging }) {
  const rows = [
    { key: 'not_due', label: 'Belum jatuh tempo', tone: 'good' },
    { key: 'd1_7', label: 'Telat 1–7 hari', tone: 'warn' },
    { key: 'd8_30', label: 'Telat 8–30 hari', tone: 'warn' },
    { key: 'd31', label: 'Telat lebih dari 30 hari', tone: 'bad' },
  ]
  const max = Math.max(1, ...rows.map((row) => Number(aging[row.key].amount)))
  return (
    <ul className="fin-aging">
      {rows.map((row) => (
        <li key={row.key}>
          <span className="fin-aging-label"><span>{row.label}</span><small>{formatNumber(aging[row.key].count)} tagihan</small></span>
          <Progress value={(Number(aging[row.key].amount) / max) * 100} tone={row.tone} label={row.label} />
          <strong className="tabular">{formatRupiah(aging[row.key].amount)}</strong>
        </li>
      ))}
    </ul>
  )
}

function CafeRows({ rows, empty }) {
  if (!rows.length) return <EmptyState compact icon={Store} title="Aman" description={empty} />
  return (
    <ul className="fin-cafes">
      {rows.map((row) => (
        <li key={`${row.id}-${row.badge}`}>
          <span className="pa-cell-main"><Link to={`/kafe/${row.id}`} className="link-button">{row.name}</Link><small>{row.detail}</small></span>
          <Badge tone={row.tone}>{row.badge}</Badge>
        </li>
      ))}
    </ul>
  )
}

/* ---------------- Kode promo ---------------- */
function PromoTab() {
  const load = useCallback(() => Promise.all([optional(rpc('pa_promos_list')), optional(rpc('pa_plans_list'))]), [])
  const { data, error, loading, reload } = useLoader(load)
  const [editing, setEditing] = useState(null)
  if (error) return <ErrorState message={error} onRetry={reload} />
  const [promos, plans] = data || []
  if (data && promos === null) return <MissingFile />

  return (
    <Card padding="none">
      <div className="ov-card-head">
        <CardHeader title="Kode promo" description="Owner memasukkan kode di halaman Langganan sebelum membayar"
          actions={<Button size="sm" icon={Plus} onClick={() => setEditing({})} disabled={!data}>Promo baru</Button>} />
      </div>
      <div className="ov-card-body">
        {loading && !data ? <SkeletonRows rows={4} /> : promos.length === 0 ? (
          <EmptyState compact icon={TicketPercent} title="Belum ada kode promo" description="Buat kode untuk diskon persen atau nominal, dengan batas pakai dan masa berlaku."
            action={<Button size="sm" icon={Plus} onClick={() => setEditing({})}>Promo baru</Button>} />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Kode</th><th scope="col">Diskon</th><th scope="col">Berlaku</th>
                  <th scope="col" className="num">Terpakai</th><th scope="col" className="num">Total diskon</th><th scope="col">Status</th>
                  <th scope="col" className="cell-actions"><span className="sr-only">Aksi</span></th>
                </tr>
              </thead>
              <tbody>
                {promos.map((promo) => {
                  const state = PROMO_STATE[promo.state] || PROMO_STATE.active
                  return (
                    <tr key={promo.id}>
                      <td><span className="pa-cell-main"><strong className="tabular">{promo.code}</strong><small>{promo.description || promoRules(promo, plans)}</small></span></td>
                      <td className="tabular">{promo.kind === 'percent' ? `${formatNumber(promo.value)}%` : formatRupiah(promo.value)}</td>
                      <td>{promo.valid_from || promo.valid_until ? `${promo.valid_from ? formatDate(promo.valid_from) : 'Sekarang'} – ${promo.valid_until ? formatDate(promo.valid_until) : 'seterusnya'}` : 'Tanpa batas waktu'}</td>
                      <td className="num tabular">{formatNumber(promo.used)}{promo.max_redemptions ? ` / ${formatNumber(promo.max_redemptions)}` : ''}{promo.reserved ? <small className="cell-sub">+{formatNumber(promo.reserved)} menunggu bayar</small> : null}</td>
                      <td className="num tabular">{formatRupiah(promo.discount_total)}</td>
                      <td><Badge tone={state.tone}>{state.label}</Badge></td>
                      <td className="cell-actions"><IconButton icon={Pencil} label={`Ubah ${promo.code}`} size="sm" onClick={() => setEditing(promo)} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <PromoDialog promo={editing} plans={plans || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </Card>
  )
}

function promoRules(promo, plans) {
  const parts = []
  if (promo.plan_codes?.length) parts.push(`Paket ${promo.plan_codes.map((code) => plans?.find((plan) => plan.code === code)?.name || code).join(', ')}`)
  if (promo.min_months > 1) parts.push(`min. ${promo.min_months} bulan`)
  if (promo.first_payment_only) parts.push('pembayaran pertama')
  return parts.join(' · ') || 'Semua paket'
}

const toDateInput = (value) => (value ? new Date(new Date(value).getTime() + 7 * 3600000).toISOString().slice(0, 10) : '')

function PromoDialog({ promo, plans, onClose, onSaved }) {
  const { toast } = useToast()
  const isNew = !promo.id
  const [form, setForm] = useState(() => ({
    code: promo.code || '', description: promo.description || '', kind: promo.kind || 'percent', value: promo.value ? Number(promo.value) : '',
    plan: promo.plan_codes?.length === 1 ? promo.plan_codes[0] : '', minMonths: String(promo.min_months || 1),
    firstOnly: Boolean(promo.first_payment_only), maxRedemptions: promo.max_redemptions ? String(promo.max_redemptions) : '',
    perCafe: String(promo.per_cafe_limit || 1), validFrom: toDateInput(promo.valid_from), validUntil: toDateInput(promo.valid_until),
    active: promo.is_active ?? true,
  }))
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (key) => (value) => { setForm((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: '', form: '' })) }

  async function submit(event) {
    event.preventDefault()
    const next = {}
    if (!/^[A-Z0-9_-]{3,24}$/.test(form.code)) next.code = '3–24 karakter: huruf, angka, - atau _'
    const value = Number(form.value)
    if (!value || value <= 0) next.value = 'Isi nilai diskon'
    else if (form.kind === 'percent' && value > 100) next.value = 'Persen 1–100'
    if (form.maxRedemptions && !(Number(form.maxRedemptions) > 0)) next.maxRedemptions = 'Kosongkan atau isi angka lebih dari 0'
    if (form.validFrom && form.validUntil && form.validUntil <= form.validFrom) next.validUntil = 'Harus setelah tanggal mulai'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      await rpc('pa_promo_upsert', {
        p_id: promo.id || null, p_code: form.code, p_description: form.description || null, p_kind: form.kind, p_value: value,
        p_plan_codes: form.plan ? [form.plan] : null, p_min_months: Number(form.minMonths), p_first_payment_only: form.firstOnly,
        p_max_redemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null, p_per_cafe_limit: Number(form.perCafe) || 1,
        p_valid_from: form.validFrom ? `${form.validFrom}T00:00:00+07:00` : null,
        p_valid_until: form.validUntil ? `${form.validUntil}T23:59:59+07:00` : null, p_is_active: form.active,
      })
      toast({ title: isNew ? 'Kode promo dibuat' : 'Kode promo disimpan', description: form.code })
      onSaved()
    } catch (caught) {
      setErrors({ form: caught.message })
      setBusy(false)
    }
  }

  return (
    <Dialog title={isNew ? 'Kode promo baru' : `Ubah ${promo.code}`} size="md" onClose={busy ? undefined : onClose} dismissible={!busy}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="promo-form" loading={busy} icon={Save}>Simpan</Button></>}>
      <form id="promo-form" className="dialog-form fin-form" onSubmit={submit} noValidate>
        <TextField label="Kode" value={form.code} maxLength={24} autoComplete="off" spellCheck={false} error={errors.code}
          hint={!isNew && promo.used + promo.reserved > 0 ? 'Kode yang sudah dipakai tidak bisa diganti' : 'Huruf besar, mis. HEMAT20'}
          onChange={(event) => set('code')(event.target.value.toUpperCase().replace(/\s/g, ''))} />
        <TextField label="Keterangan (opsional)" value={form.description} maxLength={200} onChange={(event) => set('description')(event.target.value)} />
        <div className="fin-form-row">
          <Select label="Jenis diskon" value={form.kind} onChange={(event) => set('kind')(event.target.value)}
            options={[{ value: 'percent', label: 'Persen' }, { value: 'amount', label: 'Nominal (Rp)' }]} />
          {form.kind === 'percent' ? (
            <TextField label="Diskon" type="number" inputMode="numeric" min={1} max={100} suffix="%" value={form.value} error={errors.value}
              onChange={(event) => set('value')(event.target.value)} />
          ) : (
            <RupiahInput label="Diskon" value={form.value} error={errors.value} onChange={set('value')} />
          )}
        </div>
        <div className="fin-form-row">
          <Select label="Paket" value={form.plan} onChange={(event) => set('plan')(event.target.value)}
            options={[{ value: '', label: 'Semua paket' }, ...plans.filter((plan) => !plan.is_archived).map((plan) => ({ value: plan.code, label: plan.name }))]} />
          <Select label="Minimal lama langganan" value={form.minMonths} onChange={(event) => set('minMonths')(event.target.value)}
            options={[1, 3, 6, 12].map((value) => ({ value: String(value), label: `${value} bulan` }))} />
        </div>
        <div className="fin-form-row">
          <TextField label="Kuota total (opsional)" type="number" inputMode="numeric" min={1} value={form.maxRedemptions} error={errors.maxRedemptions}
            hint="Kosong = tanpa batas" onChange={(event) => set('maxRedemptions')(event.target.value)} />
          <TextField label="Maks. per kafe" type="number" inputMode="numeric" min={1} max={24} value={form.perCafe} onChange={(event) => set('perCafe')(event.target.value)} />
        </div>
        <div className="fin-form-row">
          <TextField label="Mulai (opsional)" type="date" value={form.validFrom} onChange={(event) => set('validFrom')(event.target.value)} />
          <TextField label="Berakhir (opsional)" type="date" value={form.validUntil} error={errors.validUntil} onChange={(event) => set('validUntil')(event.target.value)} />
        </div>
        <div className="fin-switch-row"><span>Khusus pembayaran pertama kafe</span><Switch checked={form.firstOnly} onChange={set('firstOnly')} label="Khusus pembayaran pertama" /></div>
        <div className="fin-switch-row"><span>Aktif</span><Switch checked={form.active} onChange={set('active')} label="Kode promo aktif" /></div>
        {errors.form && <p className="ui-field-error" role="alert">{errors.form}</p>}
      </form>
    </Dialog>
  )
}

/* ---------------- Referral ---------------- */
function ReferralTab() {
  const load = useCallback(() => optional(rpc('pa_referrals_list', { p_limit: 100 })), [])
  const { data, error, loading, reload } = useLoader(load)
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (data === null && !loading) return <MissingFile />
  const pending = loading && !data
  return (
    <>
      <div className="ui-kpi-grid">
        <KpiCard label="Kafe diajak" loading={pending} value={data ? Number(data.summary.total) : undefined} format={formatNumber}
          caption={data ? `${formatNumber(data.summary.pending)} menunggu pembayaran pertama` : undefined} />
        <KpiCard label="Kredit referral diberikan" loading={pending} value={data ? Number(data.summary.reward_total) : undefined} format={formatRupiah}
          caption={data ? `${formatNumber(data.summary.rewarded)} referral berhasil` : undefined} />
        <KpiCard label="Diskon referral" loading={pending} value={data ? Number(data.summary.discount_total) : undefined} format={formatRupiah}
          caption="Potongan di tagihan pertama kafe baru" />
        <KpiCard label="Kredit beredar" loading={pending} value={data ? Number(data.credit_outstanding) : undefined} format={formatRupiah}
          caption="Saldo kredit semua kafe" />
      </div>
      <Card padding="none">
        <div className="ov-card-head"><CardHeader title="Riwayat referral" description="Atur hadiah & diskon di tab Pengaturan. Ubah kredit satu kafe dari halaman detail kafe." /></div>
        <div className="ov-card-body">
          {pending ? <SkeletonRows rows={4} /> : data.rows.length === 0 ? (
            <EmptyState compact icon={Gift} title="Belum ada referral" description="Setiap kafe punya kode referral di halaman Langganan. Kafe baru memakainya dalam 30 hari pertama." />
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th scope="col">Pengundang</th><th scope="col">Kafe baru</th><th scope="col">Kode</th><th scope="col">Tanggal</th><th scope="col" className="num">Hadiah</th><th scope="col">Status</th></tr></thead>
                <tbody>
                  {data.rows.map((row) => {
                    const state = REFERRAL_STATE[row.status] || REFERRAL_STATE.pending
                    return (
                      <tr key={row.id}>
                        <td><Link to={`/kafe/${row.referrer_cafe_id}`} className="link-button">{row.referrer_name}</Link></td>
                        <td><Link to={`/kafe/${row.referred_cafe_id}`} className="link-button">{row.referred_name}</Link></td>
                        <td className="tabular">{row.code}</td>
                        <td>{formatDate(row.created_at)}{row.rewarded_at ? <small className="cell-sub">kredit {formatDate(row.rewarded_at)}</small> : null}</td>
                        <td className="num tabular">{formatRupiah(row.reward_amount)}<small className="cell-sub">diskon {formatNumber(row.discount_pct)}%</small></td>
                        <td><Badge tone={state.tone}>{state.label}</Badge></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </>
  )
}

/* ---------------- Multi-cabang ---------------- */
function BranchTab() {
  const { toast } = useToast()
  const load = useCallback(() => optional(rpc('pa_billing_groups_list')), [])
  const { data, error, loading, reload } = useLoader(load)
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [deleting, setDeleting] = useState(null)
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (data === null && !loading) return <MissingFile />

  return (
    <>
      <Card>
        <CardHeader title="Grup multi-cabang"
          description={`Kafe pertama dalam grup membayar harga normal; cabang berikutnya mendapat diskon (bawaan ${data ? formatNumber(data.default_pct) : '…'}%). Harga baru berlaku di tagihan berikutnya.`}
          actions={<Button size="sm" icon={Plus} onClick={() => setEditing({})} disabled={!data}>Grup baru</Button>} />
        <p className="ui-field-hint">Masukkan kafe ke grup dari halaman detail kafe → kartu Penagihan.</p>
      </Card>
      {loading && !data ? <SkeletonRows rows={3} /> : data.groups.length === 0 ? (
        <Card><EmptyState icon={UsersRound} title="Belum ada grup" description="Buat grup untuk owner yang punya beberapa cabang." /></Card>
      ) : (
        <div className="fin-groups">
          {data.groups.map((group) => (
            <Card key={group.id}>
              <CardHeader title={group.name}
                description={`Diskon cabang ${formatNumber(group.branch_discount_pct ?? data.default_pct)}%${group.branch_discount_pct == null ? ' (bawaan)' : ''}${group.note ? ` · ${group.note}` : ''}`}
                actions={<span className="pa-actions">
                  <IconButton icon={Pencil} label={`Ubah ${group.name}`} size="sm" onClick={() => setEditing(group)} />
                  <IconButton icon={Trash2} label={`Hapus ${group.name}`} size="sm" onClick={() => setDeleting(group)} />
                </span>} />
              {group.cafes.length === 0 ? <p className="ui-field-hint">Belum ada kafe di grup ini.</p> : (
                <ul className="fin-cafes">
                  {group.cafes.map((cafe, index) => (
                    <li key={cafe.id}>
                      <span className="pa-cell-main">
                        <Link to={`/kafe/${cafe.id}`} className="link-button">{cafe.name}</Link>
                        <small>{index === 0 ? 'Kafe utama · harga normal' : `Cabang · diskon ${formatNumber(cafe.discount_pct)}%`} · {cafe.plan_name || '—'} {formatRupiah(cafe.monthly_price)}/bln</small>
                      </span>
                      <Badge tone={(STATE_META[cafe.state] || STATE_META.active).tone}>{(STATE_META[cafe.state] || STATE_META.active).label}</Badge>
                      <IconButton icon={Ban} label={`Keluarkan ${cafe.name} dari grup`} size="sm" onClick={() => setRemoving(cafe)} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
      {editing && <GroupDialog group={editing} defaultPct={data?.default_pct} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {removing && (
        <ConfirmDialog title={`Keluarkan ${removing.name}?`} description="Tagihan berikutnya kafe ini memakai harga normal paket." confirmLabel="Keluarkan"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await rpc('pa_cafe_set_billing_group', { p_cafe: removing.id, p_group: null })
            toast({ title: 'Kafe dikeluarkan dari grup' })
            setRemoving(null)
            reload()
          }} />
      )}
      {deleting && (
        <ConfirmDialog title={`Hapus grup ${deleting.name}?`} description={`${formatNumber(deleting.cafes.length)} kafe dikeluarkan dan kembali ke harga normal di tagihan berikutnya.`}
          confirmLabel="Hapus grup" onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await rpc('pa_billing_group_delete', { p_id: deleting.id })
            toast({ title: 'Grup dihapus' })
            setDeleting(null)
            reload()
          }} />
      )}
    </>
  )
}

function GroupDialog({ group, defaultPct, onClose, onSaved }) {
  const { toast } = useToast()
  const [name, setName] = useState(group.name || '')
  const [pct, setPct] = useState(group.branch_discount_pct == null ? '' : String(group.branch_discount_pct))
  const [note, setNote] = useState(group.note || '')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    const next = {}
    if (name.trim().length < 2) next.name = 'Minimal 2 karakter'
    if (pct !== '' && !(Number(pct) >= 0 && Number(pct) <= 90)) next.pct = 'Diskon 0–90%'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      await rpc('pa_billing_group_upsert', { p_id: group.id || null, p_name: name, p_branch_discount_pct: pct === '' ? null : Number(pct), p_note: note || null })
      toast({ title: group.id ? 'Grup disimpan' : 'Grup dibuat', description: name })
      onSaved()
    } catch (caught) {
      setErrors({ form: caught.message })
      setBusy(false)
    }
  }

  return (
    <Dialog title={group.id ? `Ubah ${group.name}` : 'Grup multi-cabang baru'} size="sm" onClose={busy ? undefined : onClose} dismissible={!busy}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="group-form" loading={busy} icon={Save}>Simpan</Button></>}>
      <form id="group-form" className="dialog-form" onSubmit={submit} noValidate>
        <TextField label="Nama grup" value={name} maxLength={80} error={errors.name} placeholder="mis. Kopi Senja Group" onChange={(event) => { setName(event.target.value); setErrors({}) }} />
        <TextField label="Diskon cabang" type="number" inputMode="numeric" min={0} max={90} suffix="%" value={pct} error={errors.pct}
          hint={`Kosong = bawaan ${formatNumber(defaultPct ?? 15)}%`} onChange={(event) => { setPct(event.target.value); setErrors({}) }} />
        <TextField label="Catatan (opsional)" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
        {errors.form && <p className="ui-field-error" role="alert">{errors.form}</p>}
      </form>
    </Dialog>
  )
}

/* ---------------- Pengaturan penagihan ---------------- */
function SettingsTab() {
  const load = useCallback(() => optional(rpc('pa_finance_overview', { p_months: 3 })).then((data) => data?.settings ?? null), [])
  const { data, error, loading, reload } = useLoader(load)
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (data === null && !loading) return <MissingFile />
  if (!data) return <Card><SkeletonRows rows={6} /></Card>
  return <SettingsForm key={JSON.stringify(data)} settings={data} onSaved={reload} />
}

function SettingsForm({ settings, onSaved }) {
  const { toast } = useToast()
  const [form, setForm] = useState(() => ({
    billing_suspend_enabled: Boolean(settings.billing_suspend_enabled),
    billing_suspend_after_days: String(settings.billing_suspend_after_days),
    referral_credit: Number(settings.referral_credit),
    referral_discount_pct: String(settings.referral_discount_pct),
    branch_discount_pct: String(settings.branch_discount_pct),
    billing_company_name: settings.billing_company_name || '',
    billing_company_address: settings.billing_company_address || '',
    billing_company_email: settings.billing_company_email || '',
    billing_tax_id: settings.billing_tax_id || '',
  }))
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (key) => (value) => { setForm((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: '', form: '' })) }
  const between = (value, min, max) => value !== '' && Number(value) >= min && Number(value) <= max

  async function submit(event) {
    event.preventDefault()
    const next = {}
    if (!between(form.billing_suspend_after_days, 7, 60)) next.billing_suspend_after_days = '7–60 hari'
    if (!between(form.referral_discount_pct, 0, 90)) next.referral_discount_pct = '0–90%'
    if (!between(form.branch_discount_pct, 0, 90)) next.branch_discount_pct = '0–90%'
    if (!(Number(form.referral_credit) >= 0 && Number(form.referral_credit) <= 10000000)) next.referral_credit = 'Rp 0 – 10 juta'
    if (!form.billing_company_name.trim()) next.billing_company_name = 'Isi nama penerbit kuitansi'
    if (form.billing_company_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.billing_company_email)) next.billing_company_email = 'Format email tidak valid'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      await rpc('pa_billing_settings_update', {
        p_patch: {
          ...form,
          billing_suspend_after_days: Number(form.billing_suspend_after_days),
          referral_credit: Number(form.referral_credit) || 0,
          referral_discount_pct: Number(form.referral_discount_pct),
          branch_discount_pct: Number(form.branch_discount_pct),
        },
      })
      toast({ title: 'Pengaturan penagihan disimpan' })
      onSaved()
    } catch (caught) {
      setErrors({ form: caught.message })
    } finally {
      setBusy(false)
    }
  }

  const graceEnd = Math.min(7, Number(form.billing_suspend_after_days) || 7)
  return (
    <form className="fin-settings" onSubmit={submit} noValidate>
      <Card>
        <CardHeader title="Nonaktif otomatis" description="Pengingat terkirim H-7, H-1, saat telat, telat 3 hari, dan 2 hari sebelum nonaktif" />
        <div className="fin-switch-row">
          <span>
            <strong>Nonaktifkan kafe yang belum membayar</strong>
            <small>Fitur paket tetap jalan {graceEnd} hari setelah masa berlaku habis. Lewat batas di bawah, kafe dinonaktifkan otomatis dan aktif lagi begitu tagihan lunas.</small>
          </span>
          <Switch checked={form.billing_suspend_enabled} onChange={set('billing_suspend_enabled')} label="Nonaktif otomatis" onLabel="Nyala" offLabel="Mati" />
        </div>
        <TextField label="Nonaktif setelah" type="number" inputMode="numeric" min={7} max={60} suffix="hari" value={form.billing_suspend_after_days}
          error={errors.billing_suspend_after_days} hint="Dihitung dari tanggal masa berlaku habis (7–60 hari)" disabled={!form.billing_suspend_enabled}
          onChange={(event) => set('billing_suspend_after_days')(event.target.value)} />
        <p className="ui-field-hint">Pengaman: hanya langganan yang masa berlakunya habis setelah {formatDate(settings.billing_enforce_from)} yang bisa dinonaktifkan otomatis. Menyalakan ulang fitur ini tidak menonaktifkan tunggakan lama sekaligus.</p>
      </Card>
      <Card>
        <CardHeader title="Referral & multi-cabang" description="Berlaku untuk klaim referral dan tagihan berikutnya" />
        <div className="fin-form-row">
          <RupiahInput label="Kredit untuk pengundang" value={form.referral_credit} error={errors.referral_credit} onChange={set('referral_credit')}
            hint="Diberikan setelah kafe baru membayar pertama kali" />
          <TextField label="Diskon kafe baru" type="number" inputMode="numeric" min={0} max={90} suffix="%" value={form.referral_discount_pct}
            error={errors.referral_discount_pct} hint="Di tagihan pertama" onChange={(event) => set('referral_discount_pct')(event.target.value)} />
        </div>
        <TextField label="Diskon cabang bawaan" type="number" inputMode="numeric" min={0} max={90} suffix="%" value={form.branch_discount_pct}
          error={errors.branch_discount_pct} hint="Untuk cabang ke-2 dst. di grup yang tidak punya diskon sendiri" onChange={(event) => set('branch_discount_pct')(event.target.value)} />
      </Card>
      <Card>
        <CardHeader title="Penerbit kuitansi" description="Tercetak di kepala kuitansi PDF" />
        <TextField label="Nama" value={form.billing_company_name} maxLength={80} error={errors.billing_company_name} onChange={(event) => set('billing_company_name')(event.target.value)} />
        <TextField label="Alamat (opsional)" value={form.billing_company_address} maxLength={300} onChange={(event) => set('billing_company_address')(event.target.value)} />
        <div className="fin-form-row">
          <TextField label="Email (opsional)" type="email" value={form.billing_company_email} maxLength={120} error={errors.billing_company_email} onChange={(event) => set('billing_company_email')(event.target.value)} />
          <TextField label="NPWP (opsional)" value={form.billing_tax_id} maxLength={40} onChange={(event) => set('billing_tax_id')(event.target.value)} />
        </div>
      </Card>
      {errors.form && <p className="ui-field-error" role="alert">{errors.form}</p>}
      <div><Button type="submit" icon={Save} loading={busy}>Simpan pengaturan</Button></div>
    </form>
  )
}
