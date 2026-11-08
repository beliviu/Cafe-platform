/*
 * Tim kafe: daftar anggota (RPC cafe_team_members), jabatan (RPC owner_set_member_title),
 * dan akun staff (Edge Function staff-admin — butuh kunci server, tidak bisa dari browser).
 */
import { friendlyError } from './db.js'

export const EDGE_FUNCTION_MISSING =
  'Fungsi server "staff-admin" tidak ditemukan (404). Pastikan sudah di-deploy dengan nama persis staff-admin.'

/** Browser tidak mendapat jawaban sama sekali — biasanya ditolak sebelum masuk fungsi. */
export const EDGE_FUNCTION_UNREACHABLE =
  'Fungsi server "staff-admin" tidak bisa dihubungi. Cek di Supabase → Edge Functions: (1) fungsi bernama persis staff-admin, '
  + '(2) Verify JWT dimatikan, (3) tab Logs tidak menunjukkan error saat start.'

export async function fetchTeam(supabase, cafeId) {
  const { data, error } = await supabase.rpc('cafe_team_members', { p_cafe_id: cafeId })
  if (error) throw new Error(friendlyError(error))
  return data || []
}

export async function setMemberTitle(supabase, userId, jobTitle) {
  const { error } = await supabase.rpc('owner_set_member_title', { p_user_id: userId, p_job_title: jobTitle })
  if (error) throw new Error(friendlyError(error))
}

/** Panggil Edge Function staff-admin. Melempar Error berbahasa Indonesia. */
export async function staffAdmin(supabase, payload) {
  const { data, error } = await supabase.functions.invoke('staff-admin', { body: payload })
  if (!error) {
    if (data?.error) throw new Error(data.error)
    return data
  }
  const status = error.context?.status
  if (status === 404) throw new Error(EDGE_FUNCTION_MISSING)
  if (error.name === 'FunctionsFetchError' || error.name === 'FunctionsRelayError') throw new Error(EDGE_FUNCTION_UNREACHABLE)
  let message = ''
  try {
    message = (await error.context?.json?.())?.error || ''
  } catch {
    // body bukan JSON
  }
  // Fungsi kita selalu menjawab { error }. 401 tanpa itu berasal dari gateway = Verify JWT masih menyala.
  if (!message && status === 401) {
    throw new Error('Fungsi staff-admin menolak token (401 Invalid JWT). Matikan Verify JWT di pengaturan fungsi, lalu coba lagi.')
  }
  throw new Error(message || error.message || 'Permintaan ke server gagal.')
}

/** Password acak yang mudah didiktekan: 3 suku kata + 2 angka (mis. "Kopi-Lamo-Rade-47"). */
export function generatePassword() {
  const consonants = 'bcdfghjklmnprstvwy'
  const vowels = 'aeiou'
  const values = crypto.getRandomValues(new Uint32Array(10))
  const syllable = (offset) => {
    const word = consonants[values[offset] % consonants.length] + vowels[values[offset + 1] % vowels.length]
      + consonants[values[offset + 2] % consonants.length] + vowels[values[offset + 3] % vowels.length]
    return word[0].toUpperCase() + word.slice(1)
  }
  return `${syllable(0)}-${syllable(4)}-${10 + (values[8] % 90)}`
}

export const ROLE_LABELS = { owner: 'Owner', staff: 'Staff' }
