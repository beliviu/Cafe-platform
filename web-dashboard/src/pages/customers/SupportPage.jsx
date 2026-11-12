/*
 * Pelanggan → Bantuan (file 08): kotak masuk tiket dari aplikasi customer. Balasan kafe langsung
 * masuk notifikasi pelanggan. Staff juga bisa membalas (halaman yang sama di web staff).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { CheckCircle2, LifeBuoy, Send } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SegmentedControl, SkeletonRows, TextField, useToast } from '../../components/ui/index.js'
import { CUSTOMER_REQUIRED, friendlyError } from '../../lib/db.js'
import { formatDateTime, formatQueueNumber, formatRelative } from '../../lib/format.js'
import { useLoader } from '../../lib/inventory.js'
import { rpc } from '../../lib/pos.js'
import { useCan } from '../../lib/permissions.js'
import { ContactDailybrew } from '../../components/platform/ContactDailybrew.jsx'

const TICKET_STATUS = {
  open: { label: 'Perlu dibalas', tone: 'amber' },
  answered: { label: 'Dibalas', tone: 'green' },
  closed: { label: 'Selesai', tone: 'neutral' },
}

export function SupportPage() {
  const { cafe, features } = useOutletContext()
  return (
    <div className="page page-wide">
      <PageHeader eyebrow="Pelanggan" title="Bantuan" description="Pertanyaan & keluhan dari aplikasi pelanggan. Balas di sini — pelanggan mendapat notifikasi."
        actions={<ContactDailybrew cafe={cafe} topic="Saya butuh bantuan memakai dashboard Dailybrew." label="Bantuan dari Dailybrew" />} />
      {features?.customer ? <SupportInbox cafe={cafe} /> : <Card><EmptyState title="Belum tersedia" description={CUSTOMER_REQUIRED} /></Card>}
    </div>
  )
}

export function SupportInbox({ cafe }) {
  const { supabase } = useAuth()
  const [status, setStatus] = useState('open')
  const [selectedId, setSelectedId] = useState(null)
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('support_tickets').select('id, subject, status, order_id, last_message_at, created_at')
      .eq('cafe_id', cafe.id).order('last_message_at', { ascending: false }).limit(300)
    if (error) throw new Error(friendlyError(error))
    const orderIds = [...new Set((data || []).map((ticket) => ticket.order_id).filter(Boolean))]
    const orders = orderIds.length ? await supabase.from('orders').select('id, queue_number, order_number').in('id', orderIds) : { data: [] }
    return { tickets: data || [], orders: new Map((orders.data || []).map((order) => [order.id, order])) }
  }, [cafe.id, supabase])
  const { data, error, reload } = useLoader(load)

  useEffect(() => {
    const timer = setInterval(reload, 30000)
    return () => clearInterval(timer)
  }, [reload])

  const counts = useMemo(() => Object.fromEntries(['open', 'answered', 'closed'].map((key) => [key, (data?.tickets || []).filter((ticket) => ticket.status === key).length])), [data])
  const rows = (data?.tickets || []).filter((ticket) => status === 'all' || ticket.status === status)
  const selected = (data?.tickets || []).find((ticket) => ticket.id === selectedId) || null

  if (error) return <Card><ErrorState message={error} onRetry={reload} /></Card>
  return (
    <div className="inv-page">
      <section className="toolbar" aria-label="Filter tiket">
        <SegmentedControl label="Status" value={status} onChange={setStatus}
          options={[{ value: 'open', label: `Perlu dibalas (${counts.open ?? 0})` }, { value: 'answered', label: 'Dibalas' }, { value: 'closed', label: 'Selesai' }, { value: 'all', label: 'Semua' }]} />
      </section>
      <div className="sp-layout">
        <Card padding="none" className="sp-list">
          {!data ? <SkeletonRows rows={5} label="Memuat tiket" /> : !rows.length ? (
            <EmptyState icon={LifeBuoy} compact title={status === 'open' ? 'Tidak ada yang perlu dibalas' : 'Tidak ada tiket'} description="Tiket baru dari aplikasi pelanggan muncul di sini." />
          ) : (
            <ul>
              {rows.map((ticket) => {
                const order = data.orders.get(ticket.order_id)
                return (
                  <li key={ticket.id}>
                    <button type="button" className={`sp-item${ticket.id === selectedId ? ' is-active' : ''}`} onClick={() => setSelectedId(ticket.id)} aria-current={ticket.id === selectedId}>
                      <span className="inv-name"><strong>{ticket.subject}</strong><small>{order ? `Pesanan ${formatQueueNumber(order)} · ` : ''}{formatRelative(ticket.last_message_at)}</small></span>
                      <Badge tone={TICKET_STATUS[ticket.status].tone} size="sm">{TICKET_STATUS[ticket.status].label}</Badge>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
        {selected
          ? <Thread key={selected.id} ticket={selected} order={data.orders.get(selected.order_id)} onChanged={reload} />
          : <Card className="sp-empty"><EmptyState icon={LifeBuoy} compact title="Pilih tiket" description="Percakapan tampil di sini." /></Card>}
      </div>
    </div>
  )
}

function Thread({ ticket, order, onChanged }) {
  const { supabase } = useAuth()
  const can = useCan()
  const { toast } = useToast()
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('support_messages').select('id, sender, body, created_at').eq('ticket_id', ticket.id).order('created_at')
    if (error) throw new Error(friendlyError(error))
    return data || []
  }, [supabase, ticket.id])
  const { data: messages, error, reload } = useLoader(load)

  async function send() {
    if (!reply.trim()) return
    setSending(true)
    try {
      await rpc(supabase, 'support_reply', { p_ticket_id: ticket.id, p_body: reply.trim() })
      setReply('')
      reload()
      onChanged()
      toast({ tone: 'success', title: 'Balasan terkirim', description: 'Pelanggan mendapat notifikasi.' })
    } catch (caught) {
      toast({ tone: 'error', title: 'Balasan gagal dikirim', description: caught.message })
    }
    setSending(false)
  }

  async function close() {
    try {
      await rpc(supabase, 'support_close', { p_ticket_id: ticket.id })
      onChanged()
    } catch (caught) {
      toast({ tone: 'error', title: 'Gagal menutup tiket', description: caught.message })
    }
  }

  return (
    <Card className="sp-thread">
      <div className="sp-thread-head">
        <div className="inv-name"><strong>{ticket.subject}</strong><small>Dibuka {formatDateTime(ticket.created_at)}{order ? ` · Pesanan ${formatQueueNumber(order)}` : ''}</small></div>
        {ticket.status !== 'closed' && <Button size="sm" variant="ghost" icon={CheckCircle2} onClick={close}>Tandai selesai</Button>}
      </div>
      {error ? <ErrorState compact message={error} onRetry={reload} /> : !messages ? <SkeletonRows rows={3} label="Memuat percakapan" /> : (
        <ol className="sp-messages">
          {messages.map((message) => (
            <li key={message.id} className={message.sender === 'cafe' ? 'is-cafe' : ''}>
              <span className="sp-author">{message.sender === 'cafe' ? 'Kafe' : 'Pelanggan'} · {formatDateTime(message.created_at)}</span>
              <p>{message.body}</p>
            </li>
          ))}
        </ol>
      )}
      {can('support.reply') ? <div className="sp-compose">
        <TextField label="Balasan" hideLabel multiline rows={3} maxLength={2000} value={reply} placeholder="Tulis balasan untuk pelanggan…" onChange={(event) => setReply(event.target.value)} />
        <Button icon={Send} onClick={send} loading={sending} disabled={!reply.trim()}>Kirim balasan</Button>
      </div> : <p className="text-muted">Kamu belum diberi izin membalas pelanggan. Minta owner mengaktifkannya di menu Tim.</p>}
    </Card>
  )
}

/** Web staff: kotak masuk yang sama (staff boleh membalas, RLS file 08). */
export function StaffSupportPage() {
  const { cafe, features } = useOutletContext()
  return (
    <div className="page page-wide">
      <PageHeader eyebrow={cafe.name} title="Bantuan pelanggan" description="Balas pertanyaan dari aplikasi. Pelanggan mendapat notifikasi." />
      {features?.customer ? <SupportInbox cafe={cafe} /> : <Card><EmptyState title="Belum tersedia" description={CUSTOMER_REQUIRED} /></Card>}
    </div>
  )
}
