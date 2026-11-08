/*
 * Label & warna status — identik di owner, staff, dan customer.
 * Salinan ada di mobile-customer/src/lib/status.js. Ubah keduanya bersamaan.
 * tone: amber | blue | green | neutral | red  (lihat --status-* di tokens.css)
 */

export const ORDER_STATUS = {
  pending: { label: 'Menunggu', customerLabel: 'Menunggu konfirmasi', tone: 'amber', step: 0 },
  confirmed: { label: 'Dikonfirmasi', customerLabel: 'Dikonfirmasi', tone: 'blue', step: 1 },
  preparing: { label: 'Sedang dibuat', customerLabel: 'Sedang dibuat', tone: 'blue', step: 2 },
  ready: { label: 'Siap diambil', customerLabel: 'Siap diambil', tone: 'green', step: 3 },
  completed: { label: 'Selesai', customerLabel: 'Selesai', tone: 'neutral', step: 4 },
  cancelled: { label: 'Dibatalkan', customerLabel: 'Dibatalkan', tone: 'red', step: -1 },
}

export const ORDER_FLOW = ['pending', 'confirmed', 'preparing', 'ready', 'completed']
export const ACTIVE_ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready']

export const NEXT_ORDER_STATUS = {
  pending: 'confirmed',
  confirmed: 'preparing',
  preparing: 'ready',
  ready: 'completed',
}

export const PAYMENT_STATUS = {
  unpaid: { label: 'Belum dibayar', tone: 'amber' },
  pending: { label: 'Menunggu verifikasi', tone: 'amber' },
  paid: { label: 'Lunas', tone: 'green' },
  failed: { label: 'Gagal', tone: 'red' },
  refunded: { label: 'Dikembalikan', tone: 'neutral' },
}

export const PAYMENT_METHOD = {
  cash: 'Tunai',
  qris: 'QRIS',
  bank_transfer: 'Transfer bank',
  ewallet: 'E-wallet',
  simulated: 'Simulasi',
  simulated_demo: 'Simulasi',
  legacy: 'Lainnya',
  split: 'Split',
}

export const ORDER_SOURCE = { app: 'Aplikasi', pos: 'Kasir' }
export const ORDER_TYPE_LABEL = { dine_in: 'Makan di tempat', takeaway: 'Bawa pulang' }

export const ORDER_STATUS_LABELS = Object.fromEntries(Object.entries(ORDER_STATUS).map(([key, meta]) => [key, meta.label]))
export const PAYMENT_STATUS_LABELS = Object.fromEntries(Object.entries(PAYMENT_STATUS).map(([key, meta]) => [key, meta.label]))

export function orderStatusMeta(status) {
  return ORDER_STATUS[status] || { label: status || 'Tidak diketahui', customerLabel: status || 'Tidak diketahui', tone: 'neutral', step: -1 }
}

export function paymentStatusMeta(status) {
  return PAYMENT_STATUS[status] || { label: status || 'Tidak diketahui', tone: 'neutral' }
}

export function paymentMethodLabel(method) {
  if (!method) return 'Belum dipilih'
  return PAYMENT_METHOD[method] || method
}
