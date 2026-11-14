/*
 * Detail kafe → kartu Penagihan (file 17): kode referral, kredit & riwayatnya, grup multi-cabang, jadwal nonaktif otomatis.
 * Ubah kredit & grup lewat fungsi SQL (pa_credit_adjust, pa_cafe_set_billing_group) — tercatat di log audit.
 */
import { useCallback, useState } from 'react'
import { Coins, Save, UsersRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, Card, CardHeader, Dialog, RupiahInput, SegmentedControl, Select, SkeletonRows, TextField, useToast } from './ui/index.js'
import { rpc, useLoader } from '../lib/api.js'
import { formatDate, formatDateTime, formatNumber, formatRupiah } from '../lib/format.js'

const LEDGER_KIND = { referral: 'Referral', admin: 'Diatur admin', invoice: 'Dipakai' }

export function CafeBillingCard({ cafeId, billing, onChanged }) {
  const [dialog, setDialog] = useState(null)
  if (!billing) return null
  const reserved = Number(billing.credit_balance) - Number(billing.credit_available)
  return (
    <Card>
      <CardHeader title="Penagihan" description="Kredit, referral, grup cabang, dan nonaktif otomatis" />
      <dl className="fin-position">
        <div><dt>Kredit tersedia</dt><dd className="tabular">{formatRupiah(billing.credit_available)}{reserved > 0 ? ` (+${formatRupiah(reserved)} dipesan tagihan)` : ''}</dd></div>
        <div><dt>Kode referral</dt><dd className="tabular">{billing.referral_code || '—'}{billing.referrals_made ? ` · ${formatNumber(billing.referrals_made)} kafe diajak` : ''}</dd></div>
        {billing.referred_by && (
          <div><dt>Diajak oleh</dt><dd><Link to={`/kafe/${billing.referred_by.cafe_id}`} className="link-button">{billing.referred_by.name}</Link>{billing.referred_by.status === 'pending' ? ' · menunggu bayar pertama' : ''}</dd></div>
        )}
        <div><dt>Grup cabang</dt><dd>{billing.group ? `${billing.group.name} · ${Number(billing.branch_discount_pct) > 0 ? `cabang, diskon ${formatNumber(billing.branch_discount_pct)}%` : 'kafe utama'}` : 'Bukan grup'}</dd></div>
        <div>
          <dt>Nonaktif otomatis</dt>
          <dd>{billing.suspended_kind === 'billing' ? 'Sedang nonaktif karena tagihan' : billing.suspend_at ? formatDate(billing.suspend_at) : 'Tidak dijadwalkan'}
            {billing.billing_pause_until && billing.suspend_at === billing.billing_pause_until ? ` · ditunda sampai ${formatDateTime(billing.billing_pause_until)}` : ''}</dd>
        </div>
      </dl>
      <div className="pa-billing-actions">
        <Button size="sm" variant="secondary" icon={Coins} onClick={() => setDialog('credit')}>Atur kredit</Button>
        <Button size="sm" variant="secondary" icon={UsersRound} onClick={() => setDialog('group')}>Grup cabang</Button>
      </div>
      {billing.ledger.length > 0 && (
        <ul className="pa-ledger" aria-label="Riwayat kredit">
          {billing.ledger.slice(0, 5).map((row) => (
            <li key={row.id}>
              <span>{LEDGER_KIND[row.kind] || row.kind}<small>{row.note || '—'} · {formatDate(row.created_at)}</small></span>
              <strong className={`tabular${Number(row.amount) > 0 ? ' is-plus' : ''}`}>{Number(row.amount) > 0 ? '+' : '−'}{formatRupiah(Math.abs(Number(row.amount)))}</strong>
            </li>
          ))}
        </ul>
      )}
      {dialog === 'credit' && <CreditDialog cafeId={cafeId} available={billing.credit_available} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onChanged() }} />}
      {dialog === 'group' && <GroupDialog cafeId={cafeId} current={billing.group?.id || ''} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onChanged() }} />}
    </Card>
  )
}

function CreditDialog({ cafeId, available, onClose, onDone }) {
  const { toast } = useToast()
  const [direction, setDirection] = useState('add')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    const next = {}
    const value = Number(amount)
    if (!value || value <= 0) next.amount = 'Isi nominal'
    else if (direction === 'remove' && value > Number(available)) next.amount = `Maksimal ${formatRupiah(available)}`
    if (!note.trim()) next.note = 'Isi alasan (tercatat di log audit)'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      const result = await rpc('pa_credit_adjust', { p_cafe: cafeId, p_amount: direction === 'add' ? value : -value, p_note: note })
      toast({ title: 'Kredit diperbarui', description: `Saldo ${formatRupiah(result.balance)}. Tagihan yang menunggu dihitung ulang.` })
      onDone()
    } catch (caught) {
      setErrors({ form: caught.message })
      setBusy(false)
    }
  }

  return (
    <Dialog title="Atur kredit" description={`Kredit tersedia ${formatRupiah(available)}`} size="sm" onClose={busy ? undefined : onClose} dismissible={!busy}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="credit-form" loading={busy} icon={Save}>Simpan</Button></>}>
      <form id="credit-form" className="dialog-form" onSubmit={submit} noValidate>
        <SegmentedControl label="Jenis perubahan" value={direction} onChange={(value) => { setDirection(value); setErrors({}) }}
          options={[{ value: 'add', label: 'Tambah' }, { value: 'remove', label: 'Kurangi' }]} />
        <RupiahInput label="Nominal" value={amount} error={errors.amount} onChange={(value) => { setAmount(value); setErrors({}) }} />
        <TextField label="Alasan" value={note} maxLength={200} error={errors.note} placeholder="mis. Kompensasi gangguan 2 hari"
          onChange={(event) => { setNote(event.target.value); setErrors({}) }} />
        <p className="ui-field-hint">Kredit otomatis memotong tagihan yang menunggu dan tagihan berikutnya.</p>
        {errors.form && <p className="ui-field-error" role="alert">{errors.form}</p>}
      </form>
    </Dialog>
  )
}

function GroupDialog({ cafeId, current, onClose, onDone }) {
  const { toast } = useToast()
  const load = useCallback(() => rpc('pa_billing_groups_list'), [])
  const { data, error, loading } = useLoader(load)
  const [group, setGroup] = useState(current)
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await rpc('pa_cafe_set_billing_group', { p_cafe: cafeId, p_group: group || null })
      toast({ title: group ? 'Kafe masuk grup' : 'Kafe keluar dari grup', description: `Harga berikutnya ${formatRupiah(result.monthly_price)}/bln${result.branch_discount_pct ? ` (diskon ${result.branch_discount_pct}%)` : ''}.` })
      onDone()
    } catch (caught) {
      setFormError(caught.message)
      setBusy(false)
    }
  }

  return (
    <Dialog title="Grup multi-cabang" size="sm" onClose={busy ? undefined : onClose} dismissible={!busy}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="cafe-group-form" loading={busy} disabled={loading} icon={Save}>Simpan</Button></>}>
      <form id="cafe-group-form" className="dialog-form" onSubmit={submit} noValidate>
        {loading && !data ? <SkeletonRows rows={2} /> : error ? <p className="ui-field-error" role="alert">{error}</p> : (
          <>
            <Select label="Grup" value={group} onChange={(event) => { setGroup(event.target.value); setFormError('') }}
              options={[{ value: '', label: 'Bukan grup (harga normal)' }, ...data.groups.map((item) => ({ value: item.id, label: `${item.name} · ${formatNumber(item.cafes.length)} kafe` }))]} />
            <p className="ui-field-hint">Kafe paling lama di grup membayar harga normal; cabang berikutnya didiskon. Berlaku di tagihan berikutnya. {data.groups.length === 0 && <Link to="/keuangan?tab=cabang" className="link-button">Buat grup dulu</Link>}</p>
          </>
        )}
        {formError && <p className="ui-field-error" role="alert">{formError}</p>}
      </form>
    </Dialog>
  )
}
