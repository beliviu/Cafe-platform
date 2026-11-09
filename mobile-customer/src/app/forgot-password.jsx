import { useState } from 'react'
import { router } from 'expo-router'
import * as Linking from 'expo-linking'
import { View } from 'react-native'
import { MailCheck } from 'lucide-react-native'
import { useAuth } from '../auth/useAuth.js'
import { useBrand } from '../brand/useBrand.js'
import { Button, ErrorBox, Field, Screen } from '../components/ui.jsx'
import { Text } from '../components/ui/Text.jsx'
import { makeStyles } from '../theme/useTheme.js'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function ForgotPasswordScreen() {
  const styles = useStyles()
  const { supabase } = useAuth()
  const { brand } = useBrand()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function send() {
    setError('')
    if (!EMAIL.test(email.trim())) return setError('Masukkan email yang valid.')
    setLoading(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: Linking.createURL('/reset-password') })
    setLoading(false)
    // Tidak memberi tahu apakah email terdaftar (mencegah pengecekan akun orang lain)
    if (resetError && !/not found|user/i.test(resetError.message)) return setError(`Gagal mengirim: ${resetError.message}`)
    setSent(true)
    return undefined
  }

  return (
    <Screen contentStyle={styles.content}>
      {sent ? (
        <>
          <View style={[styles.icon, { backgroundColor: brand.colors.primaryTint }]}><MailCheck size={30} color={brand.colors.primaryPressed} /></View>
          <Text serif weight="700" size="2xl">Cek email kamu</Text>
          <Text tone="secondary" style={styles.copy}>Kalau {email.trim()} terdaftar, kami sudah mengirim tautan untuk membuat password baru. Tautan berlaku 1 jam. Cek juga folder spam.</Text>
          <Button title="Kembali ke halaman masuk" onPress={() => router.replace('/login')} />
          <Button title="Kirim ulang" variant="ghost" onPress={() => setSent(false)} />
        </>
      ) : (
        <>
          <Text serif weight="700" size="2xl">Lupa password</Text>
          <Text tone="secondary" style={styles.copy}>Masukkan email akunmu. Kami kirim tautan untuk membuat password baru.</Text>
          <ErrorBox message={error} />
          <Field label="Email" value={email} onChangeText={setEmail} placeholder="nama@email.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
          <Button title="Kirim tautan" onPress={send} loading={loading} />
        </>
      )}
    </Screen>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  content: { flexGrow: 1, justifyContent: 'center', gap: 16 },
  icon: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 32 },
  copy: { lineHeight: 21, color: COLORS.textSecondary },
}))
