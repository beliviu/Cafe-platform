/*
 * WhatsApp MANUAL: tombol membuka https://wa.me/<nomor>?text=<pesan> di tab baru; admin menekan "kirim" sendiri.
 * Tidak ada pengiriman otomatis (WhatsApp Business API berbayar). Setiap klik dicatat di log audit (pa_log_whatsapp).
 */
import { formatDate, formatRupiah } from './format.js'

export const WA_TEMPLATES = [
  { key: 'tagihan', label: 'Pengingat tagihan' },
  { key: 'setup', label: 'Bantuan setup' },
  { key: 'upgrade', label: 'Tawaran upgrade' },
  { key: 'bebas', label: 'Pesan bebas' },
]

/** ctx: { cafeName, ownerName, amount, dueAt, invoiceNumber, planName } */
export function waMessage(template, ctx = {}) {
  const hi = `Halo Kak ${ctx.ownerName || ''}`.trim()
  const cafe = ctx.cafeName || 'kafe Kakak'
  switch (template) {
    case 'tagihan':
      return [
        `${hi}, salam dari Dailybrew.`,
        `Kami mengingatkan tagihan langganan ${cafe}${ctx.invoiceNumber ? ` (${ctx.invoiceNumber})` : ''}${ctx.amount ? ` sebesar ${formatRupiah(ctx.amount)}` : ''}${ctx.dueAt ? `, jatuh tempo ${formatDate(ctx.dueAt)}` : ''}.`,
        'Pembayaran bisa langsung dari dashboard: Pengaturan → Langganan → Bayar (QRIS, VA, e-wallet). Kalau sudah transfer, boleh kirim buktinya di sini ya.',
        'Terima kasih 🙏',
      ].join('\n\n')
    case 'setup':
      return [
        `${hi}, salam dari Dailybrew.`,
        `Ada yang bisa kami bantu untuk setup ${cafe}? Misalnya menambah menu, meja & QR, akun staff, atau pembayaran QRIS.`,
        'Silakan balas pesan ini, kami pandu langkah demi langkah.',
      ].join('\n\n')
    case 'upgrade':
      return [
        `${hi}, salam dari Dailybrew.`,
        `Terima kasih sudah memakai Dailybrew di ${cafe}${ctx.planName ? ` (paket ${ctx.planName})` : ''}.`,
        'Kalau Kakak butuh inventori & resep, laporan keuangan, member & poin, atau pesan lewat QR meja, paket Pro sudah mencakup semuanya. Mau kami bantu aktifkan atau jadwalkan demo singkat?',
      ].join('\n\n')
    default:
      return `${hi}, salam dari Dailybrew.\n\n`
  }
}

export function waLink(phone, text) {
  return `https://wa.me/${String(phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(text || '')}`
}

/** Tampilan nomor 62812… → +62 812-3456-7890 */
export function formatWa(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return ''
  const local = digits.replace(/^62/, '')
  return `+62 ${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`.replace(/-$/, '')
}
