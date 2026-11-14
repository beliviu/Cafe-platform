/*
 * /daftar — kafe mendaftar sendiri (file SQL 18 + Edge Function self-signup).
 * Perlindungan bot: Cloudflare Turnstile (VITE_TURNSTILE_SITE_KEY); verifikasi token & batas per IP di server.
 * Pesan sukses sama untuk email baru maupun yang sudah terdaftar (tidak membocorkan akun).
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Eye, EyeOff, MailCheck } from 'lucide-react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth.js'
import { BrandMark } from '../../components/shell/AppShell.jsx'
import { Button, TextField } from '../../components/ui/index.js'
import { usePublicBrand, useDocumentBranding } from '../../lib/branding.js'
import { loadTurnstile, submitSignup, TURNSTILE_SITE_KEY } from '../../lib/platformScale.js'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const EMPTY = { cafe_name: '', owner_name: '', email: '', whatsapp: '', city: '', password: '' }

function validate(form) {
  const errors = {}
  if (form.cafe_name.trim().length < 2) errors.cafe_name = 'Nama kafe minimal 2 karakter'
  if (form.owner_name.trim().length < 2) errors.owner_name = 'Nama owner minimal 2 karakter'
  if (!EMAIL.test(form.email.trim())) errors.email = 'Email tidak valid'
  if (form.whatsapp.replace(/\D/g, '').length < 9) errors.whatsapp = 'Nomor WhatsApp minimal 9 angka'
  if (form.city.trim().length < 2) errors.city = 'Isi kota kafe'
  if (form.password.length < 8) errors.password = 'Password minimal 8 karakter'
  return errors
}

/** Kotak Turnstile. Di mode pengembangan tanpa kunci: kotak pratinjau (server tetap menolak tanpa kunci). */
function Turnstile({ onToken, resetKey }) {
  const ref = useRef(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) {
      if (import.meta.env.DEV) onToken('dev-preview')
      return undefined
    }
    let widgetId = null
    let active = true
    loadTurnstile().then((turnstile) => {
      if (!active || !ref.current) return
      widgetId = turnstile.render(ref.current, {
        sitekey: TURNSTILE_SITE_KEY,
        language: 'id',
        theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
        callback: (token) => onToken(token),
        'expired-callback': () => onToken(''),
        'error-callback': () => { onToken(''); setError('Verifikasi gagal dimuat. Muat ulang halaman.') },
      })
    }).catch((caught) => setError(caught.message))
    return () => {
      active = false
      if (widgetId !== null) window.turnstile?.remove(widgetId)
    }
  }, [onToken, resetKey])

  if (!TURNSTILE_SITE_KEY) {
    return import.meta.env.DEV
      ? <div className="signup-captcha is-preview" role="note">Kotak "Saya bukan robot" (Turnstile) tampil di sini. Isi VITE_TURNSTILE_SITE_KEY untuk mengaktifkan.</div>
      : null
  }
  return (
    <div className="signup-captcha">
      <div ref={ref} />
      {error && <p className="ui-field-error" role="alert">{error}</p>}
    </div>
  )
}

export function SignupPage() {
  const { loading, session, supabase } = useAuth()
  const brand = usePublicBrand(supabase)
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [showPassword, setShowPassword] = useState(false)
  const [token, setToken] = useState('')
  const [resetKey, setResetKey] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(null)
  useDocumentBranding(brand, 'Daftar')

  if (loading) return <div className="login-loading" role="status">Memeriksa sesi…</div>
  if (session) return <Navigate to="/" replace />
  const closed = !TURNSTILE_SITE_KEY && !import.meta.env.DEV

  const set = (key) => (event) => {
    setForm((current) => ({ ...current, [key]: event.target.value }))
    setErrors((current) => ({ ...current, [key]: '', form: '' }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const next = validate(form)
    if (!token) next.turnstile = 'Selesaikan verifikasi "Saya bukan robot"'
    setErrors(next)
    if (Object.keys(next).length) return
    setSubmitting(true)
    try {
      const result = await submitSignup(supabase, { ...form, turnstile_token: token })
      setDone(result)
    } catch (caught) {
      setErrors(caught.field ? { [caught.field]: caught.message } : { form: caught.message })
      // Token Turnstile sekali pakai → minta ulang
      setToken('')
      setResetKey((value) => value + 1)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-intro" aria-label={`Tentang ${brand.name}`}>
        <div className="login-brand">
          <BrandMark brand={brand} size={44} />
          <span className="login-brand-name">{brand.name}</span>
        </div>
        <div className="login-intro-copy">
          <span className="login-eyebrow">Coba gratis</span>
          <h1>Kasir, pesanan QR, stok, dan laporan kafe dalam satu dashboard.</h1>
          <p>Daftar beberapa menit, langsung dapat masa coba. Tanpa kartu kredit.</p>
        </div>
        <span className="login-intro-foot"><Link to="/status">Status layanan</Link></span>
        <span className="login-ornament login-ornament-a" aria-hidden="true" />
      </section>

      <section className="login-panel">
        <div className="login-form-wrap">
          <div className="login-mobile-brand">
            <BrandMark brand={brand} size={40} />
            <span className="login-brand-name">{brand.name}</span>
          </div>

          {done ? (
            <div className="signup-done" role="status">
              <span className="signup-done-icon"><MailCheck size={28} aria-hidden="true" /></span>
              <h2>{done.pending ? 'Pendaftaran sedang ditinjau' : 'Cek email Anda'}</h2>
              <p>{done.message}</p>
              <p className="signup-muted">Email belum masuk? Cek folder spam, atau tunggu beberapa menit.</p>
              <Link className="ui-btn ui-btn-secondary ui-btn-md" to="/login">Ke halaman masuk</Link>
            </div>
          ) : (
            <>
              <header className="login-heading">
                <h2>Daftarkan kafe Anda</h2>
                <p>Sudah punya akun? <Link to="/login">Masuk</Link></p>
              </header>
              {closed && <div className="login-alert" role="alert">Pendaftaran online belum dibuka. Hubungi Dailybrew lewat WhatsApp untuk dibuatkan akun.</div>}
              {errors.form && <div className="login-alert" role="alert">{errors.form}</div>}
              <form className="login-form" onSubmit={handleSubmit} noValidate>
                <TextField label="Nama kafe" autoComplete="organization" value={form.cafe_name} onChange={set('cafe_name')} error={errors.cafe_name} maxLength={80} />
                <TextField label="Nama Anda (owner)" autoComplete="name" value={form.owner_name} onChange={set('owner_name')} error={errors.owner_name} maxLength={80} />
                <TextField label="Email" type="email" autoComplete="email" placeholder="nama@kafe.com" value={form.email} onChange={set('email')} error={errors.email} maxLength={254} />
                <div className="signup-row">
                  <TextField label="Nomor WhatsApp" type="tel" inputMode="tel" autoComplete="tel" placeholder="0812…" value={form.whatsapp} onChange={set('whatsapp')} error={errors.whatsapp} maxLength={20} />
                  <TextField label="Kota" autoComplete="address-level2" value={form.city} onChange={set('city')} error={errors.city} maxLength={60} />
                </div>
                <TextField
                  label="Password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.password} onChange={set('password')}
                  error={errors.password} hint="Minimal 8 karakter" maxLength={72}
                  suffix={(
                    <button type="button" className="login-password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}>
                      {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                    </button>
                  )}
                />
                <Turnstile onToken={setToken} resetKey={resetKey} />
                {errors.turnstile && <p className="ui-field-error" role="alert">{errors.turnstile}</p>}
                <Button type="submit" size="lg" block loading={submitting} disabled={closed} iconRight={ArrowRight}>Daftar & mulai coba</Button>
                <p className="signup-muted">Dengan mendaftar, Anda menyetujui ketentuan layanan Dailybrew. Kami mengirim email verifikasi sebelum akun aktif.</p>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  )
}
