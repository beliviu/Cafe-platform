import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Banknote, Clock3, Copy, Landmark, QrCode, Store, UserRound, Users, Wallet } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import {
  Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, SkeletonRows, Switch, TextField, useToast,
} from '../components/ui/index.js'
import {
  DAY_KEYS, DAY_LABELS, defaultOpeningHours, normalizeOpeningHours, openStatus, validateOpeningHours,
} from '../lib/cafeHours.js'
import { ALL_PAYMENT_METHODS, DB_UPDATE_REQUIRED, friendlyError } from '../lib/db.js'
import { SectionFooter } from '../components/settings/SettingsShared.jsx'
import { saveCafe } from '../lib/cafe.js'
import { BrandingSection } from '../components/settings/BrandingSection.jsx'
import { formatDate } from '../lib/format.js'
import { paymentMethodLabel } from '../lib/status.js'

const METHOD_ICONS = { cash: Banknote, qris: QrCode, bank_transfer: Landmark, ewallet: Wallet }
const PHONE_PATTERN = /^[0-9+\-\s()]{6,20}$/

function CafeInfoSection({ cafe, features, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const initial = {
    name: cafe.name || '',
    description: cafe.description || '',
    address: cafe.address || '',
    phone: cafe.phone || '',
  }
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const dirty = Object.keys(initial).some((key) => form[key] !== initial[key])

  function update(key) {
    return (event) => {
      setForm((current) => ({ ...current, [key]: event.target.value }))
      setErrors((current) => ({ ...current, [key]: '' }))
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const values = {
      name: form.name.replace(/\s+/g, ' ').trim(),
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
    }
    if (features?.operations) values.description = form.description.trim() || null
    const nextErrors = {}
    if (values.name.length < 2) nextErrors.name = 'Nama kafe minimal 2 karakter.'
    if (values.phone && !PHONE_PATTERN.test(values.phone)) nextErrors.phone = 'Nomor telepon hanya boleh angka, spasi, +, -, dan tanda kurung.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    setSaving(true)
    try {
      const saved = await saveCafe(supabase, cafe, features, values)
      onSaved(saved)
      setForm({ name: saved.name || '', description: saved.description || '', address: saved.address || '', phone: saved.phone || '' })
      toast({ tone: 'success', title: 'Info kafe disimpan' })
    } catch (caught) {
      toast({ tone: 'error', title: 'Info kafe gagal disimpan', description: caught.message })
    }
    setSaving(false)
  }

  return (
    <Card as="form" onSubmit={handleSubmit} noValidate className="settings-card">
      <CardHeader icon={Store} title="Info kafe" description="Tampil di aplikasi customer dan struk." />
      <div className="settings-fields">
        <TextField label="Nama kafe" value={form.name} onChange={update('name')} maxLength={60} error={errors.name} required />
        <TextField label="Telepon / WhatsApp" value={form.phone} onChange={update('phone')} maxLength={20} inputMode="tel" placeholder="0812 3456 7890" error={errors.phone} />
        <TextField className="settings-span" label="Alamat" value={form.address} onChange={update('address')} maxLength={200} placeholder="Jl. Contoh No. 1, Kota" />
        {features?.operations ? (
          <TextField
            className="settings-span"
            label="Deskripsi singkat"
            multiline
            rows={3}
            value={form.description}
            onChange={update('description')}
            maxLength={240}
            hint={`${form.description.length}/240 karakter · mis. "Kopi susu gula aren & roti panggang sejak 2019."`}
          />
        ) : (
          <p className="settings-note settings-span">Deskripsi kafe tersedia setelah pembaruan database diterapkan.</p>
        )}
      </div>
      <SectionFooter dirty={dirty} saving={saving} onReset={() => { setForm(initial); setErrors({}) }}>
        <Button type="submit" loading={saving} disabled={!dirty}>Simpan info kafe</Button>
      </SectionFooter>
    </Card>
  )
}

function OpeningHoursSection({ cafe, features, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const stored = normalizeOpeningHours(cafe.opening_hours)
  const [hours, setHours] = useState(() => stored || defaultOpeningHours())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(hours) !== JSON.stringify(stored)
  const status = openStatus(stored)

  if (!features?.operations) {
    return (
      <Card className="settings-card">
        <CardHeader icon={Clock3} title="Jam buka" description="Customer melihat status buka/tutup di aplikasi." />
        <EmptyState compact icon={Clock3} title="Belum tersedia" description={DB_UPDATE_REQUIRED} />
      </Card>
    )
  }

  function updateDay(key, patch) {
    setHours((current) => ({ ...current, [key]: { ...current[key], ...patch } }))
    setError('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const validation = validateOpeningHours(hours)
    setError(validation)
    if (validation) return
    setSaving(true)
    try {
      const saved = await saveCafe(supabase, cafe, features, { opening_hours: hours })
      onSaved(saved)
      toast({ tone: 'success', title: 'Jam buka disimpan' })
    } catch (caught) {
      toast({ tone: 'error', title: 'Jam buka gagal disimpan', description: caught.message })
    }
    setSaving(false)
  }

  return (
    <Card as="form" onSubmit={handleSubmit} noValidate className="settings-card">
      <CardHeader
        icon={Clock3}
        title="Jam buka"
        description="Waktu WIB. Jam tutup lebih awal dari jam buka berarti tutup lewat tengah malam."
        actions={status ? <Badge tone={status.open ? 'green' : 'neutral'}>{status.label}</Badge> : <Badge tone="amber">Belum diatur</Badge>}
      />
      <div className="hours-table" role="group" aria-label="Jam buka per hari">
        {DAY_KEYS.map((key) => {
          const day = hours[key]
          return (
            <div className={`hours-row${day.closed ? ' is-closed' : ''}`} key={key}>
              <span className="hours-day">{DAY_LABELS[key]}</span>
              <Switch
                size="sm"
                checked={!day.closed}
                onChange={(open) => updateDay(key, { closed: !open })}
                label={`${DAY_LABELS[key]} buka`}
                onLabel="Buka"
                offLabel="Tutup"
              />
              <span className="hours-times">
                <input type="time" aria-label={`Jam buka ${DAY_LABELS[key]}`} value={day.open} disabled={day.closed} onChange={(event) => updateDay(key, { open: event.target.value })} />
                <span aria-hidden="true">–</span>
                <input type="time" aria-label={`Jam tutup ${DAY_LABELS[key]}`} value={day.close} disabled={day.closed} onChange={(event) => updateDay(key, { close: event.target.value })} />
              </span>
            </div>
          )
        })}
      </div>
      <div className="hours-tools">
        <Button
          variant="ghost"
          size="sm"
          icon={Copy}
          onClick={() => setHours((current) => Object.fromEntries(DAY_KEYS.map((key) => [key, { ...current.mon }])))}
        >
          Samakan semua hari dengan Senin
        </Button>
      </div>
      {error && <p className="ui-field-error" role="alert">{error}</p>}
      <SectionFooter dirty={dirty || !stored} saving={saving} onReset={() => setHours(stored || defaultOpeningHours())}>
        <Button type="submit" loading={saving} disabled={!dirty && Boolean(stored)}>Simpan jam buka</Button>
      </SectionFooter>
    </Card>
  )
}

function PaymentMethodsSection({ cafe, features, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const stored = Array.isArray(cafe.accepted_payment_methods) ? cafe.accepted_payment_methods.filter((method) => ALL_PAYMENT_METHODS.includes(method)) : []
  const [selected, setSelected] = useState(stored)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const dirty = [...selected].sort().join() !== [...stored].sort().join()

  if (!features?.operations) {
    return (
      <Card className="settings-card">
        <CardHeader icon={Wallet} title="Metode pembayaran" description="Pilihan saat staff menandai pesanan lunas." />
        <EmptyState compact icon={Wallet} title="Belum tersedia" description={DB_UPDATE_REQUIRED} />
      </Card>
    )
  }

  function toggle(method) {
    setSelected((current) => (current.includes(method) ? current.filter((item) => item !== method) : [...current, method]))
    setError('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!selected.length) {
      setError('Pilih minimal satu metode pembayaran.')
      return
    }
    setSaving(true)
    try {
      const ordered = ALL_PAYMENT_METHODS.filter((method) => selected.includes(method))
      const saved = await saveCafe(supabase, cafe, features, { accepted_payment_methods: ordered })
      onSaved(saved)
      toast({ tone: 'success', title: 'Metode pembayaran disimpan' })
    } catch (caught) {
      toast({ tone: 'error', title: 'Metode pembayaran gagal disimpan', description: caught.message })
    }
    setSaving(false)
  }

  return (
    <Card as="form" onSubmit={handleSubmit} noValidate className="settings-card">
      <CardHeader icon={Wallet} title="Metode pembayaran" description="Muncul sebagai pilihan saat staff menandai pesanan lunas." />
      <fieldset className="ui-choice-group">
        <legend className="sr-only">Metode yang diterima</legend>
        <div className="ui-choice-grid">
          {ALL_PAYMENT_METHODS.map((method) => {
            const Icon = METHOD_ICONS[method]
            const checked = selected.includes(method)
            return (
              <label key={method} className={`ui-choice${checked ? ' is-selected' : ''}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(method)} />
                <Icon size={20} aria-hidden="true" />
                <span>{paymentMethodLabel(method)}</span>
              </label>
            )
          })}
        </div>
      </fieldset>
      {error && <p className="ui-field-error" role="alert">{error}</p>}
      <SectionFooter dirty={dirty} saving={saving} onReset={() => setSelected(stored)}>
        <Button type="submit" loading={saving} disabled={!dirty}>Simpan metode</Button>
      </SectionFooter>
    </Card>
  )
}

function ProfileSection({ profile, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const initial = { full_name: profile.full_name || '', phone: profile.phone || '' }
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const dirty = form.full_name !== initial.full_name || form.phone !== initial.phone

  async function handleSubmit(event) {
    event.preventDefault()
    const values = { full_name: form.full_name.replace(/\s+/g, ' ').trim(), phone: form.phone.trim() || null }
    const nextErrors = {}
    if (values.full_name.length < 2) nextErrors.full_name = 'Nama minimal 2 karakter.'
    if (values.phone && !PHONE_PATTERN.test(values.phone)) nextErrors.phone = 'Nomor telepon tidak valid.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    setSaving(true)
    const { data, error } = await supabase.from('profiles').update(values).eq('id', profile.id).select('full_name, phone').maybeSingle()
    if (error || !data) {
      toast({ tone: 'error', title: 'Profil gagal disimpan', description: error ? friendlyError(error) : 'Perubahan ditolak database.' })
    } else {
      onSaved(data)
      setForm({ full_name: data.full_name || '', phone: data.phone || '' })
      toast({ tone: 'success', title: 'Profil disimpan' })
    }
    setSaving(false)
  }

  return (
    <Card as="form" onSubmit={handleSubmit} noValidate className="settings-card">
      <CardHeader icon={UserRound} title="Profil Anda" description="Nama dipakai untuk sapaan di dashboard." />
      <div className="settings-fields">
        <TextField label="Nama lengkap" value={form.full_name} maxLength={80} error={errors.full_name}
          onChange={(event) => { setForm((current) => ({ ...current, full_name: event.target.value })); setErrors({}) }} />
        <TextField label="Nomor HP" value={form.phone} maxLength={20} inputMode="tel" error={errors.phone}
          onChange={(event) => { setForm((current) => ({ ...current, phone: event.target.value })); setErrors({}) }} />
      </div>
      <SectionFooter dirty={dirty} saving={saving} onReset={() => { setForm(initial); setErrors({}) }}>
        <Button type="submit" loading={saving} disabled={!dirty}>Simpan profil</Button>
      </SectionFooter>
    </Card>
  )
}

function TeamSection({ cafe, features }) {
  const { supabase } = useAuth()
  const [state, setState] = useState({ loading: true, members: [], error: '' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!features?.operations) return undefined
    let active = true
    supabase.rpc('cafe_team_members', { p_cafe_id: cafe.id }).then(({ data, error }) => {
      if (!active) return
      setState({ loading: false, members: data || [], error: error ? friendlyError(error) : '' })
    })
    return () => { active = false }
  }, [attempt, cafe.id, features?.operations, supabase])

  return (
    <Card className="settings-card">
      <CardHeader icon={Users} title="Tim kafe" description="Akun owner dan staff yang terhubung ke kafe ini." />
      {!features?.operations ? (
        <EmptyState compact icon={Users} title="Belum tersedia" description={DB_UPDATE_REQUIRED} />
      ) : state.loading ? (
        <SkeletonRows rows={2} label="Memuat tim" />
      ) : state.error ? (
        <ErrorState compact message={state.error} onRetry={() => { setState((current) => ({ ...current, loading: true })); setAttempt((value) => value + 1) }} />
      ) : (
        <ul className="team-list">
          {state.members.map((member) => (
            <li key={member.id}>
              <span className="shell-avatar" aria-hidden="true">{(member.full_name || '?').trim().slice(0, 1).toUpperCase()}</span>
              <span className="team-name">
                <strong>{member.full_name || 'Tanpa nama'}</strong>
                <small>Bergabung {formatDate(member.created_at)}</small>
              </span>
              <Badge tone={member.role === 'owner' ? 'brand' : 'blue'} dot={false}>{member.role === 'owner' ? 'Owner' : 'Staff'}</Badge>
            </li>
          ))}
        </ul>
      )}
      <p className="settings-note">
        Menambah atau menghapus akun staff saat ini dilakukan oleh administrator, karena butuh akses server.
        Staff yang sudah terdaftar masuk lewat halaman login yang sama dan otomatis diarahkan ke halaman Pesanan.
      </p>
    </Card>
  )
}

export function SettingsPage() {
  const { cafe, profile, features, updateCafe, updateProfile } = useOutletContext()
  return (
    <div className="page">
      <PageHeader eyebrow="Pengaturan" title="Pengaturan" description="Brand, info kafe, jam buka, metode pembayaran, dan tim." />
      <BrandingSection
        key={`brand-${cafe.app_name}-${cafe.logo_url}-${cafe.tagline}-${cafe.brand_color}`}
        cafe={cafe}
        features={features}
        onSaved={updateCafe}
      />
      <div className="settings-grid">
        <div className="settings-column">
          <CafeInfoSection key={`info-${cafe.name}-${cafe.address}-${cafe.phone}-${cafe.description}`} cafe={cafe} features={features} onSaved={updateCafe} />
          <OpeningHoursSection key={`hours-${JSON.stringify(cafe.opening_hours)}`} cafe={cafe} features={features} onSaved={updateCafe} />
        </div>
        <div className="settings-column">
          <PaymentMethodsSection key={`pay-${cafe.accepted_payment_methods}`} cafe={cafe} features={features} onSaved={updateCafe} />
          <ProfileSection key={`profile-${profile.full_name}-${profile.phone}`} profile={profile} onSaved={updateProfile} />
          <TeamSection cafe={cafe} features={features} />
        </div>
      </div>
    </div>
  )
}
