/*
 * Menu "Bantuan Dailybrew" (owner): buat tiket ke tim Dailybrew dan lihat balasannya.
 * Berbeda dengan menu "Bantuan" pelanggan (/support) yang berisi tiket customer ke kafe.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ImagePlus, LifeBuoy, MessageSquarePlus, Send, X } from 'lucide-react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth.js'
import { ContactDailybrew } from '../../components/platform/ContactDailybrew.jsx'
import {
  Badge, Button, Card, CardHeader, Drawer, EmptyState, ErrorState, IconButton, PageHeader, Select, SkeletonRows, TextField, useToast,
} from '../../components/ui/index.js'
import {
  CATEGORY_LABEL, createTicket, fetchTicket, fetchTickets, MAX_ATTACHMENTS, replyTicket, signedAttachmentUrl, STATUS_META, TICKET_CATEGORIES, validateAttachments,
} from '../../lib/dailybrewSupport.js'
import { formatDateTime, formatRelative } from '../../lib/format.js'

/** Pemilih gambar (maks 3) dengan pratinjau kecil. */
function AttachmentPicker({ files, onChange, error, disabled }) {
  const inputRef = useRef(null)
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files])
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews])
  return (
    <div className="hp-attach">
      <div className="hp-attach-row">
        {previews.map((url, index) => (
          <span key={url} className="hp-thumb">
            <img src={url} alt={`Lampiran ${index + 1}`} />
            <IconButton icon={X} size="sm" label={`Hapus lampiran ${index + 1}`} tooltip={false} disabled={disabled}
              onClick={() => onChange(files.filter((_, position) => position !== index))} />
          </span>
        ))}
        {files.length < MAX_ATTACHMENTS && (
          <Button variant="secondary" size="sm" icon={ImagePlus} disabled={disabled} onClick={() => inputRef.current?.click()}>Tambah gambar</Button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
        onChange={(event) => { onChange([...files, ...Array.from(event.target.files || [])]); event.target.value = '' }} />
      {error ? <p className="ui-field-error" role="alert">{error}</p> : <p className="ui-field-hint">Opsional. Maksimal {MAX_ATTACHMENTS} gambar (JPG, PNG, WebP), 5 MB per gambar. Hanya terlihat oleh Anda dan tim Dailybrew.</p>}
    </div>
  )
}

function NewTicketDrawer({ cafe, onClose, onCreated }) {
  const { supabase } = useAuth()
  const [form, setForm] = useState({ category: '', title: '', body: '' })
  const [files, setFiles] = useState([])
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  async function submit(event) {
    event.preventDefault()
    const next = {}
    if (!form.category) next.category = 'Pilih kategori.'
    if (form.title.trim().length < 3) next.title = 'Judul minimal 3 karakter.'
    if (!form.body.trim()) next.body = 'Ceritakan kendalanya.'
    const fileError = validateAttachments(files)
    if (fileError) next.files = fileError
    setErrors(next)
    if (Object.keys(next).length) return
    setSaving(true)
    try {
      const ticket = await createTicket(supabase, { cafeId: cafe.id, ...form, files })
      onCreated(ticket)
    } catch (caught) {
      setErrors({ form: caught.message })
      setSaving(false)
    }
  }

  return (
    <Drawer title="Tiket baru" description="Tim Dailybrew membalas di sini. Anda juga mendapat notifikasi saat dibalas." onClose={saving ? undefined : onClose} dismissible={!saving}
      footer={<><Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button><Button type="submit" form="new-ticket" icon={Send} loading={saving}>Kirim tiket</Button></>}>
      <form id="new-ticket" className="dialog-form" onSubmit={submit} noValidate>
        <Select label="Kategori" value={form.category} onChange={set('category')} error={errors.category}
          options={[{ value: '', label: 'Pilih kategori…' }, ...TICKET_CATEGORIES]} />
        <TextField label="Judul" placeholder="mis. Struk tidak mencetak logo" maxLength={120} value={form.title} onChange={set('title')} error={errors.title} />
        <TextField label="Ceritakan kendalanya" multiline rows={6} maxLength={4000} value={form.body} onChange={set('body')} error={errors.body}
          placeholder="Apa yang terjadi, kapan, dan apa yang sudah dicoba." />
        <AttachmentPicker files={files} onChange={setFiles} error={errors.files} disabled={saving} />
        {errors.form && <p className="form-error-box" role="alert">{errors.form}</p>}
      </form>
    </Drawer>
  )
}

export function DailybrewHelpPage() {
  const { cafe } = useOutletContext()
  const { supabase } = useAuth()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [state, setState] = useState({ tickets: undefined, error: '' })
  const [attempt, setAttempt] = useState(0)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let active = true
    fetchTickets(supabase, cafe.id)
      .then((tickets) => { if (active) setState({ tickets, error: '' }) })
      .catch((error) => { if (active) setState({ tickets: undefined, error: error.message }) })
    return () => { active = false }
  }, [attempt, cafe.id, supabase])

  const { tickets, error } = state
  const open = tickets?.filter((ticket) => ticket.status !== 'resolved') || []
  const done = tickets?.filter((ticket) => ticket.status === 'resolved') || []

  return (
    <div className="page page-narrow">
      <PageHeader eyebrow="Bisnis" title="Bantuan Dailybrew" description="Tanya atau laporkan kendala ke tim Dailybrew. Semua percakapan tersimpan di sini."
        actions={tickets !== null && <Button icon={MessageSquarePlus} onClick={() => setCreating(true)} disabled={tickets === undefined}>Tiket baru</Button>} />

      {error ? (
        <Card><ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /></Card>
      ) : tickets === undefined ? (
        <Card padding="none"><SkeletonRows rows={4} label="Memuat tiket" /></Card>
      ) : tickets === null ? (
        <Card>
          <EmptyState icon={LifeBuoy} title="Tiket bantuan belum aktif" description="Sementara itu, hubungi tim Dailybrew lewat WhatsApp."
            action={<ContactDailybrew cafe={cafe} topic="Bantuan" />} />
        </Card>
      ) : tickets.length === 0 ? (
        <Card>
          <EmptyState icon={LifeBuoy} title="Belum ada tiket" description="Ada kendala atau pertanyaan? Kirim tiket, tim Dailybrew membalas di sini."
            action={<Button icon={MessageSquarePlus} onClick={() => setCreating(true)}>Buat tiket pertama</Button>} />
        </Card>
      ) : (
        <div className="settings-stack">
          {[['Sedang berjalan', open], ['Selesai', done]].map(([label, rows]) => rows.length > 0 && (
            <Card key={label} padding="none">
              <div className="table-card-head"><CardHeader title={label} /></div>
              <ul className="hp-list">
                {rows.map((ticket) => {
                  const meta = STATUS_META[ticket.status] || STATUS_META.new
                  return (
                    <li key={ticket.id}>
                      <Link to={ticket.id} className={`hp-row${ticket.owner_unread ? ' is-unread' : ''}`}>
                        <span className="hp-row-main">
                          <strong>{ticket.owner_unread && <span className="hp-dot" aria-label="Ada balasan baru" />}{ticket.title}</strong>
                          <small>{ticket.number} · {CATEGORY_LABEL[ticket.category] || ticket.category} · {ticket.last_message}</small>
                        </span>
                        <span className="hp-row-side">
                          <Badge tone={meta.tone}>{ticket.owner_unread ? 'Dibalas' : meta.label}</Badge>
                          <small className="tabular">{formatRelative(ticket.last_message_at)}</small>
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <NewTicketDrawer cafe={cafe} onClose={() => setCreating(false)} onCreated={(ticket) => {
          setCreating(false)
          toast({ title: `Tiket ${ticket.number} terkirim`, description: 'Kami kabari saat tim Dailybrew membalas.' })
          navigate(ticket.id)
        }} />
      )}
    </div>
  )
}

function Attachment({ path }) {
  const { supabase } = useAuth()
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let active = true
    signedAttachmentUrl(supabase, path).then((value) => { if (active) setUrl(value) })
    return () => { active = false }
  }, [path, supabase])
  return url
    ? <a className="hp-thumb is-link" href={url} target="_blank" rel="noreferrer"><img src={url} alt="Lampiran" loading="lazy" /></a>
    : <span className="hp-thumb is-missing">Gambar</span>
}

export function DailybrewTicketPage() {
  const { cafe } = useOutletContext()
  const { ticketId } = useParams()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [state, setState] = useState({ data: null, error: '' })
  const [attempt, setAttempt] = useState(0)
  const [body, setBody] = useState('')
  const [files, setFiles] = useState([])
  const [replyError, setReplyError] = useState('')
  const [sending, setSending] = useState(false)
  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    let active = true
    fetchTicket(supabase, ticketId)
      .then((data) => { if (active) setState({ data, error: '' }) })
      .catch((error) => { if (active) setState({ data: null, error: error.message }) })
    return () => { active = false }
  }, [attempt, supabase, ticketId])

  async function send(event) {
    event.preventDefault()
    if (!body.trim()) return
    const fileError = validateAttachments(files)
    if (fileError) { setReplyError(fileError); return }
    setSending(true)
    setReplyError('')
    try {
      await replyTicket(supabase, { cafeId: cafe.id, ticketId, body, files })
      setBody('')
      setFiles([])
      toast({ title: 'Balasan terkirim' })
      reload()
    } catch (caught) {
      setReplyError(caught.message)
    }
    setSending(false)
  }

  const { data, error } = state
  const back = <Button as={Link} to=".." relative="path" variant="ghost" size="sm" icon={ArrowLeft}>Semua tiket</Button>
  if (error) return <div className="page page-narrow">{back}<Card><ErrorState message={error} onRetry={reload} /></Card></div>
  if (!data) return <div className="page page-narrow">{back}<Card padding="none"><SkeletonRows rows={4} label="Memuat tiket" /></Card></div>

  const { ticket, messages } = data
  const meta = STATUS_META[ticket.status] || STATUS_META.new
  return (
    <div className="page page-narrow">
      {back}
      <PageHeader eyebrow={`${ticket.number} · ${CATEGORY_LABEL[ticket.category] || ticket.category}`} title={ticket.title}>
        <div className="hp-meta"><Badge tone={meta.tone}>{meta.label}</Badge><span>Dibuat {formatDateTime(ticket.created_at)}</span></div>
      </PageHeader>
      <Card>
        <ol className="hp-thread">
          {messages.map((message) => (
            <li key={message.id} className={`hp-message is-${message.author_role}`}>
              <span className="hp-message-head"><strong>{message.author_role === 'admin' ? `${message.author_name} · Dailybrew` : 'Anda'}</strong><small className="tabular">{formatDateTime(message.created_at)}</small></span>
              <p>{message.body}</p>
              {message.attachments?.length > 0 && <span className="hp-attach-row">{message.attachments.map((path) => <Attachment key={path} path={path} />)}</span>}
            </li>
          ))}
        </ol>
        <form className="hp-reply" onSubmit={send}>
          <TextField label={ticket.status === 'resolved' ? 'Masih ada kendala? Balas untuk membuka lagi' : 'Balas'} multiline rows={3} maxLength={4000}
            value={body} onChange={(event) => setBody(event.target.value)} placeholder="Tulis balasan…" />
          <AttachmentPicker files={files} onChange={setFiles} error={replyError} disabled={sending} />
          <Button type="submit" icon={Send} loading={sending} disabled={!body.trim()}>Kirim balasan</Button>
        </form>
      </Card>
    </div>
  )
}
