/*
 * Linimasa satu kafe (file 16): daftar, ganti paket, tagihan, bayar, chat WA, catatan internal, perubahan skor, tiket.
 * Catatan internal hanya terlihat admin (tabel cafe_notes tanpa akses owner).
 */
import { useState } from 'react'
import { Activity, CircleDollarSign, FilePlus2, LifeBuoy, MessageCircle, NotebookPen, PackageCheck, Send, ShieldCheck, Store } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, Card, CardHeader, EmptyState, TextField, useToast } from './ui/index.js'
import { ACTION_LABELS, HEALTH_META, rpc, TICKET_STATUS } from '../lib/api.js'
import { formatDateTime, formatRupiah } from '../lib/format.js'

const KIND = {
  signup: { icon: Store, tone: 'accent' },
  plan: { icon: PackageCheck, tone: 'info' },
  invoice: { icon: FilePlus2, tone: 'neutral' },
  payment: { icon: CircleDollarSign, tone: 'good' },
  whatsapp: { icon: MessageCircle, tone: 'good' },
  note: { icon: NotebookPen, tone: 'warn' },
  health: { icon: Activity, tone: 'warn' },
  ticket: { icon: LifeBuoy, tone: 'info' },
  admin: { icon: ShieldCheck, tone: 'neutral' },
}

function describe(item) {
  const after = item.detail?.after || {}
  switch (item.kind) {
    case 'note':
      return { title: 'Catatan internal', body: item.detail?.body }
    case 'health': {
      const from = HEALTH_META[item.detail?.prev_label]?.label || '—'
      const to = HEALTH_META[item.detail?.label]?.label || '—'
      return { title: `Kesehatan: ${from} → ${to}`, body: [`Skor ${item.detail?.score}`, ...(item.detail?.reasons || []).slice(0, 2)].join(' · ') }
    }
    case 'ticket':
      return { title: `Tiket ${item.detail?.number}: ${item.title}`, body: TICKET_STATUS[item.detail?.status]?.label, to: `/tiket/${item.detail?.id}` }
    case 'whatsapp':
      return { title: 'Chat WA dibuka', body: after.template ? `Template: ${after.template}` : null }
    case 'signup':
      return { title: 'Kafe terdaftar' }
    default:
      return {
        title: ACTION_LABELS[item.action] || item.action,
        body: [after.number, after.amount ? formatRupiah(after.amount) : null, after.plan_code ? `paket ${after.plan_code}` : null, item.detail?.note].filter(Boolean).join(' · ') || null,
      }
  }
}

export function TimelineCard({ cafeId, items, onChanged }) {
  const { toast } = useToast()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function addNote(event) {
    event.preventDefault()
    if (!body.trim()) return
    setBusy(true)
    setError('')
    try {
      await rpc('pa_cafe_note_add', { p_cafe: cafeId, p_body: body.trim() })
      setBody('')
      toast({ title: 'Catatan disimpan', description: 'Hanya terlihat oleh tim admin.' })
      onChanged()
    } catch (caught) {
      setError(caught.message)
    }
    setBusy(false)
  }

  return (
    <Card className="timeline-card">
      <CardHeader title="Linimasa" description="Semua kejadian penting kafe ini, terbaru di atas" />
      <form className="timeline-note" onSubmit={addNote}>
        <TextField label="Catatan internal" hint="Hanya terlihat oleh admin platform, tidak oleh owner." multiline rows={2} maxLength={2000}
          placeholder="mis. Owner minta dihubungi sore hari" value={body} onChange={(event) => setBody(event.target.value)} error={error || undefined} />
        <Button type="submit" size="sm" icon={Send} loading={busy} disabled={!body.trim()}>Simpan catatan</Button>
      </form>
      {items === null ? (
        <EmptyState compact title="Belum aktif" description="Linimasa muncul setelah file SQL 16 dijalankan." />
      ) : items.length === 0 ? (
        <EmptyState compact title="Belum ada kejadian" />
      ) : (
        <ol className="timeline">
          {items.map((item, index) => {
            const meta = KIND[item.kind] || KIND.admin
            const Icon = meta.icon
            const text = describe(item)
            return (
              <li key={`${item.at}-${index}`} className={`timeline-item is-${meta.tone}`}>
                <span className="timeline-icon" aria-hidden="true"><Icon size={14} /></span>
                <span className="timeline-text">
                  {text.to ? <Link to={text.to}><strong>{text.title}</strong></Link> : <strong>{text.title}</strong>}
                  {text.body && <span className={item.kind === 'note' ? 'timeline-note-body' : ''}>{text.body}</span>}
                  <small className="tabular">{formatDateTime(item.at)}{item.actor ? ` · ${item.actor}` : ''}</small>
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}
