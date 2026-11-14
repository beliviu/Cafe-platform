/*
 * Tiket "Bantuan Dailybrew" (owner → tim Dailybrew), file SQL 16.
 * Semua tulis lewat fungsi SQL owner_ticket_* (yang memeriksa owner kafe). Lampiran gambar disimpan di bucket
 * privat support-attachments/<cafe_id>/…; owner & admin membacanya lewat URL bertanda tangan.
 * Sebelum file 16 dijalankan: fetchTickets → null (halaman menampilkan keterangan, bukan error).
 */
const MISSING = /could not find the function|schema cache|does not exist|tidak ada di mock/i
const BUCKET = 'support-attachments'
export const MAX_ATTACHMENTS = 3
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export const TICKET_CATEGORIES = [
  { value: 'akun', label: 'Akun & login' },
  { value: 'tagihan', label: 'Tagihan & langganan' },
  { value: 'pesanan', label: 'Pesanan' },
  { value: 'menu', label: 'Menu & produk' },
  { value: 'pembayaran', label: 'Pembayaran' },
  { value: 'aplikasi', label: 'Aplikasi customer' },
  { value: 'lainnya', label: 'Lainnya' },
]
export const CATEGORY_LABEL = Object.fromEntries(TICKET_CATEGORIES.map((item) => [item.value, item.label]))
export const STATUS_META = {
  new: { label: 'Terkirim', tone: 'blue' },
  in_progress: { label: 'Diproses', tone: 'amber' },
  resolved: { label: 'Selesai', tone: 'green' },
}

function fail(error) {
  throw new Error(error.message || 'Terjadi kesalahan. Coba lagi.')
}

export async function fetchTickets(supabase, cafeId) {
  const { data, error } = await supabase.rpc('owner_tickets', { p_cafe: cafeId })
  if (error) {
    if (MISSING.test(error.message)) return null
    fail(error)
  }
  return data || []
}

export async function fetchTicket(supabase, ticketId) {
  const { data, error } = await supabase.rpc('owner_ticket_detail', { p_ticket: ticketId })
  if (error) fail(error)
  return data
}

/** Unggah gambar ke <cafe_id>/<uuid>.<ext>; kembalikan path untuk disimpan di pesan. */
export async function uploadAttachments(supabase, cafeId, files) {
  const paths = []
  for (const file of files) {
    const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const path = `${cafeId}/${crypto.randomUUID()}.${extension}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
    if (error) throw new Error(`Lampiran gagal diunggah: ${error.message}`)
    paths.push(path)
  }
  return paths
}

export async function signedAttachmentUrl(supabase, path) {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600)
  return data?.signedUrl || null
}

/** Cek berkas sebelum diunggah. Mengembalikan pesan kesalahan atau ''. */
export function validateAttachments(files) {
  if (files.length > MAX_ATTACHMENTS) return `Maksimal ${MAX_ATTACHMENTS} gambar.`
  const wrongType = files.find((file) => !ATTACHMENT_TYPES.includes(file.type))
  if (wrongType) return `${wrongType.name}: hanya gambar JPG, PNG, atau WebP.`
  const tooBig = files.find((file) => file.size > MAX_ATTACHMENT_BYTES)
  if (tooBig) return `${tooBig.name}: maksimal 5 MB per gambar.`
  return ''
}

export async function createTicket(supabase, { cafeId, category, title, body, files = [] }) {
  const attachments = files.length ? await uploadAttachments(supabase, cafeId, files) : []
  const { data, error } = await supabase.rpc('owner_ticket_create', {
    p_cafe: cafeId, p_category: category, p_title: title.trim(), p_body: body.trim(), p_attachments: attachments,
  })
  if (error) fail(error)
  return data
}

export async function replyTicket(supabase, { cafeId, ticketId, body, files = [] }) {
  const attachments = files.length ? await uploadAttachments(supabase, cafeId, files) : []
  const { data, error } = await supabase.rpc('owner_ticket_reply', { p_ticket: ticketId, p_body: body.trim(), p_attachments: attachments })
  if (error) fail(error)
  return data
}
