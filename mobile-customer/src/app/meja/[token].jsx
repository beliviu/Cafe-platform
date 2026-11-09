/*
 * Tujuan QR meja: https://<app>/meja/<token>  (atau mobilecustomer://meja/<token>).
 * Token dicek server (table_qr_resolve). QR kafe lain ditolak — aplikasi ini milik satu kafe.
 */
import { useEffect, useState } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { QrCode } from 'lucide-react-native'
import { useAuth } from '../../auth/useAuth.js'
import { useBrand } from '../../brand/useBrand.js'
import { useCart } from '../../cart/useCart.js'
import { Button, EmptyState, LoadingState, Screen, useToast } from '../../components/ui.jsx'
import { isMissingRpc } from '../../lib/customer.js'

export default function TableQrScreen() {
  const { token } = useLocalSearchParams()
  const { supabase } = useAuth()
  const { cafe, brand, loading: brandLoading } = useBrand()
  const { setTable } = useCart()
  const { toast } = useToast()
  const [problem, setProblem] = useState(null)

  useEffect(() => {
    if (!supabase || brandLoading) return undefined
    let active = true
    supabase.rpc('table_qr_resolve', { p_token: String(token || '') }).then(({ data, error }) => {
      if (!active) return
      if (error) {
        setProblem(isMissingRpc(error) ? { title: 'Pesan dari meja belum aktif', description: 'Kafe belum menyalakan fitur QR meja. Silakan pesan lewat kasir.' } : { title: 'QR tidak dapat diperiksa', description: error.message })
        return
      }
      if (!data) return setProblem({ title: 'QR meja tidak dikenal', description: 'QR ini sudah tidak berlaku atau rusak. Minta QR baru ke kasir.' })
      if (cafe && data.cafe_id !== cafe.id) return setProblem({ title: 'QR milik kafe lain', description: `QR ini untuk ${data.cafe_name}. Aplikasi ini hanya untuk ${brand.businessName}.` })
      if (!data.active) return setProblem({ title: `Meja ${data.label} sedang tidak dipakai`, description: 'Silakan pindah meja atau pesan di kasir.' })
      if (!data.qr_enabled) return setProblem({ title: 'Pesan dari meja sedang dimatikan', description: 'Silakan pesan langsung di kasir.' })
      setTable({ token: String(token), label: data.label, area: data.area, cafe_id: data.cafe_id, cafe_name: data.cafe_name })
      toast({ tone: 'success', title: `Meja ${data.label}`, description: 'Pesananmu akan diantar ke meja ini.' })
      router.replace('/(tabs)/menu')
      return undefined
    })
    return () => { active = false }
  }, [brand.businessName, brandLoading, cafe, setTable, supabase, toast, token])

  if (!problem) return <Screen><LoadingState label="Memeriksa QR meja..." /></Screen>
  return (
    <Screen>
      <View style={styles.center}>
        <EmptyState icon={QrCode} title={problem.title} description={problem.description}
          action={<Button title="Lihat menu" variant="secondary" onPress={() => router.replace('/(tabs)/menu')} />} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', minHeight: 420 },
})
