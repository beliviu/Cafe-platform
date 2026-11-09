import { useCallback, useEffect, useState } from 'react'
import { router } from 'expo-router'
import { View } from 'react-native'
import { Bell, CreditCard, Heart, LifeBuoy, Sparkles, Ticket } from 'lucide-react-native'
import { useAuth } from '../../auth/useAuth.js'
import { useBrand } from '../../brand/useBrand.js'
import { Button, EmptyState, ErrorBox, Field, LoadingState, Screen, SegmentedControl } from '../../components/ui.jsx'
import { Text } from '../../components/ui/Text.jsx'
import { MenuGroup, MenuRow } from '../../components/CustomerBits.jsx'
import { useCafeStatus } from '../../lib/customer.js'
import { useNotifications } from '../../lib/useNotifications.js'
import { unregisterPush } from '../../lib/push.js'
import { makeStyles, useTheme } from '../../theme/useTheme.js'
import { THEME_PREFERENCES } from '../../brand/BrandProvider.jsx'

/** Mode tampilan app (disimpan di HP ini). Tersedia juga sebelum login. */
function AppearanceCard() {
  const styles = useStyles()
  const { preference, setPreference } = useTheme()
  return (
    <View style={styles.card}>
      <Text weight="700">Tampilan</Text>
      <Text size="sm" tone="muted">Warna mengikuti brand kafe. Pilih gelap, terang, atau ikuti pengaturan HP.</Text>
      <SegmentedControl options={THEME_PREFERENCES} value={preference} onChange={setPreference} />
    </View>
  )
}

export default function ProfileScreen() {
  const styles = useStyles()
  const { session, supabase } = useAuth()
  const { cafe, brand } = useBrand()
  const { status } = useCafeStatus(cafe)
  const notifications = useNotifications({ limit: 30 })
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(Boolean(session))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const phase4 = Boolean(status?.live)

  const loadProfile = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError('')
    const { data, error: queryError } = await supabase.from('profiles').select('full_name').eq('id', session.user.id).maybeSingle()
    if (queryError) setError(`Profil gagal dimuat: ${queryError.message}`)
    else setFullName(data?.full_name || '')
    setLoading(false)
  }, [session, supabase])

  useEffect(() => {
    const timer = setTimeout(loadProfile, 0)
    return () => clearTimeout(timer)
  }, [loadProfile])

  async function saveProfile() {
    const name = fullName.trim()
    if (!name) return setError('Nama wajib diisi.')
    setSaving(true)
    setError('')
    setSuccess('')
    const { data, error: updateError } = await supabase.from('profiles').update({ full_name: name }).eq('id', session.user.id).select('id').maybeSingle()
    if (updateError) setError(`Profil gagal disimpan: ${updateError.message}`)
    else if (!data) setError('Profil tidak diperbarui. Periksa sesi lalu coba lagi.')
    else setSuccess('Profil berhasil diperbarui.')
    setSaving(false)
    return undefined
  }

  async function signOut() {
    setError('')
    await unregisterPush(supabase)
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) setError(`Tidak dapat keluar: ${signOutError.message}`)
  }

  return (
    <Screen>
      <View>
        <Text size="xs" weight="800" style={[styles.eyebrow, { color: brand.colors.primaryPressed }]}>AKUN CUSTOMER</Text>
        <Text serif weight="700" size="3xl">Profil saya</Text>
      </View>
      {!session ? (
        <EmptyState title="Selamat datang" description="Masuk atau buat akun untuk menyimpan pesanan, mengumpulkan poin, dan melihat statusnya."
          action={<Button title="Masuk atau daftar" onPress={() => router.push('/login')} />} />
      ) : loading ? <LoadingState label="Memuat profil..." /> : (
        <>
          {phase4 && (
            <MenuGroup>
              {status.loyalty_enabled ? <MenuRow icon={Sparkles} title="Poin & member" detail="Saldo poin, tingkat, dan riwayat" onPress={() => router.push('/loyalty')} /> : null}
              <MenuRow icon={Ticket} title="Voucher" detail="Promo yang bisa kamu pakai" onPress={() => router.push('/vouchers')} />
              <MenuRow icon={Heart} title="Wishlist" detail="Menu favorit yang kamu simpan" onPress={() => router.push('/wishlist')} />
              <MenuRow icon={CreditCard} title="Riwayat pembayaran" detail="Pembayaran & pengembalian dana" onPress={() => router.push('/payments')} />
              <MenuRow icon={Bell} title="Notifikasi" badge={notifications.unread || null} onPress={() => router.push('/notifications')} />
              <MenuRow icon={LifeBuoy} title="Bantuan" detail="Tanya atau laporkan masalah ke kafe" onPress={() => router.push('/support')} />
            </MenuGroup>
          )}
          <View style={styles.card}>
            <Text weight="700">Data diri</Text>
            <Text size="sm" tone="muted">{session.user.email}</Text>
            <ErrorBox message={error} />
            {success ? <Text weight="700" size="sm" style={{ color: brand.colors.primaryPressed }}>{success}</Text> : null}
            <Field label="Nama lengkap" value={fullName} onChangeText={setFullName} placeholder="Nama kamu" />
            <Button title="Simpan profil" onPress={saveProfile} loading={saving} variant="secondary" />
          </View>
          <AppearanceCard />
          <Button title="Keluar dari akun" onPress={signOut} variant="quiet" />
        </>
      )}
      {!session ? <AppearanceCard /> : null}
    </Screen>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  eyebrow: { letterSpacing: 1.4 },
  card: { gap: 12, padding: 16, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16 },
}))
