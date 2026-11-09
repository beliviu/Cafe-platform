import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import { Platform } from 'react-native'
import { resilientFetch } from './resilientFetch.js'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim()
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_KEY?.trim()

// KHUSUS DEV/QA: EXPO_PUBLIC_MOCK=1 memakai data tiruan di memori (tidak menyentuh database)
const useMock = __DEV__ && process.env.EXPO_PUBLIC_MOCK === '1'

export const supabaseConfigError =
  !useMock && (!supabaseUrl || !supabaseKey)
    ? 'Konfigurasi Supabase belum lengkap. Isi EXPO_PUBLIC_SUPABASE_URL dan EXPO_PUBLIC_SUPABASE_KEY di mobile-customer/.env.'
    : null

const webStorage = {
  getItem: async (key) => (
    typeof window === 'undefined' ? null : window.localStorage.getItem(key)
  ),
  setItem: async (key, value) => {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value)
  },
  removeItem: async (key) => {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key)
  },
}

export const supabase = useMock
  ? require('../dev/mockSupabase.js').createMockSupabase()
  : supabaseConfigError
  ? null
  : createClient(supabaseUrl, supabaseKey, {
      auth: {
        storage: Platform.OS === 'web' ? webStorage : AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
      global: { fetch: resilientFetch },
    })
