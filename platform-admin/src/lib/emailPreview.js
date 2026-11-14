/*
 * Pratinjau template email (file SQL 18). Cermin renderEmail() di Edge Function notify — HTML email memakai warna
 * inline karena klien email tidak membaca token CSS dashboard; ini KELUARAN EMAIL, bukan tampilan dashboard.
 */
const SAMPLE = {
  platform: 'Dailybrew', nama_kafe: 'Kopi Senja', nama_owner: 'Rina',
  judul: 'Tagihan jatuh tempo besok',
  isi: 'Tagihan INV-2611-00031 sebesar Rp 349.000 jatuh tempo 18/11/2026. Bayar dari Pengaturan → Langganan.',
}
export const TEMPLATE_VARIABLES = [
  ['{{nama_kafe}}', 'nama kafe'], ['{{nama_owner}}', 'nama owner'], ['{{judul}}', 'judul notifikasi'],
  ['{{isi}}', 'isi notifikasi dari sistem (nominal, tanggal, dll.)'], ['{{platform}}', 'nama pengirim'],
]
export const TEMPLATE_META = {
  welcome: { label: 'Selamat datang', used: 'Saat kafe mendaftar sendiri' },
  invoice: { label: 'Tagihan baru', used: 'Tagihan H-7' },
  reminder: { label: 'Pengingat', used: 'H-1, telat, telat 3 hari, peringatan nonaktif, masa coba habis' },
  reset_password: { label: 'Reset password', used: 'Disalin ke Supabase → Auth → Email Templates' },
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
export const fill = (text, vars = SAMPLE) => String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name) => vars[name] ?? '')

/** HTML email lengkap. ctaUrl = alamat tombol (untuk Supabase: {{ .ConfirmationURL }}). */
export function renderEmailHtml(template, { color = '#B0805A', fromName = 'Dailybrew', ctaUrl = '#', vars = SAMPLE } = {}) {
  const title = fill(template.heading, vars)
  const paragraphs = fill(template.body, vars).split(/\n+/).filter(Boolean)
    .map((line) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#3b2f28">${escapeHtml(line)}</p>`).join('')
  const button = template.cta_label
    ? `<p style="margin:20px 0 4px"><a href="${ctaUrl}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:${color};color:#ffffff;font-weight:700;font-size:14px;text-decoration:none">${escapeHtml(template.cta_label)}</a></p>`
    : ''
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f5efe9;font-family:'Segoe UI',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:${color};padding:18px 24px;color:#ffffff;font-size:17px;font-weight:700">${escapeHtml(fromName)}</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 14px;font-size:20px;line-height:1.3;color:#1f1712">${escapeHtml(title)}</h1>${paragraphs}${button}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #efe6de;color:#8a7a6f;font-size:12px;line-height:1.5">Email otomatis dari ${escapeHtml(fromName)}.</td></tr>
</table></td></tr></table></body></html>`
}
