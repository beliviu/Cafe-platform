/*
 * Peran tim admin (file SQL 18): super | finance | support. Ini HANYA untuk tampilan (sembunyikan menu & tombol);
 * yang menegakkan izin adalah database (pa_require) dan Edge Function (pa_admin_can).
 * Sebelum file 18: pa_whoami belum mengirim "allowed" → semua dianggap boleh (perilaku lama).
 */
export const ROLE_META = {
  super: { label: 'Super admin', tone: 'brand', description: 'Semua akses, termasuk tim, pengaturan, dan feature flag' },
  finance: { label: 'Finance', tone: 'green', description: 'Tagihan, langganan, promo, keuangan platform' },
  support: { label: 'Support', tone: 'blue', description: 'Kafe baca-saja, tiket, catatan, lihat-sebagai, status sistem' },
}

/** Apakah admin ini boleh memanggil fungsi pa_* tertentu. */
export function can(admin, fn) {
  const allowed = admin?.allowed
  if (!Array.isArray(allowed)) return true
  return allowed.includes('*') || allowed.includes(fn)
}
