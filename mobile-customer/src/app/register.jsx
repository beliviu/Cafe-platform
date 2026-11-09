import { useState } from 'react'
import { Link, router } from 'expo-router'
import { View } from 'react-native'
import { useAuth } from '../auth/useAuth.js'
import { Button, ErrorBox, Field, Screen } from '../components/ui.jsx'
import { Text } from '../components/ui/Text.jsx'
import { BrandMark } from '../brand/BrandMark.jsx'
import { useBrand } from '../brand/useBrand.js'
import { makeStyles } from '../theme/useTheme.js'

export default function RegisterScreen() {
  const styles = useStyles()
  const { brand } = useBrand()
  const { supabase, error: configError } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  async function register() {
    setError('')
    setSuccess('')
    if (!supabase) {
      setError(configError || 'Koneksi Supabase tidak tersedia.')
      return
    }
    if (!name.trim() || !email.trim() || !password) {
      setError('Nama, email, dan password wajib diisi.')
      return
    }
    if (password.length < 8) {
      setError('Password minimal 8 karakter.')
      return
    }
    setLoading(true)
    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: name.trim() } },
    })
    if (authError) {
      setError(`Pendaftaran gagal: ${authError.message}`)
    } else if (data.session) {
      router.replace('/(tabs)')
    } else {
      setSuccess('Akun dibuat. Periksa email untuk konfirmasi, lalu masuk.')
    }
    setLoading(false)
  }

  return (
    <Screen contentStyle={styles.content}>
      <BrandMark size={54} />
      <Text style={[styles.eyebrow, { color: brand.colors.primaryPressed }]}>GABUNG DENGAN {brand.name.toUpperCase()}</Text>
      <Text style={styles.title}>Mulai dengan{'\n'}secangkir kopi.</Text>
      <Text style={styles.copy}>Buat akun customer untuk menyimpan dan melacak pesanan.</Text>
      <ErrorBox message={error} />
      {success ? <Text style={styles.success}>{success}</Text> : null}
      <Field label="Nama lengkap" value={name} onChangeText={setName} placeholder="Nama kamu" />
      <Field label="Email" value={email} onChangeText={setEmail} placeholder="nama@email.com" keyboardType="email-address" autoCapitalize="none" />
      <Field label="Password" value={password} onChangeText={setPassword} placeholder="Minimal 8 karakter" secureTextEntry autoCapitalize="none" />
      <Button title="Buat akun" onPress={register} loading={loading} />
      <View style={styles.bottom}><Text style={styles.bottomText}>Sudah punya akun?</Text><Link href="/login" style={styles.link}>Masuk</Link></View>
    </Screen>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  content: { flexGrow: 1, justifyContent: 'center', paddingTop: 25, paddingBottom: 35, gap: 15 },
  eyebrow: { marginTop: 9, color: COLORS.green, fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: COLORS.ink, fontFamily: 'Fraunces', fontSize: 32, fontWeight: '700', lineHeight: 37 },
  copy: { color: COLORS.muted, fontSize: 13, lineHeight: 20 },
  success: { padding: 12, color: COLORS.green, backgroundColor: COLORS.greenSoft, borderRadius: 12, fontSize: 13, lineHeight: 19 },
  bottom: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: 4 },
  bottomText: { color: COLORS.muted, fontSize: 12 },
  link: { color: COLORS.green, fontSize: 12, fontWeight: '700' },
}))
