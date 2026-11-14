/*
 * Detail tiket bantuan (file 16): utas pesan, balas (atau balas & selesaikan), ubah status/prioritas/penanggung jawab.
 * Setiap aksi tercatat di log audit (pa_ticket_reply / pa_ticket_update).
 */
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, Send } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { useCrumbs } from '../components/shell/crumbs.js'
import { WhatsAppButton } from '../components/WhatsAppButton.jsx'
import { Badge, Button, Card, CardHeader, ErrorState, PageHeader, Select, SkeletonRows, TextField, useToast } from '../components/ui/index.js'
import { rpc, STATE_META, TICKET_CATEGORY, TICKET_PRIORITY, TICKET_STATUS, useLoader } from '../lib/api.js'
import { formatDateTime } from '../lib/format.js'
import { supabase } from '../lib/supabase.js'

const BUCKET = 'support-attachments'

/** Lampiran ada di bucket privat → URL bertanda tangan 10 menit. */
function Attachment({ path }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let active = true
    supabase?.storage?.from(BUCKET).createSignedUrl(path, 600).then(({ data }) => { if (active) setUrl(data?.signedUrl || null) })
    return () => { active = false }
  }, [path])
  const name = path.split('/').pop()
  return url ? (
    <a className="tk-attachment" href={url} target="_blank" rel="noreferrer" aria-label={`Buka lampiran ${name}`}>
      <img src={url} alt={`Lampiran ${name}`} loading="lazy" />
    </a>
  ) : <span className="tk-attachment is-missing">{name}</span>
}

export function TicketDetailPage() {
  const { ticketId } = useParams()
  const { toast } = useToast()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => rpc('pa_ticket_detail', { p_ticket: ticketId }), [ticketId])
  const { data, error: loadError, loading, reload } = useLoader(load)
  useCrumbs(data ? [{ label: data.ticket.number }] : [{ label: 'Detail' }])

  if (loadError) return <div className="page"><PageHeader title="Tiket" /><ErrorState message={loadError} onRetry={reload} /></div>
  if (loading && !data) return <div className="page"><PageHeader title="Memuat…" /><Card><SkeletonRows rows={5} /></Card></div>

  const { ticket, messages, cafe, admins } = data
  const statusMeta = TICKET_STATUS[ticket.status] || TICKET_STATUS.new

  async function reply(resolve) {
    if (!body.trim()) return
    setBusy(resolve ? 'resolve' : 'reply')
    setError('')
    try {
      await rpc('pa_ticket_reply', { p_ticket: ticket.id, p_body: body.trim(), p_attachments: [], p_resolve: resolve })
      setBody('')
      toast({ title: resolve ? 'Dibalas & diselesaikan' : 'Balasan terkirim', description: 'Owner mendapat notifikasi di dashboard.' })
      reload()
    } catch (caught) {
      setError(caught.message)
    }
    setBusy(null)
  }

  async function update(patch, label) {
    setBusy(label)
    try {
      await rpc('pa_ticket_update', { p_ticket: ticket.id, p_status: null, p_priority: null, p_assigned_to: null, p_unassign: false, ...patch })
      toast({ title: 'Tiket diperbarui' })
      reload()
    } catch (caught) {
      toast({ tone: 'error', title: 'Gagal memperbarui', description: caught.message })
    }
    setBusy(null)
  }

  const cafeMeta = STATE_META[cafe?.state] || STATE_META.active
  return (
    <div className="page page-wide pa-stack">
      <PageHeader eyebrow={`${ticket.number} · ${TICKET_CATEGORY[ticket.category] || ticket.category}`} title={ticket.title}>
        <div className="pa-actions"><Badge tone={statusMeta.tone}>{statusMeta.label}</Badge><span className="pa-muted">Dibuat {formatDateTime(ticket.created_at)}</span></div>
      </PageHeader>

      <div className="tk-layout">
        <Card className="tk-thread">
          <ol className="tk-messages">
            {messages.map((message) => (
              <li key={message.id} className={`tk-message is-${message.author_role}`}>
                <span className="tk-message-head"><strong>{message.author_name}</strong><small className="tabular">{formatDateTime(message.created_at)}</small></span>
                <p>{message.body}</p>
                {message.attachments?.length > 0 && <span className="tk-attachments">{message.attachments.map((path) => <Attachment key={path} path={path} />)}</span>}
              </li>
            ))}
          </ol>
          <form className="tk-reply" onSubmit={(event) => { event.preventDefault(); reply(false) }}>
            <TextField label="Balas owner" multiline rows={4} maxLength={4000} value={body} onChange={(event) => setBody(event.target.value)}
              placeholder="Tulis balasan yang ramah dan jelas…" error={error || undefined} />
            <div className="pa-actions">
              <Button type="submit" icon={Send} loading={busy === 'reply'} disabled={!body.trim() || Boolean(busy)}>Kirim balasan</Button>
              {ticket.status !== 'resolved' && (
                <Button variant="secondary" icon={CheckCircle2} loading={busy === 'resolve'} disabled={!body.trim() || Boolean(busy)} onClick={() => reply(true)}>Kirim & selesaikan</Button>
              )}
            </div>
          </form>
        </Card>

        <div className="tk-side">
          <Card>
            <CardHeader title="Penanganan" />
            <div className="dialog-form">
              <Select label="Status" value={ticket.status} disabled={Boolean(busy)}
                options={Object.entries(TICKET_STATUS).map(([value, meta]) => ({ value, label: meta.label }))}
                onChange={(event) => update({ p_status: event.target.value }, 'status')} />
              <Select label="Prioritas" value={ticket.priority} disabled={Boolean(busy)}
                options={Object.entries(TICKET_PRIORITY).map(([value, meta]) => ({ value, label: meta.label }))}
                onChange={(event) => update({ p_priority: event.target.value }, 'priority')} />
              <Select label="Ditangani oleh" value={ticket.assigned_to || ''} disabled={Boolean(busy)}
                options={[{ value: '', label: 'Belum ditugaskan' }, ...admins.map((admin) => ({ value: admin.user_id, label: admin.full_name || 'Admin' }))]}
                onChange={(event) => update(event.target.value ? { p_assigned_to: event.target.value } : { p_unassign: true }, 'assign')} />
              <dl className="fin-position">
                <div><dt>Respons pertama</dt><dd>{ticket.first_response_at ? formatDateTime(ticket.first_response_at) : 'Belum dibalas'}</dd></div>
                {ticket.resolved_at && <div><dt>Selesai</dt><dd>{formatDateTime(ticket.resolved_at)}</dd></div>}
              </dl>
            </div>
          </Card>
          {cafe && (
            <Card>
              <CardHeader title={cafe.name} description={cafe.plan_name ? `Paket ${cafe.plan_name}` : undefined}
                actions={<Badge tone={cafeMeta.tone}>{cafeMeta.label}</Badge>} />
              <dl className="fin-position">
                <div><dt>Owner</dt><dd>{cafe.owner_name || '—'}</dd></div>
                {cafe.owner_email && <div><dt>Email</dt><dd>{cafe.owner_email}</dd></div>}
              </dl>
              <div className="pa-actions pa-card-actions">
                <WhatsAppButton size="sm" ctx={{ cafeId: cafe.id, cafeName: cafe.name, ownerName: cafe.owner_name, phone: cafe.owner_whatsapp, planName: cafe.plan_name }} />
                <Button as={Link} to={`/kafe/${cafe.id}`} size="sm" variant="ghost" iconRight={ExternalLink}>Buka kafe</Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
