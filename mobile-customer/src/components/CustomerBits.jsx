/*
 * Komponen kecil fitur customer fase 4: bintang rating, status kafe, banner meja, baris menu.
 */
import { Pressable, StyleSheet, View } from 'react-native'
import { ChevronRight, Clock3, MapPin, PauseCircle, Star, X } from 'lucide-react-native'
import { RADIUS } from '../theme/tokens.js'
import { useBrand } from '../brand/useBrand.js'
import { Text } from './ui/Text.jsx'
import { makeStyles, useTheme } from '../theme/useTheme.js'

/** ★ 4,6 (12) — ringkas untuk kartu menu. */
export function RatingInline({ rating, reviews, size = 12 }) {
  const styles = useStyles()
  const { STATUS_TONES } = useTheme()
  if (!reviews) return null
  return (
    <View style={styles.inline} accessibilityLabel={`Rating ${rating} dari 5, ${reviews} ulasan`}>
      <Star size={size} color={STATUS_TONES.amber.dot} fill={STATUS_TONES.amber.dot} />
      <Text size={size} weight="700">{String(rating).replace('.', ',')}</Text>
      <Text size={size} tone="muted">({reviews})</Text>
    </View>
  )
}

/** Input 1–5 bintang (target sentuh 40px). */
export function StarInput({ value, onChange, label = 'Rating' }) {
  const styles = useStyles()
  const { COLORS, STATUS_TONES } = useTheme()
  return (
    <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Pressable key={star} accessibilityRole="radio" accessibilityState={{ selected: value === star }} accessibilityLabel={`${star} bintang`}
          onPress={() => onChange(star)} hitSlop={4} style={styles.starButton}>
          <Star size={26} color={star <= value ? STATUS_TONES.amber.dot : COLORS.borderStrong} fill={star <= value ? STATUS_TONES.amber.dot : 'transparent'} />
        </Pressable>
      ))}
    </View>
  )
}

export function StarsDisplay({ value, size = 13 }) {
  const styles = useStyles()
  const { COLORS, STATUS_TONES } = useTheme()
  return (
    <View style={styles.inline} accessibilityLabel={`${value} dari 5 bintang`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star key={star} size={size} color={star <= value ? STATUS_TONES.amber.dot : COLORS.borderStrong} fill={star <= value ? STATUS_TONES.amber.dot : 'transparent'} />
      ))}
    </View>
  )
}

/** Status kafe: buka (estimasi), tutup (jadwal buka), atau dijeda. */
export function CafeStatusPill({ status }) {
  const styles = useStyles()
  const { STATUS_TONES } = useTheme()
  if (!status?.label) return null
  const tone = status.paused ? STATUS_TONES.amber : status.open ? STATUS_TONES.green : STATUS_TONES.red
  const Icon = status.paused ? PauseCircle : Clock3
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg }]} accessibilityRole="text">
      <Icon size={14} color={tone.fg} />
      <Text size="xs" weight="700" style={{ color: tone.fg }} numberOfLines={2}>{status.label}</Text>
    </View>
  )
}

/** Banner "Pesan untuk meja A1" dengan tombol keluar dari mode meja. */
export function TableBanner({ table, onClear }) {
  const styles = useStyles()
  const { COLORS } = useTheme()
  const { brand } = useBrand()
  if (!table) return null
  return (
    <View style={[styles.table, { backgroundColor: brand.colors.primaryTint, borderColor: brand.colors.primarySoft }]}>
      <MapPin size={18} color={brand.colors.primaryPressed} />
      <View style={styles.tableText}>
        <Text weight="700" size="sm">Pesan untuk meja {table.label}</Text>
        <Text size="xs" tone="muted">{table.area ? `${table.area} · ` : ''}Pesanan diantar ke meja ini</Text>
      </View>
      {onClear ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Bukan pesanan meja" onPress={onClear} hitSlop={10} style={styles.tableClose}>
          <X size={18} color={COLORS.textMuted} />
        </Pressable>
      ) : null}
    </View>
  )
}

/** Baris menu bergaya daftar (profil, pengaturan). */
export function MenuRow({ icon: Icon, title, detail, onPress, badge }) {
  const styles = useStyles()
  const { COLORS } = useTheme()
  const { brand } = useBrand()
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: COLORS.sunken }]}>
      {Icon ? <Icon size={20} color={brand.colors.primaryPressed} /> : null}
      <View style={styles.rowText}>
        <Text weight="600">{title}</Text>
        {detail ? <Text size="xs" tone="muted">{detail}</Text> : null}
      </View>
      {badge ? <View style={[styles.badge, { backgroundColor: brand.colors.primary }]}><Text size={11} weight="700" style={{ color: COLORS.textOnPrimary }}>{badge}</Text></View> : null}
      <ChevronRight size={18} color={COLORS.textMuted} />
    </Pressable>
  )
}

export function MenuGroup({ children }) {
  const styles = useStyles()
  return <View style={styles.group}>{children}</View>
}

/** Baris label–nilai di ringkasan (subtotal, diskon, pajak). */
export function SummaryRow({ label, value, strong = false, tone }) {
  const styles = useStyles()
  return (
    <View style={styles.summaryRow}>
      <Text size={strong ? 'base' : 'sm'} weight={strong ? '700' : '500'} tone={strong ? 'primary' : 'secondary'}>{label}</Text>
      <Text size={strong ? 'md' : 'sm'} weight={strong ? '800' : '600'} tabular style={tone ? { color: tone } : null}>{value}</Text>
    </View>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  inline: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  stars: { flexDirection: 'row', gap: 2 },
  starButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.full },
  table: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderWidth: 1, borderRadius: RADIUS.lg },
  tableText: { flex: 1, gap: 2 },
  tableClose: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  group: { overflow: 'hidden', backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 58, paddingHorizontal: 15, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  rowText: { flex: 1, gap: 2 },
  badge: { minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, borderRadius: 11 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
}))
