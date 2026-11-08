// =====================================================================
// Edge Function: push-send
// Mengirim notifikasi push (Expo Push API) untuk baris baru di tabel notifications (file 08).
// Kunci service-role HANYA ada di sini (disediakan otomatis oleh Supabase), tidak pernah ke app.
//
// Dipanggil oleh:
//   1. Database Webhook: tabel notifications, event INSERT, method POST, URL fungsi ini,
//      header  x-push-secret: <nilai PUSH_WEBHOOK_SECRET>.  Body = { type, record, ... }.
//   2. (opsional) Cron / manual: POST {} dengan header yang sama → kirim semua yang masih
//      'pending' dalam 1 jam terakhir (cadangan bila webhook sempat gagal).
//
// Aturan keamanan:
//   - Tanpa header rahasia yang benar → 401. Fungsi tidak menerima isi notifikasi dari luar:
//     isi selalu dibaca ulang dari database berdasarkan id.
//   - Token perangkat yang sudah tidak terdaftar (DeviceNotRegistered) dihapus.
//
// Deploy: Supabase Dashboard → Edge Functions → Deploy a new function → Via Editor,
//         nama "push-send", tempel isi file ini, Deploy. Verify JWT: OFF (dicek lewat secret).
//         Edge Functions → Secrets → tambah PUSH_WEBHOOK_SECRET (teks acak panjang).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.49.1'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** Variabel kunci baru Supabase berbentuk JSON, mis. {"default":"sb_secret_..."}. */
function firstKey(name: string): string | undefined {
  try {
    const parsed = JSON.parse(Deno.env.get(name) ?? '')
    const value = parsed?.default ?? Object.values(parsed ?? {})[0]
    return typeof value === 'string' && value ? value : undefined
  } catch {
    return undefined
  }
}

/** Perbandingan waktu-konstan agar secret tidak bisa ditebak dari lama respons. */
function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

type Notification = { id: string, user_id: string, title: string, body: string | null, data: Record<string, unknown>, push_status: string }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Metode tidak didukung' }, 405)
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? ''
  if (!sameSecret(req.headers.get('x-push-secret') ?? '', secret)) return json({ error: 'Tidak diizinkan' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || firstKey('SUPABASE_SECRET_KEYS')
  if (!url || !serviceKey) return json({ error: 'Konfigurasi server belum lengkap' }, 500)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  let payload: Record<string, unknown> = {}
  try {
    payload = await req.json()
  } catch {
    payload = {}
  }

  // Ambil ulang dari database (jangan percaya isi body)
  const recordId = typeof (payload.record as { id?: unknown })?.id === 'string' ? (payload.record as { id: string }).id : null
  const query = admin.from('notifications').select('id, user_id, title, body, data, push_status').eq('push_status', 'pending')
  const { data: rows, error } = recordId
    ? await query.eq('id', recordId)
    : await query.gte('created_at', new Date(Date.now() - 3600_000).toISOString()).limit(200)
  if (error) return json({ error: 'Notifikasi tidak dapat dimuat' }, 500)

  const notifications = (rows ?? []) as Notification[]
  if (!notifications.length) return json({ sent: 0, skipped: 0, failed: 0 })

  const userIds = [...new Set(notifications.map((row) => row.user_id))]
  const { data: tokens, error: tokenError } = await admin.from('push_tokens').select('token, user_id').in('user_id', userIds)
  if (tokenError) return json({ error: 'Token tidak dapat dimuat' }, 500)
  const byUser = new Map<string, string[]>()
  for (const row of tokens ?? []) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row.token])

  const messages: { notificationId: string, token: string, message: Record<string, unknown> }[] = []
  const skipped: string[] = []
  for (const row of notifications) {
    const list = byUser.get(row.user_id) ?? []
    if (!list.length) skipped.push(row.id)
    for (const token of list) {
      messages.push({
        notificationId: row.id,
        token,
        message: { to: token, title: row.title, body: row.body ?? undefined, data: { ...row.data, notification_id: row.id }, sound: 'default', channelId: 'default' },
      })
    }
  }

  const sent = new Set<string>()
  const failed = new Set<string>()
  const deadTokens: string[] = []
  for (let index = 0; index < messages.length; index += 100) {
    const chunk = messages.slice(index, index + 100)
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk.map((item) => item.message)),
      })
      const result = await response.json().catch(() => ({}))
      const tickets: { status?: string, details?: { error?: string } }[] = Array.isArray(result?.data) ? result.data : []
      chunk.forEach((item, position) => {
        const ticket = tickets[position]
        if (response.ok && ticket?.status === 'ok') sent.add(item.notificationId)
        else {
          failed.add(item.notificationId)
          if (ticket?.details?.error === 'DeviceNotRegistered') deadTokens.push(item.token)
        }
      })
    } catch {
      chunk.forEach((item) => failed.add(item.notificationId))
    }
  }

  const now = new Date().toISOString()
  const sentIds = [...sent]
  const failedIds = [...failed].filter((id) => !sent.has(id))
  if (sentIds.length) await admin.from('notifications').update({ push_status: 'sent', push_attempted_at: now }).in('id', sentIds)
  if (failedIds.length) await admin.from('notifications').update({ push_status: 'failed', push_attempted_at: now }).in('id', failedIds)
  if (skipped.length) await admin.from('notifications').update({ push_status: 'skipped', push_attempted_at: now }).in('id', skipped)
  if (deadTokens.length) await admin.from('push_tokens').delete().in('token', deadTokens)

  return json({ sent: sentIds.length, skipped: skipped.length, failed: failedIds.length })
})
