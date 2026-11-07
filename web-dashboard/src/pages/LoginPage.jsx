import { useState } from 'react'
import { ArrowRight, Coffee, Eye, EyeOff, Leaf } from 'lucide-react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'

export function LoginPage() {
  const { authError, loading, session, supabase } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  if (loading) return <div className="login-loading" role="status">Memeriksa sesi...</div>
  if (session) return <Navigate to={location.state?.from || '/'} replace />

  async function handleSubmit(event) {
    event.preventDefault()
    setErrorMessage('')

    if (!email.trim() || !password) {
      setErrorMessage('Email dan password wajib diisi.')
      return
    }
    if (!supabase) {
      setErrorMessage(authError || 'Koneksi Supabase belum tersedia.')
      return
    }

    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) setErrorMessage(`Gagal masuk: ${error.message}`)
    setSubmitting(false)
  }

  return (
    <main className="login-page">
      <section className="login-intro" aria-label="Tentang Dailybrew">
        <a className="brand-lockup login-brand" href="/" aria-label="Dailybrew">
          <span className="brand-mark"><Coffee size={20} strokeWidth={2.2} /></span>
          <span className="brand-name">daily<span>brew</span></span>
        </a>
        <div className="intro-copy">
          <span className="eyebrow"><Leaf size={14} /> YOUR CAFE, IN GOOD HANDS</span>
          <h1>Make room<br />for <em>great</em> coffee.</h1>
          <p>Semua yang Anda butuhkan untuk menjalankan cafe, dalam satu tempat yang tenang.</p>
        </div>
        <div className="intro-footer">
          <span className="intro-dot" />
          <span>Dirancang untuk hari yang lebih baik.</span>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-form-wrap">
          <div className="login-heading">
            <span className="form-kicker">CAFE WORKSPACE</span>
            <h2>Selamat datang kembali</h2>
            <p>Masuk untuk membuka dashboard sesuai peran dan akses akun Anda.</p>
          </div>

          {(errorMessage || authError) && (
            <div className="form-alert" role="alert">
              {errorMessage || authError}
            </div>
          )}

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <label className="field-label" htmlFor="email">Email</label>
            <input
              id="email"
              className="text-input"
              type="email"
              autoComplete="email"
              placeholder="nama@cafe.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />

            <div className="password-label-row">
              <label className="field-label" htmlFor="password">Password</label>
            </div>
            <div className="password-field">
              <input
                id="password"
                className="text-input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Masukkan password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                className="password-toggle"
                type="button"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>

            <button className="button button-primary login-submit" type="submit" disabled={submitting}>
              {submitting ? 'Sedang masuk...' : 'Masuk ke dashboard'}
              {!submitting && <ArrowRight size={17} />}
            </button>
          </form>

          <p className="login-footnote">
            Akun owner membuka dashboard manajemen. Akun staff langsung menuju operasional pesanan. Butuh bantuan? Hubungi administrator Anda.
          </p>
        </div>
        <span className="login-copyright">Dailybrew. Dibuat untuk hospitality.</span>
      </section>
    </main>
  )
}
