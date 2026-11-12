import { createClient } from '@supabase/supabase-js'
import { resilientFetch } from './resilientFetch.js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const supabaseConfigError =
  !supabaseUrl || !supabaseKey
    ? 'Konfigurasi Supabase belum lengkap. Isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY di platform-admin/.env.local.'
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
