// =====================================================================
// Edge Function: payments — QRIS dinamis lewat Midtrans (file SQL 09)
//
// Aksi (POST JSON, header Authorization: Bearer <token pengguna>):
//   { action: 'create',    order_id, source: 'app' | 'pos' }  → buat / pakai ulang tagihan QRIS
//   { action: 'status',    order_id }                         → cek ulang ke Midtrans (webhook terlambat)
//   { action: 'reconcile', cafe_id }                          → cek semua tagihan menunggu (owner/staff)
//   { action: 'refund',    refund_id } | { action: 'refund', order_id, amount, reason, restock?, items? } (owner)
// Webhook Midtrans (tanpa token): POST ?webhook=midtrans  ← isi di Midtrans Dashboard → Payment Notification URL
//
// Keamanan:
//   - MIDTRANS_SERVER_KEY hanya di Secrets Edge Function. Kunci service-role disediakan Supabase.
//   - Webhook: tanda tangan SHA512(order_id+status_code+gross_amount+ServerKey) diverifikasi, LALU status
//     diambil ulang dari API Midtrans; hanya hasil API itu yang dipakai untuk menandai lunas.
//   - Nominal tagihan dihitung database dari pesanan; isi body aplikasi tidak dipercaya.
//   - Semua perubahan lewat fungsi SQL pay_* (idempoten, dikunci per baris).
//
// Deploy: Dashboard → Edge Functions → Deploy new function → Via Editor, nama "payments",
//         tempel file ini, Deploy. Verify JWT: OFF (fungsi memeriksa token sendiri; webhook tanpa token).
//         Secrets: MIDTRANS_SERVER_KEY, MIDTRANS_ENV = sandbox | production.
//         Banyak kafe, akun Midtrans masing-masing (file 10): tambah secret
//         MIDTRANS_SERVER_KEY_<ID KAFE TANPA TANDA ->, mis. MIDTRANS_SERVER_KEY_3F2A...; bila tidak ada,
//         kunci umum MIDTRANS_SERVER_KEY yang dipakai.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Json = Record<string, unknown>

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function fail(message: string, status = 400, hint?: string) {
  return json({ error: message, hint }, status)
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

async function sha512Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function sameText(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** "2026-11-09 14:30:00" (WIB) → ISO */
function wibToIso(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null
  return new Date(`${value.replace(' ', 'T')}+07:00`).toISOString()
}

/** Kolom tagihan yang aman dikirim ke aplikasi */
function publicIntent(intent: Json | null) {
  if (!intent) return null
  const { id, order_id, amount, status, qr_string, qr_url, expires_at, paid_at, provider_order_id } = intent
  return { id, order_id, amount, status, qr_string, qr_url, expires_at, paid_at, provider_order_id }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('Metode tidak didukung', 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || firstKey('SUPABASE_PUBLISHABLE_KEYS')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || firstKey('SUPABASE_SECRET_KEYS')
  const defaultKey = Deno.env.get('MIDTRANS_SERVER_KEY') ?? ''
  if (!url || !anonKey || !serviceKey) return fail('Konfigurasi pembayaran server belum lengkap', 500)
  const base = Deno.env.get('MIDTRANS_ENV') === 'production' ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com'
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  /** Kunci Midtrans kafe ini (multi-merchant) atau kunci umum. */
  function keyForCafe(cafeId: unknown) {
    const own = typeof cafeId === 'string' ? Deno.env.get(`MIDTRANS_SERVER_KEY_${cafeId.replace(/-/g, '').toUpperCase()}`) : undefined
    const key = own || defaultKey
    if (!key) throw Object.assign(new Error('Kunci Midtrans untuk kafe ini belum diatur di server'), { hint: 'gateway_key_missing' })
    return key
  }

  /** Kafe pemilik tagihan (file 10). Bila fungsi belum ada → null (pakai kunci umum). */
  async function cafeOfIntent(providerOrderId: string) {
    const { data, error } = await admin.rpc('pay_intent_cafe', { p_provider_order_id: providerOrderId })
    return error ? null : data
  }

  async function midtrans(path: string, method: 'GET' | 'POST', key: string, body?: Json) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Basic ${btoa(`${key}:`)}` },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await response.json().catch(() => ({})) as Json
    return { ok: response.ok, data }
  }

  async function rpc(name: string, args: Json) {
    const { data, error } = await admin.rpc(name, args)
    if (error) throw Object.assign(new Error(error.message), { hint: error.hint })
    return data
  }

  /** Ambil status terbaru dari Midtrans lalu terapkan (sumber kebenaran untuk lunas). */
  async function pollAndApply(providerOrderId: string, source: 'poll' | 'webhook', key: string, signatureValid = true) {
    const { data } = await midtrans(`/v2/${encodeURIComponent(providerOrderId)}/status`, 'GET', key)
    if (data.status_code === '404' || !data.transaction_status) return { skipped: true }
    return rpc('pay_apply_status', {
      p_provider_order_id: providerOrderId,
      p_transaction_id: data.transaction_id ?? null,
      p_status: data.transaction_status,
      p_fraud_status: data.fraud_status ?? null,
      p_gross: Number(data.gross_amount ?? 0),
      p_raw: data,
      p_source: source,
      p_signature_valid: signatureValid,
    })
  }

  // ---------- Webhook Midtrans ----------
  if (new URL(req.url).searchParams.get('webhook') === 'midtrans') {
    let note: Json
    try {
      note = await req.json()
    } catch {
      return fail('Format notifikasi tidak valid')
    }
    const orderId = String(note.order_id ?? '')
    let webhookKey: string
    try {
      webhookKey = keyForCafe(await cafeOfIntent(orderId))
    } catch (error) {
      return fail((error as Error).message, 500)
    }
    const expected = await sha512Hex(`${orderId}${note.status_code ?? ''}${note.gross_amount ?? ''}${webhookKey}`)
    if (!sameText(expected, String(note.signature_key ?? ''))) {
      await admin.rpc('pay_apply_status', {
        p_provider_order_id: orderId, p_transaction_id: note.transaction_id ?? null, p_status: note.transaction_status ?? null,
        p_fraud_status: null, p_gross: 0, p_raw: { order_id: orderId, rejected: 'bad_signature' }, p_source: 'webhook', p_signature_valid: false,
      })
      return fail('Tanda tangan tidak valid', 401)
    }
    try {
      await pollAndApply(orderId, 'webhook', webhookKey)
      return new Response('OK', { status: 200 })
    } catch (error) {
      // 500 → Midtrans mengirim ulang nanti
      return fail((error as Error).message, 500)
    }
  }

  // ---------- Aksi pengguna ----------
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) return fail('Sesi tidak valid. Masuk ulang.', 401)
  const actor = userData.user.id

  let body: Json
  try {
    body = await req.json()
  } catch {
    return fail('Format permintaan tidak valid')
  }

  try {
    if (body.action === 'create') {
      const prep = await rpc('pay_prepare_intent', { p_actor: actor, p_order_id: body.order_id, p_source: body.source === 'pos' ? 'pos' : 'app' }) as Json
      const intent = prep.intent as Json
      const key = keyForCafe(intent.cafe_id)
      for (const stale of (prep.stale as string[]) ?? []) {
        await midtrans(`/v2/${encodeURIComponent(stale)}/cancel`, 'POST', key).catch(() => null)
      }
      if (prep.reuse) return json({ intent: publicIntent(intent), reused: true })
      const { data } = await midtrans('/v2/charge', 'POST', key, {
        payment_type: 'qris',
        transaction_details: { order_id: intent.provider_order_id, gross_amount: Math.round(Number(intent.amount)) },
        qris: { acquirer: 'gopay' },
        custom_expiry: { expiry_duration: Number(prep.expiry_minutes ?? 15), unit: 'minute' },
      })
      const ok = data.status_code === '201' && data.transaction_status === 'pending'
      const actions = Array.isArray(data.actions) ? data.actions as Json[] : []
      const attached = await rpc('pay_attach_charge', {
        p_intent_id: intent.id,
        p_ok: ok,
        p_transaction_id: data.transaction_id ?? null,
        p_qr_string: typeof data.qr_string === 'string' ? data.qr_string : null,
        p_qr_url: (actions.find((action) => action.name === 'generate-qr-code')?.url as string) ?? null,
        p_expires_at: wibToIso(data.expiry_time),
        p_message: String(data.status_message ?? 'Gateway tidak merespons'),
        p_raw: data,
      }) as Json
      if (!ok) return fail(`Gateway menolak membuat QRIS: ${data.status_message ?? 'coba lagi'}`, 502, 'gateway_error')
      return json({ intent: publicIntent(attached) })
    }

    if (body.action === 'status' || body.action === 'reconcile') {
      const targets = await rpc('pay_reconcile_targets', {
        p_actor: actor, p_cafe_id: body.cafe_id ?? null, p_order_id: body.action === 'status' ? body.order_id : null,
      }) as Json[]
      let changed = 0
      for (const target of targets ?? []) {
        const id = String(target.provider_order_id)
        const result = await pollAndApply(id, 'poll', keyForCafe(await cafeOfIntent(id))) as Json
        if (result?.changed) changed += 1
      }
      return json({ checked: targets?.length ?? 0, changed })
    }

    if (body.action === 'refund') {
      const prep = await rpc('pay_refund_prepare', {
        p_actor: actor, p_refund_id: body.refund_id ?? null, p_order_id: body.order_id ?? null, p_amount: body.amount ?? null,
        p_reason: body.reason ?? null, p_restock: Boolean(body.restock), p_items: Array.isArray(body.items) ? body.items : [],
      }) as Json
      if (prep.already) return json({ status: 'succeeded', refund_id: prep.refund_id })
      const { data } = await midtrans(`/v2/${encodeURIComponent(String(prep.provider_order_id))}/refund`, 'POST', keyForCafe(await cafeOfIntent(String(prep.provider_order_id))), {
        refund_key: prep.refund_id, amount: Math.round(Number(prep.amount)), reason: String(prep.reason ?? '').slice(0, 255),
      })
      const ok = data.status_code === '200'
      await rpc('pay_refund_complete', {
        p_actor: actor, p_refund_id: prep.refund_id, p_ok: ok, p_provider_refund_id: data.refund_chargeback_id != null ? String(data.refund_chargeback_id) : null,
        p_message: String(data.status_message ?? ''), p_raw: data,
      })
      if (!ok) return fail(`Gateway menolak refund: ${data.status_message ?? 'coba lagi'}. Pengajuan refund tetap tersimpan.`, 502, 'gateway_error')
      return json({ status: 'succeeded', refund_id: prep.refund_id })
    }

    return fail('Aksi tidak dikenal')
  } catch (error) {
    const hint = (error as { hint?: string }).hint
    return fail((error as Error).message, hint === 'gateway_disabled' ? 409 : 400, hint)
  }
})
