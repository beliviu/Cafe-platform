// =====================================================================
// Edge Function: notify — kirim email untuk antrean notification_outbox (file SQL 15)
//
// Dipanggil oleh:
//   1. Database Webhook: tabel notification_outbox, event INSERT, method POST, URL fungsi ini,
//      header  x-notify-secret: <nilai NOTIFY_WEBHOOK_SECRET>.  Body = { type, record, ... }.
//   2. (opsional) Cron / manual: POST {} dengan header yang sama → kirim ulang yang masih
//      'pending' / 'failed' (maks 3 percobaan) dalam 2 hari terakhir.
//   3. Uji kirim: POST { "test_to": "email@kamu.id" } dengan header yang sama.
//
// Aturan keamanan:
//   - Tanpa header rahasia yang benar → 401. Isi email selalu dibaca ulang dari database berdasarkan id.
//   - Kunci penyedia email hanya di Secrets. Kunci service-role disediakan Supabase.
//   - Channel 'whatsapp' TIDAK dikirim (status 'skipped') — WhatsApp masih manual lewat wa.me.
//
// Deploy: Dashboard → Edge Functions → Deploy a new function → Via Editor, nama "notify",
//         tempel isi file ini, Deploy. Verify JWT: OFF (dicek lewat secret).
//         Secrets: NOTIFY_WEBHOOK_SECRET (teks acak panjang), EMAIL_API_KEY (kunci Resend),
//                  EMAIL_FROM (mis. "Dailybrew <tagihan@domainkamu.id>", domain sudah diverifikasi di Resend),
//                  EMAIL_PROVIDER (opsional, bawaan "resend"), APP_URL_OWNER & APP_URL_ADMIN (opsional,
//                  alamat web owner & dashboard platform untuk tombol di email).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.49.1'

type Outbox = {
  id: number, channel: string, audience: string, recipient: string, kind: string, subject: string, title: string,
  body: string | null, cta_label: string | null, cta_url: string | null, status: string, attempts: number
}
type Mail = { to: string, subject: string, html: string, text: string, fromName: string }
type SendResult = { ok: true, id?: string } | { ok: false, error: string }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
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

function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))

/** Gabung tautan relatif (/kafe/…) dengan alamat aplikasi. */
function absoluteUrl(link: string | null, audience: string) {
  if (!link) return null
  if (/^https?:\/\//i.test(link)) return link
  const base = (audience === 'admin' ? Deno.env.get('APP_URL_ADMIN') : Deno.env.get('APP_URL_OWNER'))?.replace(/\/+$/, '')
  return base ? `${base}${link.startsWith('/') ? '' : '/'}${link}` : null
}

/** Template email HTML sederhana (tabel + inline style agar aman di semua klien email). */
function renderEmail(item: Pick<Outbox, 'title' | 'body' | 'cta_label'>, ctaUrl: string | null, color: string, fromName: string) {
  const paragraphs = (item.body ?? '').split(/\n+/).filter(Boolean)
    .map((line) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#3b2f28">${escapeHtml(line)}</p>`).join('')
  const button = ctaUrl && item.cta_label
    ? `<p style="margin:20px 0 4px"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:${color};color:#ffffff;font-weight:700;font-size:14px;text-decoration:none">${escapeHtml(item.cta_label)}</a></p>`
    : ''
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(item.title)}</title></head>
<body style="margin:0;padding:0;background:#f5efe9;font-family:'Segoe UI',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:${color};padding:18px 24px;color:#ffffff;font-size:17px;font-weight:700;letter-spacing:-.01em">${escapeHtml(fromName)}</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 14px;font-size:20px;line-height:1.3;color:#1f1712">${escapeHtml(item.title)}</h1>
${paragraphs}${button}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #efe6de;color:#8a7a6f;font-size:12px;line-height:1.5">Email otomatis dari ${escapeHtml(fromName)}. Butuh bantuan? Balas lewat WhatsApp Dailybrew dari menu Bantuan di dashboard.</td></tr>
</table></td></tr></table></body></html>`
  const text = [item.title, '', ...(item.body ?? '').split(/\n+/), ctaUrl ? `\n${item.cta_label ?? 'Buka'}: ${ctaUrl}` : ''].join('\n').trim()
  return { html, text }
}

// ---------- Penyedia email (ganti lewat EMAIL_PROVIDER) ----------
const PROVIDERS: Record<string, (mail: Mail, apiKey: string, from: string) => Promise<SendResult>> = {
  async resend(mail, apiKey, from) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
    })
    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) return { ok: false, error: String(data.message ?? data.error ?? `HTTP ${response.status}`).slice(0, 300) }
    return { ok: true, id: typeof data.id === 'string' ? data.id : undefined }
  },
  // Contoh penyedia lain: tambahkan fungsi dengan bentuk yang sama, lalu set EMAIL_PROVIDER ke namanya.
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Metode tidak didukung' }, 405)
  const secret = Deno.env.get('NOTIFY_WEBHOOK_SECRET') ?? ''
  if (!sameSecret(req.headers.get('x-notify-secret') ?? '', secret)) return json({ error: 'Tidak diizinkan' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || firstKey('SUPABASE_SECRET_KEYS')
  if (!url || !serviceKey) return json({ error: 'Konfigurasi server belum lengkap' }, 500)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const providerName = (Deno.env.get('EMAIL_PROVIDER') || 'resend').toLowerCase()
  const send = PROVIDERS[providerName]
  const apiKey = Deno.env.get('EMAIL_API_KEY') ?? ''
  const from = Deno.env.get('EMAIL_FROM') ?? ''

  const { data: settings } = await admin.from('platform_settings').select('theme_color, email_from_name').eq('id', true).maybeSingle()
  const color = /^#[0-9a-f]{6}$/i.test(settings?.theme_color ?? '') ? settings!.theme_color : '#B0805A'
  const fromName = settings?.email_from_name || 'Dailybrew'

  let payload: Record<string, unknown> = {}
  try {
    payload = await req.json()
  } catch {
    payload = {}
  }

  // Uji kirim tanpa menyentuh antrean
  if (typeof payload.test_to === 'string') {
    if (!send || !apiKey || !from) return json({ ok: false, error: 'EMAIL_API_KEY / EMAIL_FROM / EMAIL_PROVIDER belum diatur' }, 400)
    const { html, text } = renderEmail({ title: 'Uji email Dailybrew', body: 'Kalau email ini sampai, pengiriman notifikasi sudah berjalan.', cta_label: null }, null, color, fromName)
    const result = await send({ to: payload.test_to, subject: `[${fromName}] Uji email`, html, text, fromName }, apiKey, from)
    return json(result, result.ok ? 200 : 502)
  }

  const record = payload.record as { id?: number } | undefined
  let query = admin.from('notification_outbox').select('*')
  query = record?.id
    ? query.eq('id', record.id)
    : query.in('status', ['pending', 'failed']).lt('attempts', 3).gte('created_at', new Date(Date.now() - 2 * 86400_000).toISOString()).order('id').limit(50)
  const { data: items, error } = await query
  if (error) return json({ error: error.message }, 500)

  const results: Record<string, unknown>[] = []
  for (const item of (items ?? []) as Outbox[]) {
    if (!['pending', 'failed'].includes(item.status)) continue
    if (item.channel !== 'email') {
      await admin.from('notification_outbox').update({ status: 'skipped', error: 'WhatsApp masih manual (wa.me)' }).eq('id', item.id)
      results.push({ id: item.id, status: 'skipped' })
      continue
    }
    if (!send || !apiKey || !from) {
      await admin.from('notification_outbox').update({ status: 'failed', error: 'Penyedia email belum diatur (EMAIL_API_KEY / EMAIL_FROM)', attempts: item.attempts + 1 }).eq('id', item.id)
      results.push({ id: item.id, status: 'failed' })
      continue
    }
    // Kunci baris: hanya satu pemanggil yang mengirim
    const { data: claimed } = await admin.from('notification_outbox').update({ status: 'sending', attempts: item.attempts + 1 })
      .eq('id', item.id).in('status', ['pending', 'failed']).select('id').maybeSingle()
    if (!claimed) continue

    const ctaUrl = absoluteUrl(item.cta_url, item.audience)
    const { html, text } = renderEmail(item, ctaUrl, color, fromName)
    const result = await send({ to: item.recipient, subject: item.subject, html, text, fromName }, apiKey, from)
    await admin.from('notification_outbox').update(result.ok
      ? { status: 'sent', sent_at: new Date().toISOString(), provider: providerName, provider_id: result.id ?? null, error: null }
      : { status: 'failed', provider: providerName, error: result.error }).eq('id', item.id)
    results.push({ id: item.id, status: result.ok ? 'sent' : 'failed' })
  }
  return json({ ok: true, processed: results.length, results })
})
