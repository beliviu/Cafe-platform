/*
 * Tujuan tautan reset password dari email. Supabase mengirim token di URL
 * (#access_token=…&refresh_token=… atau ?code=…) → sesi pemulihan → password baru.
 */
import { useEffect, useState } from 'react'
import { router } from 'expo-router'
import * as Linking from 'expo-linking'
import { StyleSheet } from 'react-native'
import { useAuth } from '../auth/useAuth.js'
import { Button, ErrorBox, Field, LoadingState, Screen, useToast } from '../components/ui.jsx'
import { Text } from '../components/ui/Text.jsx'

function tokensFrom(url) {
  if (!url) return {}
  const [, query = ''] = url.split('?')
  const [, hash = ''] = url.split('#')
  const params = new URLSearchParams(`${query.split('#')[0]}&${hash}`)
  return { code: params.get('code'), access: params.get('access_token'), refresh: params.get('refresh_token'), error: params.get('error_description') }
}

export default function ResetPasswordScreen() {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const url = Linking.useURL()
  const [phase, setPhase] = useState('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!supabase || !url) return undefined
    let active = true
    async function start() {
      const tokens = tokensFrom(url)
      if (tokens.error) throw new Error(tokens.error)
      if (tokens.code) {
        const { error: codeError } = await supabase.auth.exchangeCodeForSession(tokens.code)
        if (codeError) throw codeError
      } else if (tokens.access && tokens.refresh) {
        const { error: sessionError } = await supabase.auth.setSession({ access_token: tokens.access, refresh_token: tokens.refresh })
        if (sessionError) throw sessionError
      } else {
        const { data } = await supabase.auth.getSession()
        if (!data.session) throw new Error('Tautan tidak lengkap. Buka tautan terbaru dari email.')
      }
    }
    start().then(() => active && setPhase('form')).catch((caught) => {
      if (!active) return
      setError(/expired|invalid/i.test(caught.message) ? 'Tautan sudah kedaluwarsa atau sudah dipakai. Minta tautan baru.' : caught.message)
      setPhase('failed')
    })
    return () => { active = false }
  }, [supabase, url])

  async function save() {
    setError('')
    if (password.length < 8) return setError('Password minimal 8 karakter.')
    if (password !== confirm) return setError('Konfirmasi password tidak sama.')
    setSaving(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (updateError) return setError(updateError.message)
    toast({ tone: 'success', title: 'Password diperbarui', description: 'Kamu sudah masuk dengan password baru.' })
    router.replace('/(tabs)')
    return undefined
  }

  if (phase === 'checking') return <Screen><LoadingState label="Memeriksa tautan..." /></Screen>
  return (
    <Screen contentStyle={styles.content}>
      <Text serif weight="700" size="2xl">Buat password baru</Text>
      <ErrorBox message={error} />
      {phase === 'failed' ? (
        <Button title="Minta tautan baru" onPress={() => router.replace('/forgot-password')} />
      ) : (
        <>
          <Field label="Password baru" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="new-password" hint="Minimal 8 karakter" />
          <Field label="Ulangi password" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
          <Button title="Simpan password" onPress={save} loading={saving} />
        </>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', gap: 16 },
})
