/*
 * Warna kategori untuk metode pembayaran. Urutan TETAP (warna mengikuti metode, bukan peringkat).
 * Versi lebih dalam dari palet referensi agar menyatu dengan latar hangat (#FBF7F0).
 * Divalidasi (validate_palette.js, light): lightness, chroma, kontras >= 3:1, normal-vision PASS;
 * CVD pasangan ujung-ke-awal donut 6,6 (deutan) → wajib pengodean sekunder: legenda + nilai + jarak 2px (sudah ada).
 * Bukan warna status — warna status hanya untuk Menunggu/Diproses/Siap/Selesai/Dibatalkan.
 */
export const PAYMENT_METHOD_ORDER = ['cash', 'bank_transfer', 'qris', 'ewallet', 'other']

export const PAYMENT_METHOD_COLORS = {
  cash: '#17946B',
  bank_transfer: '#D45F2C',
  qris: '#2A6CC0',
  ewallet: '#CC6A92',
  other: '#8F7F70',
}

export function paymentMethodSlot(method) {
  return PAYMENT_METHOD_ORDER.includes(method) ? method : 'other'
}
