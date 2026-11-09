/*
 * Warna kategori metode pembayaran. Urutan TETAP (warna mengikuti metode, bukan peringkat).
 * Satu keluarga warna brand (--chart-1…5 dari lib/theme.js): lightness berjenjang, hue sama,
 * jadi grafik serasi dengan tema owner di mode gelap & terang.
 * Divalidasi (dataviz validate_palette.js --ordinal, beberapa warna brand, gelap & terang): lightness monoton,
 * jarak antar-langkah >= 0.06, ujung terpudar >= 2:1 terhadap kartu. Karena identitas hanya dari lightness,
 * donut WAJIB memakai pengodean sekunder: legenda + nilai + jarak 2px antar-segmen (sudah ada).
 * Bukan warna status — warna status hanya untuk Menunggu/Diproses/Siap/Selesai/Dibatalkan.
 */
export const PAYMENT_METHOD_ORDER = ['cash', 'bank_transfer', 'qris', 'ewallet', 'other']

export const PAYMENT_METHOD_COLORS = {
  cash: 'var(--chart-1)',
  bank_transfer: 'var(--chart-2)',
  qris: 'var(--chart-3)',
  ewallet: 'var(--chart-4)',
  other: 'var(--chart-5)',
}

export function paymentMethodSlot(method) {
  return PAYMENT_METHOD_ORDER.includes(method) ? method : 'other'
}
