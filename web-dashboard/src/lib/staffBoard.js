/*
 * Papan staff: 3 kolom, satu aksi utama per tahap.
 * Database tetap mencatat urutan lengkap (trigger alur status), jadi "Konfirmasi"
 * menjalankan pending → confirmed → preparing, dan "Siap" dari confirmed menjalankan
 * confirmed → preparing → ready. Yang ditulis hanya orders.order_status.
 */
export const BOARD_COLUMNS = [
  { key: 'incoming', label: 'Masuk', statuses: ['pending'], tone: 'amber', empty: 'Belum ada pesanan baru.' },
  { key: 'progress', label: 'Diproses', statuses: ['confirmed', 'preparing'], tone: 'blue', empty: 'Tidak ada yang sedang dibuat.' },
  { key: 'ready', label: 'Siap diambil', statuses: ['ready'], tone: 'green', empty: 'Belum ada yang siap diambil.' },
]

export function boardColumnOf(order) {
  return BOARD_COLUMNS.find((column) => column.statuses.includes(order.order_status))?.key || null
}

/** { label, target } atau null */
export function primaryAction(order) {
  switch (order.order_status) {
    case 'pending': return { label: 'Konfirmasi', target: 'preparing' }
    case 'confirmed':
    case 'preparing': return { label: 'Siap', target: 'ready' }
    case 'ready': return { label: 'Selesai', target: 'completed' }
    default: return null
  }
}
