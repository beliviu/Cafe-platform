/*
 * Dialog aksi langganan di detail kafe. Semua memanggil fungsi SQL pa_* (tercatat di log audit).
 */
import { useState } from 'react'
import { Button, Dialog, RupiahInput, Select, TextField, useToast } from './ui/index.js'
import { platformAction, rpc } from '../lib/api.js'
import { formatDate, formatRupiah } from '../lib/format.js'

function ActionDialog({ title, description, submitLabel, onClose, onSubmit, children }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSubmit()
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
  }
  return (
    <Dialog title={title} description={description} size="sm" onClose={busy ? undefined : onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="pa-action" loading={busy}>{submitLabel}</Button></>}>
      <form id="pa-action" className="dialog-form" onSubmit={submit}>
        {children}
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}

const planOptions = (plans, current) => plans
  .filter((plan) => !plan.is_archived || plan.code === current)
  .map((plan) => ({ value: plan.code, label: `${plan.name}${plan.price_monthly ? ` · ${formatRupiah(plan.price_monthly)}/bln` : ''}` }))

export function ChangePlanDialog({ cafe, subscription, plans, onClose, onDone }) {
  const { toast } = useToast()
  const [plan, setPlan] = useState(subscription?.plan_code || 'basic')
  const [price, setPrice] = useState(subscription?.price_override ?? '')
  const [note, setNote] = useState('')
  return (
    <ActionDialog title="Ganti paket" description={cafe.name} submitLabel="Simpan paket" onClose={onClose}
      onSubmit={async () => {
        await rpc('pa_subscription_set_plan', {
          p_cafe: cafe.id, p_plan: plan, p_price_override: price === '' ? null : price, p_clear_override: price === '', p_note: note || null,
        })
        toast({ title: 'Paket diganti' })
        onDone()
      }}>
      <Select label="Paket" value={plan} onChange={(event) => setPlan(event.target.value)} options={planOptions(plans, subscription?.plan_code)} />
      <RupiahInput label="Harga khusus / bulan (opsional)" value={price} onChange={setPrice} hint="Kosongkan untuk memakai harga paket." />
      <TextField label="Catatan (opsional)" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
      <p className="ui-field-hint">Status & masa berlaku tidak berubah. Untuk menagih, buat tagihan.</p>
    </ActionDialog>
  )
}

export function ExtendDialog({ cafe, subscription, onClose, onDone }) {
  const { toast } = useToast()
  const [months, setMonths] = useState('1')
  const [note, setNote] = useState('')
  return (
    <ActionDialog title="Perpanjang langganan" description={`${cafe.name}${subscription?.current_period_end ? ` · berlaku s/d ${formatDate(subscription.current_period_end)}` : ''}`}
      submitLabel="Perpanjang" onClose={onClose}
      onSubmit={async () => {
        const result = await rpc('pa_subscription_extend', { p_cafe: cafe.id, p_months: Number(months), p_note: note || null })
        toast({ title: 'Langganan diperpanjang', description: `Aktif sampai ${formatDate(result.current_period_end)}.` })
        onDone()
      }}>
      <Select label="Lama" value={months} onChange={(event) => setMonths(event.target.value)}
        options={[1, 3, 6, 12].map((value) => ({ value: String(value), label: `${value} bulan` }))} />
      <TextField label="Catatan" placeholder="mis. bonus, kompensasi gangguan" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
      <p className="ui-field-hint">Tanpa tagihan. Untuk pembayaran, pakai Buat tagihan lalu Tandai lunas.</p>
    </ActionDialog>
  )
}

export function TrialDialog({ cafe, subscription, plans, onClose, onDone }) {
  const { toast } = useToast()
  const [days, setDays] = useState('14')
  const [plan, setPlan] = useState(subscription?.plan_code || 'pro')
  const [note, setNote] = useState('')
  return (
    <ActionDialog title="Beri masa coba" description={cafe.name} submitLabel="Beri masa coba" onClose={onClose}
      onSubmit={async () => {
        const result = await rpc('pa_subscription_trial', { p_cafe: cafe.id, p_days: Number(days), p_plan: plan, p_note: note || null })
        toast({ title: 'Masa coba diberikan', description: `Sampai ${formatDate(result.trial_ends_at)}.` })
        onDone()
      }}>
      <div className="dialog-row">
        <TextField label="Lama (hari)" type="number" min={1} max={90} value={days} onChange={(event) => setDays(event.target.value)} />
        <Select label="Paket" value={plan} onChange={(event) => setPlan(event.target.value)} options={planOptions(plans, subscription?.plan_code)} />
      </div>
      <TextField label="Catatan (opsional)" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
    </ActionDialog>
  )
}

export function InvoiceDialog({ cafe, subscription, plans, onClose, onDone }) {
  const { toast } = useToast()
  const [plan, setPlan] = useState(subscription?.plan_code || 'basic')
  const [months, setMonths] = useState('1')
  const [amount, setAmount] = useState('')
  const [dueDays, setDueDays] = useState('7')
  const [note, setNote] = useState('')
  const selected = plans.find((item) => item.code === plan)
  const unit = plan === subscription?.plan_code && subscription?.price_override != null ? Number(subscription.price_override) : Number(selected?.price_monthly || 0)
  return (
    <ActionDialog title="Buat tagihan" description={cafe.name} submitLabel="Buat tagihan" onClose={onClose}
      onSubmit={async () => {
        const invoice = await rpc('pa_invoice_create', {
          p_cafe: cafe.id, p_plan: plan, p_months: Number(months), p_amount: amount === '' ? null : amount, p_due_days: Number(dueDays), p_note: note || null,
        })
        toast({ title: `Tagihan ${invoice.number} dibuat`, description: `${formatRupiah(invoice.amount)} · owner bisa membayar dari Pengaturan → Langganan.` })
        onDone()
      }}>
      <div className="dialog-row">
        <Select label="Paket" value={plan} onChange={(event) => setPlan(event.target.value)} options={planOptions(plans, subscription?.plan_code)} />
        <Select label="Lama" value={months} onChange={(event) => setMonths(event.target.value)}
          options={[1, 3, 6, 12].map((value) => ({ value: String(value), label: `${value} bulan` }))} />
      </div>
      <div className="dialog-row">
        <RupiahInput label="Nominal" value={amount} onChange={setAmount} placeholder={unit ? new Intl.NumberFormat('id-ID').format(unit * Number(months)) : ''}
          hint="Kosong = harga paket × lama" />
        <TextField label="Jatuh tempo (hari)" type="number" min={0} max={60} value={dueDays} onChange={(event) => setDueDays(event.target.value)} />
      </div>
      <TextField label="Catatan (opsional)" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
    </ActionDialog>
  )
}

export function SuspendDialog({ cafe, onClose, onDone }) {
  const { toast } = useToast()
  const suspending = !cafe.suspended_at
  const [reason, setReason] = useState('')
  return (
    <ActionDialog title={suspending ? 'Nonaktifkan kafe' : 'Aktifkan kembali'} submitLabel={suspending ? 'Nonaktifkan' : 'Aktifkan'} onClose={onClose}
      description={suspending
        ? `${cafe.name} tidak bisa menerima pesanan baru dan fiturnya turun ke paket dasar. Data tidak dihapus; owner & staff melihat pemberitahuan.`
        : `${cafe.name} bisa menerima pesanan lagi dan paketnya kembali berlaku.`}
      onSubmit={async () => {
        await rpc('pa_cafe_set_suspended', { p_cafe: cafe.id, p_suspend: suspending, p_reason: suspending ? reason : null })
        toast({ title: suspending ? 'Kafe dinonaktifkan' : 'Kafe aktif kembali' })
        onDone()
      }}>
      {suspending && (
        <TextField label="Alasan (dilihat owner)" required multiline rows={3} maxLength={300} value={reason}
          placeholder="mis. Tagihan November belum dibayar." onChange={(event) => setReason(event.target.value)} />
      )}
    </ActionDialog>
  )
}

export function ResetPasswordDialog({ cafe, member, onClose, onDone }) {
  const { toast } = useToast()
  const [password, setPassword] = useState('')
  return (
    <ActionDialog title="Reset password" description={`${member.full_name || member.email} · ${cafe.name}`} submitLabel="Simpan password" onClose={onClose}
      onSubmit={async () => {
        await platformAction('reset_owner_password', { cafe_id: cafe.id, user_id: member.id, password })
        toast({ title: 'Password diganti', description: `Berikan password baru ke ${member.full_name || member.email}.` })
        onDone()
      }}>
      <TextField label="Password baru" required minLength={8} maxLength={72} autoComplete="new-password" value={password}
        onChange={(event) => setPassword(event.target.value)} hint="Minimal 8 karakter." />
    </ActionDialog>
  )
}
