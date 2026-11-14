/*
 * Pengaturan platform (file 15): tampilan (warna tema dashboard platform), nomor WA Dailybrew, email notifikasi.
 * Warna berlaku untuk semua admin; mode gelap/terang dipilih per perangkat.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Save } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import { AppearancePanel, Button, Card, CardHeader, ErrorState, PageHeader, SkeletonRows, TextField, useToast } from '../components/ui/index.js'
import { rpc, useLoader } from '../lib/api.js'
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
