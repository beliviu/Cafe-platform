// =====================================================================
// Edge Function: platform-admin — aksi admin platform Dailybrew yang butuh service-role (file SQL 14)
//
// Aksi (POST JSON, header Authorization: Bearer <token admin platform>):
//   { action: 'create_cafe', cafe_name, owner_name, email, password, plan, trial_days, owner_whatsapp? }
//   { action: 'reset_owner_password', cafe_id, user_id, password }
//
// Aturan keamanan:
//   - Token diverifikasi ke Supabase Auth (getUser), lalu claim "aal" WAJIB "aal2" (sudah 2FA).
//   - Pemanggil wajib ada & aktif di tabel platform_admins.
//   - Email yang sudah terdaftar ditolak — tidak mengambil alih akun orang.
//   - Kafe + profil owner + langganan + log audit dibuat atomik oleh SQL pa_cafe_create_for_owner;
//     bila gagal, akun login yang baru dibuat dihapus lagi.
//   - Kunci service-role hanya ada di server (disediakan otomatis oleh Supabase).
//
// Deploy: Dashboard → Edge Functions → Deploy a new function → Via Editor, nama "platform-admin",
//         hapus SEMUA contoh kode, tempel isi file ini, Deploy.
//         Verify JWT: OFF (fungsi ini memeriksa token, 2FA, & admin sendiri; wajib OFF bila
//         project memakai kunci API baru publishable/secret).
// Requires: file SQL 14 (owner_whatsapp butuh file 15; tanpa itu nomor WA diabaikan).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function fail(message: string, status = 400) {
  return json({ error: message }, status)
}

function cleanText(value: unknown, max: number) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Variabel kunci baru Supabase berbentuk JSON, mis. {"default":"sb_secret_..."}. */
function firstKey(name: string): string | undefined {
  try {
    const parsed = JSON.parse(Deno.env.get(name) ?? '')
    const value = parsed?.default ?? Object.values(parsed ?? {})[0]
    return typeof value === 'string' && value ? value : undefined
  } catch {
    return undefined
  }
}

function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 72
}

/** Isi JWT (sudah diverifikasi getUser) — dipakai untuk membaca claim aal. */
function jwtClaims(authHeader: string): Record<string, unknown> {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=')))
  } catch {
    return {}
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('Metode tidak didukung', 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || firstKey('SUPABASE_PUBLISHABLE_KEYS')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || firstKey('SUPABASE_SECRET_KEYS')
  if (!url || !anonKey || !serviceKey) return fail('Konfigurasi server belum lengkap', 500)

  // 1. Siapa pemanggilnya (dari token, bukan dari body)
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return fail('Sesi tidak valid. Masuk ulang.', 401)
  if (jwtClaims(authHeader).aal !== 'aal2') return fail('Verifikasi 2FA diperlukan', 403)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const actorId = userData.user.id
  const { data: platformAdmin, error: adminError } = await admin
    .from('platform_admins').select('user_id, is_active').eq('user_id', actorId).maybeSingle()
  if (adminError) return fail('Data admin tidak dapat dimuat', 500)
  if (!platformAdmin?.is_active) return fail('Khusus admin platform Dailybrew', 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return fail('Format permintaan tidak valid')
  }

  switch (body.action) {
    case 'create_cafe': {
      const cafeName = cleanText(body.cafe_name, 80)
      const ownerName = cleanText(body.owner_name, 80)
      const email = cleanText(body.email, 254).toLowerCase()
      const plan = cleanText(body.plan, 30)
      const trialDays = Number(body.trial_days)
      const ownerWhatsapp = cleanText(body.owner_whatsapp, 30)
      if (cafeName.length < 2) return fail('Nama kafe minimal 2 karakter')
      if (ownerName.length < 2) return fail('Nama owner minimal 2 karakter')
      if (!EMAIL_PATTERN.test(email)) return fail('Email tidak valid')
      if (!validPassword(body.password)) return fail('Password sementara minimal 8 karakter')
      if (!plan) return fail('Pilih paket awal')
      if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 90) return fail('Masa coba 0–90 hari')

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password: body.password,
        email_confirm: true,
        user_metadata: { full_name: ownerName },
      })
      if (createError || !created.user) {
        const message = createError?.message ?? ''
        if (/already|registered|exists/i.test(message)) return fail('Email ini sudah terdaftar. Gunakan email lain untuk owner baru.', 409)
        return fail(`Akun gagal dibuat: ${message}`, 500)
      }

      const ownerId = created.user.id
      const args: Record<string, unknown> = {
        p_actor: actorId,
        p_owner_id: ownerId,
        p_cafe_name: cafeName,
        p_owner_name: ownerName,
        p_plan: plan,
        p_trial_days: trialDays,
      }
      // Versi file 15 menerima nomor WA owner (dinormalisasi & divalidasi di database)
      let { data: result, error: rpcError } = await admin.rpc('pa_cafe_create_for_owner', { ...args, p_owner_whatsapp: ownerWhatsapp || null })
      if (rpcError && /could not find the function|schema cache/i.test(rpcError.message)) {
        ({ data: result, error: rpcError } = await admin.rpc('pa_cafe_create_for_owner', args))
      }
      if (rpcError) {
        // Jangan tinggalkan akun setengah jadi
        await admin.auth.admin.deleteUser(ownerId)
        return fail(rpcError.message || 'Kafe gagal dibuat', 400)
      }
      return json({ ok: true, ...(result as Record<string, unknown>) })
    }

    case 'reset_owner_password': {
      const cafeId = String(body.cafe_id ?? '')
      const userId = String(body.user_id ?? '')
      if (!UUID_PATTERN.test(cafeId) || !UUID_PATTERN.test(userId)) return fail('Data tidak lengkap')
      if (!validPassword(body.password)) return fail('Password minimal 8 karakter')
      const { data: profile, error: profileError } = await admin
        .from('profiles').select('id, full_name, role, cafe_id').eq('id', userId).maybeSingle()
      if (profileError) return fail('Profil tidak dapat dimuat', 500)
      if (!profile || profile.cafe_id !== cafeId || !['owner', 'staff'].includes(String(profile.role))) {
        return fail('Akun tidak ditemukan di kafe ini', 404)
      }
      const { error: resetError } = await admin.auth.admin.updateUserById(userId, { password: body.password })
      if (resetError) return fail(`Password gagal diubah: ${resetError.message}`, 500)
      await admin.rpc('pa_log', {
        p_action: 'account.reset_password',
        p_cafe: cafeId,
        p_entity: 'account',
        p_entity_id: userId,
        p_before: null,
        p_after: { full_name: profile.full_name, role: profile.role },
        p_note: 'Password diganti admin platform',
        p_actor: actorId,
        p_actor_label: null,
      })
      return json({ ok: true })
    }

    default:
      return fail('Aksi tidak dikenal')
  }
})
