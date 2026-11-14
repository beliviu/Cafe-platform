/*
 * KHUSUS DEV: /preview/public/* — halaman publik (/daftar, /status) dengan data tiruan, tanpa memanggil Supabase sungguhan.
 */
import { useMemo, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { AuthContext } from '../auth/AuthContext.js'
import { createFixtures, createMockSupabase } from './mockSupabase.js'

export function PublicPreview() {
  const [supabase] = useState(() => createMockSupabase(createFixtures()))
  const auth = useMemo(() => ({ authError: null, loading: false, session: null, supabase }), [supabase])
  return <AuthContext.Provider value={auth}><Outlet /></AuthContext.Provider>
}
