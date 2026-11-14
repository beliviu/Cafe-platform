/*
 * /lihat-sebagai — admin platform melihat web owner sebuah kafe, BACA-SAJA (file SQL 18).
 *
 * Alur:
 *   1. Dashboard admin memulai sesi (pa_impersonate_start: alasan + 30 menit, tercatat di log audit), lalu membuka
 *      jendela ini: /lihat-sebagai?sesi=<id>.
 *   2. Jendela ini meminta token ke jendela admin lewat postMessage. Asal pesan dicek ketat (VITE_ADMIN_APP_URL).
 *      Token hanya disimpan di memori (tidak di localStorage) dan tidak pernah lewat URL.
 *   3. Semua data dibaca dengan token admin itu. Database yang menegakkan baca-saja: helper RLS memberi akses baca
 *      ke kafe ini selama sesi berlaku, dan trigger menolak SEMUA tulis. Tombol simpan di halaman tetap tampil, tapi
 *      setiap simpan ditolak dengan pesan "Mode lihat-sebagai hanya bisa melihat".
 */
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { Eye, LogOut } from 'lucide-react'
import { Outlet, useLocation } from 'react-router-dom'
import { AuthContext } from '../auth/AuthContext.js'
import { OWNER_NAVIGATION } from '../config/ownerNavigation.js'
import { brandOf, useDocumentBranding } from '../lib/branding.js'
import { cafeColumns, detectDbFeatures } from '../lib/db.js'
import { fetchCafeFlags } from '../lib/platformScale.js'
import { resilientFetch } from '../lib/resilientFetch.js'
import { LoadingScreen } from './LoadingScreen.jsx'
import { AccessState } from './shell/AccessState.jsx'
import { AppShell } from './shell/AppShell.jsx'

const PREFIX = '/lihat-sebagai'
const ADMIN_ORIGIN = (() => {
  try { return new URL(import.meta.env.VITE_ADMIN_APP_URL || '').origin } catch { return '' }
})()
const SESSION_KEY = 'dailybrew.impersonation.session'

function readSessionId(search) {
  const fromUrl = new URLSearchParams(search).get('sesi')
  if (fromUrl) {
    try { window.sessionStorage.setItem(SESSION_KEY, fromUrl) } catch { /* abaikan */ }
    return fromUrl
  }
  try { return window.sessionStorage.getItem(SESSION_KEY) } catch { return null }
}

function formatRemaining(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function ImpersonationLayout() {
  const { search } = useLocation()
  const [sessionId] = useState(() => readSessionId(search))
  const [token, setToken] = useState('')
  const [state, setState] = useState({ status: 'waiting', error: '', context: null, cafe: null, features: null, flags: {} })
  const [now, setNow] = useState(() => Date.now())
  // KHUSUS DEV: ?mock=1 → data tiruan tanpa jendela admin (pratinjau & screenshot)
  const devMock = import.meta.env.DEV && new URLSearchParams(search).get('mock') === '1'
  const [mockClient, setMockClient] = useState(null)
  useEffect(() => {
    if (!devMock) return
    import('../dev/mockSupabase.js').then((module) => setMockClient(module.createMockSupabase(module.createFixtures())))
  }, [devMock])

  // 1. Minta token ke jendela admin
  useEffect(() => {
    if (!sessionId || !ADMIN_ORIGIN || devMock) return undefined
    function onMessage(event) {
      if (event.origin !== ADMIN_ORIGIN) return
      const data = event.data || {}
      if (data.type === 'dailybrew:impersonation-token' && data.session === sessionId && typeof data.access_token === 'string') {
        setToken(data.access_token)
      }
    }
    window.addEventListener('message', onMessage)
    const ask = () => window.opener?.postMessage({ type: 'dailybrew:impersonation-ready', session: sessionId }, ADMIN_ORIGIN)
    ask()
    const retry = window.setInterval(ask, 1500)
    const giveUp = window.setTimeout(() => {
      setState((current) => (current.status === 'waiting' ? { ...current, status: 'error', error: 'Jendela ini harus dibuka dari dashboard admin (tombol "Lihat sebagai owner"). Tutup lalu buka ulang dari sana.' } : current))
    }, 8000)
    return () => { window.removeEventListener('message', onMessage); window.clearInterval(retry); window.clearTimeout(giveUp) }
  }, [devMock, sessionId])

  const realClient = useMemo(() => {
    if (!token) return null
    return createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
      accessToken: async () => token,
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: resilientFetch },
    })
  }, [token])
  const client = devMock ? mockClient : realClient

  // 2. Konteks sesi + data kafe
  useEffect(() => {
    if (!client) return undefined
    let active = true
    async function load() {
      const { data: context, error } = await client.rpc('impersonation_context', { p_session: sessionId })
      if (!active) return
      if (error) { setState((current) => ({ ...current, status: 'error', error: error.message })); return }
      const features = await detectDbFeatures(client)
      const { data: cafe, error: cafeError } = await client.from('cafes').select(cafeColumns(features)).eq('id', context.cafe_id).maybeSingle()
      const flags = await fetchCafeFlags(client, context.cafe_id)
      if (!active) return
      if (cafeError || !cafe) { setState((current) => ({ ...current, status: 'error', error: cafeError?.message || 'Kafe tidak ditemukan' })); return }
      setState({ status: 'ready', error: '', context, cafe, features, flags })
    }
    load()
    return () => { active = false }
  }, [client, sessionId])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const brand = state.cafe ? brandOf(state.cafe) : null
  useDocumentBranding(brand, 'Lihat sebagai')
  const navigation = useMemo(() => OWNER_NAVIGATION.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item, to: item.to === '/' ? PREFIX : `${PREFIX}${item.to}` })),
  })), [])
  const auth = useMemo(() => ({ authError: null, loading: false, session: client ? { user: { id: state.context?.owner?.id || 'admin' } } : null, supabase: client }), [client, state.context])

  async function end() {
    try { await client?.rpc('pa_impersonate_end', { p_session: sessionId }) } catch { /* sesi tetap berakhir otomatis */ }
    try { window.sessionStorage.removeItem(SESSION_KEY) } catch { /* abaikan */ }
    window.opener?.postMessage({ type: 'dailybrew:impersonation-ended', session: sessionId }, ADMIN_ORIGIN || '*')
    window.close()
    setState((current) => ({ ...current, status: 'ended' }))
  }

  if (!sessionId) return <AccessState title="Sesi tidak ditemukan" message="Buka mode lihat-sebagai dari dashboard admin (detail kafe → Lihat sebagai owner)." />
  if (!ADMIN_ORIGIN && !devMock) return <AccessState title="Belum dikonfigurasi" message="Isi VITE_ADMIN_APP_URL (alamat dashboard admin) di pengaturan web owner." />
  if (state.status === 'ended') return <AccessState title="Sesi lihat-sebagai berakhir" message="Jendela ini boleh ditutup." />
  if (state.status === 'error') return <AccessState title="Tidak bisa membuka" message={state.error} />
  if (state.status !== 'ready') return <LoadingScreen label="Membuka tampilan owner (baca-saja)…" />

  const remaining = new Date(state.context.expires_at).getTime() - now
  if (remaining <= 0) return <AccessState title="Waktu 30 menit habis" message="Sesi lihat-sebagai berakhir otomatis. Mulai sesi baru dari dashboard admin bila masih perlu." />

  return (
    <AuthContext.Provider value={auth}>
      <AppShell
        brand={brand}
        navigation={navigation}
        account={{ title: state.context.admin_name || 'Admin Dailybrew', subtitle: `Melihat sebagai owner · ${state.cafe.name}`, onSignOut: end }}
        banner={(
          <div className="shell-banner is-impersonation" role="status">
            <span>
              <Eye size={16} aria-hidden="true" /> <strong>Anda melihat sebagai {state.context.owner?.full_name || 'owner'} ({state.cafe.name}).</strong>
              {' '}Baca-saja — semua perubahan ditolak. Sisa waktu <span className="tabular">{formatRemaining(remaining)}</span>.
            </span>
            <span className="shell-banner-actions">
              <button type="button" onClick={end}><LogOut size={16} aria-hidden="true" /> Akhiri</button>
            </span>
          </div>
        )}
      >
        <Outlet context={{ cafe: state.cafe, profile: { ...state.context.owner, role: 'owner' }, features: state.features, flags: state.flags, readOnly: true, updateCafe: () => {}, updateProfile: () => {} }} />
      </AppShell>
    </AuthContext.Provider>
  )
}
