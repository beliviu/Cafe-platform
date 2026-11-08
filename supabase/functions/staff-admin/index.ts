// =====================================================================
// Edge Function: staff-admin
// Owner mengelola akun staff kafenya sendiri. Kunci service-role HANYA ada di sini
// (disediakan otomatis oleh Supabase), tidak pernah dikirim ke browser.
//
// Aksi (POST JSON, header Authorization: Bearer <token owner>):
//   { action: 'create', email, password, full_name, job_title? }
//   { action: 'deactivate', user_id }
//   { action: 'reactivate', user_id }
//   { action: 'reset_password', user_id, password }
//
// Aturan keamanan:
//   - Pemanggil wajib owner aktif; kafe diambil dari profil owner, bukan dari request.
//   - Target wajib staff di kafe yang sama. Owner tidak bisa menonaktifkan dirinya/owner lain.
//   - Email yang sudah terdaftar (mis. akun customer) ditolak — tidak mengambil alih akun orang.
//
// Deploy: Supabase Dashboard → Edge Functions → Deploy a new function → Via Editor,
//         nama "staff-admin", tempel isi file ini, Deploy. (Verify JWT: biarkan ON.)
// Requires migration 04 (profiles.is_active, profiles.job_title).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const BAN_FOREVER = '876000h' // ±100 tahun

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function fail(message: string, status = 400) {
  return json({ error: message }, status)
}

function cleanText(value: unknown, max: number) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 72
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('Metode tidak didukung', 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) return fail('Konfigurasi server belum lengkap', 500)

  // 1. Siapa pemanggilnya (dari token, bukan dari body)
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return fail('Sesi tidak valid. Masuk ulang.', 401)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: owner, error: ownerError } = await admin
    .from('profiles')
    .select('id, role, cafe_id, is_active')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (ownerError) return fail('Profil tidak dapat dimuat', 500)
  if (!owner || owner.role !== 'owner' || !owner.cafe_id || owner.is_active === false) {
    return fail('Hanya owner kafe yang bisa mengelola staff', 403)
  }
  const cafeId: string = owner.cafe_id

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return fail('Format permintaan tidak valid')
  }

  async function audit(action: 'insert' | 'update', userId: string, label: string, changes: Record<string, unknown>) {
    await admin.from('audit_logs').insert({
      cafe_id: cafeId,
      actor_id: owner!.id,
      action,
      entity: 'staff_account',
      entity_id: userId,
      label,
      changes,
    })
  }

  async function loadStaff(userId: unknown) {
    if (typeof userId !== 'string' || !userId) return { error: fail('Staff tidak dipilih') }
    if (userId === owner!.id) return { error: fail('Tidak bisa mengubah akun Anda sendiri di sini') }
    const { data, error } = await admin
      .from('profiles')
      .select('id, full_name, role, cafe_id, is_active')
      .eq('id', userId)
      .maybeSingle()
    if (error) return { error: fail('Data staff tidak dapat dimuat', 500) }
    if (!data || data.cafe_id !== cafeId || data.role !== 'staff') {
      return { error: fail('Staff tidak ditemukan di kafe ini', 404) }
    }
    return { staff: data }
  }

  switch (body.action) {
    case 'create': {
      const email = cleanText(body.email, 254).toLowerCase()
      const fullName = cleanText(body.full_name, 80)
      const jobTitle = cleanText(body.job_title, 40) || null
      if (!EMAIL_PATTERN.test(email)) return fail('Email tidak valid')
      if (fullName.length < 2) return fail('Nama minimal 2 karakter')
      if (!validPassword(body.password)) return fail('Password minimal 8 karakter')

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password: body.password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })
      if (createError || !created.user) {
        const message = createError?.message ?? ''
        if (/already|registered|exists/i.test(message)) {
          return fail('Email ini sudah terdaftar. Gunakan email lain untuk akun staff.', 409)
        }
        return fail(`Akun gagal dibuat: ${message}`, 500)
      }

      const userId = created.user.id
      // Profil biasanya sudah dibuat trigger pendaftaran (sebagai customer) → jadikan staff
      const profile = { full_name: fullName, role: 'staff', cafe_id: cafeId, job_title: jobTitle, is_active: true }
      const { data: updated, error: updateError } = await admin
        .from('profiles').update(profile).eq('id', userId).select('id').maybeSingle()
      let profileError = updateError
      if (!updateError && !updated) {
        const { error: insertError } = await admin.from('profiles').insert({ id: userId, ...profile })
        profileError = insertError
      }
      if (profileError) {
        // Jangan tinggalkan akun setengah jadi
        await admin.auth.admin.deleteUser(userId)
        return fail(`Profil staff gagal disiapkan: ${profileError.message}`, 500)
      }

      await audit('insert', userId, fullName, { email, job_title: jobTitle })
      return json({ ok: true, user_id: userId })
    }

    case 'deactivate':
    case 'reactivate': {
      const { staff, error } = await loadStaff(body.user_id)
      if (error) return error
      const active = body.action === 'reactivate'
      const { error: banError } = await admin.auth.admin.updateUserById(staff.id, {
        ban_duration: active ? 'none' : BAN_FOREVER,
      })
      if (banError) return fail(`Status akun gagal diubah: ${banError.message}`, 500)
      const { error: profileError } = await admin.from('profiles').update({ is_active: active }).eq('id', staff.id)
      if (profileError) return fail(`Status profil gagal diubah: ${profileError.message}`, 500)
      return json({ ok: true })
    }

    case 'reset_password': {
      const { staff, error } = await loadStaff(body.user_id)
      if (error) return error
      if (!validPassword(body.password)) return fail('Password minimal 8 karakter')
      const { error: resetError } = await admin.auth.admin.updateUserById(staff.id, { password: body.password })
      if (resetError) return fail(`Password gagal diubah: ${resetError.message}`, 500)
      await audit('update', staff.id, staff.full_name ?? 'Staff', { password: 'diubah oleh owner' })
      return json({ ok: true })
    }

    default:
      return fail('Aksi tidak dikenal')
  }
})
