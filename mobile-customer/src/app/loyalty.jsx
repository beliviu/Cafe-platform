import { useCallback, useEffect, useState } from 'react'
import { router } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { Sparkles } from 'lucide-react-native'
import { useAuth } from '../auth/useAuth.js'
import { useBrand } from '../brand/useBrand.js'
import { Button, EmptyState, ErrorBox, formatCurrency, LoadingState, Screen } from '../components/ui.jsx'
import { Text } from '../components/ui/Text.jsx'
import { formatDateShort, formatNumber } from '../lib/format.js'
import { POINTS_KIND } from '../lib/customer.js'
import { makeStyles, useTheme } from '../theme/useTheme.js'
import { withAlpha } from '../theme/palette.js'

export default function LoyaltyScreen() {
  const styles = useStyles()
  const { COLORS } = useTheme()
  const { session, supabase } = useAuth()
  const { cafe, brand } = useBrand()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!session || !cafe) return
    const [me, ledger] = await Promise.all([
      supabase.rpc('loyalty_me', { p_cafe_id: cafe.id }),
      supabase.from('loyalty_ledger').select('id, kind, points, balance_after, note, created_at').eq('cafe_id', cafe.id).order('created_at', { ascending: false }).limit(100),
    ])
    if (me.error) return setError(me.error.message)
    setData({ me: me.data, ledger: ledger.data || [] })
    return undefined
  }, [cafe, session, supabase])

  useEffect(() => {
    const timer = setTimeout(load, 0)
    return () => clearTimeout(timer)
  }, [load])

  if (!session) return <Screen><EmptyState title="Masuk untuk melihat poin" action={<Button title="Masuk" onPress={() => router.push('/login')} />} /></Screen>
  if (error) return <Screen><ErrorBox message={error} onRetry={load} /></Screen>
  if (!data) return <Screen><LoadingState label="Memuat poin..." /></Screen>
  const { me, ledger } = data
  if (!me.enabled) return <Screen><EmptyState icon={Sparkles} title="Program poin belum aktif" description="Kafe ini belum menjalankan program poin." /></Screen>

  const spend = Number(me.lifetime_spend)
  const next = me.next_tier
  const from = Number(me.tier?.min_spend || 0)
  const progress = next ? Math.min(1, (spend - from) / Math.max(Number(next.min_spend) - from, 1)) : 1

  return (
    <Screen>
      <View style={[styles.hero, { backgroundColor: brand.colors.primary }]}>
        <Text size="xs" weight="800" style={styles.heroLabel}>{(me.tier?.name || 'MEMBER').toUpperCase()}</Text>
        <Text serif weight="700" size={40} style={styles.heroValue} tabular>{formatNumber(me.balance)}</Text>
        <Text size="sm" style={styles.heroCopy}>poin · senilai {formatCurrency(me.balance * Number(me.point_value))}</Text>
        <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} /></View>
        <Text size="xs" style={styles.heroCopy}>
          {next ? `Belanja ${formatCurrency(Number(next.min_spend) - spend)} lagi untuk naik ke ${next.name} (poin ×${next.multiplier})` : `Tingkat tertinggi · poin ×${me.tier?.multiplier}`}
        </Text>
      </View>

      <View style={styles.card}>
        <Text weight="700">Cara kerja</Text>
        <Text size="sm" tone="secondary">• Dapat 1 poin tiap belanja {formatCurrency(me.spend_per_point)} (dikali tingkat member), setelah pesanan selesai.</Text>
        <Text size="sm" tone="secondary">• Tukar minimal {me.min_redeem} poin saat checkout; 1 poin = {formatCurrency(me.point_value)}, maksimal {me.max_redeem_pct}% dari belanja.</Text>
        <Text size="sm" tone="secondary">• Pesanan batal → poin yang ditukar kembali. Refund → poin dari pesanan itu dikurangi.</Text>
      </View>

      <View style={styles.card}>
        <Text weight="700">Tingkat member</Text>
        {(me.tiers || []).map((tier) => (
          <View key={tier.name} style={styles.tierRow}>
            <Text size="sm" weight={tier.name === me.tier?.name ? '800' : '500'}>{tier.name}{tier.name === me.tier?.name ? ' · kamu' : ''}</Text>
            <Text size="sm" tone="muted">{Number(tier.min_spend) ? `belanja ≥ ${formatCurrency(tier.min_spend)}` : 'awal'} · ×{tier.multiplier}</Text>
          </View>
        ))}
        <Text size="xs" tone="muted">Total belanja kamu: {formatCurrency(spend)}</Text>
      </View>

      <View style={styles.card}>
        <Text weight="700">Riwayat poin</Text>
        {!ledger.length ? <Text size="sm" tone="muted">Belum ada riwayat. Poin pertama masuk setelah pesanan selesai.</Text> : ledger.map((row) => (
          <View key={row.id} style={styles.ledgerRow}>
            <View style={styles.flex}>
              <Text size="sm" weight="600">{POINTS_KIND[row.kind] || row.kind}</Text>
              <Text size="xs" tone="muted">{row.note ? `${row.note} · ` : ''}{formatDateShort(row.created_at)}</Text>
            </View>
            <Text weight="800" tabular style={{ color: row.points > 0 ? brand.colors.primaryPressed : COLORS.red }}>{row.points > 0 ? '+' : ''}{formatNumber(row.points)}</Text>
          </View>
        ))}
      </View>
    </Screen>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  hero: { gap: 6, padding: 20, borderRadius: 22 },
  heroLabel: { color: COLORS.onPrimaryMuted, letterSpacing: 1.4 },
  heroValue: { color: COLORS.textOnPrimary, lineHeight: 48 },
  heroCopy: { color: COLORS.onPrimaryMuted },
  track: { height: 8, marginTop: 8, overflow: 'hidden', backgroundColor: withAlpha(COLORS.textOnPrimary, 0.18), borderRadius: 4 },
  fill: { height: '100%', backgroundColor: COLORS.textOnPrimary, borderRadius: 4 },
  card: { gap: 9, padding: 16, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16 },
  tierRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  ledgerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  flex: { flex: 1, gap: 2 },
}))
