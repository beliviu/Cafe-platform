import { useMemo, useState } from 'react'
import { Pressable, ScrollView, TextInput, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useCafeProducts } from '../../components/useCafeData.js'
import { useBrand } from '../../brand/useBrand.js'
import { ProductCard } from '../../components/ProductCard.jsx'
import { EmptyState, ErrorBox, IconButton, LoadingState, Screen, SectionTitle } from '../../components/ui.jsx'
import { useCart } from '../../cart/useCart.js'
import { Text } from '../../components/ui/Text.jsx'
import { Search, ShoppingBag } from 'lucide-react-native'
import { CafeStatusPill, TableBanner } from '../../components/CustomerBits.jsx'
import { useCafeStatus } from '../../lib/customer.js'
import { makeStyles, useTheme } from '../../theme/useTheme.js'

export default function MenuScreen() {
  const styles = useStyles()
  const { COLORS } = useTheme()
  const { categoryId: requestedCategory } = useLocalSearchParams()
  const { cafe: selectedCafe, brand, loading: cafesLoading, error: cafesError, reload } = useBrand()
  const [search, setSearch] = useState('')
  const { itemCount, table, setTable } = useCart()
  const { status } = useCafeStatus(selectedCafe)
  const { products, categories, loading, error } = useCafeProducts(selectedCafe?.id)

  const categoryId = typeof requestedCategory === 'string' && categories.some((category) => category.id === requestedCategory)
    ? requestedCategory
    : 'all'

  const filteredProducts = useMemo(() => products.filter((product) => {
    const matchesCategory = categoryId === 'all' || product.category_id === categoryId
    const matchesSearch = `${product.name} ${product.description || ''}`.toLowerCase().includes(search.trim().toLowerCase())
    return matchesCategory && matchesSearch
  }), [categoryId, products, search])

  if (cafesLoading) return <Screen><LoadingState label="Memuat cafe..." /></Screen>
  if (cafesError) return <Screen><ErrorBox message={cafesError} onRetry={reload} /></Screen>
  if (!selectedCafe) return <Screen><EmptyState title="Belum ada cafe" description="Cafe akan tampil setelah tersedia di database." /></Screen>

  return (
    <Screen>
      <View style={styles.heading}>
        <View><Text style={styles.eyebrow}>DARI BARISTA KAMI</Text><Text style={styles.title}>Menu pilihan</Text></View>
        <IconButton icon={ShoppingBag} label={itemCount > 0 ? `Keranjang, ${itemCount} item` : 'Keranjang'} badge={itemCount} onPress={() => router.push('/cart')} />
      </View>
      <TableBanner table={table} onClear={() => setTable(null)} />
      {status ? <CafeStatusPill status={status} /> : null}
      <View style={styles.searchWrap}>
        <Search size={18} color={COLORS.textMuted} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Cari kopi, pastry..." placeholderTextColor={COLORS.placeholder} style={styles.search} />
      </View>
      <SectionTitle title={brand.businessName} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>
        {[{ id: 'all', name: 'Semua' }, ...categories].map((category) => (
          <Pressable key={category.id} onPress={() => router.setParams({ categoryId: category.id === 'all' ? '' : category.id })} style={[styles.chip, categoryId === category.id && { backgroundColor: brand.colors.primary, borderColor: brand.colors.primary }]}>
            <Text style={[styles.chipText, categoryId === category.id && styles.selectedChipText]}>{category.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {loading ? <LoadingState label="Memuat menu..." /> : error ? <ErrorBox message={error} /> : !filteredProducts.length ? (
        <EmptyState title="Produk tidak ditemukan" description="Coba kata pencarian atau kategori lain." />
      ) : (
        <View style={styles.grid}>{filteredProducts.map((product) => <ProductCard key={product.id} product={product} cafe={selectedCafe} />)}</View>
      )}
    </Screen>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: COLORS.primaryPressed, fontSize: 10, fontWeight: '800', letterSpacing: 1.6 },
  title: { marginTop: 5, color: COLORS.text, fontFamily: 'Fraunces', fontSize: 28, fontWeight: '600', letterSpacing: -0.5 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, paddingHorizontal: 16,
    backgroundColor: COLORS.field, borderWidth: 1, borderColor: COLORS.borderSubtle, borderRadius: 26,
  },
  search: { flex: 1, height: '100%', padding: 0, color: COLORS.text, fontSize: 13.5 },
  categories: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 20 },
  chip: { alignItems: 'center', justifyContent: 'center', minHeight: 40, paddingHorizontal: 16, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 20 },
  chipText: { color: COLORS.textSecondary, fontSize: 12.5, fontWeight: '700' },
  selectedChipText: { color: COLORS.textOnPrimary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 },
}))
