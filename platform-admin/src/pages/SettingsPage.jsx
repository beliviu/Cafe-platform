/*
 * Pengaturan platform (file 15): tampilan (warna tema dashboard platform), nomor WA Dailybrew, email notifikasi.
 * Warna berlaku untuk semua admin; mode gelap/terang dipilih per perangkat.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Save } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import { AppearancePanel, Button, Card, CardHeader, Dialog, ErrorState, PageHeader, Select, SkeletonRows, Switch, TextField, useToast } from '../components/ui/index.js'
import { optional, rpc, useLoader } from '../lib/api.js'
import { fill, renderEmailHtml, TEMPLATE_META, TEMPLATE_VARIABLES } from '../lib/emailPreview.js'
import { can } from '../lib/roles.js'
import { formatWa } from '../lib/whatsapp.js'

const KINDS = [
  { key: 'cafe_created', label: 'Kafe baru dibuat', admin: true },
  { key: 'invoice_paid', label: 'Tagihan lunas', admin: true },
  { key: 'invoice_overdue', label: 'Tagihan telat', admin: true, owner: true },
  { key: 'payment_failed', label: 'Pembayaran gagal', admin: true },
  { key: 'trial_ending', label: 'Masa coba habis ≤ 3 hari', admin: true, owner: true },
  { key: 'idle_cafe', label: 'Kafe tanpa pesanan 7 hari', admin: true },
  { key: 'invoice_due_7', label: 'Tagihan H-7', owner: true },
  { key: 'invoice_due_1', label: 'Tagihan H-1', owner: true },
]

function AppearanceCard({ initial }) {
  const { theme, setTheme } = useAuth()
  const { toast } = useToast()
  const [saved, setSaved] = useState({ color: initial.theme_color, color2: null })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dirty = theme.color !== saved.color

  // Keluar halaman tanpa menyimpan → kembali ke warna tersimpan terakhir
  const savedRef = useRef(saved)
  useEffect(() => { savedRef.current = saved }, [saved])
  useEffect(() => () => setTheme(savedRef.current), [setTheme])

  async function save() {
    setBusy(true)
    setError('')
    try {
      const result = await rpc('pa_settings_update', { p_patch: { theme_color: theme.color, theme_color2: '' } })
      setSaved({ color: result.theme_color, color2: null })
      toast({ title: 'Warna aksen disimpan', description: 'Berlaku untuk semua admin platform.' })
    } catch (caught) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Tampilan" description="Mode, sudut kartu, dan animasi tersimpan di perangkat ini. Warna aksen berlaku untuk semua admin." />
      <AppearancePanel accent={theme.color} onAccentChange={(color) => setTheme({ color, color2: null })}>
        <div className="appearance-save">
          <Button icon={Save} loading={busy} disabled={!dirty} onClick={save}>Simpan warna aksen</Button>
          {dirty && <Button variant="ghost" disabled={busy} onClick={() => setTheme(saved)}>Batalkan</Button>}
          {dirty && <span className="appearance-dirty">Belum disimpan</span>}
        </div>
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </AppearancePanel>
    </Card>
  )
}

function ContactCard({ initial, onSaved }) {
  const { toast } = useToast()
  const [whatsapp, setWhatsapp] = useState(initial.support_whatsapp || '')
  const [fromName, setFromName] = useState(initial.email_from_name || 'Dailybrew')
  const [adminKinds, setAdminKinds] = useState(initial.email_admin_kinds || [])
  const [ownerKinds, setOwnerKinds] = useState(initial.email_owner_kinds || [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggle = (list, setList, key) => setList(list.includes(key) ? list.filter((item) => item !== key) : [...list, key])

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await rpc('pa_settings_update', { p_patch: { support_whatsapp: whatsapp, email_from_name: fromName, email_admin_kinds: adminKinds, email_owner_kinds: ownerKinds } })
      setWhatsapp(result.support_whatsapp || '')
      toast({ title: 'Pengaturan disimpan' })
      onSaved()
    } catch (caught) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card as="form" onSubmit={save}>
      <CardHeader title="Kontak & email" description="Nomor WhatsApp Dailybrew dipakai tombol “Hubungi Dailybrew” di dashboard owner." />
      <div className="dialog-form">
        <TextField label="WhatsApp Dailybrew" inputMode="tel" placeholder="0812 3456 7890" value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)}
          hint={initial.support_whatsapp ? `Tersimpan: ${formatWa(initial.support_whatsapp)}` : 'Belum diisi — tombol Hubungi Dailybrew belum tampil di sisi owner.'} />
        <TextField label="Nama pengirim email" maxLength={60} value={fromName} onChange={(event) => setFromName(event.target.value)} />
        <div className="pa-kind-grid">
          <fieldset className="pa-fieldset">
            <legend className="ui-field-label">Email ke admin</legend>
            {KINDS.filter((kind) => kind.admin).map((kind) => (
              <label key={kind.key} className="settings-check"><input type="checkbox" checked={adminKinds.includes(kind.key)} onChange={() => toggle(adminKinds, setAdminKinds, kind.key)} />{kind.label}</label>
            ))}
          </fieldset>
          <fieldset className="pa-fieldset">
            <legend className="ui-field-label">Email ke owner</legend>
            {KINDS.filter((kind) => kind.owner).map((kind) => (
              <label key={kind.key} className="settings-check"><input type="checkbox" checked={ownerKinds.includes(kind.key)} onChange={() => toggle(ownerKinds, setOwnerKinds, kind.key)} />{kind.label}</label>
            ))}
          </fieldset>
        </div>
        <p className="ui-field-hint">Notifikasi di dashboard selalu dibuat; pilihan ini hanya menentukan mana yang juga dikirim lewat email (butuh Edge Function “notify”).</p>
        {error && <p className="ui-field-error" role="alert">{error}</p>}
        <div><Button type="submit" icon={Save} loading={busy}>Simpan</Button></div>
      </div>
    </Card>
  )
}

/* ---------- File 18: daftar sendiri, trial, masa tenggang, kuota AI ---------- */
function PlatformCard({ initial, plans, onSaved, readOnly }) {
  const { toast } = useToast()
  const [form, setForm] = useState(() => ({
    signup_enabled: Boolean(initial.signup_enabled), signup_approval_mode: Boolean(initial.signup_approval_mode),
    default_trial_days: String(initial.default_trial_days), default_trial_plan: initial.default_trial_plan,
    billing_grace_days: String(initial.billing_grace_days), ai_daily_limit: String(initial.ai_daily_limit),
  }))
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (key) => (value) => { setForm((current) => ({ ...current, [key]: value })); setErrors({}) }
  const between = (value, min, max) => value !== '' && Number(value) >= min && Number(value) <= max

  async function save(event) {
    event.preventDefault()
    const next = {}
    if (!between(form.default_trial_days, 0, 90)) next.default_trial_days = '0–90 hari'
    if (!between(form.billing_grace_days, 0, 30)) next.billing_grace_days = '0–30 hari'
    if (!between(form.ai_daily_limit, 0, 500)) next.ai_daily_limit = '0–500'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      await rpc('pa_platform_settings_update', { p_patch: {
        ...form, default_trial_days: Number(form.default_trial_days), billing_grace_days: Number(form.billing_grace_days), ai_daily_limit: Number(form.ai_daily_limit),
      } })
      toast({ title: 'Pengaturan platform disimpan' })
      onSaved()
    } catch (caught) {
      setErrors({ form: caught.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card as="form" onSubmit={save}>
      <CardHeader title="Pendaftaran & langganan" description="Halaman /daftar di web owner, masa coba bawaan, dan masa tenggang setelah langganan habis." />
      <div className="dialog-form">
        <div className="fin-switch-row">
          <span><strong>Buka pendaftaran mandiri</strong><small>Kafe bisa daftar sendiri lewat /daftar (butuh Edge Function self-signup & Turnstile).</small></span>
          <Switch checked={form.signup_enabled} onChange={set('signup_enabled')} label="Buka pendaftaran" onLabel="Buka" offLabel="Tutup" disabled={readOnly} />
        </div>
        <div className="fin-switch-row">
          <span><strong>Mode persetujuan</strong><small>Kafe baru menunggu persetujuan di menu Pendaftaran sebelum bisa menerima pesanan.</small></span>
          <Switch checked={form.signup_approval_mode} onChange={set('signup_approval_mode')} label="Mode persetujuan" onLabel="Nyala" offLabel="Mati" disabled={readOnly} />
        </div>
        <div className="fin-form-row">
          <TextField label="Masa coba bawaan" type="number" inputMode="numeric" min={0} max={90} suffix="hari" value={form.default_trial_days} error={errors.default_trial_days}
            onChange={(event) => set('default_trial_days')(event.target.value)} disabled={readOnly} />
          <Select label="Paket masa coba" value={form.default_trial_plan} onChange={(event) => set('default_trial_plan')(event.target.value)} disabled={readOnly}
            options={plans.filter((plan) => !plan.is_archived).map((plan) => ({ value: plan.code, label: plan.name }))} />
        </div>
        <div className="fin-form-row">
          <TextField label="Masa tenggang" type="number" inputMode="numeric" min={0} max={30} suffix="hari" value={form.billing_grace_days} error={errors.billing_grace_days}
            hint="Fitur paket tetap jalan sekian hari setelah masa berlaku habis" onChange={(event) => set('billing_grace_days')(event.target.value)} disabled={readOnly} />
          <TextField label="Kuota Tanya AI" type="number" inputMode="numeric" min={0} max={500} suffix="/admin/hari" value={form.ai_daily_limit} error={errors.ai_daily_limit}
            onChange={(event) => set('ai_daily_limit')(event.target.value)} disabled={readOnly} />
        </div>
        <p className="ui-field-hint">Nonaktif otomatis setelah tenggang diatur di Keuangan → Pengaturan.</p>
        {errors.form && <p className="ui-field-error" role="alert">{errors.form}</p>}
        {!readOnly && <div><Button type="submit" icon={Save} loading={busy}>Simpan</Button></div>}
      </div>
    </Card>
  )
}

function TemplatesCard({ settings, readOnly }) {
  const load = useCallback(() => optional(rpc('pa_email_templates_list')), [])
  const { data, reload } = useLoader(load)
  const [editing, setEditing] = useState(null)
  if (!data) return null
  return (
    <Card>
      <CardHeader title="Template email" description="Dipakai Edge Function notify untuk email ke owner. Klik untuk mengubah & melihat pratinjau." />
      <ul className="tpl-list">
        {data.map((template) => (
          <li key={template.key}>
            <span className="pa-cell-main"><strong>{TEMPLATE_META[template.key]?.label}</strong><small>{TEMPLATE_META[template.key]?.used} · subjek: {fill(template.subject)}</small></span>
            <Button size="sm" variant="secondary" onClick={() => setEditing(template)}>{readOnly ? 'Lihat' : 'Ubah'}</Button>
          </li>
        ))}
      </ul>
      {editing && <TemplateDialog template={editing} settings={settings} readOnly={readOnly} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </Card>
  )
}

function TemplateDialog({ template, settings, readOnly, onClose, onSaved }) {
  const { toast } = useToast()
  const [form, setForm] = useState({ subject: template.subject, heading: template.heading, body: template.body, cta_label: template.cta_label || '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key) => (event) => { setForm((current) => ({ ...current, [key]: event.target.value })); setError('') }
  const html = renderEmailHtml(form, { color: settings.theme_color, fromName: settings.email_from_name })
  const isReset = template.key === 'reset_password'

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    try {
      await rpc('pa_email_template_update', { p_key: template.key, p_subject: form.subject, p_heading: form.heading, p_body: form.body, p_cta_label: form.cta_label || null })
      toast({ title: 'Template disimpan', description: TEMPLATE_META[template.key]?.label })
      onSaved()
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
  }

  async function copySupabase() {
    const supabaseHtml = renderEmailHtml(form, { color: settings.theme_color, fromName: settings.email_from_name, ctaUrl: '{{ .ConfirmationURL }}', vars: { platform: settings.email_from_name } })
    try {
      await navigator.clipboard.writeText(supabaseHtml)
      toast({ title: 'HTML disalin', description: 'Tempel di Supabase → Authentication → Email Templates → Reset Password.' })
    } catch {
      toast({ tone: 'danger', title: 'Gagal menyalin' })
    }
  }

  return (
    <Dialog title={`Template: ${TEMPLATE_META[template.key]?.label}`} size="lg" onClose={busy ? undefined : onClose} dismissible={!busy}
      footer={<>
        {isReset && <Button variant="ghost" onClick={copySupabase}>Salin HTML untuk Supabase</Button>}
        <Button variant="ghost" onClick={onClose} disabled={busy}>Tutup</Button>
        {!readOnly && <Button type="submit" form="tpl-form" icon={Save} loading={busy}>Simpan</Button>}
      </>}>
      <div className="tpl-editor">
        <form id="tpl-form" className="dialog-form" onSubmit={save} noValidate>
          <TextField label="Subjek" value={form.subject} maxLength={160} onChange={set('subject')} disabled={readOnly} />
          <TextField label="Judul" value={form.heading} maxLength={160} onChange={set('heading')} disabled={readOnly} />
          <TextField label="Isi" multiline rows={7} value={form.body} maxLength={4000} onChange={set('body')} disabled={readOnly} />
          <TextField label="Tulisan tombol" value={form.cta_label} maxLength={40} onChange={set('cta_label')} disabled={readOnly} hint="Kosongkan bila tanpa tombol" />
          <p className="ui-field-hint">Variabel: {TEMPLATE_VARIABLES.map(([name, label]) => `${name} (${label})`).join(', ')}.</p>
          {isReset && <p className="ui-field-hint">Email reset password dikirim oleh Supabase Auth, bukan antrean Dailybrew. Simpan di sini, lalu salin HTML-nya ke Supabase.</p>}
          {error && <p className="ui-field-error" role="alert">{error}</p>}
        </form>
        <div className="tpl-preview">
          <span className="ui-field-label">Pratinjau · subjek: {fill(form.subject)}</span>
          <iframe title="Pratinjau email" srcDoc={html} sandbox="" />
        </div>
      </div>
    </Dialog>
  )
}

export function SettingsPage() {
  const { admin } = useAuth()
  const load = useCallback(() => Promise.all([rpc('pa_settings_get'), optional(rpc('pa_plans_list'))]).then(([settings, plans]) => ({ ...settings, plans: plans || [] })), [])
  const { data, error, loading, reload } = useLoader(load)
  const readOnly = !can(admin, 'pa_settings_update')
  return (
    <div className="page page-narrow pa-stack">
      <PageHeader eyebrow="Sistem" title="Pengaturan" description="Tampilan dashboard platform, kontak WhatsApp Dailybrew, dan email notifikasi" />
      {error ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <Card><SkeletonRows rows={5} /></Card> : (
        <>
          <AppearanceCard initial={data} />
          <ContactCard key={data.updated_at} initial={data} onSaved={reload} />
          {'signup_enabled' in data && <PlatformCard key={'p-' + data.updated_at} initial={data} plans={data.plans} onSaved={reload} readOnly={readOnly} />}
          {'signup_enabled' in data && <TemplatesCard settings={data} readOnly={readOnly} />}
        </>
      )}
    </div>
  )
}
