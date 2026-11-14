/*
 * Feature flag (file SQL 18): ringkasan per fitur, uji coba massal ke beberapa kafe, tambah fitur beta.
 * Riwayat perubahan ada di Log audit (aksi "Flag fitur diubah").
 */
import { useCallback, useMemo, useState } from 'react'
import { Flag, Plus, Rocket } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import {
  Badge, Button, Card, CardHeader, Dialog, EmptyState, ErrorState, PageHeader, SearchInput, Select, SkeletonRows, TextField, useToast,
} from '../components/ui/index.js'
import { optional, rpc, useLoader } from '../lib/api.js'
import { formatDate, formatNumber } from '../lib/format.js'
import { can } from '../lib/roles.js'

export function FlagsPage() {
  const { admin } = useAuth()
  const load = useCallback(() => optional(rpc('pa_flags_overview')), [])
  const { data, error, loading, reload } = useLoader(load)
  const [dialog, setDialog] = useState(null)
  const canEdit = can(admin, 'pa_flag_set')

  if (error) return <div className="page"><PageHeader title="Feature flag" /><ErrorState message={error} onRetry={reload} /></div>
  return (
    <div className="page pa-stack">
      <PageHeader eyebrow="Kelola" title="Feature flag" description="Nyalakan fitur untuk kafe tertentu di luar paketnya, mis. uji coba fitur baru ke 5 kafe."
        actions={canEdit && data ? <div className="pa-actions">
          <Button variant="secondary" icon={Plus} onClick={() => setDialog({ type: 'feature' })}>Fitur beta</Button>
          <Button icon={Rocket} onClick={() => setDialog({ type: 'bulk' })}>Uji coba ke kafe</Button>
        </div> : null} />
      {loading && !data ? <Card><SkeletonRows rows={6} /></Card>
        : data === null ? <Card><EmptyState icon={Flag} title="Belum aktif" description="Halaman ini aktif setelah file SQL 18 dijalankan." /></Card>
          : (
            <div className="flag-grid">
              {data.map((feature) => (
                <Card key={feature.key}>
                  <CardHeader title={feature.label} description={feature.description || (feature.kind === 'beta' ? 'Fitur beta' : 'Modul paket')}
                    actions={feature.kind === 'beta' ? <Badge tone="blue">Beta</Badge> : <Badge tone="neutral">Modul</Badge>} />
                  <p className="flag-counts"><strong className="tabular">{formatNumber(feature.on_count)}</strong> kafe dinyalakan · <strong className="tabular">{formatNumber(feature.off_count)}</strong> dimatikan</p>
                  {feature.cafes.length > 0 && (
                    <ul className="flag-cafes">
                      {feature.cafes.slice(0, 8).map((cafe) => (
                        <li key={cafe.cafe_id}>
                          <Link to={`/kafe/${cafe.cafe_id}`} className="link-button">{cafe.name}</Link>
                          <span>{cafe.enabled ? <Badge tone="green" size="sm">Nyala</Badge> : <Badge tone="red" size="sm">Mati</Badge>}{cafe.expires_at ? <small>s.d. {formatDate(cafe.expires_at)}</small> : null}</span>
                        </li>
                      ))}
                      {feature.cafes.length > 8 && <li><small>+{formatNumber(feature.cafes.length - 8)} kafe lain</small></li>}
                    </ul>
                  )}
                  {canEdit && <Button size="sm" variant="ghost" icon={Rocket} onClick={() => setDialog({ type: 'bulk', feature: feature.key })}>Atur kafe</Button>}
                </Card>
              ))}
            </div>
          )}
      {dialog?.type === 'bulk' && <BulkDialog features={data} initialFeature={dialog.feature} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload() }} />}
      {dialog?.type === 'feature' && <FeatureDialog onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload() }} />}
    </div>
  )
}

function BulkDialog({ features, initialFeature, onClose, onDone }) {
  const { toast } = useToast()
  const [feature, setFeature] = useState(initialFeature || features[0]?.key || '')
  const [mode, setMode] = useState('on')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState([])
  const [until, setUntil] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => rpc('pa_cafes_list', { p_limit: 200, p_offset: 0 }), [])
  const { data } = useLoader(load)
  const cafes = useMemo(() => (data?.rows || []).filter((cafe) => !search || cafe.name.toLowerCase().includes(search.toLowerCase())), [data, search])
  const toggle = (id) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))

  async function submit(event) {
    event.preventDefault()
    if (!selected.length) { setError('Pilih minimal satu kafe'); return }
    setBusy(true)
    setError('')
    try {
      const count = await rpc('pa_flag_bulk', {
        p_feature: feature, p_cafe_ids: selected, p_enabled: mode === 'plan' ? null : mode === 'on', p_note: note || null,
        p_expires_at: until ? `${until}T23:59:59+07:00` : null,
      })
      toast({ title: 'Flag disimpan', description: `${formatNumber(count)} kafe diperbarui.` })
      onDone()
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
  }

  return (
    <Dialog title="Atur flag untuk beberapa kafe" size="md" onClose={busy ? undefined : onClose} dismissible={!busy}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="bulk-form" loading={busy}>Simpan untuk {formatNumber(selected.length)} kafe</Button></>}>
      <form id="bulk-form" className="dialog-form" onSubmit={submit} noValidate>
        <div className="fin-form-row">
          <Select label="Fitur" value={feature} onChange={(event) => setFeature(event.target.value)} options={features.map((item) => ({ value: item.key, label: item.label }))} />
          <Select label="Jadikan" value={mode} onChange={(event) => setMode(event.target.value)}
            options={[{ value: 'on', label: 'Nyala' }, { value: 'off', label: 'Mati' }, { value: 'plan', label: 'Ikuti paket (hapus flag)' }]} />
        </div>
        <div className="fin-form-row">
          <TextField label="Berlaku sampai (opsional)" type="date" value={until} onChange={(event) => setUntil(event.target.value)} hint="Kosong = sampai diubah lagi" />
          <TextField label="Catatan (opsional)" value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} />
        </div>
        <SearchInput value={search} onChange={setSearch} placeholder="Cari kafe…" label="Cari kafe" />
        <ul className="flag-pick" aria-label="Pilih kafe">
          {cafes.map((cafe) => (
            <li key={cafe.cafe_id}>
              <label className="settings-check"><input type="checkbox" checked={selected.includes(cafe.cafe_id)} onChange={() => toggle(cafe.cafe_id)} />{cafe.name}<small>{cafe.plan_name || '—'}</small></label>
            </li>
          ))}
          {data && cafes.length === 0 && <li><small>Tidak ada kafe cocok</small></li>}
        </ul>
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}

function FeatureDialog({ onClose, onDone }) {
  const { toast } = useToast()
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(key)) { setError('Kunci 2–40 karakter: huruf kecil, angka, garis bawah (mis. kasir_baru)'); return }
    if (label.trim().length < 2) { setError('Isi nama fitur'); return }
    setBusy(true)
    try {
      await rpc('pa_feature_upsert', { p_key: key, p_label: label, p_description: description || null })
      toast({ title: 'Fitur beta ditambahkan', description: `Web owner membaca flag "${key}".` })
      onDone()
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
  }

  return (
    <Dialog title="Fitur beta baru" size="sm" onClose={busy ? undefined : onClose} dismissible={!busy}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="feature-form" loading={busy}>Tambah</Button></>}>
      <form id="feature-form" className="dialog-form" onSubmit={submit} noValidate>
        <TextField label="Kunci" value={key} maxLength={40} hint="Dipakai kode web owner: flags.kunci" onChange={(event) => { setKey(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_')); setError('') }} />
        <TextField label="Nama" value={label} maxLength={60} onChange={(event) => { setLabel(event.target.value); setError('') }} />
        <TextField label="Keterangan (opsional)" value={description} maxLength={200} onChange={(event) => setDescription(event.target.value)} />
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}
