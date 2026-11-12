import { createClient } from '@supabase/supabase-js'
import { resilientFetch } from './resilientFetch.js'

/*
 * Rapikan isi VITE_SUPABASE_URL yang sering salah tempel:
 * kutip, garis miring di akhir, tempelan /rest/v1 dsb (→ ambil origin saja),
 * link dashboard supabase.com/dashboard/project/<ref> (→ https://<ref>.supabase.co), atau tanpa https://.
 */
function normalizeSupabaseUrl(raw) {
  let value = String(raw || '').trim().replace(/^["']|["']$/g, '')
  if (!value) return ''
  const dashboard = value.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i)
  if (dashboard) return `https://${dashboard[1]}.supabase.co`
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  try {
    return new URL(value).origin
  } catch {
    return value
  }
}

export const supabaseUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL)
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim().replace(/^["']|["']$/g, '')

export const supabaseConfigError =
  !supabaseUrl || !supabaseKey
    ? 'Konfigurasi Supabase belum lengkap. Isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY (lokal: platform-admin/.env.local · Vercel: Settings → Environment Variables, lalu Redeploy).'
    : null

// Hanya kunci publik (anon/publishable). Aksi yang butuh service-role lewat Edge Function platform-admin.
export const supabase = supabaseConfigError
  ? null
  : createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        persistSession: true,
        storageKey: 'dailybrew.platform.auth',
      },
      global: { fetch: resilientFetch },
    })
