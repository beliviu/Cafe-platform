import { Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { useCart } from '../cart/useCart.js'
import { useBrand } from '../brand/useBrand.js'
import { Button, EmptyState, formatCurrency, ProductImage, QuantityStepper, Screen } from '../components/ui.jsx'
import { Text } from '../components/ui/Text.jsx'
import { TableBanner } from '../components/CustomerBits.jsx'
import { makeStyles } from '../theme/useTheme.js'

export default function CartScreen() {
  const styles = useStyles()
  const { brand } = useBrand()
  const { items, subtotal, changeQuantity, removeItem, table, setTable } = useCart()
  return (
    <Screen>
      <TableBanner table={table} onClear={() => setTable(null)} />
      {!items.length ? (
        <EmptyState title="Keranjang masih kosong" description="Pilih minuman atau camilan dari menu kafe. Isi keranjang tetap tersimpan meski aplikasi ditutup."
          action={<Button title="Jelajahi menu" onPress={() => router.push('/(tabs)/menu')} />} />
      ) : (
        <>
          <View style={styles.cafeHeading}>
            <Text size="xs" weight="800" tone="muted" style={styles.label}>PESANAN DARI</Text>
            <Text serif weight="700" size="xl">{items[0].cafe_name}</Text>
          </View>
          <View style={styles.list}>
            {items.map((item) => (
              <View key={item.key} style={styles.item}>
                <ProductImage uri={item.image_url} style={styles.image} />
                <View style={styles.itemInfo}>
                  <Text weight="700" size="sm">{item.name}</Text>
                  {item.options?.length ? <Text size="xs" tone="muted">{item.options.map((option) => option.name).join(', ')}</Text> : null}
                  {item.notes ? <Text size="xs" tone="muted">Catatan: {item.notes}</Text> : null}
                  <Text size="sm" weight="700" style={{ color: brand.colors.primaryPressed }}>{formatCurrency(item.unit_price)}</Text>
                  <View style={styles.controls}>
                    <QuantityStepper size="sm" value={item.quantity} onChange={(next) => changeQuantity(item.key, next - item.quantity)} itemName={item.name} />
                    <Pressable accessibilityRole="button" accessibilityLabel={`Hapus ${item.name} dari keranjang`} onPress={() => removeItem(item.key)} hitSlop={8} style={styles.remove}>
                      <Text size="xs" weight="700" tone="danger">Hapus</Text>
                    </Pressable>
                  </View>
                </View>
                <Text size="sm" weight="700" tabular>{formatCurrency(item.unit_price * item.quantity)}</Text>
              </View>
            ))}
          </View>
          <View style={styles.summary}>
            <View style={styles.row}><Text tone="muted" size="sm">Subtotal perkiraan</Text><Text weight="800" tabular>{formatCurrency(subtotal)}</Text></View>
            <Text size="xs" tone="muted">Pajak, voucher, dan poin dihitung di checkout. Total akhir selalu dihitung ulang oleh kafe.</Text>
          </View>
          <Button title="Lanjut ke checkout" onPress={() => router.push('/checkout')} />
        </>
      )}
    </Screen>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  label: { letterSpacing: 1.2 },
  cafeHeading: { gap: 4, paddingBottom: 4 },
  list: { gap: 10 },
  item: { flexDirection: 'row', gap: 11, padding: 11, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.borderSubtle, borderRadius: 15 },
  image: { width: 76, height: 76, backgroundColor: COLORS.sand, borderRadius: 12 },
  itemInfo: { flex: 1, gap: 4 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  remove: { minHeight: 34, justifyContent: 'center' },
  summary: { padding: 16, backgroundColor: COLORS.sunken, borderRadius: 14, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
}))
