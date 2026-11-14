// =====================================================================
// Edge Function: subscription-billing — owner membayar langganan Dailybrew lewat Midtrans Snap (file SQL 14)
//
// Aksi (POST JSON, header Authorization: Bearer <token owner>):
//   { action: 'checkout', invoice_id, return_url? }  → { checkout_url }  (halaman bayar Midtrans: QRIS, VA, e-wallet, kartu)
//   { action: 'status',   invoice_id }               → cek ulang ke Midtrans (bila webhook terlambat)
//   { action: 'receipt',  invoice_id }               → kuitansi PDF tagihan lunas (file SQL 17). Owner kafe itu ATAU
//        admin platform (2FA). Hak akses dicek SQL invoice_receipt() dengan token pemanggil; tidak butuh kunci Midtrans.
// Webhook Midtrans (tanpa token): POST ?webhook=midtrans
//   URL webhook dikirim otomatis per transaksi lewat header X-Override-Notification, jadi TIDAK
//   bentrok dengan webhook pesanan kafe (Edge Function "payments") walau memakai akun Midtrans yang sama.
//
// Keamanan:
//   - Kunci Midtrans hanya di Secrets Edge Function. Kunci service-role disediakan Supabase.
//   - Nominal diambil dari database (subscription_invoices), bukan dari aplikasi.
//   - Webhook: tanda tangan SHA512(order_id+status_code+gross_amount+ServerKey) diverifikasi, LALU status
//     diambil ulang dari API Midtrans; hanya hasil API itu yang dipakai untuk menandai lunas.
//   - Penandaan lunas & perpanjangan langganan lewat SQL pa_gateway_apply (idempoten, tercatat di audit).
//
// Deploy: Dashboard → Edge Functions → Deploy new function → Via Editor, nama "subscription-billing",
//         tempel file ini, Deploy. Verify JWT: OFF (fungsi memeriksa token sendiri; webhook tanpa token).
//         Secrets (Edge Functions → Secrets):
//           PLATFORM_MIDTRANS_SERVER_KEY  = Server Key akun Midtrans milik Dailybrew (bila kosong → MIDTRANS_SERVER_KEY)
//           PLATFORM_MIDTRANS_ENV         = sandbox | production (bila kosong → MIDTRANS_ENV, default sandbox)
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.49.1'
import { PDFDocument, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Json = Record<string, unknown>
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function fail(message: string, status = 400) {
  return json({ error: message }, status)
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

/** Hanya izinkan kembali ke situs https (atau localhost saat pengembangan). */
function safeReturnUrl(value: unknown) {
  if (typeof value !== 'string') return undefined
  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return parsed.toString()
  } catch {
    /* abaikan */
  }
  return undefined
}

// ---------- Kuitansi PDF (pdf-lib, huruf standar Helvetica — tanpa berkas font) ----------
type Receipt = {
  receipt_number: string; invoice_number: string
  issuer: { name: string; address?: string | null; email?: string | null; tax_id?: string | null }
  cafe: { name: string; address?: string | null; phone?: string | null }
  owner?: { name?: string | null; email?: string | null } | null
  plan_name: string; months: number; period_start: string; period_end: string
  list_amount: number; promo_code?: string | null; promo_discount: number; referral_discount: number; credit_amount: number; amount: number
  paid_at: string; method: string; payment_ref?: string | null
}

const DATE = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })
const rupiah = (value: number) => `Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0))}`
const METHOD: Record<string, string> = { gateway: 'Pembayaran online (Midtrans)', manual_transfer: 'Transfer bank', credit: 'Kredit / diskon' }
// Helvetica standar hanya mengenal WinAnsi: ganti karakter di luar itu
const ascii = (value: unknown) => String(value ?? '').replace(/[–—]/g, '-').replace(/[^\x20-\x7E -ÿ]/g, '?')

async function receiptPdf(r: Receipt) {
  const doc = await PDFDocument.create()
  doc.setTitle(`Kuitansi ${r.receipt_number}`)
  doc.setAuthor(ascii(r.issuer.name))
  const page = doc.addPage([595.28, 841.89]) // A4
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.13, 0.11, 0.09)
  const muted = rgb(0.42, 0.38, 0.34)
  const accent = rgb(0.69, 0.5, 0.35)
  const left = 56
  const right = 595.28 - 56
  let y = 841.89 - 64

  const text = (value: unknown, x: number, size = 10, font = regular, color = ink) => page.drawText(ascii(value), { x, y, size, font, color })
  const textRight = (value: unknown, size = 10, font = regular, color = ink) => {
    const content = ascii(value)
    page.drawText(content, { x: right - font.widthOfTextAtSize(content, size), y, size, font, color })
  }
  const rule = (thickness = 0.6, color = rgb(0.85, 0.82, 0.78)) => page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness, color })

  // Kepala
  text(r.issuer.name, left, 18, bold)
  textRight('KUITANSI', 18, bold, accent)
  y -= 16
  for (const line of [r.issuer.address, r.issuer.email, r.issuer.tax_id ? `NPWP ${r.issuer.tax_id}` : null].filter(Boolean)) {
    text(line, left, 9, regular, muted)
    y -= 12
  }
  y -= 8
  rule(1.2, accent)
  y -= 28

  // Identitas
  const meta: [string, string][] = [
    ['Nomor kuitansi', r.receipt_number],
    ['Nomor tagihan', r.invoice_number],
    ['Tanggal bayar', DATE.format(new Date(r.paid_at))],
    ['Metode', METHOD[r.method] || r.method],
    ...(r.payment_ref ? [['Referensi', r.payment_ref] as [string, string]] : []),
  ]
  const top = y
  for (const [label, value] of meta) {
    text(label, left, 9, regular, muted)
    text(value, left + 92, 10, bold)
    y -= 15
  }
  const after = y
  y = top
  const billX = 340
  text('Diterima dari', billX, 9, regular, muted)
  y -= 15
  text(r.cafe.name, billX, 11, bold)
  y -= 14
  for (const line of [r.owner?.name, r.owner?.email, r.cafe.address, r.cafe.phone].filter(Boolean)) {
    text(String(line).slice(0, 48), billX, 9, regular, muted)
    y -= 12
  }
  y = Math.min(after, y) - 20

  // Rincian
  rule()
  y -= 16
  text('Uraian', left, 9, bold, muted)
  textRight('Jumlah', 9, bold, muted)
  y -= 10
  rule()
  y -= 18
  text(`Langganan Dailybrew ${r.plan_name} - ${r.months} bulan`, left, 11, bold)
  textRight(rupiah(r.list_amount), 11)
  y -= 14
  text(`Periode ${DATE.format(new Date(r.period_start))} s.d. ${DATE.format(new Date(r.period_end))}`, left, 9, regular, muted)
  y -= 22
  const lines: [string, number][] = [
    ...(Number(r.promo_discount) > 0 ? [[`Diskon promo ${r.promo_code || ''}`.trim(), -r.promo_discount] as [string, number]] : []),
    ...(Number(r.referral_discount) > 0 ? [['Diskon referral', -r.referral_discount] as [string, number]] : []),
    ...(Number(r.credit_amount) > 0 ? [['Kredit dipakai', -r.credit_amount] as [string, number]] : []),
  ]
  for (const [label, value] of lines) {
    text(label, left, 10)
    textRight(`- ${rupiah(Math.abs(value))}`, 10)
    y -= 18
  }
  rule()
  y -= 22
  text('Total dibayar', left, 12, bold)
  textRight(rupiah(r.amount), 14, bold)
  y -= 34

  // Cap LUNAS
  const stamp = 'LUNAS'
  page.drawRectangle({ x: left, y: y - 8, width: bold.widthOfTextAtSize(stamp, 14) + 24, height: 26, borderColor: rgb(0.2, 0.55, 0.35), borderWidth: 1.4 })
  page.drawText(stamp, { x: left + 12, y: y, size: 14, font: bold, color: rgb(0.2, 0.55, 0.35) })
  y -= 48
  text('Kuitansi ini dibuat otomatis oleh sistem dan sah tanpa tanda tangan.', left, 9, regular, muted)
  y -= 12
  text(`Dicetak ${DATE.format(new Date())}.`, left, 9, regular, muted)
  return await doc.save()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('Metode tidak didukung', 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || firstKey('SUPABASE_PUBLISHABLE_KEYS')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || firstKey('SUPABASE_SECRET_KEYS')
  const serverKey = Deno.env.get('PLATFORM_MIDTRANS_SERVER_KEY') || Deno.env.get('MIDTRANS_SERVER_KEY') || ''
  const production = (Deno.env.get('PLATFORM_MIDTRANS_ENV') || Deno.env.get('MIDTRANS_ENV')) === 'production'
  if (!url || !anonKey || !serviceKey) return fail('Konfigurasi server belum lengkap', 500)
  const gatewayOff = () => fail('Pembayaran online langganan belum diaktifkan. Hubungi Dailybrew untuk transfer manual.', 503)

  const apiBase = production ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com'
  const snapBase = production ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com'
  const authorization = `Basic ${btoa(`${serverKey}:`)}`
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  async function rpc(name: string, args: Json) {
    const { data, error } = await admin.rpc(name, args)
    if (error) throw new Error(error.message)
    return data
  }

  /** Ambil status terbaru dari Midtrans lalu terapkan (sumber kebenaran untuk lunas). */
  async function pollAndApply(providerOrderId: string) {
    const response = await fetch(`${apiBase}/v2/${encodeURIComponent(providerOrderId)}/status`, {
      headers: { Accept: 'application/json', Authorization: authorization },
    })
    const data = await response.json().catch(() => ({})) as Json
    if (data.status_code === '404' || !data.transaction_status) return { ok: true, paid: false, status: 'not_started' }
    return rpc('pa_gateway_apply', {
      p_provider_order_id: providerOrderId,
      p_status: data.transaction_status,
      p_fraud: data.fraud_status ?? null,
      p_gross: Number(data.gross_amount ?? 0),
      p_raw: data,
    })
  }

  // ---------- Webhook Midtrans ----------
  if (new URL(req.url).searchParams.get('webhook') === 'midtrans') {
    if (!serverKey) return gatewayOff()
    let note: Json
    try {
      note = await req.json()
    } catch {
      return fail('Format notifikasi tidak valid')
    }
    const orderId = String(note.order_id ?? '')
    const expected = await sha512Hex(`${orderId}${note.status_code ?? ''}${note.gross_amount ?? ''}${serverKey}`)
    if (!sameText(expected, String(note.signature_key ?? ''))) return fail('Tanda tangan tidak valid', 401)
    try {
      await pollAndApply(orderId)
      return new Response('OK', { status: 200 })
    } catch (error) {
      // 500 → Midtrans mengirim ulang nanti
      return fail((error as Error).message, 500)
    }
  }

  // ---------- Aksi owner ----------
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) return fail('Sesi tidak valid. Masuk ulang.', 401)
  const userId = userData.user.id

  let body: Json
  try {
    body = await req.json()
  } catch {
    return fail('Format permintaan tidak valid')
  }
  const invoiceId = String(body.invoice_id ?? '')
  if (!UUID_PATTERN.test(invoiceId)) return fail('Tagihan tidak dipilih')

  // Kuitansi: dibaca dengan token pemanggil (owner kafe itu / admin 2FA) — bukan service role
  if (body.action === 'receipt') {
    const { data, error } = await userClient.rpc('invoice_receipt', { p_invoice: invoiceId })
    if (error) return fail(error.message || 'Kuitansi tidak tersedia', /tidak ditemukan/i.test(error.message) ? 404 : 400)
    const pdf = await receiptPdf(data as Receipt)
    return new Response(new Blob([pdf as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Access-Control-Expose-Headers': 'Content-Disposition',
        // octet-stream → supabase-js functions.invoke mengembalikan Blob
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${(data as Receipt).receipt_number}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  if (!serverKey) return gatewayOff()
  try {
    switch (body.action) {
      case 'checkout': {
        const prep = await rpc('pa_gateway_prepare', { p_invoice: invoiceId, p_user: userId }) as Json
        if (prep.reuse) return json({ checkout_url: prep.checkout_url })

        const orderId = String(prep.provider_order_id)
        const amount = Math.round(Number(prep.amount))
        const finish = safeReturnUrl(body.return_url)
        const response = await fetch(`${snapBase}/snap/v1/transactions`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: authorization,
            'X-Override-Notification': `${url}/functions/v1/subscription-billing?webhook=midtrans`,
          },
          body: JSON.stringify({
            transaction_details: { order_id: orderId, gross_amount: amount },
            item_details: [{
              id: String(prep.number),
              price: amount,
              quantity: 1,
              name: `Dailybrew ${prep.plan_name} ${prep.months} bln`.slice(0, 50),
            }],
            customer_details: {
              first_name: String(prep.owner_name ?? prep.cafe_name ?? 'Owner').slice(0, 50),
              email: prep.owner_email ?? undefined,
            },
            ...(finish ? { callbacks: { finish } } : {}),
          }),
        })
        const data = await response.json().catch(() => ({})) as Json
        if (!response.ok || typeof data.redirect_url !== 'string') {
          const messages = Array.isArray(data.error_messages) ? data.error_messages.join(', ') : ''
          return fail(`Halaman pembayaran gagal dibuat${messages ? `: ${messages}` : ''}`, 502)
        }
        await rpc('pa_gateway_save_checkout', { p_provider_order_id: orderId, p_url: data.redirect_url })
        return json({ checkout_url: data.redirect_url })
      }

      case 'status': {
        const orderId = await rpc('pa_gateway_lookup', { p_invoice: invoiceId, p_user: userId })
        if (!orderId) return json({ ok: true, paid: false, status: 'not_started' })
        return json(await pollAndApply(String(orderId)))
      }

      default:
        return fail('Aksi tidak dikenal')
    }
  } catch (error) {
    return fail((error as Error).message || 'Terjadi kesalahan', 400)
  }
})
