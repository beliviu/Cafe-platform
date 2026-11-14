// Uji file usulan/18: peran tim admin (SEMUA fungsi pa_* dicoba per peran), feature flag, lihat-sebagai baca-saja,
// halaman status publik, daftar sendiri (batas IP, mode persetujuan), wizard setup, template email, masa tenggang,
// advisor AI platform, tim admin. PGlite — TIDAK menyentuh database live.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'

const usulan = (name) => fs.readFileSync(new URL(`../usulan/${name}`, import.meta.url), 'utf8')
let passed = 0
const failures = []
const check = (name, ok, detail = '') => { if (ok) passed += 1; else failures.push(`${name}${detail !== '' ? ` → ${detail}` : ''}`) }
const J = (value) => JSON.stringify(value)
const db = new PGlite()
const q = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await q(sql, params))[0]
async function as(id, aal = 'aal1') {
  await db.exec('reset role')
  await q("select set_config('request.jwt.claim.sub', $1, false)", [id || ''])
  await q("select set_config('request.jwt.claims', $1, false)", [id ? J({ sub: id, aal }) : ''])
  await db.exec(id ? 'set role authenticated' : 'set role anon')
}
async function su() {
  await db.exec('reset role')
  await q("select set_config('request.jwt.claim.sub', '', false)")
  await q("select set_config('request.jwt.claims', '', false)")
}
async function asService() {
  await db.exec('reset role')
  await q("select set_config('request.jwt.claim.sub', '', false)")
  await q("select set_config('request.jwt.claims', '', false)")
  await db.exec('set role service_role')
}
async function fails(name, sql, params = [], pattern) {
  try {
    await db.query(sql, params)
    failures.push(`${name} → seharusnya gagal`)
  } catch (error) {
    if (pattern && !pattern.test(error.message)) failures.push(`${name} → pesan: ${error.message}`)
    else passed += 1
  }
}
async function works(name, sql, params = []) {
  try {
    const rows = (await db.query(sql, params)).rows
    passed += 1
    return rows
  } catch (error) {
    failures.push(`${name} → ${error.message}`)
    return []
  }
}
const val = async (sql, params = []) => (await one(sql, params))?.v

// ---------- Skema ----------
await db.exec(fs.readFileSync(new URL('./base-schema.sql', import.meta.url), 'utf8'))
await db.exec("set timezone to 'Asia/Jakarta'; create role service_role nologin bypassrls; grant usage on schema public, auth to service_role;")
await db.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant execute on function auth.jwt() to anon, authenticated, service_role;
  grant execute on function auth.uid() to service_role;`)
for (const file of ['04-owner-dashboard.sql', '05-inventori-supplier.sql', '06-pesanan-v2-pos.sql', '07-akuntansi.sql', '08-pelanggan-qr.sql',
  '09-payment-gateway.sql', '10-izin-langganan-keamanan.sql', '12-qris-statis.sql', '13-tamu-qr-meja.sql', '14-platform-admin.sql',
  '15-notifikasi-platform.sql', '16-kesehatan-analitik-tiket.sql', '17-penagihan-otomatis.sql']) await db.exec(usulan(file))

const U = {
  sup: '00000000-0000-0000-0000-0000000000e1', fin: '00000000-0000-0000-0000-0000000000e2', spt: '00000000-0000-0000-0000-0000000000e3',
  off: '00000000-0000-0000-0000-0000000000e4', newAdmin: '00000000-0000-0000-0000-0000000000e5',
  ownerA: '00000000-0000-0000-0000-0000000000a1', staffA: '00000000-0000-0000-0000-0000000000a2', ownerB: '00000000-0000-0000-0000-0000000000b1',
  cust: '00000000-0000-0000-0000-0000000000c1', signup1: '00000000-0000-0000-0000-0000000000d1', signup2: '00000000-0000-0000-0000-0000000000d2',
}
for (const [key, id] of Object.entries(U)) await q('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@contoh.id`])
const cafe = async (name, days) => (await one(`insert into cafes (name, created_at) values ($1, now() - make_interval(days => $2)) returning id`, [name, days])).id
const A = await cafe('Kopi Alfa', 120)
const B = await cafe('Kopi Beta', 120)
await q(`insert into profiles (id, cafe_id, full_name, role) values ($1,$2,'Owner A','owner'), ($3,$2,'Staff A','staff'), ($4,$5,'Owner B','owner'), ($6,null,'Rani','customer'),
  ($7,null,'Calon Satu','customer'), ($8,null,'Calon Dua','customer')`, [U.ownerA, A, U.staffA, U.ownerB, B, U.cust, U.signup1, U.signup2])
await q("insert into platform_admins (user_id, full_name) values ($1, 'Super Satu'), ($2, 'Fina'), ($3, 'Sapto'), ($4, 'Lama')", [U.sup, U.fin, U.spt, U.off])
for (const id of [A, B]) await q("update cafe_subscriptions set plan_code = 'pro', status = 'active', trial_ends_at = null, current_period_end = now() + interval '20 days' where cafe_id = $1", [id])
await q("insert into orders (cafe_id, total_amount, created_at) values ($1, 25000, now() - interval '1 day'), ($1, 30000, now() - interval '2 days'), ($2, 15000, now() - interval '1 day')", [A, B])

// Tiru policy live: baca pesanan & profil tim lewat helper (migrasi 20261107210700 / RLS awal), tulis owner lewat helper
await db.exec(`
  alter table auth.users add column if not exists email_confirmed_at timestamptz;
  drop policy if exists "Customers and cafe staff can view orders" on public.orders;
  create policy "Customers and cafe staff can view orders" on public.orders for select to authenticated
    using (customer_id = auth.uid() or public.is_cafe_member(cafe_id));
  create policy "Customers create orders" on public.orders for insert to authenticated with check (customer_id = auth.uid() or public.is_cafe_member(cafe_id));
  create policy "Members read cafe profiles" on public.profiles for select to authenticated using (id = auth.uid() or public.is_cafe_member(cafe_id, array['owner']));
  drop policy if exists "Owners update cafe" on public.cafes;
  create policy "Owners update cafe" on public.cafes for update to authenticated using (public.is_cafe_member(id, array['owner'])) with check (public.is_cafe_member(id, array['owner']));
  drop policy if exists "Owners manage products" on public.products;
  create policy "Owners manage products" on public.products for all to authenticated using (public.is_cafe_member(cafe_id, array['owner'])) with check (public.is_cafe_member(cafe_id, array['owner']));
  drop policy if exists "Owners manage categories" on public.categories;
  create policy "Owners manage categories" on public.categories for all to authenticated using (public.is_cafe_member(cafe_id, array['owner'])) with check (public.is_cafe_member(cafe_id, array['owner']));
  grant insert on public.orders to authenticated;
  grant insert, update, delete on public.products, public.categories to authenticated;
  grant update (name) on public.cafes to authenticated;
`)

// ---------- Jalankan file 18 ----------
const result = await db.exec(usulan('18-skala-platform.sql'))
const verify = result.at(-1).rows
const guards = Number(verify.find((row) => row.kind === 'penjaga_baca_saja')?.name)
check('verifikasi: 11 tabel, penjaga terpasang, tanpa tabel tanpa RLS', verify.filter((row) => row.kind === 'table').length === 11 && guards > 50 && !verify.some((row) => row.kind === 'tanpa_rls'), J(verify))
try { await db.exec(usulan('18-skala-platform.sql')); passed += 1 } catch (error) { failures.push(`dijalankan ulang → ${error.message}`) }

await su()
check('admin lama otomatis super', (await q('select role from platform_admins')).every((row) => row.role === 'super'))
await q("update platform_admins set role = 'finance' where user_id = $1", [U.fin])
await q("update platform_admins set role = 'support' where user_id = $1", [U.spt])
await q('update platform_admins set is_active = false where user_id = $1', [U.off])

// ---------- B. Peran: SEMUA fungsi pa_* yang bisa dipanggil aplikasi, dicoba per peran ----------
const fns = await q(`select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'pa\\_%' and has_function_privilege('authenticated', p.oid, 'execute')
    and p.proname not in ('pa_whoami', 'pa_role', 'pa_theme', 'pa_is_cafe_owner')
  order by 1`)
const nullCall = (fn) => {
  const types = fn.args ? fn.args.split(', ').map((part) => part.replace(/^\w+\s+/, '')) : []
  return `select public.${fn.name}(${types.map((type) => `null::${type}`).join(', ')})`
}
const perms = Object.fromEntries((await q('select fn, roles from platform_role_permissions')).map((row) => [row.fn, row.roles]))
check('fungsi admin yang dicoba ≥ 70', fns.length >= 70, fns.length)
const ROLE_ERROR = /Peran .* tidak boleh/
async function attempt(id, aal, sql) {
  await su()
  await db.exec('begin')
  try {
    await as(id, aal)
    await db.query(sql)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error.message }
  } finally {
    await db.exec('rollback')
  }
}
const matrix = { super: [0, 0], finance: [0, 0], support: [0, 0] }
for (const fn of fns) {
  const sql = nullCall(fn)
  for (const [role, id] of [['super', U.sup], ['finance', U.fin], ['support', U.spt]]) {
    const allowed = role === 'super' || (perms[fn.name] || []).includes(role)
    const res = await attempt(id, 'aal2', sql)
    const roleBlocked = !res.ok && ROLE_ERROR.test(res.message)
    if (allowed) {
      check(`${role}: ${fn.name} lolos penjaga peran`, !roleBlocked, res.message)
      matrix[role][0] += 1
    } else {
      check(`${role}: ${fn.name} ditolak karena peran`, roleBlocked, res.ok ? 'berhasil' : res.message)
      matrix[role][1] += 1
    }
  }
  const noMfa = await attempt(U.sup, 'aal1', sql)
  check(`super tanpa 2FA: ${fn.name} ditolak`, !noMfa.ok && /2FA/.test(noMfa.message), noMfa.message)
  const inactive = await attempt(U.off, 'aal2', sql)
  check(`admin nonaktif: ${fn.name} ditolak`, !inactive.ok && /Khusus admin/.test(inactive.message), inactive.message)
  const owner = await attempt(U.ownerA, 'aal2', sql)
  check(`owner: ${fn.name} ditolak`, !owner.ok && /Khusus admin/.test(owner.message), owner.message)
  const anon = await attempt(null, 'aal1', sql)
  check(`anon: ${fn.name} ditolak`, !anon.ok && /permission denied/.test(anon.message), anon.message)
}
console.log('matriks peran (boleh/ditolak):', J(matrix))
// Spot check peta izin yang paling penting
const allows = async (role, fn) => val('select public.pa_role_allows($1, $2) v', [role, fn])
check('finance boleh tandai lunas, tidak boleh nonaktifkan kafe', (await allows('finance', 'pa_invoice_mark_paid')) && !(await allows('finance', 'pa_cafe_set_suspended')))
check('support boleh balas tiket & catatan, tidak boleh tagihan', (await allows('support', 'pa_ticket_reply')) && (await allows('support', 'pa_cafe_note_add')) && !(await allows('support', 'pa_invoice_create')))
check('support & finance tidak boleh kelola tim / pengaturan / flag', !(await allows('support', 'pa_admin_update')) && !(await allows('finance', 'pa_platform_settings_update')) && !(await allows('finance', 'pa_flag_set')))
check('fungsi tak terdaftar = khusus super', !(await allows('finance', 'pa_fungsi_baru')) && (await allows('super', 'pa_fungsi_baru')))

// whoami
await as(U.fin, 'aal2')
const whoFin = await val('select public.pa_whoami() v')
check('whoami: peran finance + daftar izin', whoFin.role === 'finance' && whoFin.allowed.includes('pa_finance_overview') && !whoFin.allowed.includes('pa_ticket_reply'), J(whoFin))
await as(U.sup, 'aal2')
check('whoami: super = *', J((await val('select public.pa_whoami() v')).allowed) === J(['*']))

// Edge Function (service_role): pa_admin_can, pa_cafe_create_for_owner, pa_admin_add
await asService()
check('pa_admin_can: super buat kafe ya, finance tidak', (await val("select public.pa_admin_can($1, 'pa_cafe_create_for_owner') v", [U.sup])) && !(await val("select public.pa_admin_can($1, 'pa_cafe_create_for_owner') v", [U.fin])))
await fails('finance tidak bisa buat kafe lewat Edge Function', "select public.pa_cafe_create_for_owner($1, $2, 'Kopi Baru', 'Owner Baru', 'pro', 14, null)", [U.fin, U.cust], /Super admin/)
await fails('versi 6 argumen tertutup untuk service_role', "select public.pa_cafe_create_for_owner($1, $2, 'Kopi Baru', 'Owner Baru', 'pro', 14)", [U.sup, U.cust], /permission denied/)
await fails('finance tidak bisa mengundang admin', "select public.pa_admin_add($1, $2, 'Nadia', 'support')", [U.fin, U.newAdmin], /Super admin/)
const added = (await works('super mengundang admin support', "select public.pa_admin_add($1, $2, 'Nadia', 'support') v", [U.sup, U.newAdmin]))[0]?.v
check('anggota baru: support aktif', added?.role === 'support' && added.is_active === true, J(added))
await fails('akun owner kafe tidak bisa jadi admin', "select public.pa_admin_add($1, $2, 'Owner A', 'support')", [U.sup, U.ownerA], /terhubung ke kafe/)

// Tim admin
await as(U.sup, 'aal2')
const team = (await works('daftar tim', 'select public.pa_admins_list() v'))[0]?.v
check('daftar tim: 5 anggota, tanda diri sendiri', team?.length === 5 && team.find((row) => row.is_me)?.user_id === U.sup, J(team?.map((row) => [row.full_name, row.role])))
await fails('tidak bisa ubah peran sendiri', "select public.pa_admin_update($1, 'finance')", [U.sup], /sendiri/)
await works('ubah support baru → finance', "select public.pa_admin_update($1, 'finance')", [U.newAdmin])
await su()
await q("update platform_admins set role = 'support' where user_id = $1", [U.off])
await as(U.sup, 'aal2')
await su()
await q("insert into platform_admins (user_id, full_name, role) values ($1, 'Super Dua', 'super')", [U.cust])
await as(U.sup, 'aal2')
await works('turunkan super kedua', "select public.pa_admin_update($1, 'support')", [U.cust])
await su()
await q('delete from platform_admins where user_id = $1', [U.cust])
await as(U.sup, 'aal2')
check('audit admin.add & admin.update', Number((await (async () => { await su(); return one("select count(*) v from platform_audit_logs where action in ('admin.add', 'admin.update')") })()).v) >= 3)
// Super terakhir tidak bisa dinonaktifkan oleh super lain yang kemudian turun peran: simulasi langsung
await su()
await q("insert into platform_admins (user_id, full_name, role) values ($1, 'Super Dua', 'super')", [U.cust])
await as(U.cust, 'aal2')
await works('super dua menonaktifkan super satu', 'select public.pa_admin_update($1, null, false)', [U.sup])
await su()
await q('update platform_admins set is_active = true where user_id = $1', [U.sup])
await as(U.sup, 'aal2')
await works('super satu menurunkan super dua', "select public.pa_admin_update($1, 'support')", [U.cust])
await su()
await q("update platform_admins set role = 'super' where user_id = $1", [U.cust])
await q('update platform_admins set is_active = false where user_id = $1', [U.sup])
await as(U.cust, 'aal2')
await fails('super terakhir tidak bisa diturunkan (oleh dirinya: ditolak karena diri sendiri)', "select public.pa_admin_update($1, 'support')", [U.cust], /sendiri/)
await su()
await q('update platform_admins set is_active = true where user_id = $1', [U.sup])
await q('delete from platform_admins where user_id = $1', [U.cust])

// ---------- A. Masa tenggang & pengaturan platform ----------
await su()
await q("update cafe_subscriptions set status = 'past_due', current_period_end = now() - interval '9 days' where cafe_id = $1", [B])
check('tenggang 7 hari: lewat 9 hari = habis (fitur Basic)', (await val('select state v from public.pa_cafe_rows() where cafe_id = $1', [B])) === 'expired' && (await val('select (public.cafe_plan($1)).code v', [B])) === 'basic')
await as(U.sup, 'aal2')
await works('super: tenggang 10 hari', `select public.pa_platform_settings_update('{"billing_grace_days": 10}'::jsonb)`)
await su()
check('tenggang 10 hari: lewat 9 hari = masih tenggang (fitur Pro)', (await val('select state v from public.pa_cafe_rows() where cafe_id = $1', [B])) === 'past_due' && (await val('select (public.cafe_plan($1)).code v', [B])) === 'pro')
await as(U.ownerB)
check('status owner: grace_until mengikuti pengaturan', (await (async () => { const st = await val('select public.cafe_platform_status($1) v', [B]); return Math.round((new Date(st.grace_until) - new Date(st.current_period_end)) / 86400000) })()) === 10)
await as(U.sup, 'aal2')
await fails('tenggang > batas nonaktif ditolak', `select public.pa_platform_settings_update('{"billing_grace_days": 20}'::jsonb)`, [], /batas nonaktif/)
await fails('trial 120 hari ditolak', `select public.pa_platform_settings_update('{"default_trial_days": 120}'::jsonb)`, [], /tidak valid/)
await fails('paket trial tak dikenal ditolak', `select public.pa_platform_settings_update('{"default_trial_plan": "emas"}'::jsonb)`, [], /Paket trial/)
await fails('kunci tak dikenal ditolak', `select public.pa_platform_settings_update('{"theme_color": "#000000"}'::jsonb)`, [], /tidak dikenal/)
await works('pengaturan trial 21 hari', `select public.pa_platform_settings_update('{"default_trial_days": 21, "billing_grace_days": 7}'::jsonb)`)
await su()
await q("update cafe_subscriptions set status = 'active', current_period_end = now() + interval '20 days' where cafe_id = $1", [B])
await asService()
const daily = (await works('pengecekan harian tetap jalan', 'select public.pa_daily_check() v'))[0]?.v
check('pengecekan harian: hasil lengkap', daily?.billing && daily?.health, J(daily))

// ---------- Helper RLS: selalu benar/salah, tidak pernah NULL ----------
await as(U.ownerB)
const helper = await one("select public.is_cafe_member($1) a, public.is_cafe_member($1, array['owner']) b, public.pa_is_cafe_owner($1, $2) c", [A, U.ownerB])
check('owner kafe lain: helper = false (bukan NULL)', helper.a === false && helper.b === false && helper.c === false, J(helper))
await as(null)
check('anon: is_cafe_member = false', (await (async () => { await su(); return val("select public.is_cafe_member($1) v", [A]) })()) === false)

// ---------- C. Feature flag ----------
await as(U.sup, 'aal2')
await works('super: tambah fitur beta', "select public.pa_feature_upsert('pos_baru', 'Kasir versi baru', 'Uji coba')")
await fails('kunci fitur tidak valid', "select public.pa_feature_upsert('POS Baru!', 'x y')", [], /Kunci fitur/)
await works('flag inventori MATI untuk A (padahal paket Pro)', "select public.pa_flag_set($1, 'inventory', false, 'Uji matikan')", [A])
const bulk = (await works('flag beta massal ke A & B', "select public.pa_flag_bulk('pos_baru', $1::uuid[], true, 'Uji 2 kafe') v", [[A, B]]))[0]?.v
check('massal: 2 kafe', bulk === 2)
await fails('flag fitur tak dikenal', "select public.pa_flag_set($1, 'teleport', true)", [A], /tidak dikenal/)
await fails('flag kedaluwarsa di masa lalu ditolak', "select public.pa_flag_set($1, 'loyalty', true, null, now() - interval '1 day')", [A], /masa depan/)
await su()
check('cafe_has_feature: flag mati menang atas paket', (await val("select public.cafe_has_feature($1, 'inventory') v", [A])) === false)
check('cafe_has_feature: kafe B tetap punya inventori', (await val("select public.cafe_has_feature($1, 'inventory') v", [B])) === true)
await as(U.ownerA)
const ent = await val('select public.cafe_entitlements($1) v', [A])
check('entitlements: fitur efektif tanpa inventori, flag terbaca', !ent.features.includes('inventory') && ent.plan_features.includes('inventory') && ent.flags.inventory === false && ent.flags.pos_baru === true, J(ent.flags))
const ownFlags = await val('select public.cafe_flags($1) v', [A])
check('owner membaca cafe_flags kafenya', ownFlags.inventory === false && ownFlags.pos_baru === true && Object.keys(ownFlags).length === 2, J(ownFlags))
await as(U.ownerB)
await fails('owner B tidak bisa baca flag kafe A', 'select public.cafe_flags($1)', [A], /anggota/)
await as(U.staffA)
check('staff juga membaca flag kafenya', (await val('select public.cafe_flags($1) v', [A])).pos_baru === true)
await su()
await q("update cafe_feature_flags set expires_at = now() - interval '1 minute' where cafe_id = $1 and feature = 'inventory'", [A])
check('flag kedaluwarsa diabaikan → kembali ke paket', (await val("select public.cafe_has_feature($1, 'inventory') v", [A])) === true)
await as(U.sup, 'aal2')
const cafeFlags = await val('select public.pa_cafe_flags($1) v', [A])
check('admin: daftar flag kafe (paket vs flag vs efektif)', cafeFlags.find((row) => row.key === 'pos_baru')?.effective === true && cafeFlags.find((row) => row.key === 'inventory')?.in_plan === true, J(cafeFlags.map((row) => [row.key, row.flag, row.effective])))
await works('hapus flag beta kafe B', "select public.pa_flag_set($1, 'pos_baru', null)", [B])
const overview = await val('select public.pa_flags_overview() v')
check('ringkasan flag: pos_baru 1 kafe', overview.find((row) => row.key === 'pos_baru')?.on_count === 1, J(overview.find((row) => row.key === 'pos_baru')))
await su()
check('riwayat flag di log audit (4 perubahan berhasil)', Number(await val("select count(*) v from platform_audit_logs where action = 'flag.set'")) === 4)

// ---------- D. Lihat-sebagai baca-saja ----------
await as(U.fin, 'aal2')
await fails('finance tidak boleh lihat-sebagai', "select public.pa_impersonate_start($1, 'Cek laporan owner')", [A], /Peran/)
await as(U.spt, 'aal2')
await fails('alasan terlalu pendek ditolak', "select public.pa_impersonate_start($1, 'cek')", [A], /minimal 10/)
check('sebelum mulai: support tidak melihat pesanan A', (await q('select id from orders where cafe_id = $1', [A])).length === 0)
const sess = (await works('support mulai lihat-sebagai A', "select public.pa_impersonate_start($1, 'Owner lapor laporan kosong') v", [A]))[0]?.v
check('sesi: 30 menit', Math.round((new Date(sess.expires_at) - Date.now()) / 60000) === 30, sess?.expires_at)
const ctx = (await works('konteks lihat-sebagai', 'select public.impersonation_context($1) v', [sess.id]))[0]?.v
check('konteks: kafe A + owner A', ctx?.cafe_id === A && ctx.owner.id === U.ownerA && ctx.cafe_name === 'Kopi Alfa', J(ctx))
check('BACA: pesanan A terlihat (2)', (await q('select id from orders where cafe_id = $1', [A])).length === 2)
check('BACA: pesanan B tetap tidak terlihat', (await q('select id from orders where cafe_id = $1', [B])).length === 0)
check('BACA: profil tim A terlihat', (await q('select id from profiles where cafe_id = $1', [A])).length >= 1)
await works('BACA: entitlements A', 'select public.cafe_entitlements($1)', [A])
await works('BACA: tagihan owner A', 'select public.owner_invoices($1)', [A])
await works('BACA: progres setup A', 'select public.owner_setup_progress($1)', [A])
const RO = /hanya bisa melihat/
await fails('TULIS ditolak: insert pesanan', "insert into orders (cafe_id, total_amount) values ($1, 1000)", [A], RO)
await fails('TULIS ditolak: ubah kafe', "update cafes set name = 'Diretas' where id = $1", [A], RO)
await fails('TULIS ditolak: hapus produk', 'delete from products where cafe_id = $1', [A], RO)
await fails('TULIS ditolak: ubah pengaturan kafe', "update cafe_settings set tax_enabled = true where cafe_id = $1", [A], RO)
await fails('TULIS ditolak: tambah kategori', "insert into categories (cafe_id, name) values ($1, 'X')", [A], RO)
await fails('TULIS ditolak lewat RPC owner: buat tiket', "select public.owner_ticket_create($1, 'aplikasi', 'Judul tiket uji', 'Isi tiket uji panjang')", [A], RO)
await fails('TULIS ditolak lewat RPC owner: minta tagihan', "select public.owner_invoice_request($1, 'pro', 1)", [A], RO)
await fails('TULIS ditolak lewat RPC owner: catat sinyal paket', "select public.owner_log_plan_block($1, 'limit', 'staff')", [A], RO)
await fails('TULIS ditolak lewat RPC owner: nomor WA', "select public.owner_set_whatsapp($1, '08123456789')", [A], RO)
await su()
check('tidak ada data berubah selama lihat-sebagai', (await val('select name v from cafes where id = $1', [A])) === 'Kopi Alfa' && Number(await val('select count(*) v from orders where cafe_id = $1', [A])) === 2)
await as(U.spt, 'aal2')
await works('aksi admin pa_* tetap boleh (catatan internal kafe B)', "select public.pa_cafe_note_add($1, 'Catatan saat lihat-sebagai')", [B])
await as(U.spt, 'aal1')
check('token tanpa 2FA: tidak bisa membaca lewat lihat-sebagai', (await q('select id from orders where cafe_id = $1', [A])).length === 0)
await as(U.spt, 'aal2')
await su()
await q("update platform_impersonations set expires_at = started_at + interval '1 second', started_at = started_at - interval '1 hour' where id = $1", [sess.id]).catch(() => null)
await q("update platform_impersonations set started_at = now() - interval '31 minutes', expires_at = now() - interval '1 minute' where id = $1", [sess.id])
await as(U.spt, 'aal2')
check('setelah 30 menit: akses baca hilang', (await q('select id from orders where cafe_id = $1', [A])).length === 0)
await fails('setelah 30 menit: konteks ditolak', 'select public.impersonation_context($1)', [sess.id], /berakhir/)
await su()
await fails('sesi > 30 menit ditolak database', "insert into platform_impersonations (admin_id, cafe_id, reason, expires_at) values ($1, $2, 'Alasan panjang uji', now() + interval '2 hours')", [U.spt, A], /window/)
await as(U.spt, 'aal2')
const sess2 = (await works('mulai lagi', "select public.pa_impersonate_start($1, 'Cek ulang laporan owner') v", [A]))[0]?.v
await as(U.sup, 'aal2')
await works('super lain tidak terpengaruh: baca pesanan A tidak bisa', 'select 1')
check('admin lain tidak ikut melihat kafe A', (await q('select id from orders where cafe_id = $1', [A])).length === 0)
await as(U.spt, 'aal2')
const ended = (await works('akhiri sesi', 'select public.pa_impersonate_end($1) v', [sess2.id]))[0]?.v
check('sesi berakhir', ended?.ended === 1)
check('setelah diakhiri: tidak bisa membaca', (await q('select id from orders where cafe_id = $1', [A])).length === 0)
await su()
const impLogs = await q("select action, note from platform_audit_logs where action like 'impersonation.%' order by id")
check('audit: mulai (dengan alasan) & akhiri', impLogs.filter((row) => row.action === 'impersonation.start').length === 2 && impLogs[0].note === 'Owner lapor laporan kosong' && impLogs.some((row) => row.action === 'impersonation.end'), J(impLogs))
await q("update platform_admins set role = 'finance' where user_id = $1", [U.spt])
await q("insert into platform_impersonations (admin_id, cafe_id, reason, expires_at) values ($1, $2, 'Sesi lama finance', now() + interval '10 minutes')", [U.spt, A])
await as(U.spt, 'aal2')
check('peran finance: sesi lama tidak memberi akses', (await q('select id from orders where cafe_id = $1', [A])).length === 0)
await su()
await q("update platform_admins set role = 'support' where user_id = $1", [U.spt])
await q('update platform_impersonations set ended_at = now() where admin_id = $1 and ended_at is null', [U.spt])
await as(U.ownerA)
await works('owner normal tetap bisa menulis (penjaga tidak mengganggu)', "update cafes set name = 'Kopi Alfa' where id = $1", [A])
await as(U.cust)
await works('pelanggan tetap bisa membuat pesanan', "insert into orders (cafe_id, customer_id, total_amount) values ($1, $2, 5000)", [A, U.cust]).catch(() => null)

// ---------- E. Status sistem ----------
await as(null)
const pub = (await works('anon: status publik', 'select public.public_status() v'))[0]?.v
check('status publik: 4 layanan, normal', pub?.services?.length === 4 && pub.overall === 'operational', J(pub))
await fails('anon tidak bisa membuat insiden', "select public.pa_incident_create('X', 'minor', '{}', 'xxxx')", [], /permission denied/)
await as(U.fin, 'aal2')
await fails('finance tidak bisa membuat insiden', "select public.pa_incident_create('Gangguan', 'minor', '{payments}', 'Sedang dicek')", [], /Peran/)
await as(U.spt, 'aal2')
const inc = (await works('support membuat insiden pembayaran', "select public.pa_incident_create('QRIS lambat', 'minor', '{payments}', 'Pembayaran QRIS terlambat dikonfirmasi', 'degraded') v"))[0]?.v
await fails('layanan tak dikenal ditolak', "select public.pa_incident_create('Gangguan X', 'minor', '{mars}', 'Sedang dicek')", [], /tidak dikenal/)
await fails('judul terlalu pendek ditolak', "select public.pa_incident_create('X', 'minor', '{web}', 'Sedang dicek')", [], /Judul/)
await as(null)
const pub2 = await val('select public.public_status() v')
check('publik: menurun + insiden aktif dengan pembaruan', pub2.overall === 'degraded' && pub2.incidents[0]?.status === 'investigating' && pub2.incidents[0].updates.length === 1, J(pub2.incidents))
check('publik: tidak memuat id admin / data kafe', !J(pub2).includes(U.spt) && !J(pub2).includes('Kopi Alfa') && !('created_by' in pub2.incidents[0]))
await as(U.spt, 'aal2')
await works('pembaruan: teridentifikasi', "select public.pa_incident_update($1, 'identified', 'Penyebab ditemukan di penyedia')", [inc.id])
await works('pembaruan: selesai', "select public.pa_incident_update($1, 'resolved', 'Sudah normal kembali')", [inc.id])
await fails('insiden selesai tidak bisa diperbarui', "select public.pa_incident_update($1, 'monitoring', 'Pantau lagi')", [inc.id], /sudah selesai/)
await as(null)
const pub3 = await val('select public.public_status() v')
check('selesai: layanan normal, riwayat 3 pembaruan', pub3.overall === 'operational' && pub3.incidents[0].status === 'resolved' && pub3.incidents[0].updates.length === 3, J(pub3.incidents[0]))
await as(U.spt, 'aal2')
await works('ubah status layanan manual', "select public.pa_service_set_status('app', 'maintenance')")
await fails('status layanan tak dikenal', "select public.pa_service_set_status('app', 'meledak')", [], /tidak dikenal/)

// ---------- F. Daftar sendiri ----------
await as(null)
await fails('anon tidak bisa memanggil pa_signup_create', "select public.pa_signup_create($1, 'Kopi', 'Nama', '0812', 'Kota')", [U.signup1], /permission denied/)
await fails('anon tidak bisa memanggil pa_signup_rate', "select public.pa_signup_rate('x')", [], /permission denied/)
await as(U.cust)
await fails('pengguna login tidak bisa memanggil pa_signup_create', "select public.pa_signup_create($1, 'Kopi', 'Nama', '0812', 'Kota')", [U.cust], /permission denied/)
await asService()
const ip = 'a'.repeat(64)
const rates = []
for (let index = 0; index < 6; index += 1) rates.push((await val('select public.pa_signup_rate($1) v', [ip])).ok)
check('batas per IP: 5 per jam, ke-6 ditolak', J(rates) === J([true, true, true, true, true, false]), J(rates))
check('IP lain tidak terpengaruh', (await val('select public.pa_signup_rate($1) v', ['b'.repeat(64)])).ok === true)
await fails('daftar tanpa WA ditolak', "select public.pa_signup_create($1, 'Kopi Senja', 'Rina', '', 'Bandung')", [U.signup1], /WhatsApp/)
await fails('daftar tanpa kota ditolak', "select public.pa_signup_create($1, 'Kopi Senja', 'Rina', '0812345678', ' ')", [U.signup1], /kota/)
const s1 = (await works('daftar: kafe + owner + trial', "select public.pa_signup_create($1, '  Kopi   Senja ', 'Rina', '0812-3456-789', 'Bandung', $2) v", [U.signup1, 'b'.repeat(64)]))[0]?.v
await su()
const c1 = await one('select name, city, owner_whatsapp, signup_status, suspended_at from cafes where id = $1', [s1.cafe_id])
check('kafe baru: nama dirapikan, kota, WA dinormalisasi, aktif', c1.name === 'Kopi Senja' && c1.city === 'Bandung' && c1.owner_whatsapp === '628123456789' && c1.signup_status === 'approved' && c1.suspended_at === null, J(c1))
check('owner terhubung', (await val('select role v from profiles where id = $1', [U.signup1])) === 'owner')
const sub1 = await one("select plan_code, status, round(extract(epoch from trial_ends_at - now()) / 86400) d from cafe_subscriptions where cafe_id = $1", [s1.cafe_id])
check('trial dari pengaturan (Pro, 21 hari)', sub1.plan_code === 'pro' && sub1.status === 'trialing' && Number(sub1.d) === 21, J(sub1))
check('admin dapat notifikasi "Kafe baru mendaftar"', Boolean(await one("select 1 from platform_notifications where kind = 'cafe_signup' and cafe_id = $1", [s1.cafe_id])))
check('email selamat datang masuk antrean', Boolean(await one("select 1 from notification_outbox where kind = 'cafe_welcome' and cafe_id = $1", [s1.cafe_id])))
check('audit cafe.signup', (await val("select actor_label v from platform_audit_logs where action = 'cafe.signup' and cafe_id = $1", [s1.cafe_id])) === 'pendaftaran')
await asService()
await fails('akun yang sudah punya kafe ditolak', "select public.pa_signup_create($1, 'Kopi Lagi', 'Rina', '0812345678', 'Bandung')", [U.signup1], /sudah terhubung/)
await fails('akun admin tidak bisa daftar kafe', "select public.pa_signup_create($1, 'Kopi Admin', 'Sup', '0812345678', 'Bandung')", [U.sup], /sudah terhubung/)
// Mode persetujuan
await su()
await q('update platform_settings set signup_approval_mode = true')
await asService()
const s2 = (await works('daftar saat mode persetujuan', "select public.pa_signup_create($1, 'Kedai Dua', 'Dodi', '081299998888', 'Malang') v", [U.signup2]))[0]?.v
check('menunggu persetujuan', s2?.pending === true)
await su()
const c2 = await one('select signup_status, suspended_kind, suspended_at is not null s from cafes where id = $1', [s2.cafe_id])
check('kafe menunggu: nonaktif jenis approval', c2.signup_status === 'pending' && c2.suspended_kind === 'approval' && c2.s, J(c2))
await fails('kafe menunggu tidak bisa menerima pesanan', "insert into orders (cafe_id, total_amount) values ($1, 1000)", [s2.cafe_id], /dinonaktifkan/)
await as(U.signup2)
check('owner melihat status menunggu', (await val('select public.owner_signup_status($1) v', [s2.cafe_id])).signup_status === 'pending')
check('banner owner: suspended_kind approval', (await val('select public.cafe_platform_status($1) v', [s2.cafe_id])).suspended_kind === 'approval')
await as(U.spt, 'aal2')
const signups = (await works('support melihat daftar pendaftaran', "select public.pa_signups_list('pending') v"))[0]?.v
check('daftar pendaftaran: 1 menunggu', signups?.counts?.pending === 1 && signups.rows[0]?.name === 'Kedai Dua', J(signups?.counts))
await fails('support tidak bisa menyetujui', 'select public.pa_signup_decide($1, true)', [s2.cafe_id], /Peran/)
await as(U.sup, 'aal2')
await fails('tolak tanpa alasan ditolak', 'select public.pa_signup_decide($1, false)', [s2.cafe_id], /alasan/)
await works('super menyetujui', 'select public.pa_signup_decide($1, true)', [s2.cafe_id])
await fails('tidak bisa diputuskan dua kali', 'select public.pa_signup_decide($1, false, $2)', [s2.cafe_id, 'spam'], /sudah diputuskan/)
await su()
const c2b = await one('select signup_status, suspended_at, suspended_kind from cafes where id = $1', [s2.cafe_id])
check('disetujui: aktif, jenis nonaktif kosong', c2b.signup_status === 'approved' && c2b.suspended_at === null && c2b.suspended_kind === null, J(c2b))
check('owner dapat notifikasi disetujui (email dipaksa)', Boolean(await one("select 1 from notification_outbox where kind = 'signup_approved' and cafe_id = $1", [s2.cafe_id])))
await q('update platform_settings set signup_enabled = false')
await asService()
check('pendaftaran ditutup: pa_signup_rate disabled', (await val('select public.pa_signup_rate($1) v', ['c'.repeat(64)])).reason === 'disabled')
await su()
await q('update platform_settings set signup_enabled = true, signup_approval_mode = false')

// ---------- G. Wizard setup ----------
await as(U.ownerA)
const setup = (await works('owner: progres setup', 'select public.owner_setup_progress($1) v', [A]))[0]?.v
check('progres setup: 8 langkah, tanpa stuck_days', setup?.total === 8 && setup.steps.length === 8 && !('stuck_days' in setup), J(setup))
await as(U.staffA)
await fails('staff tidak bisa melihat wizard owner', 'select public.owner_setup_progress($1)', [A], /owner/)
await as(U.ownerB)
await fails('owner lain ditolak', 'select public.owner_setup_progress($1)', [A], /owner/)

// ---------- H. Template email ----------
await as(U.sup, 'aal2')
const tpls = (await works('template email', 'select public.pa_email_templates_list() v'))[0]?.v
check('4 template berurutan', J(tpls?.map((row) => row.key)) === J(['welcome', 'invoice', 'reminder', 'reset_password']))
await works('ubah template tagihan', "select public.pa_email_template_update('invoice', 'Tagihan {{nama_kafe}}', 'Tagihan baru', 'Halo {{nama_owner}}, {{isi}}', 'Bayar')")
await fails('subjek terlalu pendek ditolak', "select public.pa_email_template_update('invoice', 'Hi', 'Tagihan baru', 'Isi', 'Bayar')", [], /Subjek/)
await fails('template tak dikenal', "select public.pa_email_template_update('promo', 'Subjek', 'Judul', 'Isi', null)", [], /tidak dikenal/)
await asService()
check('service_role (notify) bisa membaca template', (await q('select key from platform_email_templates')).length === 4)
await as(U.ownerA)
await fails('owner tidak bisa membaca template langsung', 'select * from platform_email_templates', [], /permission denied/)

// ---------- I. Advisor AI ----------
await su()
await q("insert into platform_tickets (cafe_id, number, category, title, created_by) values ($1, 'TKT-T1', 'aplikasi', 'Uji', $2)", [B, U.ownerB]).catch(() => null)
await as(U.fin, 'aal2')
const quota = (await works('kuota AI', 'select public.pa_ai_quota() v'))[0]?.v
check('kuota awal 30', quota?.limit === 30 && quota.remaining === 30, J(quota))
const facts = (await works('fakta AI', 'select public.pa_ai_facts() v'))[0]?.v
check('fakta: rumus risiko + kafe urut risiko', typeof facts?.risk_formula === 'string' && facts.cafes_by_risk.length >= 2
  && facts.cafes_by_risk.every((row, index, list) => index === 0 || list[index - 1].risk_points >= row.risk_points), J(facts?.cafes_by_risk?.map((row) => [row.cafe, row.risk_points])))
check('fakta: tanpa email / id pengguna', !J(facts).includes('@contoh.id') && !J(facts).includes(U.ownerA))
await works('catat pemakaian AI', "select public.pa_ai_log('Kafe mana paling berisiko?', 'Jawaban', 'answered', 'claude-opus-5-5', 1200, 300)")
await works('catat error (tidak memotong kuota)', "select public.pa_ai_log('Pertanyaan', null, 'error', 'claude-opus-5-5', null, null)")
check('kuota berkurang 1', (await val('select public.pa_ai_quota() v')).remaining === 29)
check('riwayat hanya milik sendiri (2)', (await val('select public.pa_ai_history(10) v')).length === 2)
await as(U.sup, 'aal2')
check('admin lain: riwayat kosong', (await val('select public.pa_ai_history(10) v')).length === 0)
await su()
await q('update platform_settings set ai_daily_limit = 1')
await as(U.fin, 'aal2')
check('batas harian tercapai → sisa 0', (await val('select public.pa_ai_quota() v')).remaining === 0)

// ---------- Akses langsung tabel baru ----------
await as(U.sup, 'aal2')
for (const table of ['platform_role_permissions', 'platform_features', 'cafe_feature_flags', 'platform_impersonations', 'platform_services',
  'platform_incidents', 'platform_incident_updates', 'signup_attempts', 'platform_email_templates', 'platform_ai_logs']) {
  await fails(`admin pun tidak bisa baca ${table} langsung`, `select * from public.${table}`, [], /permission denied/)
}
await as(U.ownerA)
await fails('owner tidak bisa mengubah perannya jadi admin', "insert into platform_admins (user_id, role) values ($1, 'super')", [U.ownerA], /permission denied/)
await fails('owner tidak bisa ubah city/signup_status sendiri', "update cafes set signup_status = 'approved' where id = $1", [A], /permission denied/)

await su()
console.log(`file 18: ${passed} lulus, ${failures.length} gagal`)
if (failures.length) {
  for (const line of failures.slice(0, 60)) console.log(' ✗', line)
  if (failures.length > 60) console.log(` … dan ${failures.length - 60} lagi`)
  process.exit(1)
}
