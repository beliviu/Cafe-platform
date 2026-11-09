import { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { useCafeProducts } from '../../components/useCafeData.js'
import { BrandMark } from '../../brand/BrandMark.jsx'
import { useBrand } from '../../brand/useBrand.js'
import { ProductCard } from '../../components/ProductCard.jsx'
import { PromoCarousel } from '../../components/PromoCarousel.jsx'
import { useCafePromotions } from '../../components/useCafePromotions.js'
import { AppText, EmptyState, ErrorBox, IconButton, LoadingState, Screen, SectionTitle } from '../../components/ui.jsx'
import { useCart } from '../../cart/useCart.js'
import { Text } from '../../components/ui/Text.jsx'
import { ArrowRight, Bell, Search, ShieldCheck, ShoppingBag, Sparkles } from 'lucide-react-native'
import { useAuth } from '../../auth/useAuth.js'
import { CafeStatusPill, TableBanner } from '../../components/CustomerBits.jsx'
import { useCafeStatus } from '../../lib/customer.js'
import { useNotifications } from '../../lib/useNotifications.js'
import { formatNumber } from '../../lib/format.js'
import { makeStyles, useTheme } from '../../theme/useTheme.js'

/** Sapaan sesuai jam WIB (UTC+7). */
function greetingNow() {
  const hour = (new Date().getUTCHours() + 7) % 24
  if (hour < 11) return 'Selamat pagi'
  if (hour < 15) return 'Selamat siang'
  if (hour < 19) return 'Selamat sore'
  return 'Selamat malam'
}

function CafeHighlights({ cafe, products, categories, loading, error, reload }) {
  const styles = useStyles()
  if (loading) return <LoadingState label="Memuat menu pilihan..." />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  const ratedProducts = products
    .filter((product) => Number(product.reviews) > 0)
    .sort((left, right) => Number(right.rating) - Number(left.rating) || Number(right.reviews) - Number(left.reviews))
  const featured = (ratedProducts.length ? ratedProducts : products).slice(0, 4)
  return (
    <>
      {categories.length ? (
        <View style={styles.categorySection}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>
            <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/menu')} style={[styles.category, styles.categoryActive]}>
              <Text style={[styles.categoryName, styles.categoryNameActive]}>Semua</Text>
            </Pressable>
            {categories.map((category) => (
              <Pressable
                key={category.id}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/(tabs)/menu', params: { categoryId: category.id } })}
                style={styles.category}
              >
                <Text style={styles.categoryName}>{category.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      <View style={styles.highlightSection}>
        <SectionTitle
          title={ratedProducts.length ? 'Favorit pelanggan' : 'Menu yang bisa kamu coba'}
          action="Lihat semua"
          onAction={() => router.push('/(tabs)/menu')}
        />
        <View style={styles.products}>
          {featured.map((product) => <ProductCard key={product.id} product={product} cafe={cafe} />)}
        </View>
      </View>
    </>
  )
}

/** Kartu poin & tingkat member (bila program loyalti kafe aktif). */
function MemberCard({ cafe }) {
  const styles = useStyles()
  const { session, supabase } = useAuth()
  const { brand } = useBrand()
  const [loyalty, setLoyalty] = useState(null)
  useEffect(() => {
    if (!session || !supabase || !cafe?.id) return
    supabase.rpc('loyalty_me', { p_cafe_id: cafe.id }).then(({ data }) => setLoyalty(data?.enabled ? data : null))
  }, [cafe?.id, session, supabase])
  if (!loyalty) return null
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/loyalty')} style={[styles.member, { backgroundColor: brand.colors.primaryTint, borderColor: brand.colors.primarySoft }]}>
      <Sparkles size={20} color={brand.colors.primaryPressed} />
      <View style={styles.memberText}>
        <Text style={styles.memberTitle}>{formatNumber(loyalty.balance)} poin · {loyalty.tier?.name}</Text>
        <Text style={styles.memberCopy}>{loyalty.next_tier ? `Belanja lagi untuk naik ke ${loyalty.next_tier.name}` : 'Tingkat tertinggi — terima kasih!'}</Text>
      </View>
      <ArrowRight size={18} color={brand.colors.primaryPressed} />
    </Pressable>
  )
}

export default function HomeScreen() {
  const styles = useStyles()
  const { COLORS } = useTheme()
  const { session } = useAuth()
  const [greeting] = useState(greetingNow)
  const firstName = (session?.user?.user_metadata?.full_name || '').trim().split(/\s+/)[0]
  const { cafe, brand, loading, error, reload } = useBrand()
  const { itemCount, table, setTable } = useCart()
  const { status } = useCafeStatus(cafe)
  const notifications = useNotifications({ limit: 30 })
  const menu = useCafeProducts(cafe?.id)
  const promotions = useCafePromotions(cafe?.id)
  const fallbackProduct = menu.products.find((product) => product.image_url && !product.sold_out)

  return (
    <Screen>
      <View style={styles.topbar}>
        <View style={styles.brandRow}>
          <BrandMark size={40} />
          <View style={styles.brandText}>
            <Text style={styles.brand} numberOfLines={1}>{brand.businessName}</Text>
            <Text style={styles.location} numberOfLines={1}>{brand.tagline || 'Menu dibuat segar untukmu'}</Text>
          </View>
        </View>
        <View style={styles.topActions}>
          {notifications.available ? (
            <IconButton icon={Bell} label={notifications.unread ? `Notifikasi, ${notifications.unread} belum dibaca` : 'Notifikasi'} badge={notifications.unread} onPress={() => router.push('/notifications')} />
          ) : null}
          <IconButton icon={ShoppingBag} label={itemCount > 0 ? `Keranjang, ${itemCount} item` : 'Keranjang'} badge={itemCount} onPress={() => router.push('/cart')} />
        </View>
      </View>
      <View style={styles.hero}>
        <Text style={styles.greeting}>{greeting}{firstName ? `, ${firstName}` : ''}</Text>
        <Text style={styles.heroTitle}>Siap untuk secangkir kopi hari ini?</Text>
      </View>
      <Pressable accessibilityRole="search" accessibilityLabel="Cari menu" onPress={() => router.push('/(tabs)/menu')} style={({ pressed }) => [styles.search, pressed && styles.searchPressed]}>
        <Search size={18} color={COLORS.textMuted} />
        <Text style={styles.searchText}>Cari kopi, pastry, atau minuman lain…</Text>
      </Pressable>
      <TableBanner table={table} onClear={() => setTable(null)} />
      {status ? <CafeStatusPill status={status} /> : null}
      <PromoCarousel
        banners={promotions.banners}
        cafe={{ id: cafe?.id, name: brand.businessName, tagline: brand.tagline, description: cafe?.description }}
        product={fallbackProduct}
        error={promotions.error}
        onRetry={promotions.reload}
      />

      {loading ? <LoadingState label="Memuat kafe..." /> : error ? <ErrorBox message={error} onRetry={reload} /> : !cafe ? (
        <EmptyState title="Belum ada cafe" description="Cafe akan tampil di sini setelah tersedia di database." />
      ) : (
        <>
          <MemberCard cafe={cafe} />
          <CafeHighlights cafe={cafe} {...menu} />
          <View style={styles.note}><ShieldCheck size={18} color={brand.colors.primary} /><AppText muted>Harga produk dan total pesanan selalu diverifikasi oleh database saat checkout.</AppText></View>
        </>
      )}
    </Screen>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topActions: { flexDirection: 'row', gap: 8 },
  member: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, borderWidth: 1, borderRadius: 17 },
  memberText: { flex: 1, gap: 3 },
  memberTitle: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
  memberCopy: { color: COLORS.textMuted, fontSize: 12 },
  brandRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, marginRight: 12 },
  brandText: { flex: 1, minWidth: 0 },
  brand: { color: COLORS.text, fontFamily: 'Fraunces', fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  location: { marginTop: 1, color: COLORS.textMuted, fontSize: 11.5 },
  hero: { gap: 6, marginTop: 4 },
  greeting: { color: COLORS.primaryPressed, fontSize: 13, fontWeight: '700' },
  heroTitle: { color: COLORS.text, fontFamily: 'Fraunces', fontSize: 30, fontWeight: '600', lineHeight: 36, letterSpacing: -0.6 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, paddingHorizontal: 16,
    backgroundColor: COLORS.field, borderWidth: 1, borderColor: COLORS.borderSubtle, borderRadius: 26,
  },
  searchPressed: { borderColor: COLORS.border },
  searchText: { flex: 1, color: COLORS.placeholder, fontSize: 13.5 },
  categorySection: { gap: 8 },
  categories: { flexDirection: 'row', gap: 8, paddingRight: 20 },
  category: { alignItems: 'center', justifyContent: 'center', minHeight: 40, paddingHorizontal: 16, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 20 },
  categoryActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  categoryName: { color: COLORS.textSecondary, fontSize: 12.5, fontWeight: '700' },
  categoryNameActive: { color: COLORS.textOnPrimary },
  highlightSection: { gap: 10 },
  products: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 },
  note: { flexDirection: 'row', gap: 9, padding: 13, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.borderSubtle, borderRadius: 14 },
  noteMark: { color: COLORS.green, fontWeight: '800' },
}))
