/*
 * Pengaturan → Pesanan app (file 08): jeda pesanan, pesanan terjadwal, estimasi waktu siap, QR meja.
 * Jam buka diatur di tab Operasional; app menolak pesanan saat kafe tutup.
 */
import { useCallback, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth.js'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, SkeletonRows, Switch, TextField, useToast } from '../../components/ui/index.js'
import { SectionFooter } from '../../components/settings/SettingsShared.jsx'
import { CUSTOMER_REQUIRED, friendlyError } from '../../lib/db.js'
import { useLoader } from '../../lib/inventory.js'
import { rpc } from '../../lib/pos.js'

const KEYS = ['scheduled_orders_enabled', 'prep_minutes_base', 'prep_minutes_per_order', 'qr_ordering_enabled']

export function OrderingSettings() {
  const { cafe, features } = useOutletContext()
  const { supabase } = useAuth()
  const load = useCallback(async () => {
    const [settings, status] = await Promise.all([
      supabase.from('cafe_settings').select(`ordering_paused, ordering_message, ${KEYS.join(', ')}`).eq('cafe_id', cafe.id).maybeSingle(),
      supabase.rpc('cafe_status', { p_cafe_id: cafe.id }),
    ])
    if (settings.error) throw new Error(friendlyError(settings.error))
    return { settings: settings.data, status: status.data }
  }, [cafe.id, supabase])
  const { data, error, reload } = useLoader(features?.customer ? load : null)

  if (!features?.customer) return <Card className="settings-card"><CardHeader title="Pesanan app" /><EmptyState compact title="Belum tersedia" description={CUSTOMER_REQUIRED} /></Card>
  if (error) return <Card className="settings-card"><ErrorState compact message={error} onRetry={reload} /></Card>
  if (!data) return <Card className="settings-card"><SkeletonRows rows={4} label="Memuat pengaturan" /></Card>
  return (
    <div className="settings-stack">
      <PauseCard cafeId={cafe.id} settings={data.settings} status={data.status} onSaved={reload} />
      <OrderingForm key={JSON.stringify(data.settings)} cafeId={cafe.id} settings={data.settings} onSaved={reload} />
    </div>
  )
}

function PauseCard({ cafeId, settings, status, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [message, setMessage] = useState(settings.ordering_message || '')
  const [busy, setBusy] = useState(false)

  async function toggle(paused) {
    setBusy(true)
    try {
      await rpc(supabase, 'cafe_set_ordering_paused', { p_cafe_id: cafeId, p_paused: paused, p_message: message.trim() || null })
      toast({ tone: 'success', title: paused ? 'Pesanan app dijeda' : 'Pesanan app dibuka lagi' })
      onSaved()
    } catch (caught) {
      toast({ tone: 'error', title: 'Gagal mengubah', description: caught.message })
    }
    setBusy(false)
  }

  return (
    <Card className="settings-card">
      <CardHeader title="Terima pesanan dari app"
        description="Jeda sementara saat antrean penuh atau bahan habis. Staff juga bisa menjeda dari papan pesanan."
        actions={settings.ordering_paused ? <Badge tone="amber">Dijeda</Badge> : status?.open === false ? <Badge tone="neutral">Tutup (jam buka)</Badge> : <Badge tone="green">Menerima pesanan</Badge>} />
      <div className="settings-fields">
        <TextField className="settings-span" label="Pesan untuk pelanggan saat dijeda (opsional)" value={message} maxLength={160}
          placeholder="Mis. Antrean sedang penuh, buka lagi 15 menit" onChange={(event) => setMessage(event.target.value)} />
      </div>
      <div className="settings-actions">
        {settings.ordering_paused
          ? <Button loading={busy} onClick={() => toggle(false)}>Buka lagi pesanan app</Button>
          : <Button variant="secondary" loading={busy} onClick={() => toggle(true)}>Jeda pesanan app</Button>}
      </div>
    </Card>
  )
}

function OrderingForm({ cafeId, settings, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const initial = Object.fromEntries(KEYS.map((key) => [key, settings[key]]))
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dirty = KEYS.some((key) => String(form[key]) !== String(initial[key]))
  const set = (key) => (value) => { setForm((current) => ({ ...current, [key]: value })); setError('') }

  async function submit(event) {
    event.preventDefault()
    const base = Number(form.prep_minutes_base)
    const perOrder = Number(form.prep_minutes_per_order)
    if (!Number.isInteger(base) || base < 0 || base > 180) return setError('Waktu dasar 0–180 menit')
    if (!Number.isInteger(perOrder) || perOrder < 0 || perOrder > 60) return setError('Tambahan per pesanan 0–60 menit')
    setSaving(true)
    const { error: saveError } = await supabase.from('cafe_settings')
      .update({ ...form, prep_minutes_base: base, prep_minutes_per_order: perOrder }).eq('cafe_id', cafeId).select('cafe_id').maybeSingle()
    setSaving(false)
    if (saveError) return setError(friendlyError(saveError))
    toast({ tone: 'success', title: 'Pengaturan pesanan app disimpan' })
    onSaved()
    return undefined
  }

  const example = Number(form.prep_minutes_base || 0) + Number(form.prep_minutes_per_order || 0) * 3
  return (
    <Card as="form" className="settings-card" onSubmit={submit} noValidate>
      <CardHeader title="Aturan pesanan" description="Berlaku untuk pesanan dari aplikasi pelanggan dan QR meja." />
      <div className="settings-fields">
        <div className="inv-switch-line settings-span">
          <span><strong>Pesanan terjadwal</strong><small>Pelanggan bisa memilih jam ambil (15 menit–7 hari ke depan), juga saat kafe sedang tutup.</small></span>
          <Switch checked={form.scheduled_orders_enabled} onChange={set('scheduled_orders_enabled')} label="Pesanan terjadwal" onLabel="Aktif" offLabel="Nonaktif" />
        </div>
        <div className="inv-switch-line settings-span">
          <span><strong>Pesan lewat QR meja</strong><small>Matikan bila sedang tidak melayani pesanan dari meja.</small></span>
          <Switch checked={form.qr_ordering_enabled} onChange={set('qr_ordering_enabled')} label="Pesan lewat QR meja" onLabel="Aktif" offLabel="Nonaktif" />
        </div>
        <TextField label="Waktu siap dasar" suffix="menit" inputMode="numeric" value={String(form.prep_minutes_base ?? '')}
          onChange={(event) => set('prep_minutes_base')(event.target.value.replace(/\D/g, ''))} />
        <TextField label="Tambahan per pesanan antre" suffix="menit" inputMode="numeric" value={String(form.prep_minutes_per_order ?? '')}
          onChange={(event) => set('prep_minutes_per_order')(event.target.value.replace(/\D/g, ''))} />
        <p className="ui-field-hint settings-span">Contoh: 3 pesanan sedang antre → pelanggan melihat perkiraan siap ±{example} menit.</p>
      </div>
      {error && <p className="ui-field-error" role="alert">{error}</p>}
      <SectionFooter dirty={dirty} saving={saving} onReset={() => setForm(initial)}>
        <Button type="submit" loading={saving} disabled={!dirty}>Simpan</Button>
      </SectionFooter>
    </Card>
  )
}
