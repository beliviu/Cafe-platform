import { LinearGradient } from 'expo-linear-gradient'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { RADIUS, TAP_TARGET } from '../../theme/tokens.js'
import { Text } from './Text.jsx'
import { useBrand } from '../../brand/useBrand.js'
import { makeStyles, useTheme } from '../../theme/useTheme.js'

/** Warna tiap varian dari tema aktif (dihitung sekali per tema). */
const variantCache = new WeakMap()
function variantsFor({ COLORS, STATUS_TONES }) {
  if (variantCache.has(COLORS)) return variantCache.get(COLORS)
  const variants = {
    primary: { bg: COLORS.primary, pressed: COLORS.primaryPressed, fg: COLORS.textOnPrimary, border: 'transparent' },
    secondary: { bg: COLORS.raised, pressed: COLORS.primaryTint, fg: COLORS.text, border: COLORS.border },
    ghost: { bg: 'transparent', pressed: COLORS.hover, fg: COLORS.textSecondary, border: 'transparent' },
    danger: { bg: COLORS.danger, pressed: COLORS.dangerPressed, fg: '#FFFFFF', border: 'transparent' },
    'danger-soft': { bg: STATUS_TONES.red.bg, pressed: COLORS.dangerSoftPressed, fg: STATUS_TONES.red.fg, border: 'transparent' },
  }
  variants.quiet = { ...variants.ghost, border: COLORS.border } // alias lama
  variantCache.set(COLORS, variants)
  return variants
}

/** Varian primary/secondary mengikuti warna brand kafe (cafes.brand_color). */
function useVariant(variant, fallback) {
  const { brand } = useBrand()
  const VARIANTS = variantsFor(useTheme())
  const base = VARIANTS[variant] || VARIANTS[fallback]
  const { primary, primaryPressed, primaryTint } = brand.colors
  if (variant === 'primary' || (!VARIANTS[variant] && fallback === 'primary')) return { ...base, bg: primary, pressed: primaryPressed }
  if (variant === 'secondary' || (!VARIANTS[variant] && fallback === 'secondary')) return { ...base, pressed: primaryTint }
  return base
}

/**
 * Tombol. variant: primary | secondary | ghost | danger | danger-soft
 * size: sm (40) | md (48) | lg (54). icon / iconRight = komponen ikon lucide.
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  disabled = false,
  loading = false,
  block = false,
  accessibilityLabel,
  style,
}) {
  const styles = useStyles()
  const palette = useVariant(variant, 'primary')
  const { brand } = useBrand()
  const showGradient = variant === 'primary' && brand.isGradient
  const inactive = disabled || loading
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[size],
        { backgroundColor: pressed ? palette.pressed : palette.bg, borderColor: palette.border },
        showGradient && styles.gradientHost,
        block && styles.block,
        inactive && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {showGradient && (
        <LinearGradient colors={brand.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
      )}
      {loading ? <ActivityIndicator color={palette.fg} /> : (
        <View style={styles.content}>
          {Icon && <Icon size={size === 'sm' ? 16 : 18} color={palette.fg} strokeWidth={2.2} />}
          {title ? <Text weight="700" size={size === 'sm' ? 'sm' : 'base'} style={{ color: palette.fg }}>{title}</Text> : null}
          {IconRight && <IconRight size={size === 'sm' ? 16 : 18} color={palette.fg} strokeWidth={2.2} />}
        </View>
      )}
    </Pressable>
  )
}

/** Tombol ikon 44×44 — `label` wajib untuk pembaca layar. */
export function IconButton({ icon: Icon, label, onPress, variant = 'secondary', size = TAP_TARGET, badge, color, disabled = false, style }) {
  const styles = useStyles()
  const palette = useVariant(variant, 'secondary')
  const { brand } = useBrand()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={size < TAP_TARGET ? (TAP_TARGET - size) / 2 : undefined}
      style={({ pressed }) => [
        styles.iconButton,
        { width: size, height: size, backgroundColor: pressed ? palette.pressed : palette.bg, borderColor: palette.border },
        disabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      <Icon size={Math.round(size * 0.44)} color={color || palette.fg} strokeWidth={2.1} />
      {badge ? (
        <View style={[styles.badge, { backgroundColor: brand.colors.primary }]} accessibilityElementsHidden importantForAccessibility="no">
          <Text weight="700" size={11} tone="inverse" tabular style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  button: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, borderWidth: 1, borderRadius: RADIUS.md },
  sm: { minHeight: 40, paddingHorizontal: 14, borderRadius: RADIUS.sm + 2 },
  md: { minHeight: 48 },
  lg: { minHeight: 54, borderRadius: RADIUS.lg },
  block: { alignSelf: 'stretch' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  disabled: { opacity: 0.5 },
  gradientHost: { overflow: 'hidden' },
  pressed: { transform: [{ scale: 0.98 }] },
  iconButton: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: RADIUS.md },
  badge: {
    position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, paddingHorizontal: 5,
    alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: 10,
    borderWidth: 2, borderColor: COLORS.canvas,
  },
  badgeText: { lineHeight: 13 },
}))
