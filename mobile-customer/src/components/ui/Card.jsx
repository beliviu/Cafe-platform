import { Pressable, View } from 'react-native'
import { RADIUS } from '../../theme/tokens.js'
import { makeStyles } from '../../theme/useTheme.js'

/** Kartu permukaan putih hangat. Beri `onPress` agar bisa ditekan (dengan umpan balik). */
export function Card({ children, onPress, padding = 16, style, accessibilityLabel, accessibilityHint }) {
  const styles = useStyles()
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        onPress={onPress}
        style={({ pressed }) => [styles.card, { padding }, pressed && styles.pressed, style]}
      >
        {children}
      </Pressable>
    )
  }
  return <View style={[styles.card, { padding }, style]}>{children}</View>
}

const useStyles = makeStyles(({ COLORS, SHADOW }) => ({
  card: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.borderSubtle, borderRadius: RADIUS.lg, ...SHADOW.sm },
  pressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
}))
