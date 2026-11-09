import { useCallback, useEffect, useState } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import { TextInput, View } from 'react-native'
import { useAuth } from '../../auth/useAuth.js'
import { useBrand } from '../../brand/useBrand.js'
import { Badge, Button, ErrorBox, LoadingState, Screen, useToast } from '../../components/ui.jsx'
import { Text } from '../../components/ui/Text.jsx'
import { formatDateTime } from '../../lib/format.js'
import { TICKET_STATUS } from '../../lib/customer.js'
import { makeStyles, useTheme } from '../../theme/useTheme.js'

let channelSequence = 0

export default function TicketScreen() {
  const styles = useStyles()
  const { COLORS } = useTheme()
  const { id } = useLocalSearchParams()
  const { supabase } = useAuth()
  const { brand } = useBrand()
  const { toast } = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    const [ticket, messages] = await Promise.all([
      supabase.from('support_tickets').select('id, subject, status, order_id, created_at').eq('id', id).maybeSingle(),
      supabase.from('support_messages').select('id, sender, body, created_at').eq('ticket_id', id).order('created_at'),
    ])
    if (ticket.error || !ticket.data) return setError(ticket.error?.message || 'Percakapan tidak ditemukan.')
    setData({ ticket: ticket.data, messages: messages.data || [] })
    return undefined
  }, [id, supabase])

  useEffect(() => {
    const timer = setTimeout(load, 0)
    const channel = supabase.channel(`ticket-${id}-${++channelSequence}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `ticket_id=eq.${id}` }, load)
      .subscribe()
    return () => { clearTimeout(timer); supabase.removeChannel(channel) }
  }, [id, load, supabase])

  async function send() {
    if (!reply.trim()) return
    setSending(true)
    const { error: rpcError } = await supabase.rpc('support_reply', { p_ticket_id: id, p_body: reply.trim() })
    setSending(false)
    if (rpcError) return toast({ tone: 'error', title: 'Pesan gagal dikirim', description: rpcError.message })
    setReply('')
    load()
    return undefined
  }

  async function close() {
    const { error: rpcError } = await supabase.rpc('support_close', { p_ticket_id: id })
    if (rpcError) toast({ tone: 'error', title: 'Gagal menutup', description: rpcError.message })
    else load()
  }

  if (error) return <Screen><ErrorBox message={error} onRetry={load} /></Screen>
  if (!data) return <Screen><LoadingState label="Memuat percakapan..." /></Screen>
  const { ticket, messages } = data
  const status = TICKET_STATUS[ticket.status]

  return (
    <Screen>
      <View style={styles.head}>
        <Text serif weight="700" size="xl" style={styles.flex}>{ticket.subject}</Text>
        <Badge tone={status?.tone} size="sm">{status?.label}</Badge>
      </View>
      {ticket.order_id ? <Button title="Lihat pesanan terkait" variant="ghost" size="sm" onPress={() => router.push(`/order/${ticket.order_id}`)} style={styles.left} /> : null}
      <View style={styles.thread}>
        {messages.map((message) => {
          const mine = message.sender === 'customer'
          return (
            <View key={message.id} style={[styles.bubble, mine ? [styles.mine, { backgroundColor: brand.colors.primaryTint, borderColor: brand.colors.primarySoft }] : styles.theirs]}>
              <Text size="xs" weight="700" tone="muted">{mine ? 'Kamu' : brand.businessName}</Text>
              <Text size="sm">{message.body}</Text>
              <Text size={11} tone="muted">{formatDateTime(message.created_at)}</Text>
            </View>
          )
        })}
      </View>
      <TextInput value={reply} onChangeText={setReply} placeholder={ticket.status === 'closed' ? 'Tulis pesan untuk membuka lagi…' : 'Tulis balasan…'}
        placeholderTextColor={COLORS.placeholder} multiline maxLength={2000} accessibilityLabel="Balasan" style={styles.input} />
      <Button title="Kirim" onPress={send} loading={sending} disabled={!reply.trim()} />
      {ticket.status !== 'closed' ? <Button title="Tandai selesai" variant="ghost" onPress={close} /> : null}
    </Screen>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  flex: { flex: 1 },
  left: { alignSelf: 'flex-start' },
  thread: { gap: 10 },
  bubble: { maxWidth: '88%', gap: 4, padding: 12, borderWidth: 1, borderRadius: 14 },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start', backgroundColor: COLORS.card, borderColor: COLORS.border },
  input: { minHeight: 80, padding: 12, color: COLORS.text, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, textAlignVertical: 'top', fontFamily: 'PlusJakartaSans', fontSize: 14 },
}))
