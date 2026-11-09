import { useState } from 'react'
import { Link, router, useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'
import { useAuth } from '../auth/useAuth.js'
import { Button, ErrorBox, Field, Screen } from '../components/ui.jsx'
import { Text } from '../components/ui/Text.jsx'
import { BrandMark } from '../brand/BrandMark.jsx'
import { useBrand } from '../brand/useBrand.js'
import { makeStyles } from '../theme/useTheme.js'

export default function LoginScreen() {
  const styles = useStyles()
  const { brand } = useBrand()
  const { supabase, error: configError } = useAuth()
  const params = useLocalSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function signIn() {
    setError('')
    if (!email.trim() || !password) {
      setError('Email dan password wajib diisi.')
      return
    }
    if (!supabase) {
      setError(configError || 'Koneksi Supabase tidak tersedia.')
      return
    }
    setLoading(true)
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (authError) {
      setError(`Gagal masuk: ${authError.message}`)
      setLoading(false)
      return
    }
    router.replace(typeof params.returnTo === 'string' ? params.returnTo : '/(tabs)')
  }

  return (
    <Screen contentStyle={styles.content}>
      <BrandMark size={54} />
      <Text style={[styles.eyebrow, { color: brand.colors.primaryPressed }]}>MASUK KE {brand.name.toUpperCase()}</Text>
      <Text style={styles.title}>Selamat{'\n'}datang kembali.</Text>
      <Text style={styles.copy}>Masuk untuk memesan dan mengikuti pesananmu.</Text>
      <ErrorBox message={error || configError} />
      <Field label="Email" value={email} onChangeText={setEmail} placeholder="nama@email.com" keyboardType="email-address" autoCapitalize="none" />
      <Field label="Password" value={password} onChangeText={setPassword} placeholder="Masukkan password" secureTextEntry autoCapitalize="none" />
      <Link href="/forgot-password" style={[styles.forgot, { color: brand.colors.primaryPressed }]}>Lupa password?</Link>
      <Button title="Masuk" onPress={signIn} loading={loading} />
      <View style={styles.bottom}><Text style={styles.bottomText}>Belum punya akun?</Text><Link href="/register" style={styles.link}>Daftar sekarang</Link></View>
    </Screen>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  content: { flexGrow: 1, justifyContent: 'center', paddingTop: 30, paddingBottom: 35, gap: 16 },
  eyebrow: { marginTop: 10, color: COLORS.green, fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: COLORS.ink, fontFamily: 'Fraunces', fontSize: 34, fontWeight: '700', lineHeight: 39 },
  copy: { marginBottom: 3, color: COLORS.muted, fontSize: 13, lineHeight: 20 },
  bottom: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: 6 },
  bottomText: { color: COLORS.muted, fontSize: 12 },
  forgot: { alignSelf: 'flex-end', paddingVertical: 6, fontSize: 13, fontWeight: '700' },
  link: { color: COLORS.green, fontSize: 12, fontWeight: '700' },
}))
