import { useCallback, useEffect, useState } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import { StyleSheet, TextInput, View } from 'react-native'
import { CalendarClock, Check, Clock3, LifeBuoy, MapPin, QrCode, RotateCcw, XCircle } from 'lucide-react-native'
import { useAuth } from '../../auth/useAuth.js'
import { useBrand } from '../../brand/useBrand.js'
import { useCart } from '../../cart/useCart.js'
import { Button, ConfirmDialog, ErrorBox, formatCurrency, LoadingState, Screen, useToast } from '../../components/ui.jsx'
import { Text } from '../../components/ui/Text.jsx'
import { StarInput, SummaryRow } from '../../components/CustomerBits.jsx'
import { formatDateTime, formatQueueNumber, formatTime } from '../../lib/format.js'
import { orderDetailSelect } from '../../lib/orders.js'
import { buildReorder } from '../../lib/reorder.js'
import { useStaticQris } from '../../lib/payments.js'
import { ORDER_STATUS, PAYMENT_METHOD } from '../../lib/status.js'
import { makeStyles, useTheme } from '../../theme/useTheme.js'
import { withAlpha } from '../../theme/palette.js'

let orderChannelSequence = 0

const STATUS_STEPS = [
  ['pending', 'Pesanan masuk'],
  ['confirmed', ORDER_STATUS.confirmed.customerLabel],
  ['preparing', ORDER_STATUS.preparing.customerLabel],
  ['ready', ORDER_STATUS.ready.customerLabel],
  ['completed', ORDER_STATUS.completed.customerLabel],
]

const STATUS_COPY = {
  pending: 'Pesananmu sudah masuk dan menunggu diterima kafe.',
  confirmed: 'Kafe sudah menerima pesananmu.',
  preparing: 'Barista sedang menyiapkan pesanan.',
  ready: 'Pesanan siap.',
  completed: 'Terima kasih, pesanan sudah selesai.',
  cancelled: 'Pesanan ini dibatalkan.',
}

export default function OrderTrackingScreen() {
  const styles = useStyles()
  const { COLORS } = useTheme()
  const { id } = useLocalSearchParams()
  const { session, supabase } = useAuth()
  const { brand } = useBrand()
  const { items: cartItems, replaceLines } = useCart()
  const { toast } = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState(null)
  const [reordering, setReordering] = useState(false)
  const staticQris = useStaticQris(data?.order?.cafe_id)

  const loadOrder = useCallback(async () => {
    if (!session) {
      setError('Masuk ke akun customer untuk melihat pesanan ini.')
      setLoading(false)
      return
    }
    const { data: order, error: orderError } = await supabase.from('orders')
      .select(await orderDetailSelect(supabase, 'id, cafe_id, order_number, total_amount, order_status, payment_status, payment_method, created_at, notes'))
      .eq('id', id).eq('customer_id', session.user.id).maybeSingle()
    if (orderError || !order) {
      setError(orderError ? `Status pesanan gagal dimuat: ${orderError.message}` : 'Pesanan tidak ditemukan di akun ini.')
      setLoading(false)
      return
    }
    const [itemsResult, payments, reviews, points] = await Promise.all([
      supabase.from('order_items').select('id, product_id, product_name, price, quantity, subtotal, notes').eq('order_id', order.id).order('created_at'),
      supabase.from('payments').select('id, method, payment_method, status, amount, paid_at, created_at').eq('order_id', order.id),
      supabase.from('product_reviews').select('product_id, rating, comment').eq('order_id', order.id),
      supabase.from('loyalty_ledger').select('kind, points').eq('order_id', order.id),
    ])
    if (itemsResult.error) setError(`Rincian pesanan gagal dimuat: ${itemsResult.error.message}`)
    setData({
      order,
      items: itemsResult.data || [],
      payments: payments.data || [],
      reviews: reviews.error ? null : reviews.data || [], // null = fitur ulasan belum aktif
      pointsEarned: (points.data || []).filter((row) => row.kind === 'earn').reduce((sum, row) => sum + row.points, 0),
    })
    setLoading(false)
  }, [id, session, supabase])

  useEffect(() => {
    const timer = setTimeout(loadOrder, 0)
    return () => clearTimeout(timer)
  }, [loadOrder])

  useEffect(() => {
    if (!session || !id) return undefined
    const channel = supabase.channel(`order-track-${id}-${++orderChannelSequence}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` }, loadOrder)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id, loadOrder, session, supabase])

  async function cancelOrder() {
    const { error: cancelError } = await supabase.rpc('customer_cancel_order', { p_order_id: id, p_reason: 'Dibatalkan pelanggan' })
    setDialog(null)
    if (cancelError) toast({ tone: 'error', title: 'Tidak bisa dibatalkan', description: cancelError.message })
    else {
      toast({ tone: 'success', title: 'Pesanan dibatalkan' })
      loadOrder()
    }
  }

  async function reorder(order) {
    setDialog(null)
    setReordering(true)
    try {
      const result = await buildReorder(supabase, order.id, brand.businessName)
      if (!result.lines.length) {
        toast({ tone: 'error', title: 'Menu pesanan ini sedang tidak tersedia', description: result.changes.join(' · ') })
        return
      }
      replaceLines(result.lines)
      toast({
        tone: result.changes.length ? 'info' : 'success',
        title: `${result.lines.length} menu masuk keranjang`,
        description: result.changes.length ? result.changes.join(' · ') : 'Harga sudah disesuaikan dengan harga terkini.',
      })
      router.push('/cart')
    } catch (caught) {
      toast({ tone: 'error', title: 'Gagal memesan ulang', description: caught.message })
    } finally {
      setReordering(false)
    }
  }

  if (loading) return <Screen><LoadingState label="Memuat status pesanan..." /></Screen>
  if (!data) return <Screen><ErrorBox message={error} /><Button title="Kembali ke beranda" onPress={() => router.replace('/(tabs)')} /></Screen>

  const { order, items, payments, reviews, pointsEarned } = data
  const currentStep = STATUS_STEPS.findIndex(([status]) => status === order.order_status)
  const cancelled = order.order_status === 'cancelled'
  const active = !cancelled && order.order_status !== 'completed'
  const canCancel = order.order_status === 'pending' && order.payment_status !== 'paid' && !Number(order.paid_amount) && 'cancelled_by' in order
  const paidTotal = payments.filter((payment) => payment.status === 'paid').reduce((sum, payment) => sum + Number(payment.amount), 0)
  const refundedTotal = payments.filter((payment) => payment.status === 'refunded').reduce((sum, payment) => sum + Number(payment.amount), 0)
  const reviewable = order.order_status === 'completed' && reviews !== null
    ? [...new Map(items.filter((item) => item.product_id).map((item) => [item.product_id, item])).values()]
    : []

  return (
    <Screen>
      <View style={[styles.header, styles.statusHero]}>
        <Text size="xs" weight="800" style={[styles.eyebrow, { color: brand.colors.primaryPressed }]}>{active ? 'PESANAN DIPROSES' : cancelled ? 'PESANAN DIBATALKAN' : 'PESANAN SELESAI'}</Text>
        <Text serif weight="700" size="3xl" tabular style={styles.queueNumber}>{formatQueueNumber(order)}</Text>
        <Text style={styles.statusCopy}>{STATUS_COPY[order.order_status] || order.order_status}</Text>
      </View>
      <ErrorBox message={error} onRetry={loadOrder} />

      {(order.table_label || order.scheduled_for || (active && order.estimated_ready_at)) && (
        <View style={styles.facts}>
          {order.table_label ? <Fact icon={MapPin} label="Meja" value={order.table_label} /> : null}
          {order.scheduled_for ? <Fact icon={CalendarClock} label="Dijadwalkan" value={formatDateTime(order.scheduled_for)} /> : null}
          {active && order.estimated_ready_at && !order.scheduled_for ? <Fact icon={Clock3} label="Perkiraan siap" value={`${formatTime(order.estimated_ready_at)} WIB`} /> : null}
        </View>
      )}

      {cancelled ? (
        <View style={styles.cancelled}>
          <XCircle size={20} color={COLORS.red} />
          <View style={styles.flex}>
            <Text weight="700" style={{ color: COLORS.red }}>{order.cancelled_by === 'customer' ? 'Kamu membatalkan pesanan ini' : 'Dibatalkan oleh kafe'}</Text>
            {order.cancel_reason ? <Text size="sm" tone="secondary">Alasan: {order.cancel_reason}</Text> : null}
            {order.cancelled_at ? <Text size="xs" tone="muted">{formatDateTime(order.cancelled_at)}</Text> : null}
            {paidTotal > 0 ? <Text size="xs" tone="secondary">{refundedTotal >= paidTotal ? `Dana ${formatCurrency(refundedTotal)} sudah dikembalikan.` : 'Pembayaran sudah tercatat — hubungi kafe untuk pengembalian dana.'}</Text> : null}
            {Number(order.points_redeemed) > 0 ? <Text size="xs" tone="secondary">{order.points_redeemed} poin yang ditukar sudah dikembalikan.</Text> : null}
          </View>
        </View>
      ) : (
        <View style={styles.steps}>
          {STATUS_STEPS.map(([status, label], index) => {
            const done = index <= currentStep
            return (
              <View key={status} style={styles.step}>
                <View style={[styles.stepMark, done && { backgroundColor: brand.colors.primary, borderColor: brand.colors.primary }]}>
                  {done ? <Check size={13} color={COLORS.textOnPrimary} strokeWidth={3} /> : <Text size={11} weight="700" tone="muted">{index + 1}</Text>}
                </View>
                <Text size="sm" weight={done ? '700' : '500'} tone={done ? 'primary' : 'muted'}>{label}</Text>
              </View>
            )
          })}
        </View>
      )}

      <View style={styles.card}>
        <Text weight="700">Rincian</Text>
        {items.map((item) => (
          <View key={item.id} style={styles.itemRow}>
            <View style={styles.flex}>
              <Text size="sm">{item.quantity} × {item.product_name}</Text>
              {item.notes ? <Text size="xs" tone="muted">Catatan: {item.notes}</Text> : null}
            </View>
            <Text size="sm" weight="600" tabular>{formatCurrency(item.subtotal ?? item.price * item.quantity)}</Text>
          </View>
        ))}
        <View style={styles.divider} />
        {order.subtotal_amount != null && Number(order.subtotal_amount) !== Number(order.total_amount) ? <SummaryRow label="Subtotal" value={formatCurrency(order.subtotal_amount)} /> : null}
        {Number(order.voucher_discount) ? <SummaryRow label={`Voucher ${order.voucher_code || ''}`} value={`−${formatCurrency(order.voucher_discount)}`} /> : null}
        {Number(order.points_discount) ? <SummaryRow label={`${order.points_redeemed} poin`} value={`−${formatCurrency(order.points_discount)}`} /> : null}
        {Number(order.service_charge_amount) ? <SummaryRow label="Service" value={formatCurrency(order.service_charge_amount)} /> : null}
        {Number(order.tax_amount) ? <SummaryRow label="Pajak" value={formatCurrency(order.tax_amount)} /> : null}
        {Number(order.rounding_amount) ? <SummaryRow label="Pembulatan" value={formatCurrency(order.rounding_amount)} /> : null}
        <SummaryRow label="Total" value={formatCurrency(order.total_amount)} strong />
        <SummaryRow label="Pembayaran" value={order.payment_status === 'paid' ? `Lunas · ${PAYMENT_METHOD[payments[0]?.method] || 'tercatat'}` : order.payment_method === 'simulated' ? 'QRIS demo · belum lunas' : order.payment_method === 'qris' ? 'QRIS · menunggu konfirmasi kafe' : 'Bayar di kafe'} />
        {pointsEarned > 0 ? <SummaryRow label="Poin didapat" value={`+${pointsEarned}`} tone={brand.colors.primaryPressed} /> : null}
      </View>

      {reviewable.length > 0 && (
        <View style={styles.card}>
          <Text weight="700">Beri ulasan</Text>
          <Text size="xs" tone="muted">Ulasanmu membantu pelanggan lain memilih menu.</Text>
          {reviewable.map((item) => (
            <ReviewItem key={item.product_id} orderId={order.id} item={item} existing={reviews.find((review) => review.product_id === item.product_id)} onSaved={loadOrder} />
          ))}
        </View>
      )}

      <View style={styles.actions}>
        {staticQris && order.payment_method === 'qris' && active && order.payment_status !== 'paid' ? (
          <Button title="Bayar dengan QRIS" icon={QrCode} onPress={() => router.push(`/payment/${order.id}`)} />
        ) : null}
        {canCancel ? <Button title="Batalkan pesanan" variant="danger-soft" icon={XCircle} onPress={() => setDialog('cancel')} /> : null}
        {!active && reviews !== null ? <Button title="Pesan lagi" icon={RotateCcw} loading={reordering} onPress={() => (cartItems.length ? setDialog('reorder') : reorder(order))} /> : null}
        {reviews !== null ? <Button title="Butuh bantuan?" variant="secondary" icon={LifeBuoy} onPress={() => router.push({ pathname: '/support/new', params: { orderId: order.id, ref: formatQueueNumber(order) } })} /> : null}
        <Button title="Lihat semua pesanan" variant="ghost" onPress={() => router.replace('/(tabs)/orders')} />
      </View>
      {active ? <Text size="xs" tone="muted" center>Status diperbarui otomatis saat kafe memproses pesanan.</Text> : null}

      <ConfirmDialog visible={dialog === 'cancel'} title="Batalkan pesanan?" description="Pesanan bisa dibatalkan selama kafe belum menerimanya. Voucher dan poin yang dipakai akan dikembalikan."
        confirmLabel="Batalkan pesanan" onConfirm={cancelOrder} onClose={() => setDialog(null)} />
      <ConfirmDialog visible={dialog === 'reorder'} tone="primary" title="Ganti isi keranjang?" description="Keranjangmu masih berisi menu lain. Pesan lagi akan mengganti isi keranjang dengan menu dari pesanan ini."
        confirmLabel="Ganti & pesan lagi" onConfirm={() => reorder(order)} onClose={() => setDialog(null)} />
    </Screen>
  )
}

function Fact({ icon: Icon, label, value }) {
  const styles = useStyles()
  const { brand } = useBrand()
  return (
    <View style={styles.fact}>
      <Icon size={17} color={brand.colors.primaryPressed} />
      <Text size="xs" tone="muted">{label}</Text>
      <Text size="sm" weight="700">{value}</Text>
    </View>
  )
}

function ReviewItem({ orderId, item, existing, onSaved }) {
  const styles = useStyles()
  const { COLORS } = useTheme()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [rating, setRating] = useState(existing?.rating || 0)
  const [comment, setComment] = useState(existing?.comment || '')
  const [saving, setSaving] = useState(false)
  const name = item.product_name.replace(/\s*\(.*\)$/, '')

  async function save() {
    setSaving(true)
    const { error } = await supabase.rpc('review_submit', { p_order_id: orderId, p_product_id: item.product_id, p_rating: rating, p_comment: comment.trim() || null })
    setSaving(false)
    if (error) toast({ tone: 'error', title: 'Ulasan gagal dikirim', description: error.message })
    else {
      toast({ tone: 'success', title: existing ? 'Ulasan diperbarui' : 'Terima kasih atas ulasannya' })
      onSaved()
    }
  }

  return (
    <View style={styles.review}>
      <Text size="sm" weight="700">{name}</Text>
      <StarInput value={rating} onChange={setRating} label={`Rating ${name}`} />
      {rating > 0 && (
        <>
          <TextInput value={comment} onChangeText={setComment} placeholder="Ceritakan rasanya (opsional)" placeholderTextColor={COLORS.placeholder}
            multiline maxLength={500} accessibilityLabel={`Ulasan ${name}`} style={styles.reviewInput} />
          <Button title={existing ? 'Perbarui ulasan' : 'Kirim ulasan'} size="sm" variant="secondary" onPress={save} loading={saving} />
        </>
      )}
    </View>
  )
}

const useStyles = makeStyles(({ COLORS, STATUS_TONES }) => ({
  header: { gap: 7 },
  statusHero: { padding: 19, backgroundColor: COLORS.espresso, borderRadius: 18 },
  eyebrow: { color: COLORS.navAccent, letterSpacing: 1.3 },
  queueNumber: { color: COLORS.onDark },
  statusCopy: { color: withAlpha(COLORS.onDark, 0.78), fontSize: 13, lineHeight: 19 },
  flex: { flex: 1, gap: 3 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  fact: { flexGrow: 1, minWidth: 140, gap: 3, padding: 12, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14 },
  cancelled: { flexDirection: 'row', gap: 11, padding: 15, backgroundColor: STATUS_TONES.red.bg, borderRadius: 14 },
  steps: { gap: 4, padding: 16, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.borderSubtle, borderRadius: 15 },
  step: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 11 },
  stepMark: { width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 13, backgroundColor: COLORS.canvas },
  card: { padding: 16, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.borderSubtle, borderRadius: 15, gap: 10 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  divider: { height: 1, backgroundColor: COLORS.border },
  actions: { gap: 10 },
  review: { gap: 6, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  reviewInput: { minHeight: 70, padding: 12, color: COLORS.text, backgroundColor: COLORS.canvas, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, textAlignVertical: 'top', fontFamily: 'PlusJakartaSans', fontSize: 14 },
}))
