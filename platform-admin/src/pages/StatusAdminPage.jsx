/*
 * Status sistem (file SQL 18): status layanan, insiden & pembaruannya. Tampil di halaman publik /status web owner
 * dan sebagai banner di dashboard owner/staff selama insiden belum selesai. Super & Support boleh mengubah.
 */
import { useCallback, useState } from 'react'
import { Activity, ExternalLink, Plus } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import {
  Badge, Button, Card, CardHeader, Dialog, EmptyState, ErrorState, PageHeader, Select, SkeletonRows, TextField, useToast,
} from '../components/ui/index.js'
import { optional, rpc, useLoader } from '../lib/api.js'
import { formatDateTime } from '../lib/format.js'
import { OWNER_APP_URL } from '../lib/impersonation.js'
import { can } from '../lib/roles.js'

const SERVICE_STATUS = {
  operational: { label: 'Normal', tone: 'green' },
  degraded: { label: 'Melambat', tone: 'amber' },
  partial_outage: { label: 'Gangguan sebagian', tone: 'amber' },
  major_outage: { label: 'Gangguan besar', tone: 'red' },
  maintenance: { label: 'Pemeliharaan', tone: 'blue' },
}
const INCIDENT_STATUS = {
  investigating: { label: 'Sedang dicek', tone: 'amber' },
  identified: { label: 'Penyebab ditemukan', tone: 'amber' },
  monitoring: { label: 'Dipantau', tone: 'blue' },
  resolved: { label: 'Selesai', tone: 'green' },
}
const IMPACT = { minor: 'Gangguan kecil', major: 'Gangguan besar', maintenance: 'Pemeliharaan' }
const SERVICE_OPTIONS = Object.entries(SERVICE_STATUS).map(([value, meta]) => ({ value, label: meta.label }))

export function StatusAdminPage() {
  const { admin } = useAuth()
  const { toast } = useToast()
  const load = useCallback(() => optional(rpc('pa_status_admin')), [])
  const { data, error, loading, reload } = useLoader(load)
  const [dialog, setDialog] = useState(null)
  const canEdit = can(admin, 'pa_incident_create')

  async function setService(service, status) {
    try {
      await rpc('pa_service_set_status', { p_service: service.key, p_status: status })
      toast({ title: `${service.name}: ${SERVICE_STATUS[status].label}` })
      reload()
    } catch (caught) {
      toast({ tone: 'danger', title: 'Status tidak diubah', description: caught.message })
    }
  }

  if (error) return <div className="page"><PageHeader title="Status sistem" /><ErrorState message={error} onRetry={reload} /></div>
  const active = (data?.incidents || []).filter((item) => item.status !== 'resolved')
  const history = (data?.incidents || []).filter((item) => item.status === 'resolved')
  return (
    <div className="page pa-stack">
      <PageHeader eyebrow="Layanan" title="Status sistem" description="Kabari semua kafe saat ada gangguan. Insiden aktif tampil sebagai banner di dashboard owner & staff."
        actions={<div className="pa-actions">
          {OWNER_APP_URL && <Button as="a" href={`${OWNER_APP_URL}/status`} target="_blank" rel="noreferrer" variant="secondary" icon={ExternalLink}>Halaman publik</Button>}
          {canEdit && data && <Button icon={Plus} onClick={() => setDialog({ type: 'create' })}>Insiden baru</Button>}
        </div>} />
      {loading && !data ? <Card><SkeletonRows rows={5} /></Card>
        : data === null ? <Card><EmptyState icon={Activity} title="Belum aktif" description="Halaman ini aktif setelah file SQL 18 dijalankan." /></Card>
          : (
            <>
              <Card>
                <CardHeader title="Layanan" description="Ubah manual, atau otomatis lewat insiden" />
                <ul className="status-admin-services">
                  {data.services.map((service) => (
                    <li key={service.key}>
                      <span className="pa-cell-main"><strong>{service.name}</strong><small>{service.description}</small></span>
                      {canEdit
                        ? <Select label={`Status ${service.name}`} hideLabel value={service.status} options={SERVICE_OPTIONS} onChange={(event) => setService(service, event.target.value)} />
                        : <Badge tone={SERVICE_STATUS[service.status]?.tone}>{SERVICE_STATUS[service.status]?.label}</Badge>}
                    </li>
                  ))}
                </ul>
              </Card>

              <Card>
                <CardHeader title="Insiden aktif" description={active.length ? `${active.length} belum selesai` : 'Tidak ada gangguan'} />
                {active.length === 0 ? <EmptyState compact icon={Activity} title="Semua normal" description="Buat insiden saat ada gangguan agar kafe tahu." />
                  : active.map((incident) => <IncidentItem key={incident.id} incident={incident} onUpdate={canEdit ? () => setDialog({ type: 'update', incident }) : null} />)}
              </Card>

              {history.length > 0 && (
                <Card>
                  <CardHeader title="Riwayat 90 hari" />
                  {history.map((incident) => <IncidentItem key={incident.id} incident={incident} />)}
                </Card>
              )}
            </>
          )}
      {dialog?.type === 'create' && <CreateDialog services={data.services} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload() }} />}
      {dialog?.type === 'update' && <UpdateDialog incident={dialog.incident} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload() }} />}
    </div>
  )
}

function IncidentItem({ incident, onUpdate }) {
  const meta = INCIDENT_STATUS[incident.status] || INCIDENT_STATUS.investigating
  return (
    <article className="status-admin-incident">
      <header>
        <span className="pa-cell-main">
          <strong>{incident.title}</strong>
          <small>{IMPACT[incident.impact]} · {incident.services.join(', ') || 'umum'} · mulai {formatDateTime(incident.started_at)}{incident.resolved_at ? ` · selesai ${formatDateTime(incident.resolved_at)}` : ''}</small>
        </span>
        <span className="pa-actions"><Badge tone={meta.tone}>{meta.label}</Badge>{onUpdate && <Button size="sm" variant="secondary" onClick={onUpdate}>Kirim pembaruan</Button>}</span>
      </header>
      <ol className="status-admin-updates">
        {incident.updates.map((update, index) => (
          <li key={`${update.created_at}-${index}`}><strong>{INCIDENT_STATUS[update.status]?.label}</strong> {update.body} <time dateTime={update.created_at}>{formatDateTime(update.created_at)}</time></li>
        ))}
      </ol>
    </article>
  )
}

function CreateDialog({ services, onClose, onDone }) {
  const { toast } = useToast()
  const [form, setForm] = useState({ title: '', impact: 'minor', services: [], body: '', service_status: 'degraded' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const toggle = (key) => setForm((current) => ({ ...current, services: current.services.includes(key) ? current.services.filter((item) => item !== key) : [...current.services, key] }))

  async function submit(event) {
    event.preventDefault()
    if (form.title.trim().length < 4) { setError('Judul minimal 4 karakter'); return }
    if (form.body.trim().length < 4) { setError('Tulis keterangan untuk kafe'); return }
    setBusy(true)
    try {
      await rpc('pa_incident_create', { p_title: form.title, p_impact: form.impact, p_services: form.services, p_body: form.body, p_service_status: form.services.length ? form.service_status : null })
      toast({ title: 'Insiden diumumkan', description: 'Banner tampil di dashboard owner & staff.' })
      onDone()
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
  }

  return (
    <Dialog title="Insiden baru" size="md" onClose={busy ? undefined : onClose} dismissible={!busy}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="incident-form" loading={busy}>Umumkan</Button></>}>
      <form id="incident-form" className="dialog-form" onSubmit={submit} noValidate>
        <TextField label="Judul" value={form.title} maxLength={120} placeholder="mis. Konfirmasi QRIS terlambat" onChange={(event) => { setForm({ ...form, title: event.target.value }); setError('') }} />
        <div className="fin-form-row">
          <Select label="Dampak" value={form.impact} onChange={(event) => setForm({ ...form, impact: event.target.value })}
            options={Object.entries(IMPACT).map(([value, label]) => ({ value, label }))} />
          <Select label="Status layanan terdampak" value={form.service_status} onChange={(event) => setForm({ ...form, service_status: event.target.value })} options={SERVICE_OPTIONS.filter((option) => option.value !== 'operational')} />
        </div>
        <fieldset className="pa-fieldset">
          <legend className="ui-field-label">Layanan terdampak</legend>
          {services.map((service) => (
            <label key={service.key} className="settings-check"><input type="checkbox" checked={form.services.includes(service.key)} onChange={() => toggle(service.key)} />{service.name}</label>
          ))}
        </fieldset>
        <TextField label="Keterangan untuk kafe" multiline rows={3} value={form.body} maxLength={1000} onChange={(event) => { setForm({ ...form, body: event.target.value }); setError('') }}
          hint="Tampil di banner & halaman status. Tulis apa yang terjadi dan apa yang perlu dilakukan kafe." />
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}

function UpdateDialog({ incident, onClose, onDone }) {
  const { toast } = useToast()
  const [status, setStatus] = useState(incident.status === 'investigating' ? 'identified' : 'resolved')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (body.trim().length < 4) { setError('Tulis pembaruan untuk kafe'); return }
    setBusy(true)
    try {
      await rpc('pa_incident_update', { p_incident: incident.id, p_status: status, p_body: body, p_service_status: null })
      toast({ title: status === 'resolved' ? 'Insiden selesai' : 'Pembaruan dikirim', description: status === 'resolved' ? 'Layanan terdampak kembali normal.' : undefined })
      onDone()
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
  }

  return (
    <Dialog title={`Pembaruan: ${incident.title}`} size="sm" onClose={busy ? undefined : onClose} dismissible={!busy}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="incident-update" loading={busy}>Kirim</Button></>}>
      <form id="incident-update" className="dialog-form" onSubmit={submit} noValidate>
        <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value)}
          options={['investigating', 'identified', 'monitoring', 'resolved'].map((value) => ({ value, label: INCIDENT_STATUS[value].label }))} />
        <TextField label="Pembaruan" multiline rows={3} value={body} maxLength={1000} onChange={(event) => { setBody(event.target.value); setError('') }} />
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}
