/*
 * Pengaturan platform (file 15): tampilan (warna tema dashboard platform), nomor WA Dailybrew, email notifikasi.
 * Warna berlaku untuk semua admin; mode gelap/terang dipilih per perangkat.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Palette, Save } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import { Button, Card, CardHeader, ErrorState, PageHeader, SegmentedControl, SkeletonRows, TextField, useToast } from '../components/ui/index.js'
import { rpc, useLoader } from '../lib/api.js'
import { DEFAULT_THEME_COLOR, isHex, THEME_GRADIENTS, THEME_PRESETS } from '../lib/theme.js'
import { THEME_PREFERENCES, useThemeMode } from '../lib/themeMode.js'
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

function Swatch({ color, color2, label, selected, onClick }) {
  return (
    <button type="button" className={`pa-swatch${selected ? ' is-selected' : ''}`} onClick={onClick} aria-pressed={selected} title={label}
      style={{ background: color2 ? `linear-gradient(135deg, ${color}, ${color2})` : color }}>
      {selected && <Check size={16} aria-hidden="true" />}
      <span className="sr-only">{label}</span>
    </button>
  )
}

function AppearanceCard({ initial }) {
  const { theme, setTheme } = useAuth()
  const { preference, setPreference } = useThemeMode()
  const { toast } = useToast()
  const [saved, setSaved] = useState({ color: initial.theme_color, color2: initial.theme_color2 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dirty = theme.color !== saved.color || (theme.color2 || null) !== (saved.color2 || null)

  // Keluar halaman tanpa menyimpan → kembali ke warna tersimpan terakhir
  const savedRef = useRef(saved)
  useEffect(() => { savedRef.current = saved }, [saved])
  useEffect(() => () => setTheme(savedRef.current), [setTheme])

  function preview(color, color2 = null) {
    setTheme({ color, color2 })
  }

  async function save() {
    setBusy(true)
    setError('')
    try {
      const result = await rpc('pa_settings_update', { p_patch: { theme_color: theme.color, theme_color2: theme.color2 || '' } })
      setSaved({ color: result.theme_color, color2: result.theme_color2 })
      toast({ title: 'Warna disimpan', description: 'Berlaku untuk semua admin platform.' })
    } catch (caught) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Tampilan" description="Warna dashboard platform. Semua warna lain (sidebar, tombol, grafik, status) dihitung otomatis dari pilihan ini."
        actions={dirty && <span className="pa-dirty">Belum disimpan</span>} />
      <div className="pa-settings-block">
        <span className="ui-field-label">Warna utama</span>
        <div className="pa-swatches">
          {THEME_PRESETS.map((preset) => (
            <Swatch key={preset.color} color={preset.color} label={preset.label} selected={!theme.color2 && theme.color === preset.color} onClick={() => preview(preset.color)} />
          ))}
          <label className={`pa-swatch pa-swatch-custom${!theme.color2 && !THEME_PRESETS.some((preset) => preset.color === theme.color) ? ' is-selected' : ''}`} title="Warna bebas">
            <Palette size={16} aria-hidden="true" />
            <span className="sr-only">Pilih warna bebas</span>
            <input type="color" value={isHex(theme.color) ? theme.color : DEFAULT_THEME_COLOR} onChange={(event) => preview(event.target.value.toUpperCase(), theme.color2)} />
          </label>
        </div>
      </div>
      <div className="pa-settings-block">
        <span className="ui-field-label">Gradasi (opsional)</span>
        <div className="pa-swatches">
          {THEME_GRADIENTS.map((gradient) => (
            <Swatch key={gradient.label} color={gradient.from} color2={gradient.to} label={gradient.label}
              selected={theme.color === gradient.from && theme.color2 === gradient.to} onClick={() => preview(gradient.from, gradient.to)} />
          ))}
          {theme.color2 && <Button size="sm" variant="ghost" onClick={() => preview(theme.color, null)}>Tanpa gradasi</Button>}
        </div>
      </div>
      <div className="pa-settings-block">
        <span className="ui-field-label">Mode</span>
        <SegmentedControl label="Mode tampilan" options={THEME_PREFERENCES} value={preference} onChange={setPreference} />
        <p className="ui-field-hint">Mode dipilih per perangkat dan langsung tersimpan.</p>
      </div>
      <div className="pa-preview" aria-hidden="true">
        <span className="pa-preview-rail"><span /><span /><span /></span>
        <span className="pa-preview-body">
          <span className="pa-preview-hero">MRR · Rp 4.200.000</span>
          <span className="pa-preview-row"><span className="ui-btn ui-btn-primary ui-btn-sm"><span>Tombol utama</span></span><span className="ui-badge ui-badge-green ui-badge-sm">Aktif</span><span className="ui-badge ui-badge-amber ui-badge-sm">Telat</span></span>
        </span>
      </div>
      <div className="pa-actions pa-card-actions">
        <Button icon={Save} loading={busy} disabled={!dirty} onClick={save}>Simpan warna</Button>
        {dirty && <Button variant="ghost" onClick={() => setTheme(saved)}>Batalkan</Button>}
      </div>
      {error && <p className="ui-field-error" role="alert">{error}</p>}
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

export function SettingsPage() {
  const load = useCallback(() => rpc('pa_settings_get'), [])
  const { data, error, loading, reload } = useLoader(load)
  return (
    <div className="page page-narrow pa-stack">
      <PageHeader eyebrow="Sistem" title="Pengaturan" description="Tampilan dashboard platform, kontak WhatsApp Dailybrew, dan email notifikasi" />
      {error ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <Card><SkeletonRows rows={5} /></Card> : (
        <>
          <AppearanceCard initial={data} />
          <ContactCard key={data.updated_at} initial={data} onSaved={reload} />
        </>
      )}
    </div>
  )
}
