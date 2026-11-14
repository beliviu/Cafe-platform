/*
 * Lihat-sebagai (file SQL 18): mulai sesi baca-saja 30 menit lalu buka web owner di jendela baru.
 * Token admin diserahkan lewat postMessage HANYA ke asal web owner (VITE_OWNER_APP_URL) dan hanya untuk sesi itu;
 * tidak pernah lewat URL. Database yang menegakkan baca-saja & batas waktu.
 */
import { rpc } from './api.js'
import { supabase } from './supabase.js'

export const OWNER_APP_URL = (import.meta.env.VITE_OWNER_APP_URL || '').replace(/\/+$/, '')
const OWNER_ORIGIN = (() => { try { return new URL(OWNER_APP_URL).origin } catch { return '' } })()

let listening = null

/** Pasang pendengar sekali: jawab permintaan token dari jendela web owner untuk sesi yang kita mulai. */
function ensureListener(sessions) {
  if (listening) return
  listening = async (event) => {
    if (event.origin !== OWNER_ORIGIN) return
    const data = event.data || {}
    if (data.type === 'dailybrew:impersonation-ready' && sessions.has(data.session)) {
      const { data: auth } = await supabase.auth.getSession()
      const token = auth?.session?.access_token
      if (token) event.source?.postMessage({ type: 'dailybrew:impersonation-token', session: data.session, access_token: token }, OWNER_ORIGIN)
    }
    if (data.type === 'dailybrew:impersonation-ended') sessions.delete(data.session)
  }
  window.addEventListener('message', listening)
}
const sessions = new Set()

export async function startImpersonation(cafeId, reason) {
  if (!OWNER_ORIGIN) throw new Error('Isi VITE_OWNER_APP_URL (alamat web owner) di pengaturan dashboard admin.')
  // Jendela dibuka dulu (sinkron dengan klik) agar tidak diblok browser, lalu diarahkan setelah sesi dibuat
  const popup = window.open('about:blank', 'dailybrew-lihat-sebagai')
  try {
    const session = await rpc('pa_impersonate_start', { p_cafe: cafeId, p_reason: reason })
    sessions.add(session.id)
    ensureListener(sessions)
    if (popup) popup.location.href = `${OWNER_APP_URL}/lihat-sebagai?sesi=${encodeURIComponent(session.id)}`
    else throw new Error('Jendela baru diblok browser. Izinkan pop-up untuk dashboard ini lalu coba lagi.')
    return session
  } catch (error) {
    popup?.close()
    throw error
  }
}

export async function endImpersonation(sessionId = null) {
  if (sessionId) sessions.delete(sessionId)
  return rpc('pa_impersonate_end', { p_session: sessionId })
}
