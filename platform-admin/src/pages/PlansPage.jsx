import { useCallback, useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { Badge, Button, Card, Dialog, ErrorState, IconButton, PageHeader, RupiahInput, SkeletonRows, Switch, TextField, useToast } from '../components/ui/index.js'
import { FEATURES, LIMITS, rpc, useLoader } from '../lib/api.js'
import { formatNumber, formatRupiah } from '../lib/format.js'

function PlanDialog({ plan, onClose, onDone }) {
  const { toast } = useToast()
  const editing = Boolean(plan)
  const [form, setForm] = useState(() => ({
    code: plan?.code || '',
    name: plan?.name || '',
    description: plan?.description || '',
    price: plan?.price_monthly ?? '',
    limits: Object.fromEntries(LIMITS.map((item) => [item.key, plan?.limits?.[item.key] ?? ''])),
    features: plan?.features || [],
    is_public: plan?.is_public ?? true,
    is_archived: plan?.is_archived ?? false,
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  function toggleFeature(key) {
    set('features', form.features.includes(key) ? form.features.filter((item) => item !== key) : [...form.features, key])
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const limits = Object.fromEntries(Object.entries(form.limits).filter(([, value]) => value !== '' && value !== null).map(([key, value]) => [key, Number(value)]))
      await rpc('pa_plan_upsert', {
        p_code: form.code, p_name: form.name, p_description: form.description || null, p_price_monthly: form.price === '' ? null : form.price,
        p_limits: limits, p_features: form.features, p_is_public: form.is_public, p_is_archived: form.is_archived, p_sort_order: plan?.sort_order ?? null,
      })
      toast({ title: editing ? 'Paket disimpan' : 'Paket dibuat' })
      onDone()
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
  }

  return (
    <Dialog title={editing ? `Ubah paket ${plan.name}` : 'Paket baru'} onClose={busy ? undefined : onClose}
      description={editing && plan.cafes ? `Dipakai ${formatNumber(plan.cafes)} kafe. Perubahan batas & modul langsung berlaku untuk mereka.` : undefined}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="plan-form" loading={busy}>Simpan</Button></>}>
      <form id="plan-form" className="dialog-form" onSubmit={submit}>
        <div className="dialog-row">
          <TextField label="Kode" required disabled={editing} value={form.code} maxLength={30} pattern="[a-z0-9_-]{2,30}"
            hint={editing ? 'Kode tidak bisa diubah' : 'huruf kecil, angka, - atau _'} onChange={(event) => set('code', event.target.value.toLowerCase())} />
          <TextField label="Nama" required value={form.name} maxLength={60} onChange={(event) => set('name', event.target.value)} />
        </div>
        <TextField label="Deskripsi" value={form.description} maxLength={200} onChange={(event) => set('description', event.target.value)} />
        <RupiahInput label="Harga / bulan" value={form.price} onChange={(value) => set('price', value)} hint="Kosong = tidak dijual sendiri (hubungi Dailybrew)" />
        <fieldset className="pa-fieldset">
          <legend className="ui-field-label">Batas (kosong = tanpa batas)</legend>
          <div className="dialog-row">
            {LIMITS.map((item) => (
              <TextField key={item.key} label={item.label} type="number" min={1} value={form.limits[item.key]}
                onChange={(event) => set('limits', { ...form.limits, [item.key]: event.target.value })} />
            ))}
          </div>
        </fieldset>
        <fieldset className="pa-fieldset">
          <legend className="ui-field-label">Modul</legend>
          <div className="pa-features">
            {FEATURES.map((item) => (
              <label key={item.key} className="settings-check">
                <input type="checkbox" checked={form.features.includes(item.key)} onChange={() => toggleFeature(item.key)} />
                {item.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="pa-actions">
          <Switch label="Tampil di pilihan paket owner" checked={form.is_public} onChange={(value) => set('is_public', value)} onLabel="Publik" offLabel="Tersembunyi" />
          <Switch label="Arsipkan paket" checked={form.is_archived} onChange={(value) => set('is_archived', value)} onLabel="Diarsipkan" offLabel="Aktif" disabled={form.code === 'basic'} />
        </div>
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}

export function PlansPage() {
  const load = useCallback(() => rpc('pa_plans_list'), [])
  const { data: plans, error, loading, reload } = useLoader(load)
  const [editing, setEditing] = useState(null)

  return (
    <div className="page">
      <PageHeader eyebrow="Dailybrew" title="Paket" description="Harga, batas, dan modul tiap paket. Basic adalah paket cadangan saat langganan habis."
        actions={<Button icon={Plus} onClick={() => setEditing({})}>Paket baru</Button>} />
      <Card padding="none">
        {error ? <ErrorState message={error} onRetry={reload} /> : loading && !plans ? <SkeletonRows rows={3} /> : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Paket</th>
                  <th scope="col" className="num">Harga / bln</th>
                  {LIMITS.map((item) => <th key={item.key} scope="col" className="num">{item.label}</th>)}
                  <th scope="col">Modul</th>
                  <th scope="col" className="num">Kafe</th>
                  <th scope="col" className="cell-actions"><span className="sr-only">Aksi</span></th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.code}>
                    <td>
                      <span className="pa-cell-main">
                        <strong>{plan.name} <small className="pa-muted">{plan.code}</small></strong>
                        <small>{plan.description || '—'}</small>
                      </span>
                      <span className="pa-actions">
                        {!plan.is_public && <Badge tone="neutral" size="sm">Tersembunyi</Badge>}
                        {plan.is_archived && <Badge tone="amber" size="sm">Diarsipkan</Badge>}
                      </span>
                    </td>
                    <td className="num tabular">{plan.price_monthly ? formatRupiah(plan.price_monthly) : '—'}</td>
                    {LIMITS.map((item) => <td key={item.key} className="num tabular">{plan.limits?.[item.key] ? formatNumber(plan.limits[item.key]) : '∞'}</td>)}
                    <td>{plan.features?.length ? FEATURES.filter((item) => plan.features.includes(item.key)).map((item) => item.label).join(', ') : 'Dasar'}</td>
                    <td className="num tabular">{formatNumber(plan.cafes)}</td>
                    <td className="cell-actions"><IconButton icon={Pencil} label={`Ubah paket ${plan.name}`} size="sm" onClick={() => setEditing(plan)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <PlanDialog plan={editing.code ? editing : null} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload() }} />}
    </div>
  )
}
