/*
 * Pembayaran pesanan dengan QRIS kafe (gambar QRIS yang diunggah owner, file 12).
 * Pelanggan scan & mengetik total; staff menandai lunas setelah mengecek mutasi.
 */
import { useCallback, useEffect, useState } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'
import { Image } from 'expo-image'
import { Check, Clock3, RefreshCw } from 'lucide-react-native'
import { useAuth } from '../../auth/useAuth.js'
import { Button, ErrorBox, formatCurrency, LoadingState, Screen } from '../../components/ui.jsx'
import { Text } from '../../components/ui/Text.jsx'
import { formatQueueNumber } from '../../lib/format.js'
import { orderSelect } from '../../lib/orders.js'
import { useStaticQris } from '../../lib/payments.js'
import { makeStyles, useTheme } from '../../theme/useTheme.js'

export default function PaymentScreen() {
  const { id } = useLocalSearchParams()
  const { session, supabase } = useAuth()
  const [order, setOrder] = useState(null)
  const [error, setError] = useState('')
  const staticQris = useStaticQris(order?.cafe_id)

  const loadOrder = useCallback(async () => {
    if (!session) {
      setError('Masuk ke akun customer untuk melihat pesanan ini.')
      return
    }
    const { data, error: queryError } = await supabase.from('orders')
      .select(await orderSelect(supabase, 'id, cafe_id, order_number, total_amount, order_status, payment_status, payment_method'))
      .eq('id', id).eq('customer_id', session.user.id).maybeSingle()
    if (queryError) setError(`Pesanan gagal dimuat: ${queryError.message}`)
    else if (!data) setError('Pesanan tidak ditemukan.')
    else setOrder(data)
  }, [id, session, supabase])

  useEffect(() => {
    const timer = setTimeout(loadOrder, 0)
    return () => clearTimeout(timer)
  }, [loadOrder])

  if (error) return <Screen><ErrorBox message={error} /></Screen>
  if (!order) return <Screen><LoadingState label="Memuat tagihan..." /></Screen>
  if (staticQris === undefined) return <Screen><LoadingState label="Memuat QRIS kafe..." /></Screen>
  if (!staticQris) {
    return (
      <Screen>
        <ErrorBox message="Kafe belum memasang QRIS. Silakan bayar langsung di kasir." />
        <Button title="Lihat status pesanan" onPress={() => router.replace(`/order/${order.id}`)} />
      </Screen>
    )
  }
  return <StaticQrisPayment order={order} image={staticQris} onRefresh={loadOrder} />
}

/** Mode demo lama: tidak pernah melunasi pesanan. */
/** QRIS statis kafe: pelanggan scan & ketik nominal; staff menandai lunas setelah cek mutasi. */
function StaticQrisPayment({ order, image, onRefresh }) {
  const styles = useStyles()
  const { COLORS, STATUS_TONES } = useTheme()
  const paid = order.payment_status === 'paid'
  return (
    <Screen contentStyle={styles.content}>
      <Text size="xs" weight="800" style={[styles.eyebrow, { color: COLORS.primaryPressed }]}>QRIS KAFE · {formatQueueNumber(order)}</Text>
      <Text serif weight="700" size="2xl">{paid ? 'Pembayaran diterima' : 'Scan & bayar'}</Text>
      <View style={styles.staticAmount}>
        <Text size="sm" tone="muted">Ketik nominal ini di aplikasi bank / e-wallet</Text>
        <Text serif weight="700" size="3xl" tabular>{formatCurrency(order.total_amount)}</Text>
      </View>
      {!paid ? (
        <View style={styles.staticFrame}>
          <Image source={{ uri: image }} style={styles.staticImage} contentFit="contain" accessibilityLabel="QRIS kafe" />
        </View>
      ) : null}
      <View style={[styles.staticStatus, { backgroundColor: paid ? STATUS_TONES.green.bg : STATUS_TONES.amber.bg }]}>
        {paid ? <Check size={18} color={STATUS_TONES.green.fg} /> : <Clock3 size={18} color={STATUS_TONES.amber.fg} />}
        <Text size="sm" weight="700" style={{ flex: 1, color: paid ? STATUS_TONES.green.fg : STATUS_TONES.amber.fg }}>
          {paid ? 'Lunas — kafe sudah mengonfirmasi pembayaranmu.' : 'Setelah membayar, kafe akan mengecek dan mengonfirmasi. Simpan bukti transfer bila diminta.'}
        </Text>
      </View>
      {!paid ? <Button title="Cek status pembayaran" variant="secondary" icon={RefreshCw} onPress={onRefresh} /> : null}
      <Button title="Lihat status pesanan" onPress={() => router.replace(`/order/${order.id}`)} />
    </Screen>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  staticAmount: { gap: 4, padding: 16, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.borderSubtle, borderRadius: 18 },
  staticFrame: { alignSelf: 'center', width: '100%', maxWidth: 320, padding: 12, backgroundColor: '#FFFFFF', borderRadius: 20 },
  staticImage: { width: '100%', aspectRatio: 0.75 },
  staticStatus: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14 },
  content: { gap: 16 },
  head: { gap: 6 },
  eyebrow: { letterSpacing: 1.2 },
  card: { alignItems: 'center', gap: 14, padding: 20, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 22 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  qr: { padding: 10, backgroundColor: '#FFFFFF', borderRadius: 16 },
  done: { width: 140, height: 140, alignItems: 'center', justifyContent: 'center', borderRadius: 70 },
  placeholder: { width: 232, height: 232, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.sunken, borderRadius: 16 },
}))
