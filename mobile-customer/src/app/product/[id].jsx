import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { Check, Heart } from 'lucide-react-native'
import { useAuth } from '../../auth/useAuth.js'
import { useBrand } from '../../brand/useBrand.js'
import { useCart } from '../../cart/useCart.js'
import { Button, ErrorBox, Field, formatCurrency, ProductImage, QuantityStepper, Screen, useToast } from '../../components/ui.jsx'
import { Text } from '../../components/ui/Text.jsx'
import { RatingInline, StarsDisplay } from '../../components/CustomerBits.jsx'
import { fetchAvailability, withAvailability } from '../../components/useCafeData.js'
import { formatDateShort } from '../../lib/format.js'
import { makeStyles, useTheme } from '../../theme/useTheme.js'

/** Pilihan awal: grup wajib → pilihan bawaan (atau yang pertama tersedia). */
function initialSelection(groups) {
  const picked = {}
  for (const group of groups) {
    if (!group.is_required) continue
    const option = group.options.find((item) => item.is_default && item.is_available) || group.options.find((item) => item.is_available)
    if (option) picked[group.id] = [option.id]
  }
  return picked
}

export default function ProductDetailScreen() {
  const styles = useStyles()
  const { COLORS } = useTheme()
  const { id, cafeId } = useLocalSearchParams()
  const { supabase, session, error: configError } = useAuth()
  const { brand } = useBrand()
  const { addItem } = useCart()
  const { toast } = useToast()
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState({})
  const [quantity, setQuantity] = useState(1)
  const [notes, setNotes] = useState('')
  const [wished, setWished] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!supabase) {
      setError(configError || 'Koneksi Supabase tidak tersedia.')
      setLoading(false)
      return
    }
    const [productResult, availability, cafeResult, groupResult, ratingResult, reviewsResult] = await Promise.all([
      supabase.from('products').select('id, cafe_id, category_id, name, description, price, image_url, is_available').eq('id', id).eq('cafe_id', cafeId).maybeSingle(),
      fetchAvailability(supabase, cafeId),
      supabase.from('cafes').select('id, name').eq('id', cafeId).maybeSingle(),
      supabase.from('product_option_groups').select('id, name, selection_type, is_required, max_select, sort_order').eq('product_id', id).order('sort_order'),
      supabase.rpc('product_rating_summary', { p_cafe_id: cafeId }),
      supabase.rpc('product_reviews_public', { p_product_id: id, p_limit: 10 }),
    ])
    if (productResult.error || !productResult.data) {
      setError(productResult.error ? `Produk gagal dimuat: ${productResult.error.message}` : 'Produk tidak tersedia atau sudah dihapus.')
      setLoading(false)
      return
    }
    const groups = groupResult.error ? [] : groupResult.data || []
    let options = []
    if (groups.length) {
      const optionResult = await supabase.from('product_options').select('id, group_id, name, price_delta, is_available, is_default, sort_order')
        .in('group_id', groups.map((group) => group.id)).order('sort_order')
      options = optionResult.data || []
    }
    const withOptions = groups.map((group) => ({ ...group, options: options.filter((option) => option.group_id === group.id) })).filter((group) => group.options.length)
    const rating = ratingResult.error ? null : (ratingResult.data || []).find((row) => row.product_id === id)
    setData({
      product: withAvailability(productResult.data, availability),
      cafe: cafeResult.data,
      groups: withOptions,
      rating: rating ? { rating: Number(rating.rating), reviews: rating.reviews } : null,
      reviews: reviewsResult.error ? [] : reviewsResult.data || [],
    })
    setSelected(initialSelection(withOptions))
    setLoading(false)
  }, [cafeId, configError, id, supabase])

  useEffect(() => {
    const timer = setTimeout(load, 0)
    return () => clearTimeout(timer)
  }, [load])

  useEffect(() => {
    if (!session || !supabase) return
    supabase.from('wishlist_items').select('product_id').eq('product_id', id).maybeSingle()
      .then(({ data: row, error: wishError }) => { if (!wishError) setWished(Boolean(row)) })
  }, [id, session, supabase])

  const chosen = useMemo(() => {
    if (!data) return []
    return data.groups.flatMap((group) => group.options.filter((option) => (selected[group.id] || []).includes(option.id)))
  }, [data, selected])
  const unitPrice = data ? Number(data.product.price) + chosen.reduce((sum, option) => sum + Number(option.price_delta), 0) : 0
  const missing = data?.groups.find((group) => group.is_required && !(selected[group.id] || []).length)

  function toggle(group, option) {
    if (!option.is_available) return
    setSelected((current) => {
      const list = current[group.id] || []
      if (group.selection_type === 'single') return { ...current, [group.id]: group.is_required || !list.includes(option.id) ? [option.id] : [] }
      if (list.includes(option.id)) return { ...current, [group.id]: list.filter((item) => item !== option.id) }
      if (group.max_select && list.length >= group.max_select) return current
      return { ...current, [group.id]: [...list, option.id] }
    })
  }

  async function toggleWish() {
    if (!session) {
      router.push({ pathname: '/login', params: { returnTo: `/product/${id}?cafeId=${cafeId}` } })
      return
    }
    const next = !wished
    setWished(next)
    const { error: wishError } = next
      ? await supabase.from('wishlist_items').insert({ product_id: id })
      : await supabase.from('wishlist_items').delete().eq('product_id', id)
    if (wishError) {
      setWished(!next)
      toast({ tone: 'error', title: 'Wishlist belum tersedia', description: wishError.message })
    } else toast({ tone: 'success', title: next ? 'Disimpan ke wishlist' : 'Dihapus dari wishlist' })
  }

  function addToCart() {
    if (!data || missing) return
    if (addItem(data.product, data.cafe, { options: chosen, quantity, notes })) {
      toast({ tone: 'success', title: `${quantity} × ${data.product.name} ditambahkan`, action: { label: 'Keranjang', onPress: () => router.push('/cart') } })
      router.back()
    }
  }

  if (loading) return <Screen><View style={styles.loading}><ActivityIndicator color={brand.colors.primary} /></View></Screen>
  if (!data) return <Screen><ErrorBox message={error} onRetry={load} /></Screen>
  const { product, groups, rating, reviews } = data

  return (
    <Screen>
      <View>
        <ProductImage uri={product.image_url} style={styles.image} />
        <Pressable accessibilityRole="button" accessibilityLabel={wished ? 'Hapus dari wishlist' : 'Simpan ke wishlist'} accessibilityState={{ selected: wished }}
          onPress={toggleWish} style={styles.heart} hitSlop={6}>
          <Heart size={20} color={wished ? COLORS.danger : COLORS.text} fill={wished ? COLORS.danger : 'transparent'} />
        </Pressable>
      </View>
      <View style={styles.titleBlock}>
        <Text size="xs" weight="700" style={{ color: brand.colors.primaryPressed }}>{data.cafe?.name}</Text>
        <Text serif weight="700" size="2xl">{product.name}</Text>
        <View style={styles.priceRow}>
          <Text size="lg" weight="800" style={{ color: brand.colors.primaryPressed }}>{formatCurrency(product.price)}</Text>
          {rating ? <RatingInline rating={rating.rating} reviews={rating.reviews} size={13} /> : null}
        </View>
        <Text tone="muted" style={styles.description}>{product.description || 'Dibuat dengan bahan pilihan dan disajikan segar.'}</Text>
      </View>

      {product.sold_out ? (
        <View style={styles.soldOut}><Text weight="700" tone="danger">Sedang habis — coba lagi nanti</Text></View>
      ) : (
        <>
          {groups.map((group) => (
            <View key={group.id} style={styles.group}>
              <View style={styles.groupHead}>
                <Text weight="700">{group.name}</Text>
                <Text size="xs" tone="muted">{group.is_required ? 'Wajib · pilih 1' : group.selection_type === 'single' ? 'Opsional · pilih 1' : `Opsional${group.max_select ? ` · maks. ${group.max_select}` : ''}`}</Text>
              </View>
              {group.options.map((option) => {
                const on = (selected[group.id] || []).includes(option.id)
                return (
                  <Pressable key={option.id} accessibilityRole={group.selection_type === 'single' ? 'radio' : 'checkbox'}
                    accessibilityState={{ checked: on, selected: on, disabled: !option.is_available }}
                    onPress={() => toggle(group, option)} style={[styles.option, on && { borderColor: brand.colors.primary, backgroundColor: brand.colors.primaryTint }]}>
                    <View style={[group.selection_type === 'single' ? styles.radio : styles.check, on && { borderColor: brand.colors.primary, backgroundColor: brand.colors.primary }]}>
                      {on ? <Check size={12} color={COLORS.textOnPrimary} strokeWidth={3} /> : null}
                    </View>
                    <Text style={[styles.optionName, !option.is_available && styles.optionOff]}>{option.name}{option.is_available ? '' : ' · habis'}</Text>
                    {Number(option.price_delta) ? <Text size="sm" weight="600" tone="secondary">+{formatCurrency(option.price_delta)}</Text> : null}
                  </Pressable>
                )
              })}
            </View>
          ))}
          <Field label="Catatan untuk menu ini (opsional)" value={notes} onChangeText={setNotes} placeholder="Mis. less sugar, tanpa es" maxLength={200} />
          <View style={styles.addRow}>
            <QuantityStepper value={quantity} onChange={(next) => setQuantity(Math.max(1, next))} min={1} itemName={product.name} />
            <Button title={missing ? `Pilih ${missing.name}` : `Tambah · ${formatCurrency(unitPrice * quantity)}`} onPress={addToCart} disabled={Boolean(missing)} style={styles.addButton} />
          </View>
        </>
      )}

      {reviews.length > 0 && (
        <View style={styles.reviews}>
          <Text weight="700" size="lg">Ulasan</Text>
          {reviews.map((review) => (
            <View key={review.id} style={styles.review}>
              <View style={styles.reviewHead}>
                <StarsDisplay value={review.rating} />
                <Text size="xs" tone="muted">{review.reviewer} · {formatDateShort(review.created_at)}</Text>
              </View>
              {review.comment ? <Text size="sm">{review.comment}</Text> : null}
              {review.reply ? <View style={styles.reply}><Text size="xs" weight="700">Balasan kafe</Text><Text size="sm" tone="secondary">{review.reply}</Text></View> : null}
            </View>
          ))}
        </View>
      )}
    </Screen>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  loading: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: 330, backgroundColor: COLORS.sand, borderRadius: 22 },
  heart: { position: 'absolute', top: 14, right: 14, width: 46, height: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.borderSubtle, borderRadius: 23 },
  titleBlock: { gap: 8, paddingTop: 2 },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  description: { maxWidth: 620, lineHeight: 22 },
  soldOut: { padding: 14, backgroundColor: '#F9E7E3', borderRadius: 13 },
  group: { gap: 9, padding: 14, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.borderSubtle, borderRadius: 17 },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 50, paddingHorizontal: 13, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.borderSubtle, borderRadius: 12 },
  radio: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: COLORS.borderStrong, borderRadius: 10 },
  check: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: COLORS.borderStrong, borderRadius: 6 },
  optionName: { flex: 1 },
  optionOff: { color: COLORS.textMuted, textDecorationLine: 'line-through' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 4 },
  addButton: { flex: 1 },
  reviews: { gap: 12, paddingTop: 6 },
  review: { gap: 6, padding: 13, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.borderSubtle, borderRadius: 14 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  reply: { gap: 2, padding: 10, backgroundColor: COLORS.sunken, borderRadius: 10 },
}))
