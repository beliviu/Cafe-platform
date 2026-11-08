/*
 * Izin per staff (file SQL 10). Database yang menegakkan (trigger); di UI hanya untuk
 * menyembunyikan/menonaktifkan tombol yang pasti ditolak. permissions null = semua izin (owner,
 * staff tanpa batasan, atau file 10 belum dijalankan).
 */
import { useOutletContext } from 'react-router-dom'

export const PERMISSIONS = [
  { key: 'pos.sell', label: 'Kasir (POS)', description: 'Membuat pesanan di kasir' },
  { key: 'pos.discount', label: 'Beri diskon', description: 'Diskon di kasir (tetap dibatasi persen maksimal staff)' },
  { key: 'payment.manual', label: 'Konfirmasi non-tunai', description: 'Menandai lunas QRIS manual / transfer / e-wallet' },
  { key: 'order.cancel', label: 'Batalkan pesanan', description: 'Membatalkan pesanan aktif' },
  { key: 'refund.request', label: 'Ajukan refund', description: 'Mengajukan refund (tetap disetujui owner)' },
  { key: 'cash.move', label: 'Kas masuk/keluar', description: 'Mengambil atau menambah uang laci di luar penjualan' },
  { key: 'menu.availability', label: 'Atur menu habis', description: 'Menandai menu habis / tersedia' },
  { key: 'ordering.pause', label: 'Jeda pesanan app', description: 'Menghentikan sementara pesanan dari aplikasi' },
  { key: 'support.reply', label: 'Balas pelanggan', description: 'Membalas tiket bantuan pelanggan' },
]

export const PERMISSION_LABELS = Object.fromEntries(PERMISSIONS.map((item) => [item.key, item.label]))

export function canDo(permissions, key) {
  return !Array.isArray(permissions) || permissions.includes(key)
}

/** const can = useCan(); can('order.cancel') */
export function useCan() {
  const context = useOutletContext()
  const permissions = context?.permissions ?? null
  return (key) => canDo(permissions, key)
}

/** Izin staff yang sedang masuk (null bila kolom belum ada / semua izin). */
export async function fetchOwnPermissions(supabase, userId) {
  const { data, error } = await supabase.from('profiles').select('staff_permissions').eq('id', userId).maybeSingle()
  if (error) return null
  return data?.staff_permissions ?? null
}
