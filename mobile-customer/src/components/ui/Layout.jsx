import { Image, Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronRight, Coffee } from 'lucide-react-native'
import { Text } from './Text.jsx'
import { makeStyles, useTheme } from '../../theme/useTheme.js'

export function Screen({ children, scroll = true, contentStyle, style, edges, refreshControl }) {
  const styles = useStyles()
  const content = scroll
    ? <ScrollView contentContainerStyle={[styles.content, contentStyle]} keyboardShouldPersistTaps="handled" refreshControl={refreshControl}>{children}</ScrollView>
    : <View style={[styles.content, styles.fill, contentStyle]}>{children}</View>
  return <SafeAreaView edges={edges} style={[styles.screen, style]}>{content}</SafeAreaView>
}

export function SectionTitle({ title, action, onAction }) {
  const styles = useStyles()
  const { COLORS } = useTheme()
  return (
    <View style={styles.sectionTitle}>
      <Text weight="700" size="lg" accessibilityRole="header">{title}</Text>
      {action ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={10} style={styles.sectionAction}>
          <Text weight="700" size="sm" tone="brand">{action}</Text>
          <ChevronRight size={16} color={COLORS.primary} />
        </Pressable>
      ) : null}
    </View>
  )
}

export function ProductImage({ uri, style, placeholderStyle, iconSize = 28 }) {
  const styles = useStyles()
  const { COLORS } = useTheme()
  return uri
    ? <Image source={{ uri }} style={style} resizeMode="cover" accessibilityIgnoresInvertColors />
    : (
      <View style={[style, styles.imagePlaceholder, placeholderStyle]}>
        <Coffee size={iconSize} color={COLORS.primary} strokeWidth={1.8} />
      </View>
    )
}

const useStyles = makeStyles(({ COLORS }) => ({
  screen: { flex: 1, backgroundColor: COLORS.canvas },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 34, gap: 18 },
  fill: { flex: 1 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44 },
  imagePlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.sand },
}))
