import { useState } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import { useAuth } from '../../auth/useAuth.js'
import { useBrand } from '../../brand/useBrand.js'
import { Button, ErrorBox, Field, Screen, useToast } from '../../components/ui.jsx'
import { Text } from '../../components/ui/Text.jsx'

const TOPICS = ['Pesanan kurang / salah', 'Pertanyaan refund', 'Pembayaran', 'Saran & masukan']

export default function NewTicketScreen() {
  const { orderId, ref } = useLocalSearchParams()
  const { supabase } = useAuth()
  const { cafe } = useBrand()
  const { toast } = useToast()
  const [subject, setSubject] = useState(orderId ? `Pesanan ${ref || ''}`.trim() : '')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  async function send() {
    setError('')
    if (subject.trim().length < 3 || body.trim().length < 3) return setError('Tulis judul dan pesan (minimal 3 huruf).')
    setSending(true)
    const { data, error: rpcError } = await supabase.rpc('support_open', { p_cafe_id: cafe.id, p_subject: subject.trim(), p_body: body.trim(), p_order_id: orderId || null })
    setSending(false)
    if (rpcError) return setError(rpcError.message)
    toast({ tone: 'success', title: 'Pesan terkirim', description: 'Balasan kafe akan masuk ke notifikasi.' })
    router.replace(`/support/${data}`)
    return undefined
  }

  return (
    <Screen>
      {orderId ? <Text size="sm" tone="muted">Pesan ini terhubung ke pesanan {ref}, jadi kafe langsung tahu konteksnya.</Text> : null}
      <ErrorBox message={error} />
      {!orderId && (
        <Field label="Topik" value={subject} onChangeText={setSubject} placeholder={TOPICS.join(' · ')} maxLength={120} />
      )}
      <Field label="Pesan" value={body} onChangeText={setBody} placeholder="Ceritakan masalahnya. Mis. croissant tidak ada di pesanan saya." multiline maxLength={2000} />
      <Button title="Kirim ke kafe" onPress={send} loading={sending} />
    </Screen>
  )
}
