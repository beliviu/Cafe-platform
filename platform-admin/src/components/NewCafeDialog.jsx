import { useState } from 'react'
import { Copy, KeyRound, Store } from 'lucide-react'
import { Button, Dialog, Select, TextField, useToast } from './ui/index.js'
import { platformAction } from '../lib/api.js'
import { formatRupiah } from '../lib/format.js'

function randomPassword() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

/** Buat kafe baru + akun owner (Edge Function platform-admin → SQL pa_cafe_create_for_owner). */
export function NewCafeDialog({ plans, onClose, onCreated }) {
  const { toast } = useToast()
  const choosable = plans.filter((plan) => !plan.is_archived)
  const [form, setForm] = useState({
    cafe_name: '', owner_name: '', email: '', password: randomPassword(),
    plan: choosable.find((plan) => plan.code === 'pro')?.code || choosable[0]?.code || '', trial_days: '14',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null)
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await platformAction('create_cafe', { ...form, trial_days: Number(form.trial_days) })
      setCreated({ ...form, cafe_id: result.cafe_id })
    } catch (caught) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  async function copyCredentials() {
    const text = `Dashboard Dailybrew\nEmail: ${created.email}\nPassword sementara: ${created.password}\nSegera ganti password setelah masuk.`
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: 'Disalin', description: 'Kirim ke owner lewat chat pribadi.' })
    } catch {
      toast({ tone: 'error', title: 'Tidak bisa menyalin', description: 'Salin manual dari kotak di atas.' })
    }
  }

  if (created) {
    return (
      <Dialog title="Kafe dibuat" description={`${created.cafe_name} siap dipakai.`} size="sm" onClose={() => onCreated(created.cafe_id)}
        footer={<><Button variant="secondary" icon={Copy} onClick={copyCredentials}>Salin akses</Button><Button onClick={() => onCreated(created.cafe_id)}>Buka detail kafe</Button></>}>
        <dl className="credential-box">
          <div><dt>Owner</dt><dd>{created.owner_name}</dd></div>
          <div><dt>Email</dt><dd>{created.email}</dd></div>
          <div><dt>Password sementara</dt><dd><code>{created.password}</code></dd></div>
        </dl>
        <p className="ui-field-hint">Password ini tidak ditampilkan lagi. Minta owner menggantinya setelah masuk pertama kali.</p>
      </Dialog>
    )
  }

  return (
    <Dialog title="Kafe baru" description="Membuat kafe sekaligus akun owner-nya." onClose={busy ? undefined : onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="new-cafe" loading={busy} icon={Store}>Buat kafe</Button></>}>
      <form id="new-cafe" className="dialog-form" onSubmit={submit}>
        <TextField label="Nama kafe" required maxLength={80} value={form.cafe_name} onChange={set('cafe_name')} />
        <div className="dialog-row">
          <TextField label="Nama owner" required maxLength={80} value={form.owner_name} onChange={set('owner_name')} />
          <TextField label="Email owner" type="email" required autoComplete="off" value={form.email} onChange={set('email')} />
        </div>
        <TextField label="Password sementara" required minLength={8} maxLength={72} autoComplete="new-password" value={form.password} onChange={set('password')}
          hint="Minimal 8 karakter. Owner bisa menggantinya nanti."
          suffix={<button type="button" className="login-password-toggle" aria-label="Buat password acak" onClick={() => setForm((current) => ({ ...current, password: randomPassword() }))}><KeyRound size={18} aria-hidden="true" /></button>} />
        <div className="dialog-row">
          <Select label="Paket awal" value={form.plan} onChange={set('plan')}
            options={choosable.map((plan) => ({ value: plan.code, label: `${plan.name}${plan.price_monthly ? ` · ${formatRupiah(plan.price_monthly)}` : ''}` }))} />
          <TextField label="Masa coba (hari)" type="number" min={0} max={90} value={form.trial_days} onChange={set('trial_days')}
            hint="0 = langsung tagih (fitur dasar sampai lunas)" />
        </div>
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}
