import { useEffect, useState } from 'react'
import { Animated, Easing, View } from 'react-native'
import { AlertCircle, Coffee } from 'lucide-react-native'
import { RADIUS } from '../../theme/tokens.js'
import { Button } from './Button.jsx'
import { Text } from './Text.jsx'
import { makeStyles, useTheme } from '../../theme/useTheme.js'

export function EmptyState({ icon: Icon = Coffee, title, description, action, tone = 'sage', compact = false, style }) {
  const styles = useStyles()
  const { STATUS_TONES } = useTheme()
  const palette = STATUS_TONES[tone] || STATUS_TONES.sage
  return (
    <View style={[styles.empty, compact && styles.emptyCompact, style]}>
      <View style={[styles.emptyIcon, { backgroundColor: palette.bg }]}>
        <Icon size={compact ? 20 : 24} color={palette.fg} strokeWidth={2} />
      </View>
      <Text weight="700" size="md" center>{title}</Text>
      {description ? <Text tone="muted" size="sm" center style={styles.emptyDescription}>{description}</Text> : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  )
}

export function ErrorState({ title = 'Gagal memuat', message, onRetry, compact = false, style }) {
  return (
    <EmptyState
      icon={AlertCircle}
      tone="red"
      compact={compact}
      title={title}
      description={message}
      style={style}
      action={onRetry ? <Button title="Coba lagi" variant="secondary" size="sm" onPress={onRetry} /> : null}
    />
  )
}

/** Kotak pesan error ringkas (inline). */
export function ErrorBox({ message, onRetry }) {
  const styles = useStyles()
  const { STATUS_TONES } = useTheme()
  if (!message) return null
  return (
    <View style={styles.errorBox} accessibilityRole="alert">
      <AlertCircle size={18} color={STATUS_TONES.red.fg} />
      <View style={styles.errorText}>
        <Text size="sm" style={{ color: STATUS_TONES.red.fg }}>{message}</Text>
        {onRetry ? <Text weight="700" size="sm" tone="brand" onPress={onRetry} accessibilityRole="button" suppressHighlighting>Coba lagi</Text> : null}
      </View>
    </View>
  )
}

/** Blok placeholder berdenyut halus. */
export function Skeleton({ width = '100%', height = 14, radius = 8, style }) {
  const { COLORS } = useTheme()
  const [opacity] = useState(() => new Animated.Value(0.55))
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [opacity])
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: COLORS.sunken, opacity }, style]} />
}

/** Placeholder untuk grid kartu produk 2 kolom. */
export function ProductGridSkeleton({ count = 4 }) {
  const styles = useStyles()
  return (
    <View style={styles.grid} accessibilityLabel="Memuat menu" accessibilityRole="progressbar">
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.gridItem}>
          <Skeleton height={124} radius={14} />
          <Skeleton width="75%" style={styles.gap} />
          <Skeleton width="45%" height={12} />
        </View>
      ))}
    </View>
  )
}

/** Placeholder untuk daftar kartu (pesanan, dsb). */
export function ListSkeleton({ rows = 3 }) {
  const styles = useStyles()
  return (
    <View style={styles.list} accessibilityLabel="Memuat" accessibilityRole="progressbar">
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={styles.listRow}>
          <Skeleton width={44} height={44} radius={12} />
          <View style={styles.listText}><Skeleton width="55%" /><Skeleton width="35%" height={12} /></View>
          <Skeleton width={64} height={22} radius={999} />
        </View>
      ))}
    </View>
  )
}

/** Alias lama: sekarang skeleton daftar, bukan spinner. */
export function LoadingState() {
  return <ListSkeleton rows={2} />
}

const useStyles = makeStyles(({ COLORS, STATUS_TONES }) => ({
  empty: { alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 32, paddingHorizontal: 24, backgroundColor: COLORS.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.borderSubtle },
  emptyCompact: { paddingVertical: 20 },
  emptyIcon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.lg, marginBottom: 6 },
  emptyDescription: { maxWidth: 300 },
  emptyAction: { marginTop: 10 },
  errorBox: { flexDirection: 'row', gap: 10, padding: 14, backgroundColor: STATUS_TONES.red.bg, borderRadius: RADIUS.md },
  errorText: { flex: 1, gap: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridItem: { width: '47%', flexGrow: 1, gap: 8, padding: 10, backgroundColor: COLORS.card, borderRadius: RADIUS.lg },
  gap: { marginTop: 4 },
  list: { gap: 10 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: COLORS.card, borderRadius: RADIUS.lg },
  listText: { flex: 1, gap: 8 },
}))
