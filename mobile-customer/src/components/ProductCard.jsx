import { Pressable, View } from 'react-native'
import { Plus, Star } from 'lucide-react-native'
import { router } from 'expo-router'
import { formatCurrency, ProductImage } from './ui.jsx'
import { Text } from './ui/Text.jsx'
import { makeStyles, useTheme } from '../theme/useTheme.js'

/** Kartu produk 2 kolom: foto, rating, nama, harga, tombol + (membuka detail untuk varian & catatan). */
export function ProductCard({ product, cafe }) {
  const styles = useStyles()
  const { COLORS } = useTheme()
  const open = () => router.push({ pathname: '/product/[id]', params: { id: product.id, cafeId: cafe.id } })
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${formatCurrency(product.price)}${product.sold_out ? ', habis' : ''}`}
      onPress={open}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={[styles.imageWrap, product.sold_out && styles.soldOutImage]}>
        <ProductImage uri={product.image_url} style={styles.image} />
        {product.reviews ? (
          <View style={styles.rating}>
            <Star size={11} color={COLORS.primary} fill={COLORS.primary} />
            <Text style={styles.ratingText}>{Number(product.rating).toFixed(1).replace('.', ',')}</Text>
          </View>
        ) : null}
        {product.sold_out ? <View style={styles.soldOut}><Text style={styles.soldOutText}>HABIS</Text></View> : null}
      </View>
      <View style={styles.details}>
        <Text style={styles.name} numberOfLines={1}>{product.name}</Text>
        <Text style={styles.description} numberOfLines={1}>{product.description || ' '}</Text>
        <View style={styles.priceRow}>
          <Text style={[styles.price, product.sold_out && styles.priceMuted]}>{formatCurrency(product.price)}</Text>
          {!product.sold_out ? (
            <View style={styles.add} accessibilityElementsHidden importantForAccessibility="no">
              <Plus size={17} color={COLORS.textOnPrimary} strokeWidth={2.6} />
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  )
}

const useStyles = makeStyles(({ COLORS, SHADOW }) => ({
  card: {
    flexGrow: 1, flexBasis: 150, maxWidth: '49%', minWidth: 145, overflow: 'hidden',
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.borderSubtle, borderRadius: 22, ...SHADOW.sm,
  },
  pressed: { opacity: 0.94, transform: [{ scale: 0.985 }] },
  imageWrap: { position: 'relative', overflow: 'hidden', margin: 7, marginBottom: 0, borderRadius: 17 },
  image: { width: '100%', height: 150, backgroundColor: COLORS.sunken },
  rating: {
    position: 'absolute', left: 8, top: 8, flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, backgroundColor: COLORS.overlay, borderRadius: 999,
  },
  ratingText: { color: COLORS.onDark, fontSize: 11, fontWeight: '700' },
  details: { paddingHorizontal: 13, paddingTop: 11, paddingBottom: 13, gap: 3 },
  name: { color: COLORS.text, fontFamily: 'Fraunces', fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  description: { color: COLORS.textMuted, fontSize: 11.5 },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 8 },
  price: { color: COLORS.text, fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  add: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: 12 },
  soldOutImage: { opacity: 0.5 },
  soldOut: { position: 'absolute', right: 8, top: 8, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: COLORS.espresso, borderRadius: 999 },
  soldOutText: { color: COLORS.onDark, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  priceMuted: { color: COLORS.textMuted },
}))
