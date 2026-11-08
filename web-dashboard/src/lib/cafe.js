/* Tulis data kafe (owner). RLS: hanya owner kafe itu (policy file 02). */
import { cafeColumns, friendlyError } from './db.js'

/** Simpan sebagian kolom cafes, lalu kembalikan baris terbaru. Kosong = ditolak RLS. */
export async function saveCafe(supabase, cafe, features, values) {
  const { data, error } = await supabase
    .from('cafes')
    .update(values)
    .eq('id', cafe.id)
    .select(cafeColumns(features))
    .maybeSingle()
  if (error) throw new Error(friendlyError(error))
  if (!data) throw new Error('Perubahan ditolak database. Pastikan pembaruan database (file 02) sudah dijalankan.')
  return data
}
