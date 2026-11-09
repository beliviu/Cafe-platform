import { Image } from 'expo-image'
import { Coffee } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'
import { useBrand } from './useBrand.js'
import { makeStyles } from '../theme/useTheme.js'

/** Logo kafe. Tanpa logo: ikon kopi di kotak warna brand muda. */
export function BrandMark({ size = 44 }) {
  const styles = useStyles()
  const { brand } = useBrand()
  const radius = Math.round(size * 0.3)
  if (brand.logoUrl) {
    return (
      <View style={[styles.frame, { width: size, height: size, borderRadius: radius }]}>
        <Image source={{ uri: brand.logoUrl }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityLabel={`Logo ${brand.name}`} />
      </View>
    )
  }
  return (
    <View style={[styles.frame, styles.fallback, { width: size, height: size, borderRadius: radius, backgroundColor: brand.colors.primarySoft }]}>
      <Coffee size={Math.round(size * 0.5)} color={brand.colors.primaryDeep} strokeWidth={1.9} />
    </View>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  frame: { overflow: 'hidden', backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.borderSubtle },
  fallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 0 },
}))
