import { Text as RNText } from 'react-native'
import { FONTS, TYPE } from '../../theme/tokens.js'
import { makeStyles } from '../../theme/useTheme.js'

/**
 * Text dengan font brand. Pakai ini menggantikan Text dari react-native.
 * tone: primary | secondary | muted | brand | danger | inverse
 */
export function Text({ style, tone = 'primary', weight, size, serif = false, tabular = false, center = false, ...props }) {
  const styles = useStyles()
  return (
    <RNText
      {...props}
      style={[
        styles.base,
        serif && styles.serif,
        tone !== 'primary' && styles[`tone_${tone}`],
        weight && { fontWeight: weight },
        size && { fontSize: TYPE[size] ?? size, lineHeight: Math.round((TYPE[size] ?? size) * 1.4) },
        tabular && styles.tabular,
        center && styles.center,
        style,
      ]}
    />
  )
}

/** Judul serif dengan titik aksen brand ("Menu."). */
export function Heading({ children, period = true, size = '2xl', style, ...props }) {
  const styles = useStyles()
  return (
    <Text serif weight="600" size={size} style={[styles.heading, style]} accessibilityRole="header" {...props}>
      {children}
      {period && <RNText style={styles.period}>.</RNText>}
    </Text>
  )
}

/** Alias lama. */
export function AppText({ muted = false, ...props }) {
  return <Text tone={muted ? 'muted' : 'primary'} size={muted ? 'sm' : undefined} {...props} />
}

const useStyles = makeStyles(({ COLORS }) => ({
  base: { color: COLORS.text, fontFamily: FONTS.sans, fontSize: TYPE.base },
  serif: { fontFamily: FONTS.serif, letterSpacing: -0.3 },
  heading: { color: COLORS.text },
  period: { color: COLORS.primary },
  tabular: { fontVariant: ['tabular-nums'] },
  center: { textAlign: 'center' },
  tone_secondary: { color: COLORS.textSecondary },
  tone_muted: { color: COLORS.textMuted },
  tone_brand: { color: COLORS.primaryPressed },
  tone_danger: { color: COLORS.red },
  tone_inverse: { color: COLORS.textOnPrimary },
}))
