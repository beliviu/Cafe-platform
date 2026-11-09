import { StyleSheet, View } from 'react-native'
import { orderStatusMeta, paymentMethodLabel, paymentStatusMeta } from '../../lib/status.js'
import { RADIUS } from '../../theme/tokens.js'
import { Text } from './Text.jsx'
import { useTheme } from '../../theme/useTheme.js'

/** tone: amber | blue | green | neutral | red | sage */
export function Badge({ tone = 'neutral', dot = true, size = 'md', children, style }) {
  const { STATUS_TONES } = useTheme()
  const palette = STATUS_TONES[tone] || STATUS_TONES.neutral
  return (
    <View style={[styles.badge, size === 'lg' && styles.lg, { backgroundColor: palette.bg }, style]}>
      {dot && <View style={[styles.dot, { backgroundColor: palette.dot }]} />}
      <Text weight="600" size={size === 'lg' ? 'sm' : 'xs'} style={{ color: palette.fg }} numberOfLines={1}>{children}</Text>
    </View>
  )
}

export function OrderStatusBadge({ status, ...props }) {
  const meta = orderStatusMeta(status)
  return <Badge tone={meta.tone} {...props}>{meta.customerLabel}</Badge>
}

export function PaymentBadge({ status, method, showMethod = false, ...props }) {
  const meta = paymentStatusMeta(status)
  return <Badge tone={meta.tone} {...props}>{showMethod && method ? `${meta.label} · ${paymentMethodLabel(method)}` : meta.label}</Badge>
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.full },
  lg: { paddingHorizontal: 12, paddingVertical: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
})
