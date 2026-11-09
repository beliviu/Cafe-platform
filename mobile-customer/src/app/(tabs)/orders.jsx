import { useCallback, useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { useAuth } from '../../auth/useAuth.js'
import { Button, EmptyState, ErrorBox, formatCurrency, LoadingState, OrderStatusBadge, PaymentBadge, Screen, SectionTitle } from '../../components/ui.jsx'
import { Text } from '../../components/ui/Text.jsx'
import { formatDateShort, formatQueueNumber, formatTime } from '../../lib/format.js'
import { orderSelect } from '../../lib/orders.js'
import { makeStyles } from '../../theme/useTheme.js'

let ordersChannelSequence = 0

function formatDate(value) {
  return `${formatDateShort(value)}, ${formatTime(value)}`
}

export default function OrdersScreen() {
  const styles = useStyles()
  const { session, supabase } = useAuth()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(Boolean(session))
  const [error, setError] = useState('')

  const loadOrders = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError('')
    const { data, error: queryError } = await supabase.from('orders')
      .select(await orderSelect(supabase, 'id, cafe_id, order_number, total_amount, order_status, payment_status, payment_method, created_at'))
      .eq('customer_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(100)
    if (queryError) setError(`Riwayat pesanan gagal dimuat: ${queryError.message}`)
    else setOrders(data || [])
    setLoading(false)
  }, [session, supabase])

  useEffect(() => {
    const timer = setTimeout(loadOrders, 0)
    return () => clearTimeout(timer)
  }, [loadOrders])

  useEffect(() => {
    if (!session) return undefined
    const channel = supabase.channel(`customer-orders-${session.user.id}-${++ordersChannelSequence}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `customer_id=eq.${session.user.id}`,
      }, loadOrders)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadOrders, session, supabase])

  return (
    <Screen>
      <View><Text style={styles.eyebrow}>PESANANMU</Text><Text style={styles.title}>Riwayat</Text></View>
      {!session ? (
        <EmptyState title="Masuk untuk melihat pesanan" description="Pesanan dan statusnya tersimpan di akunmu." action={<Button title="Masuk" onPress={() => router.push('/login')} />} />
      ) : loading ? <LoadingState label="Memuat pesanan..." /> : error ? <ErrorBox message={error} onRetry={loadOrders} /> : !orders.length ? (
        <EmptyState title="Belum ada pesanan" description="Pesanan pertamamu akan muncul di sini." action={<Button title="Lihat menu" onPress={() => router.push('/(tabs)/menu')} />} />
      ) : (
        <View style={styles.list}>
          <SectionTitle title="Semua pesanan" />
          {orders.map((order) => (
            <Pressable key={order.id} onPress={() => router.push(`/order/${order.id}`)} style={styles.card}>
              <View style={styles.cardTop}>
                <View><Text style={styles.orderNumber} tabular>Pesanan {formatQueueNumber(order)}</Text><Text style={styles.date}>{formatDate(order.created_at)}</Text></View>
                <OrderStatusBadge status={order.order_status} />
              </View>
              <View style={styles.cardBottom}>
                <PaymentBadge status={order.payment_status} size="sm" />
                <Text style={styles.total}>{formatCurrency(order.total_amount)}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  eyebrow: { color: COLORS.green, fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  title: { marginTop: 5, color: COLORS.ink, fontFamily: 'Fraunces', fontSize: 27, fontWeight: '700' },
  list: { gap: 12 },
  card: { padding: 15, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, borderRadius: 16, gap: 14 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  orderNumber: { color: COLORS.ink, fontSize: 14, fontWeight: '700' },
  date: { marginTop: 5, color: COLORS.muted, fontSize: 11 },
  status: { maxWidth: 130, color: COLORS.accentText, fontSize: 10, fontWeight: '700', textAlign: 'right' },
  statusDone: { color: COLORS.green },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 11, borderTopWidth: 1, borderTopColor: COLORS.line },
  payment: { color: COLORS.muted, fontSize: 11 },
  total: { color: COLORS.green, fontSize: 13, fontWeight: '800' },
}))
