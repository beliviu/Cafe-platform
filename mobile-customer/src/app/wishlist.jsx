import { useCallback, useEffect, useState } from 'react'
import { router } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { Heart } from 'lucide-react-native'
import { useAuth } from '../auth/useAuth.js'
import { useBrand } from '../brand/useBrand.js'
import { Button, EmptyState, ErrorBox, LoadingState, Screen } from '../components/ui.jsx'
import { ProductCard } from '../components/ProductCard.jsx'
import { fetchAvailability, withAvailability } from '../components/useCafeData.js'

export default function WishlistScreen() {
  const { session, supabase } = useAuth()
  const { cafe } = useBrand()
  const [products, setProducts] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!session || !cafe) return
    const saved = await supabase.from('wishlist_items').select('product_id, created_at').eq('cafe_id', cafe.id).order('created_at', { ascending: false })
    if (saved.error) return setError(saved.error.message)
    const ids = (saved.data || []).map((row) => row.product_id)
    if (!ids.length) return setProducts([])
    const [list, availability] = await Promise.all([
      supabase.from('products').select('id, cafe_id, category_id, name, description, price, image_url, is_available').in('id', ids),
      fetchAvailability(supabase, cafe.id),
    ])
    if (list.error) return setError(list.error.message)
    const byId = new Map((list.data || []).map((product) => [product.id, withAvailability(product, availability)]))
    setProducts(ids.map((id) => byId.get(id)).filter(Boolean))
    return undefined
  }, [cafe, session, supabase])

  useEffect(() => {
    const timer = setTimeout(load, 0)
    return () => clearTimeout(timer)
  }, [load])

  if (!session) return <Screen><EmptyState icon={Heart} title="Masuk untuk menyimpan menu favorit" action={<Button title="Masuk" onPress={() => router.push('/login')} />} /></Screen>
  if (error) return <Screen><ErrorBox message={error} onRetry={load} /></Screen>
  if (!products) return <Screen><LoadingState label="Memuat wishlist..." /></Screen>
  return (
    <Screen>
      {!products.length ? (
        <EmptyState icon={Heart} title="Wishlist masih kosong" description="Ketuk ikon hati di halaman menu untuk menyimpan favoritmu."
          action={<Button title="Lihat menu" onPress={() => router.push('/(tabs)/menu')} />} />
      ) : (
        <View style={styles.grid}>{products.map((product) => <ProductCard key={product.id} product={product} cafe={cafe} />)}</View>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 },
})
