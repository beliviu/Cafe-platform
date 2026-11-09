import { useCallback, useEffect, useState } from 'react'
import { router } from 'expo-router'
import { Pressable, View } from 'react-native'
import { CreditCard } from 'lucide-react-native'
import { useAuth } from '../auth/useAuth.js'
import { Badge, Button, EmptyState, ErrorBox, formatCurrency, LoadingState, Screen } from '../components/ui.jsx'
import { Text } from '../components/ui/Text.jsx'
import { formatDateTime, formatQueueNumber } from '../lib/format.js'
import { PAYMENT_METHOD } from '../lib/status.js'
import { makeStyles, useTheme } from '../theme/useTheme.js'

/** Pembayaran & pengembalian dana dari pesanan milik customer (RLS: hanya pesanan sendiri). */
export default function PaymentsScreen() {
  const styles = useStyles()
  const { COLORS } = useTheme()
  const { session, supabase } = useAuth()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!session) return
    const orders = await supabase.from('orders').select('id, order_number, queue_number, total_amount, payment_method, payment_status, created_at')
      .eq('customer_id', session.user.id).order('created_at', { ascending: false }).limit(200)
    if (orders.error) return setError(orders.error.message)
    const ids = (orders.data || []).map((order) => order.id)
    const payments = ids.length ? await supabase.from('payments').select('id, order_id, method, payment_method, status, amount, paid_at, created_at').in('order_id', ids) : { data: [] }
    if (payments.error) return setError(payments.error.message)
    const byId = new Map(orders.data.map((order) => [order.id, order]))
    setRows((payments.data || []).filter((payment) => ['paid', 'refunded'].includes(payment.status))
      .map((payment) => ({ ...payment, order: byId.get(payment.order_id) }))
      .sort((a, b) => ((b.paid_at || b.created_at) > (a.paid_at || a.created_at) ? 1 : -1)))
    return undefined
  }, [session, supabase])

  useEffect(() => {
    const timer = setTimeout(load, 0)
    return () => clearTimeout(timer)
  }, [load])

  if (!session) return <Screen><EmptyState title="Masuk untuk melihat pembayaran" action={<Button title="Masuk" onPress={() => router.push('/login')} />} /></Screen>
  if (error) return <Screen><ErrorBox message={error} onRetry={load} /></Screen>
  if (!rows) return <Screen><LoadingState label="Memuat pembayaran..." /></Screen>
  const paid = rows.filter((row) => row.status === 'paid').reduce((sum, row) => sum + Number(row.amount), 0)
  const refunded = rows.filter((row) => row.status === 'refunded').reduce((sum, row) => sum + Number(row.amount), 0)

  return (
    <Screen>
      <View style={styles.summary}>
        <View style={styles.flex}><Text size="xs" tone="muted">Total dibayar</Text><Text weight="800" size="lg" tabular>{formatCurrency(paid)}</Text></View>
        <View style={styles.flex}><Text size="xs" tone="muted">Dikembalikan</Text><Text weight="800" size="lg" tabular>{formatCurrency(refunded)}</Text></View>
      </View>
      {!rows.length ? (
        <EmptyState icon={CreditCard} title="Belum ada pembayaran" description="Pembayaran tercatat setelah kasir menerima pembayaranmu." />
      ) : rows.map((row) => (
        <Pressable key={row.id} accessibilityRole="button" onPress={() => router.push(`/order/${row.order_id}`)} style={styles.row}>
          <View style={styles.flex}>
            <Text weight="700" size="sm">Pesanan {formatQueueNumber(row.order)}</Text>
            <Text size="xs" tone="muted">{PAYMENT_METHOD[row.method || row.payment_method] || 'Pembayaran'} · {formatDateTime(row.paid_at || row.created_at)}</Text>
          </View>
          <View style={styles.right}>
            <Text weight="800" tabular style={row.status === 'refunded' ? { color: COLORS.red } : null}>{row.status === 'refunded' ? '−' : ''}{formatCurrency(row.amount)}</Text>
            <Badge tone={row.status === 'refunded' ? 'neutral' : 'green'} size="sm">{row.status === 'refunded' ? 'Refund' : 'Lunas'}</Badge>
          </View>
        </Pressable>
      ))}
    </Screen>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  summary: { flexDirection: 'row', gap: 12, padding: 16, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16 },
  flex: { flex: 1, gap: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14 },
  right: { alignItems: 'flex-end', gap: 5 },
}))
