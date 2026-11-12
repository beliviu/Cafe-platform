import { useState } from 'react'
import { ArrowRight, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { BrandMark } from '../components/shell/AppShell.jsx'
import { Button, TextField } from '../components/ui/index.js'

const BRAND = { name: 'Dailybrew Platform' }

function loginErrorMessage(error) {
  const message = String(error?.message || '')
  if (/invalid login credentials/i.test(message)) return 'Email atau password salah.'
  if (/email not confirmed/i.test(message)) return 'Email belum dikonfirmasi.'
  if (/failed to fetch|network/i.test(message)) return 'Koneksi terputus. Periksa internet lalu coba lagi.'
  return `Gagal masuk: ${message}`
}

export function LoginShell({ title, description, children }) {
  return (
    <main className="login-page">
      <section className="login-intro" aria-label="Tentang Dailybrew Platform">
        <div className="login-brand">
          <BrandMark brand={BRAND} size={44} />
          <span className="login-brand-name">{BRAND.name}</span>
        </div>
        <div className="login-intro-copy">
          <span className="login-eyebrow">Khusus admin</span>
          <h1>Kelola semua kafe yang berlangganan Dailybrew.</h1>
          <p>Paket, langganan, tagihan, dan log audit di satu tempat. Akses dilindungi password dan kode 2FA.</p>
        </div>
        <span className="login-intro-foot"><ShieldCheck size={14} aria-hidden="true" /> Setiap aksi tercatat di log audit.</span>
        <span className="login-ornament login-ornament-a" aria-hidden="true" />
        <span className="login-ornament login-ornament-b" aria-hidden="true" />
      </section>
      <section className="login-panel">
        <div className="login-form-wrap">
          <div className="login-mobile-brand"><BrandMark brand={BRAND} size={36} /><span className="login-brand-name">{BRAND.name}</span></div>
          <div className="login-heading">
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          {children}
        </div>
      </section>
    </main>
  )
}

export function LoginPage() {
  const { authError, loading, session, supabase } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  if (loading) return <div className="login-loading" role="status">Memeriksa sesi…</div>
  if (session) return <Navigate to="/" replace />

  async function handleSubmit(event) {
    event.preventDefault()
    setErrorMessage('')
    if (!email.trim() || !password) {
      setErrorMessage('Email dan password wajib diisi.')
      return
    }
    if (!supabase) {
      setErrorMessage(authError || 'Koneksi ke server belum tersedia.')
      return
    }
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setErrorMessage(loginErrorMessage(error))
    setSubmitting(false)
  }

  const alert = errorMessage || authError
  return (
    <LoginShell title="Masuk" description="Gunakan akun admin platform. Setelah ini kamu diminta kode 2FA.">
      {alert && <div className="login-alert" role="alert">{alert}</div>}
      <form className="login-form" onSubmit={handleSubmit} noValidate>
        <TextField label="Email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
        <TextField
          label="Password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          suffix={(
            <button type="button" className="login-password-toggle" onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}>
              {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          )}
        />
        <Button type="submit" size="lg" block loading={submitting} iconRight={ArrowRight}>Masuk</Button>
      </form>
    </LoginShell>
  )
}
