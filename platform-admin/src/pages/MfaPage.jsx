/*
 * 2FA wajib (Supabase Auth MFA, TOTP):
 * - Belum punya faktor terverifikasi → daftar: scan QR di aplikasi authenticator, masukkan kode 6 digit.
 * - Sudah punya → masukkan kode 6 digit. Setelah lolos, sesi naik ke aal2.
 */
import { useEffect, useState } from 'react'
import { LogOut, ShieldCheck } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { Button, TextField } from '../components/ui/index.js'
import { LoginShell } from './LoginPage.jsx'

export function MfaPage() {
  const { aal, admin, loading, session, signOut, supabase, refresh } = useAuth()
  const navigate = useNavigate()
  const [factor, setFactor] = useState(null)
  const [enroll, setEnroll] = useState(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(true)

  useEffect(() => {
    if (!supabase || !session || aal === 'aal2' || !admin?.is_admin) return undefined
    let active = true
    async function prepare() {
      setPreparing(true)
      setError('')
      const { data, error: listError } = await supabase.auth.mfa.listFactors()
      if (!active) return
      if (listError) {
        setError(listError.message)
        setPreparing(false)
        return
      }
      const verified = data.totp.find((item) => item.status === 'verified')
      if (verified) {
        setFactor(verified)
        setPreparing(false)
        return
      }
      // Bersihkan pendaftaran lama yang belum selesai, lalu daftar baru
      for (const item of data.all.filter((entry) => entry.status !== 'verified')) {
        await supabase.auth.mfa.unenroll({ factorId: item.id })
      }
      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Dailybrew Platform ${new Date().toISOString().slice(0, 10)}`,
      })
      if (!active) return
      if (enrollError) setError(`2FA belum bisa didaftarkan: ${enrollError.message}`)
      else {
        setEnroll(enrolled)
        setFactor({ id: enrolled.id })
      }
      setPreparing(false)
    }
    prepare()
    return () => { active = false }
  }, [aal, admin?.is_admin, session, supabase])

  if (loading || (session && !admin)) return <div className="login-loading" role="status">Memeriksa sesi…</div>
  if (!session) return <Navigate to="/login" replace />
  if (aal === 'aal2') return <Navigate to="/" replace />
  if (!admin.is_admin) return <Navigate to="/" replace />

  async function verify(event) {
    event.preventDefault()
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Masukkan 6 digit kode dari aplikasi authenticator.')
      return
    }
    setBusy(true)
    setError('')
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() })
    if (verifyError) {
      setError(/invalid|expired/i.test(verifyError.message) ? 'Kode salah atau sudah kedaluwarsa. Coba kode terbaru.' : verifyError.message)
      setBusy(false)
      return
    }
    await refresh()
    navigate('/', { replace: true })
  }

  return (
    <LoginShell
      title={enroll ? 'Aktifkan 2FA' : 'Kode 2FA'}
      description={enroll
        ? 'Wajib untuk admin platform. Scan QR dengan Google Authenticator, Authy, atau 1Password, lalu masukkan kodenya.'
        : 'Buka aplikasi authenticator dan masukkan kode 6 digit untuk Dailybrew Platform.'}
    >
      {error && <div className="login-alert" role="alert">{error}</div>}
      {preparing ? (
        <p className="login-footnote" role="status">Menyiapkan 2FA…</p>
      ) : (
        <form className="login-form" onSubmit={verify} noValidate>
          {enroll && (
            <div className="mfa-enroll">
              <img src={enroll.totp.qr_code} alt="Kode QR untuk aplikasi authenticator" width="184" height="184" />
              <p>Tidak bisa scan? Masukkan kunci ini manual:</p>
              <code className="mfa-secret">{enroll.totp.secret}</code>
            </div>
          )}
          {factor && (
            <TextField label="Kode 6 digit" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
              value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} />
          )}
          <Button type="submit" size="lg" block loading={busy} icon={ShieldCheck} disabled={!factor}>Verifikasi</Button>
          <Button variant="ghost" icon={LogOut} onClick={signOut}>Keluar</Button>
        </form>
      )}
    </LoginShell>
  )
}
