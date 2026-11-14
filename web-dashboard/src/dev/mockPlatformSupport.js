/*
 * KHUSUS DEV: tiket "Bantuan Dailybrew" (file 16) untuk /preview/owner. Bentuk data = keluaran fungsi SQL owner_ticket_*.
 */
const now = Date.now()
const iso = (hoursAgo) => new Date(now - hoursAgo * 3600000).toISOString()
let seq = 3

export function createSupportFixtures(cafeId) {
  const tickets = [
    { id: 'tkt-2', number: 'TKT-00002', cafe_id: cafeId, category: 'aplikasi', title: 'Printer struk tidak mencetak logo', status: 'in_progress', priority: 'normal',
      owner_unread: true, created_at: iso(50), last_message_at: iso(46), message_count: 2, last_message: 'Coba aktifkan "Tampilkan logo" di Pengaturan → Struk.' },
    { id: 'tkt-1', number: 'TKT-00001', cafe_id: cafeId, category: 'akun', title: 'Tambah akun staff baru', status: 'resolved', priority: 'low',
      owner_unread: false, created_at: iso(240), last_message_at: iso(216), message_count: 3, last_message: 'Sudah bisa, terima kasih!' },
  ]
  const messages = {
    'tkt-2': [
      { id: 1, author_role: 'owner', author_name: 'Owner', body: 'Logo kafe tidak muncul di struk printer 58mm.', attachments: [], created_at: iso(50) },
      { id: 2, author_role: 'admin', author_name: 'Iwan', body: 'Coba aktifkan "Tampilkan logo" di Pengaturan → Struk. Kalau masih belum muncul, kirim foto struknya ya.', attachments: [], created_at: iso(46) },
    ],
    'tkt-1': [
      { id: 3, author_role: 'owner', author_name: 'Owner', body: 'Mau tambah akun staff baru tapi gagal.', attachments: [], created_at: iso(240) },
      { id: 4, author_role: 'admin', author_name: 'Iwan', body: 'Paket Basic dibatasi 3 staff aktif. Nonaktifkan satu staff lama dulu, atau naik ke Pro.', attachments: [], created_at: iso(220) },
      { id: 5, author_role: 'owner', author_name: 'Owner', body: 'Sudah bisa, terima kasih!', attachments: [], created_at: iso(216) },
    ],
  }
  return { tickets, messages }
}

export function supportRpc(support, name, args) {
  const ok = (data) => ({ data, error: null })
  switch (name) {
    case 'owner_tickets':
      return ok([...support.tickets].sort((a, b) => (a.last_message_at < b.last_message_at ? 1 : -1)))
    case 'owner_ticket_detail': {
      const ticket = support.tickets.find((item) => item.id === args.p_ticket)
      if (!ticket) return { data: null, error: { message: 'Tiket tidak ditemukan' } }
      ticket.owner_unread = false
      return ok({ ticket, messages: support.messages[ticket.id] || [] })
    }
    case 'owner_ticket_create': {
      seq += 1
      const id = `tkt-${seq}`
      const ticket = {
        id, number: `TKT-${String(seq).padStart(5, '0')}`, cafe_id: args.p_cafe, category: args.p_category, title: args.p_title, status: 'new', priority: 'normal',
        owner_unread: false, created_at: new Date().toISOString(), last_message_at: new Date().toISOString(), message_count: 1, last_message: args.p_body.slice(0, 160),
      }
      support.tickets.push(ticket)
      support.messages[id] = [{ id: Date.now(), author_role: 'owner', author_name: 'Owner', body: args.p_body, attachments: args.p_attachments || [], created_at: ticket.created_at }]
      return ok(ticket)
    }
    case 'owner_ticket_reply': {
      const ticket = support.tickets.find((item) => item.id === args.p_ticket)
      support.messages[ticket.id].push({ id: Date.now(), author_role: 'owner', author_name: 'Owner', body: args.p_body, attachments: args.p_attachments || [], created_at: new Date().toISOString() })
      Object.assign(ticket, { status: ticket.status === 'resolved' ? 'in_progress' : ticket.status, last_message_at: new Date().toISOString(), last_message: args.p_body.slice(0, 160), message_count: support.messages[ticket.id].length })
      return ok(ticket)
    }
    case 'owner_log_plan_block':
      return ok(null)
    default:
      return null
  }
}
