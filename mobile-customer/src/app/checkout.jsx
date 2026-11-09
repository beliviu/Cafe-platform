import { useEffect, useMemo, useState } from 'react'
import { router } from 'expo-router'
import { Platform, Pressable, ScrollView, Switch, TextInput, View } from 'react-native'
import { Banknote, QrCode, Ticket, X } from 'lucide-react-native'
import { useAuth } from '../auth/useAuth.js'
import { useBrand } from '../brand/useBrand.js'
import { useCart } from '../cart/useCart.js'
import { Button, ErrorBox, Field, formatCurrency, Screen, SegmentedControl, useToast } from '../components/ui.jsx'
import { Text } from '../components/ui/Text.jsx'
import { CafeStatusPill, SummaryRow, TableBanner } from '../components/CustomerBits.jsx'
import { openStatus } from '../lib/cafeHours.js'
import { checkoutError, newIdempotencyKey, rpc, useCafeStatus } from '../lib/customer.js'
import { useStaticQris } from '../lib/payments.js'
import { computeCharges } from '../lib/pricing.js'
import { makeStyles, useTheme } from '../theme/useTheme.js'

const CASH_OPTION = { value: 'cash', label: 'Bayar di kafe', detail: 'Bayar di kasir saat mengambil atau di meja.', icon: Banknote }
const STATIC_OPTION = { value: 'qris', label: 'QRIS kafe', detail: 'Scan QRIS kafe & ketik total. Kafe mengonfirmasi setelah uang masuk.', icon: QrCode }
const DAY_LABELS = ['Hari ini', 'Besok', 'Lusa']
const pad = (value) => String(value).padStart(2, '0')

/** Slot ambil per 30 menit dalam jam buka, mulai 20 menit dari sekarang (WIB). */
function pickupSlots(hours, dayOffset) {
  const local = new Date(Date.now() + 7 * 3600000 + dayOffset * 86400000)
  const key = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
  const earliest = Date.now() + 20 * 60000
  const slots = []
  for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
    const label = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
    const at = Date.parse(`${key}T${label}:00+07:00`)
    if (at < earliest) continue
    const status = openStatus(hours, new Date(at))
    const open = status ? status.open : minutes >= 7 * 60 && minutes <= 21 * 60
    if (open) slots.push({ value: new Date(at).toISOString(), label: label.replace(':', '.') })
  }
  return slots
}

export default function CheckoutScreen() {
  const styles = useStyles()
  const { COLORS } = useTheme()
  const { session, supabase } = useAuth()
  const { cafe, brand } = useBrand()
  const { toast } = useToast()
  const { items, cafeId, subtotal, clearCart, table, setTable } = useCart()
  const { status, reload: reloadStatus } = useCafeStatus(cafe)
  const [settings, setSettings] = useState(null)
  const [loyalty, setLoyalty] = useState(null)
  const [orderType, setOrderType] = useState('takeaway')
  const [when, setWhen] = useState('now')
  const [day, setDay] = useState(0)
  const [slot, setSlot] = useState(null)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [notes, setNotes] = useState('')
  const [voucherInput, setVoucherInput] = useState('')
  const [voucher, setVoucher] = useState(null)
  const [voucherError, setVoucherError] = useState('')
  const [checkingVoucher, setCheckingVoucher] = useState(false)
  const [usePoints, setUsePoints] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [orderKey, setOrderKey] = useState(newIdempotencyKey)
  const live = Boolean(status?.live) // file 08 aktif: voucher, poin, jadwal, QR
  const staticQris = useStaticQris(cafeId) // file 12: gambar QRIS milik kafe
  // Pembayaran: bayar di kafe, atau QRIS kafe bila owner sudah mengunggah gambar QRIS
  const paymentOptions = staticQris ? [CASH_OPTION, STATIC_OPTION] : [CASH_OPTION]
  const method = paymentOptions.some((option) => option.value === paymentMethod) ? paymentMethod : 'cash'

  useEffect(() => {
    if (!supabase || !cafeId) return
    supabase.from('cafe_settings').select('*').eq('cafe_id', cafeId).maybeSingle()
      .then(({ data }) => {
        setSettings(data || null)
        const types = data?.order_types || []
        if (types.length && !types.includes('takeaway')) setOrderType(types[0])
      })
  }, [cafeId, supabase])

  useEffect(() => {
    if (!supabase || !session || !cafeId || !live) return
    supabase.rpc('loyalty_me', { p_cafe_id: cafeId }).then(({ data }) => setLoyalty(data?.enabled ? data : null))
  }, [cafeId, live, session, supabase])

  const closedNow = status && !status.accepting
  const canSchedule = live && status?.scheduled_enabled && !table
  const scheduling = canSchedule && (when === 'later' || (closedNow && !status.paused))
  const slots = useMemo(() => (scheduling ? pickupSlots(cafe?.opening_hours, day) : []), [cafe?.opening_hours, day, scheduling])
  const voucherDiscount = voucher ? Math.min(voucher.discount, subtotal) : 0
  const pointsInfo = useMemo(() => {
    if (!loyalty || loyalty.balance < loyalty.min_redeem) return null
    const cap = Math.floor((subtotal - voucherDiscount) * loyalty.max_redeem_pct / 100)
    const points = Math.min(loyalty.balance, Math.floor(cap / loyalty.point_value))
    return points >= loyalty.min_redeem ? { points, value: points * loyalty.point_value } : null
  }, [loyalty, subtotal, voucherDiscount])
  const pointsDiscount = usePoints && pointsInfo ? pointsInfo.value : 0
  const charges = computeCharges(Math.max(subtotal - voucherDiscount - pointsDiscount, 0), settings)
  const orderTypes = (settings?.order_types?.length ? settings.order_types : ['takeaway', 'dine_in']).filter((type) => ['takeaway', 'dine_in'].includes(type))

  async function applyVoucher() {
    const code = voucherInput.trim().toUpperCase()
    if (!code) return
    setCheckingVoucher(true)
    setVoucherError('')
    const { data, error: rpcError } = await supabase.rpc('voucher_check', { p_cafe_id: cafeId, p_code: code, p_subtotal: subtotal })
    setCheckingVoucher(false)
    if (rpcError) return setVoucherError(rpcError.message)
    if (!data.ok) return setVoucherError(data.message)
    setVoucher({ code, name: data.name, discount: Number(data.discount) })
    setVoucherInput('')
    return undefined
  }

  async function placeOrder() {
    setError('')
    if (!session) {
      router.push({ pathname: '/login', params: { returnTo: '/checkout' } })
      return
    }
    if (!items.length || !cafeId) return setError('Keranjang kosong. Tambahkan menu sebelum checkout.')
    if (scheduling && !slot) return setError('Pilih jam ambil pesanan.')
    setLoading(true)
    const payload = items.map((item) => ({ product_id: item.product_id, quantity: item.quantity, option_ids: item.option_ids, ...(item.notes ? { notes: item.notes } : {}) }))
    let result = await rpc(supabase, 'customer_place_order', {
      p_cafe_id: cafeId, p_items: payload, p_order_type: table ? 'dine_in' : orderType, p_table_token: table?.token || null,
      p_notes: notes.trim() || null, p_payment_method: method === 'qris' ? null : method, p_idempotency_key: orderKey,
      p_scheduled_for: scheduling ? slot : null, p_voucher_code: voucher?.code || null, p_redeem_points: pointsDiscount ? pointsInfo.points : 0,
    })
    if (result.missing) {
      // Database belum memakai file 08 → jalur lama
      result = await rpc(supabase, 'create_order', { p_cafe_id: cafeId, p_items: payload, p_payment_method: method === 'qris' ? null : method, p_notes: notes.trim() || null })
    }
    setLoading(false)
    if (result.error) {
      const problem = checkoutError(result.error)
      setError(problem.message)
      if (problem.kind === 'voucher') setVoucher(null)
      if (problem.kind === 'closed' || problem.kind === 'paused') reloadStatus()
      return undefined
    }
    if (method === 'qris') {
      // Tandai pesanan dibayar via QRIS kafe; bila gagal, pesanan tetap ada (bayar di kafe)
      await rpc(supabase, 'customer_use_static_qris', { p_order_id: result.data })
    }
    clearCart()
    setOrderKey(newIdempotencyKey())
    toast({ tone: 'success', title: scheduling ? 'Pesanan terjadwal dibuat' : 'Pesanan dibuat', description: 'Kami kabari saat statusnya berubah.' })
    router.replace(method === 'cash' ? `/order/${result.data}` : `/payment/${result.data}`)
    return undefined
  }

  const blocked = Boolean(status?.paused) || (closedNow && !canSchedule)
  return (
    <Screen>
      {!session && <View style={styles.notice}><Text size="sm" style={{ color: brand.colors.primaryPressed }}>Masuk atau buat akun dulu sebelum memesan.</Text></View>}
      <TableBanner table={table} onClear={() => setTable(null)} />
      {status ? <CafeStatusPill status={status} /> : null}
      {error ? <ErrorBox message={error} /> : null}
      <View><Text size="xs" weight="800" tone="muted" style={styles.label}>PESANAN UNTUK</Text><Text weight="700" size="lg">{items[0]?.cafe_name || 'Keranjang kosong'}</Text></View>

      {!items.length ? <Text tone="muted">Tambahkan menu ke keranjang terlebih dahulu.</Text> : (
        <>
          <View style={styles.card}>
            {items.map((item) => (
              <View key={item.key} style={styles.line}>
                <View style={styles.lineText}>
                  <Text size="sm">{item.quantity} × {item.name}</Text>
                  {item.options?.length ? <Text size="xs" tone="muted">{item.options.map((option) => option.name).join(', ')}</Text> : null}
                </View>
                <Text size="sm" weight="600" tabular>{formatCurrency(item.unit_price * item.quantity)}</Text>
              </View>
            ))}
          </View>

          {!table && orderTypes.length > 1 && (
            <View style={styles.section}>
              <Text weight="700">Jenis pesanan</Text>
              <SegmentedControl value={orderType} onChange={setOrderType}
                options={orderTypes.map((type) => ({ value: type, label: type === 'dine_in' ? 'Makan di tempat' : 'Bawa pulang' }))} />
            </View>
          )}

          {canSchedule && (
            <View style={styles.section}>
              <Text weight="700">Waktu ambil</Text>
              {!closedNow && (
                <SegmentedControl value={when} onChange={(value) => { setWhen(value); setSlot(null) }}
                  options={[{ value: 'now', label: status?.prep_minutes ? `Secepatnya · ±${status.prep_minutes} mnt` : 'Secepatnya' }, { value: 'later', label: 'Jadwalkan' }]} />
              )}
              {scheduling && (
                <>
                  {closedNow && <Text size="sm" tone="muted">Kafe sedang tutup — pilih jam ambil saat kafe buka.</Text>}
                  <SegmentedControl value={day} onChange={(value) => { setDay(value); setSlot(null) }} options={DAY_LABELS.map((label, index) => ({ value: index, label }))} />
                  {slots.length ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.slots}>
                      {slots.map((item) => (
                        <Pressable key={item.value} accessibilityRole="radio" accessibilityState={{ selected: slot === item.value }} onPress={() => setSlot(item.value)}
                          style={[styles.slot, slot === item.value && { borderColor: brand.colors.primary, backgroundColor: brand.colors.primaryTint }]}>
                          <Text size="sm" weight="700" tabular style={slot === item.value ? { color: brand.colors.primaryPressed } : null}>{item.label}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  ) : <Text size="sm" tone="muted">Tidak ada jam tersedia di hari ini. Pilih hari lain.</Text>}
                </>
              )}
            </View>
          )}

          {live && (
            <View style={styles.section}>
              <Text weight="700">Voucher</Text>
              {voucher ? (
                <View style={[styles.applied, { borderColor: brand.colors.primarySoft, backgroundColor: brand.colors.primaryTint }]}>
                  <Ticket size={18} color={brand.colors.primaryPressed} />
                  <View style={styles.lineText}><Text weight="700" size="sm">{voucher.code} · −{formatCurrency(voucher.discount)}</Text><Text size="xs" tone="muted">{voucher.name}</Text></View>
                  <Pressable accessibilityRole="button" accessibilityLabel="Lepas voucher" onPress={() => setVoucher(null)} hitSlop={10} style={styles.iconTap}><X size={18} color={COLORS.textMuted} /></Pressable>
                </View>
              ) : (
                <View style={styles.voucherRow}>
                  <TextInput value={voucherInput} onChangeText={(text) => { setVoucherInput(text.toUpperCase()); setVoucherError('') }} placeholder="Kode voucher" placeholderTextColor={COLORS.placeholder}
                    autoCapitalize="characters" maxLength={20} accessibilityLabel="Kode voucher" style={styles.voucherInput} />
                  <Button title="Pakai" variant="secondary" onPress={applyVoucher} loading={checkingVoucher} disabled={!voucherInput.trim()} />
                </View>
              )}
              {voucherError ? <Text size="xs" weight="600" tone="danger">{voucherError}</Text> : (
                <Pressable onPress={() => router.push('/vouchers')} hitSlop={6}><Text size="xs" weight="700" style={{ color: brand.colors.primaryPressed }}>Lihat voucher yang tersedia</Text></Pressable>
              )}
            </View>
          )}

          {pointsInfo && (
            <View style={[styles.card, styles.pointsRow]}>
              <View style={styles.lineText}>
                <Text weight="700" size="sm">Pakai {pointsInfo.points} poin</Text>
                <Text size="xs" tone="muted">Hemat {formatCurrency(pointsInfo.value)} · saldo {loyalty.balance} poin</Text>
              </View>
              <Switch value={usePoints} onValueChange={setUsePoints} accessibilityLabel="Pakai poin" trackColor={{ true: brand.colors.primary, false: COLORS.borderStrong }}
                thumbColor={COLORS.card} {...(Platform.OS === 'web' ? { activeThumbColor: COLORS.card } : {})} />
            </View>
          )}

          <View style={styles.section}>
            <Text weight="700">Pembayaran</Text>
            {paymentOptions.map((option) => (
              <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ selected: method === option.value }} onPress={() => setPaymentMethod(option.value)}
                style={[styles.option, method === option.value && { borderColor: brand.colors.primary, backgroundColor: brand.colors.primaryTint }]}>
                <View style={[styles.radio, method === option.value && { borderWidth: 5, borderColor: brand.colors.primary }]} />
                <option.icon size={19} color={method === option.value ? brand.colors.primary : COLORS.textMuted} />
                <View style={styles.lineText}><Text weight="700" size="sm">{option.label}</Text><Text size="xs" tone="muted">{option.detail}</Text></View>
              </Pressable>
            ))}
          </View>
          <Field label="Catatan untuk kafe (opsional)" value={notes} onChangeText={setNotes} placeholder="Contoh: tolong pisah sedotan" multiline maxLength={1000} />

          <View style={styles.card}>
            <SummaryRow label="Subtotal" value={formatCurrency(subtotal)} />
            {voucherDiscount ? <SummaryRow label={`Voucher ${voucher.code}`} value={`−${formatCurrency(voucherDiscount)}`} tone={COLORS.primaryPressed} /> : null}
            {pointsDiscount ? <SummaryRow label={`${pointsInfo.points} poin`} value={`−${formatCurrency(pointsDiscount)}`} tone={COLORS.primaryPressed} /> : null}
            {charges.service ? <SummaryRow label={`Service ${charges.serviceRate}%`} value={formatCurrency(charges.service)} /> : null}
            {charges.tax ? <SummaryRow label={`Pajak ${charges.taxRate}%${charges.taxInclusive ? ' (termasuk)' : ''}`} value={formatCurrency(charges.tax)} /> : null}
            {charges.rounding ? <SummaryRow label="Pembulatan" value={formatCurrency(charges.rounding)} /> : null}
            <View style={styles.divider} />
            <SummaryRow label="Perkiraan total" value={formatCurrency(charges.total)} strong />
            <Text size="xs" tone="muted">Total final dihitung kafe saat pesanan dibuat (harga, stok, voucher & poin dicek ulang).</Text>
          </View>

          <Button
            title={!session ? 'Masuk untuk memesan' : blocked ? (status?.paused ? 'Pesanan sedang dijeda' : 'Kafe sedang tutup') : scheduling ? 'Jadwalkan pesanan' : method === 'qris' ? 'Pesan & bayar QRIS' : 'Buat pesanan'}
            onPress={placeOrder} loading={loading} disabled={Boolean(session) && blocked}
          />
        </>
      )}
    </Screen>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  notice: { padding: 14, backgroundColor: COLORS.primaryTint, borderLeftWidth: 3, borderLeftColor: COLORS.primary, borderRadius: 12 },
  label: { letterSpacing: 1.2 },
  card: { padding: 16, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.borderSubtle, borderRadius: 15, gap: 11 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 14 },
  lineText: { flex: 1, gap: 2 },
  section: { gap: 10, paddingTop: 2 },
  slots: { gap: 8, paddingVertical: 2 },
  slot: { minWidth: 68, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.borderSubtle, borderRadius: 11 },
  applied: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderWidth: 1, borderRadius: 14 },
  iconTap: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  voucherRow: { flexDirection: 'row', gap: 10 },
  voucherInput: { flex: 1, minHeight: 48, paddingHorizontal: 14, color: COLORS.text, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, fontFamily: 'PlusJakartaSans', fontSize: 15, fontWeight: '700', letterSpacing: 1 },
  pointsRow: { flexDirection: 'row', alignItems: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 68, padding: 13, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.borderSubtle, borderRadius: 14 },
  radio: { width: 18, height: 18, borderWidth: 1.5, borderColor: COLORS.borderStrong, borderRadius: 9 },
  divider: { height: 1, backgroundColor: COLORS.border },
}))
