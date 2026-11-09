import { useCallback, useEffect, useState } from 'react'
import { Linking, Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { LifeBuoy, MessageCircle, Phone, Plus } from 'lucide-react-native'
import { useAuth } from '../../auth/useAuth.js'
import { useBrand } from '../../brand/useBrand.js'
import { Badge, Button, EmptyState, ErrorBox, LoadingState, Screen } from '../../components/ui.jsx'
import { Text } from '../../components/ui/Text.jsx'
import { formatRelative } from '../../lib/format.js'
import { TICKET_STATUS } from '../../lib/customer.js'
import { makeStyles } from '../../theme/useTheme.js'

/** Nomor lokal 08… → format WhatsApp 628… */
function waNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return null
  return digits.startsWith('0') ? `62${digits.slice(1)}` : digits
}

export default function SupportScreen() {
  const styles = useStyles()
  const { session, supabase } = useAuth()
  const { cafe, brand } = useBrand()
  const [tickets, setTickets] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!session || !cafe) return
    const { data, error: queryError } = await supabase.from('support_tickets').select('id, subject, status, last_message_at, order_id')
      .eq('cafe_id', cafe.id).order('last_message_at', { ascending: false })
    if (queryError) return setError(queryError.message)
    setTickets(data || [])
    return undefined
  }, [cafe, session, supabase])

  useEffect(() => {
    const timer = setTimeout(load, 0)
    return () => clearTimeout(timer)
  }, [load])

  const wa = waNumber(cafe?.phone)
  return (
    <Screen>
      <View style={styles.contact}>
        <Text weight="700">Butuh jawaban cepat?</Text>
        <Text size="sm" tone="muted">Hubungi {brand.businessName} langsung, atau kirim pesan di bawah — balasan kafe masuk ke notifikasi.</Text>
        {wa ? (
          <View style={styles.contactRow}>
            <Button title="WhatsApp" icon={MessageCircle} variant="secondary" size="sm" onPress={() => Linking.openURL(`https://wa.me/${wa}`)} style={styles.flex} />
            <Button title="Telepon" icon={Phone} variant="secondary" size="sm" onPress={() => Linking.openURL(`tel:${cafe.phone}`)} style={styles.flex} />
          </View>
        ) : null}
      </View>
      {!session ? (
        <EmptyState icon={LifeBuoy} title="Masuk untuk mengirim pesan" action={<Button title="Masuk" onPress={() => router.push('/login')} />} />
      ) : error ? <ErrorBox message={error} onRetry={load} /> : !tickets ? <LoadingState label="Memuat pesan..." /> : (
        <>
          <Button title="Kirim pesan baru" icon={Plus} onPress={() => router.push('/support/new')} />
          {!tickets.length ? <EmptyState icon={LifeBuoy} compact title="Belum ada percakapan" description="Pertanyaan tentang pesanan, refund, atau saran — kirim di sini." /> : tickets.map((ticket) => (
            <Pressable key={ticket.id} accessibilityRole="button" onPress={() => router.push(`/support/${ticket.id}`)} style={styles.row}>
              <View style={styles.flex}>
                <Text weight="700" size="sm" numberOfLines={1}>{ticket.subject}</Text>
                <Text size="xs" tone="muted">{formatRelative(ticket.last_message_at)}</Text>
              </View>
              <Badge tone={TICKET_STATUS[ticket.status]?.tone} size="sm">{TICKET_STATUS[ticket.status]?.label}</Badge>
            </Pressable>
          ))}
        </>
      )}
    </Screen>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  contact: { gap: 8, padding: 16, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16 },
  contactRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flex: { flex: 1, gap: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14 },
}))
