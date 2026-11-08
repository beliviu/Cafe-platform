/*
 * Warna kategori untuk metode pembayaran. Urutan TETAP (warna mengikuti metode, bukan peringkat)
 * dan sudah divalidasi: pasangan bersebelahan (termasuk ujung-ke-awal pada donut) lolos uji
 * buta warna dengan pengodean sekunder (legenda + nilai + jarak 2px).
 * Bukan warna status — warna status hanya untuk Menunggu/Diproses/Siap/Selesai/Dibatalkan.
 */
export const PAYMENT_METHOD_ORDER = ['cash', 'bank_transfer', 'qris', 'ewallet', 'other']

export const PAYMENT_METHOD_COLORS = {
  cash: '#1baf7a',
  bank_transfer: '#eb6834',
  qris: '#2a78d6',
  ewallet: '#e87ba4',
  other: '#8f887c',
}

export function paymentMethodSlot(method) {
  return PAYMENT_METHOD_ORDER.includes(method) ? method : 'other'
}
