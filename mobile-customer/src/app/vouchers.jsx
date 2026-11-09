import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { Ticket } from 'lucide-react-native'
import { useAuth } from '../auth/useAuth.js'
import { useBrand } from '../brand/useBrand.js'
import { EmptyState, ErrorBox, formatCurrency, LoadingState, Screen } from '../components/ui.jsx'
import { Text } from '../components/ui/Text.jsx'
import { formatDateShort } from '../lib/format.js'
import { makeStyles } from '../theme/useTheme.js'

/** Voucher publik kafe (RLS hanya menampilkan yang aktif & publik). Dipakai dengan mengetik kodenya di checkout. */
export default function VouchersScreen() {
  const styles = useStyles()
  const { supabase } = useAuth()
  const { cafe, brand } = useBrand()
  const [vouchers, setVouchers] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!cafe || !supabase) return
    const { data, error: queryError } = await supabase.from('vouchers')
      .select('id, code, name, discount_type, discount_value, max_discount, min_subtotal, ends_at').eq('cafe_id', cafe.id).order('ends_at')
    if (queryError) return setError(queryError.message)
    setVouchers(data || [])
    return undefined
  }, [cafe, supabase])

  useEffect(() => {
    const timer = setTimeout(load, 0)
    return () => clearTimeout(timer)
  }, [load])

  if (error) return <Screen><ErrorBox message={error} onRetry={load} /></Screen>
  if (!vouchers) return <Screen><LoadingState label="Memuat voucher..." /></Screen>
  return (
    <Screen>
      <Text tone="muted" size="sm">Ketik kodenya di halaman checkout. Satu voucher per pesanan.</Text>
      {!vouchers.length ? <EmptyState icon={Ticket} title="Belum ada promo" description="Promo dari kafe akan muncul di sini." /> : vouchers.map((voucher) => (
        <View key={voucher.id} style={[styles.card, { borderColor: brand.colors.primarySoft }]}>
          <View style={[styles.stub, { backgroundColor: brand.colors.primary }]}>
            <Text weight="800" size="lg" style={styles.stubValue}>{voucher.discount_type === 'percent' ? `${Number(voucher.discount_value)}%` : formatCurrency(voucher.discount_value).replace(/\s/g, '')}</Text>
            <Text size={11} weight="700" style={styles.stubLabel}>DISKON</Text>
          </View>
          <View style={styles.body}>
            <Text weight="700">{voucher.name}</Text>
            <Text size="xs" tone="muted">
              {[Number(voucher.min_subtotal) ? `Min. ${formatCurrency(voucher.min_subtotal)}` : null, voucher.max_discount ? `maks. ${formatCurrency(voucher.max_discount)}` : null,
                voucher.ends_at ? `s.d. ${formatDateShort(voucher.ends_at)}` : null].filter(Boolean).join(' · ') || 'Tanpa minimal belanja'}
            </Text>
            <View style={styles.code}><Text weight="800" tabular style={{ color: brand.colors.primaryPressed, letterSpacing: 1.2 }} selectable>{voucher.code}</Text></View>
          </View>
        </View>
      ))}
    </Screen>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  card: { flexDirection: 'row', overflow: 'hidden', backgroundColor: COLORS.card, borderWidth: 1, borderRadius: 16 },
  stub: { width: 96, alignItems: 'center', justifyContent: 'center', gap: 2, padding: 10 },
  stubValue: { color: COLORS.textOnPrimary, textAlign: 'center' },
  stubLabel: { color: COLORS.onPrimaryMuted, letterSpacing: 1 },
  body: { flex: 1, gap: 5, padding: 14 },
  code: { alignSelf: 'flex-start', marginTop: 3, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.borderStrong, borderRadius: 8 },
}))
