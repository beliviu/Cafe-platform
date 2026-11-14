// =====================================================================
// Edge Function: self-signup — daftar kafe sendiri dari halaman publik /daftar (file SQL 18)
//
// POST JSON (tanpa login):
//   { cafe_name, owner_name, email, whatsapp, city, password, turnstile_token, redirect_to? }
//   → { ok: true, message }   (pesan SAMA untuk email baru maupun yang sudah terdaftar — tidak membocorkan akun)
//
// Perlindungan:
//   1. Cloudflare Turnstile diverifikasi di server (TURNSTILE_SECRET_KEY). Tanpa kunci → pendaftaran ditolak (503).
//   2. Batas percobaan per IP di database (pa_signup_rate: 5/jam, 20/hari). IP disimpan sebagai hash SHA-256 + garam.
//   3. Akun dibuat lewat Supabase Auth signUp → Supabase mengirim email verifikasi (nyalakan "Confirm email").
//   4. Kafe + owner + trial dibuat atomik oleh SQL pa_signup_create (service_role, tidak bisa dipanggil browser).
//      Bila gagal, akun yang baru dibuat dihapus lagi.
//
// Deploy: Edge Functions → Deploy new function → Via Editor, nama "self-signup", tempel file ini, Deploy.
//         Verify JWT: OFF (halaman publik, belum ada sesi).
//         Secrets: TURNSTILE_SECRET_KEY (Cloudflare → Turnstile → widget → Secret key),
//                  SIGNUP_IP_SALT (teks acak panjang; opsional, bawaan memakai kunci service role),
//                  APP_URL_OWNER (alamat web owner, mis. https://dashboard.domainkamu.id — tujuan link verifikasi).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const DONE_MESSAGE = 'Pendaftaran diterima. Cek email untuk verifikasi, lalu masuk ke dashboard.'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
function fail(message: string, status = 400, field?: string) {
  return json({ error: message, field }, status)
}
function firstKey(name: string): string | undefined {
  try {
    const parsed = JSON.parse(Deno.env.get(name) ?? '')
    const value = parsed?.default ?? Object.values(parsed ?? {})[0]
    return typeof value === 'string' && value ? value : undefined
  } catch {
    return undefined
  }
}
function cleanText(value: unknown, max: number) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}
async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
function clientIp(req: Request) {
  return req.headers.get('cf-connecting-ip')
    || req.headers.get('x-real-ip')
    || (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
    || 'unknown'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('Metode tidak didukung', 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || firstKey('SUPABASE_PUBLISHABLE_KEYS')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || firstKey('SUPABASE_SECRET_KEYS')
  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY') ?? ''
  if (!url || !anonKey || !serviceKey) return fail('Konfigurasi server belum lengkap', 500)
  if (!turnstileSecret) return fail('Pendaftaran online belum dibuka. Hubungi Dailybrew lewat WhatsApp.', 503)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return fail('Format permintaan tidak valid')
  }

  const cafeName = cleanText(body.cafe_name, 80)
  const ownerName = cleanText(body.owner_name, 80)
  const email = cleanText(body.email, 254).toLowerCase()
  const whatsapp = cleanText(body.whatsapp, 30)
  const city = cleanText(body.city, 60)
  const password = typeof body.password === 'string' ? body.password : ''
  const token = typeof body.turnstile_token === 'string' ? body.turnstile_token : ''
  if (cafeName.length < 2) return fail('Nama kafe minimal 2 karakter', 400, 'cafe_name')
  if (ownerName.length < 2) return fail('Nama owner minimal 2 karakter', 400, 'owner_name')
  if (!EMAIL_PATTERN.test(email)) return fail('Email tidak valid', 400, 'email')
  if (whatsapp.replace(/\D/g, '').length < 9) return fail('Nomor WhatsApp tidak valid', 400, 'whatsapp')
  if (city.length < 2) return fail('Isi kota kafe', 400, 'city')
  if (password.length < 8 || password.length > 72) return fail('Password 8–72 karakter', 400, 'password')
  if (!token) return fail('Selesaikan verifikasi "Saya bukan robot"', 400, 'turnstile')

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const ip = clientIp(req)
  const ipHash = await sha256Hex(`${Deno.env.get('SIGNUP_IP_SALT') || serviceKey}:${ip}`)

  // 1. Batas per IP (dicatat sebelum verifikasi bot agar percobaan berulang tetap terhitung)
  const { data: rate, error: rateError } = await admin.rpc('pa_signup_rate', { p_ip_hash: ipHash })
  if (rateError) return fail('Pendaftaran sedang tidak tersedia. Coba lagi nanti.', 503)
  if (!rate?.ok) {
    if (rate?.reason === 'disabled') return fail('Pendaftaran sedang ditutup. Hubungi Dailybrew lewat WhatsApp.', 403)
    return fail('Terlalu banyak percobaan dari jaringan ini. Coba lagi 1 jam lagi.', 429)
  }

  // 2. Turnstile
  const form = new FormData()
  form.append('secret', turnstileSecret)
  form.append('response', token)
  if (ip !== 'unknown') form.append('remoteip', ip)
  const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
    .then((response) => response.json()).catch(() => ({ success: false }))
  if (!verify?.success) return fail('Verifikasi "Saya bukan robot" gagal. Muat ulang halaman lalu coba lagi.', 400, 'turnstile')

  // 3. Akun Auth (Supabase mengirim email verifikasi). Email yang sudah terdaftar → identities kosong → jawaban sama.
  const ownerUrl = (Deno.env.get('APP_URL_OWNER') ?? '').replace(/\/+$/, '')
  const publicClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: signUp, error: signUpError } = await publicClient.auth.signUp({
    email,
    password,
    options: { data: { full_name: ownerName }, emailRedirectTo: ownerUrl ? `${ownerUrl}/mulai` : undefined },
  })
  if (signUpError) {
    if (/password/i.test(signUpError.message)) return fail('Password terlalu lemah. Pakai kombinasi huruf dan angka.', 400, 'password')
    if (/rate|too many/i.test(signUpError.message)) return fail('Terlalu banyak permintaan. Coba lagi beberapa menit lagi.', 429)
    if (/already|registered|exists/i.test(signUpError.message)) return json({ ok: true, message: DONE_MESSAGE })
    return fail('Akun belum bisa dibuat. Coba lagi nanti.', 502)
  }
  const user = signUp.user
  if (!user || !user.identities || user.identities.length === 0) {
    // Email sudah terdaftar: jangan beri tahu (anti-enumerasi). Pemilik akun bisa masuk / reset password.
    return json({ ok: true, message: DONE_MESSAGE })
  }

  // 4. Kafe + owner + trial
  const { data: created, error: createError } = await admin.rpc('pa_signup_create', {
    p_user: user.id, p_cafe_name: cafeName, p_owner_name: ownerName, p_whatsapp: whatsapp, p_city: city, p_ip_hash: ipHash,
  })
  if (createError) {
    await admin.auth.admin.deleteUser(user.id)
    return fail(createError.message || 'Kafe gagal dibuat', 400)
  }
  return json({
    ok: true,
    pending: Boolean((created as Record<string, unknown>)?.pending),
    message: (created as Record<string, unknown>)?.pending
      ? 'Pendaftaran diterima dan akan ditinjau Dailybrew. Cek email untuk verifikasi sambil menunggu.'
      : DONE_MESSAGE,
  })
})
