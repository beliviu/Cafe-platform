import { useState } from 'react'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { BrandMark } from '../components/shell/AppShell.jsx'
import { Button, TextField } from '../components/ui/index.js'
import { usePublicBrand, useDocumentBranding } from '../lib/branding.js'

const YEAR = new Date().getFullYear()

function loginErrorMessage(error) {
  const message = String(error?.message || '')
  if (/invalid login credentials/i.test(message)) return 'Email atau password salah.'
  if (/email not confirmed/i.test(message)) return 'Email belum dikonfirmasi. Cek kotak masuk email Anda.'
  if (/failed to fetch|network/i.test(message)) return 'Koneksi terputus. Periksa internet lalu coba lagi.'
  return `Gagal masuk: ${message}`
}

export function LoginPage() {
  const { authError, loading, session, supabase } = useAuth()
  const location = useLocation()
  const brand = usePublicBrand(supabase)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useDocumentBranding(brand, 'Masuk')

  if (loading) return <div className="login-loading" role="status">Memeriksa sesi…</div>
  if (session) return <Navigate to={location.state?.from || '/'} replace />

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
    <main className="login-page">
      <section className="login-intro" aria-label={`Tentang ${brand.name}`}>
        <div className="login-brand">
          <BrandMark brand={brand} size={44} />
          <span className="login-brand-name">{brand.name}</span>
        </div>
        <div className="login-intro-copy">
          <span className="login-eyebrow">Ruang kerja kafe</span>
          <h1>{brand.tagline || 'Kelola penjualan, menu, dan tim dari satu tempat.'}</h1>
          <p>Owner membuka dashboard bisnis. Staff langsung menuju antrean pesanan.</p>
        </div>
        <span className="login-intro-foot">© {YEAR} {brand.businessName}</span>
        <span className="login-ornament login-ornament-a" aria-hidden="true" />
      </section>

      <section className="login-panel">
        <div className="login-form-wrap">
          <div className="login-mobile-brand">
            <BrandMark brand={brand} size={40} />
            <span className="login-brand-name">{brand.name}</span>
          </div>
          <header className="login-heading">
            <h2>Selamat datang kembali</h2>
            <p>Masuk dengan akun owner atau staff Anda.</p>
          </header>

          {alert && <div className="login-alert" role="alert">{alert}</div>}

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <TextField
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="nama@kafe.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <TextField
              label="Password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Masukkan password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              suffix={(
                <button
                  className="login-password-toggle"
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                >
                  {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                </button>
              )}
            />
            <Button type="submit" size="lg" block loading={submitting} iconRight={ArrowRight}>
              {submitting ? 'Sedang masuk…' : 'Masuk'}
            </Button>
          </form>

          <p className="login-footnote">Lupa password? Hubungi owner kafe Anda. Pemilik kafe baru? <Link to="/daftar">Daftar gratis</Link> · <Link to="/status">Status layanan</Link></p>
        </div>
      </section>
    </main>
  )
}
