// Uji file usulan/14: dashboard platform (admin SaaS), suspend kafe, masa tenggang, tagihan & penagihan otomatis.
// Postgres lokal (PGlite) — TIDAK menyentuh database live.
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
let restore = async () => {}
const su = async () => { restore = async () => db.exec('reset role'); await db.exec('reset role') }
async function as(id, aal = 'aal1') {
  restore = () => as(id, aal)
  await db.exec('reset role')
  await q("select set_config('request.jwt.claim.sub', $1, false)", [id || ''])
  await q("select set_config('request.jwt.claims', $1, false)", [id ? J({ sub: id, aal }) : ''])
  await db.exec(id ? 'set role authenticated' : 'set role anon')
}
async function asService() {
  restore = asService
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
async function raw(sql, params = []) {
  const back = restore
  await db.exec('reset role')
  const row = await one(sql, params)
  await back()
  return row
}
async function auditCount() {
  const back = restore
  await db.exec('reset role')
  const n = Number((await one('select count(*) n from platform_audit_logs')).n)
  await back()
  return n
}

// ---------- Skema ----------
await db.exec(fs.readFileSync(new URL('./base-schema.sql', import.meta.url), 'utf8'))
await db.exec("set timezone to 'Asia/Jakarta'; create role service_role nologin bypassrls; grant usage on schema public, auth to service_role;")
await db.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant execute on function auth.jwt() to anon, authenticated, service_role;
  grant execute on function auth.uid() to service_role;`)
for (const file of ['04-owner-dashboard.sql', '05-inventori-supplier.sql', '06-pesanan-v2-pos.sql', '07-akuntansi.sql', '08-pelanggan-qr.sql',
  '09-payment-gateway.sql', '10-izin-langganan-keamanan.sql', '12-qris-statis.sql', '13-tamu-qr-meja.sql']) await db.exec(usulan(file))

const U = {
  admin: '00000000-0000-0000-0000-0000000000e1', admin2: '00000000-0000-0000-0000-0000000000e2',
  ownerA: '00000000-0000-0000-0000-0000000000a1', staffA: '00000000-0000-0000-0000-0000000000a2',
  ownerB: '00000000-0000-0000-0000-0000000000b1', cust: '00000000-0000-0000-0000-0000000000c1',
  newOwner: '00000000-0000-0000-0000-0000000000f1', newOwner2: '00000000-0000-0000-0000-0000000000f2',
}
for (const [key, id] of Object.entries(U)) await q('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@contoh.id`])
const cafeA = (await one("insert into cafes (name) values ('Kopi A') returning id")).id
const cafeB = (await one("insert into cafes (name) values ('Kopi B') returning id")).id
await q(`insert into profiles (id, cafe_id, full_name, role) values ($1,$2,'Owner A','owner'),($3,$2,'Staff A','staff'),($4,$5,'Owner B','owner'),($6,null,'Rani','customer')`,
  [U.ownerA, cafeA, U.staffA, U.ownerB, cafeB, U.cust])

const result = await db.exec(usulan('14-platform-admin.sql'))
const verify = result.at(-1).rows
check('verifikasi: 5 tabel + 1 trigger, tanpa tabel tanpa RLS', verify.length === 6 && !verify.some((row) => row.kind === 'tanpa_rls'), J(verify))
await db.exec(usulan('14-platform-admin.sql'))
passed += 1 // aman dijalankan ulang

await su()
// Kafe lama di produksi = Enterprise aktif tanpa batas waktu (file 10)
await q("update cafe_subscriptions set plan_code = 'enterprise', status = 'active', trial_ends_at = null, current_period_end = null where cafe_id in ($1, $2)", [cafeA, cafeB])
await q("insert into platform_admins (user_id, full_name) values ($1, 'Admin Satu'), ($2, 'Admin Dua')", [U.admin, U.admin2])
await q('update platform_admins set is_active = false where user_id = $1', [U.admin2])
const prod = (await one("insert into products (cafe_id, name, price) values ($1, 'Latte', 25000) returning id", [cafeA])).id

// ---------- 1. Hak akses: semua fungsi admin ditolak untuk non-admin ----------
const ADMIN_CALLS = [
  ['pa_overview', 'select pa_overview()', []],
  ['pa_cafes_list', 'select pa_cafes_list()', []],
  ['pa_cafe_detail', 'select pa_cafe_detail($1)', [cafeA]],
  ['pa_invoices_list', 'select pa_invoices_list()', []],
  ['pa_audit_list', 'select pa_audit_list()', []],
  ['pa_plans_list', 'select pa_plans_list()', []],
  ['pa_cafe_set_suspended', "select pa_cafe_set_suspended($1, true, 'x')", [cafeA]],
  ['pa_plan_upsert', "select pa_plan_upsert('hack', 'Hack', null, 1, '{}'::jsonb, '{}'::text[])", []],
  ['pa_subscription_set_plan', "select pa_subscription_set_plan($1, 'enterprise')", [cafeA]],
  ['pa_subscription_extend', 'select pa_subscription_extend($1, 12)', [cafeA]],
  ['pa_subscription_trial', 'select pa_subscription_trial($1, 30)', [cafeA]],
  ['pa_invoice_create', 'select pa_invoice_create($1)', [cafeA]],
  ['pa_invoice_mark_paid', 'select pa_invoice_mark_paid(gen_random_uuid())', []],
  ['pa_invoice_void', 'select pa_invoice_void(gen_random_uuid())', []],
]
const SERVICE_ONLY = [
  ['pa_cafe_create_for_owner', "select pa_cafe_create_for_owner($1, $2, 'X', 'Y', 'pro', 7)", [U.admin, U.newOwner]],
  ['pa_billing_run', 'select pa_billing_run()', []],
  ['pa_gateway_prepare', 'select pa_gateway_prepare(gen_random_uuid(), $1)', [U.ownerA]],
  ['pa_gateway_apply', "select pa_gateway_apply('x', 'settlement', 'accept', 1, '{}'::jsonb)", []],
  ['pa_gateway_save_checkout', "select pa_gateway_save_checkout('x', 'y')", []],
  ['pa_gateway_lookup', 'select pa_gateway_lookup(gen_random_uuid(), $1)', [U.ownerA]],
  ['pa_log', "select pa_log('x', null, 'x', null, null, null)", []],
  ['pa_cafe_rows', 'select * from pa_cafe_rows()', []],
  ['pa_apply_invoice_paid', "select pa_apply_invoice_paid(gen_random_uuid(), 'gateway', null, null, null, null, null)", []],
]
const ROLES = [
  ['anon', null, 'aal1'], ['customer', U.cust, 'aal2'], ['staff', U.staffA, 'aal2'], ['owner', U.ownerA, 'aal2'],
  ['admin tanpa 2FA', U.admin, 'aal1'], ['admin nonaktif', U.admin2, 'aal2'],
]
for (const [label, id, aal] of ROLES) {
  for (const [fn, sql, params] of ADMIN_CALLS) {
    await as(id, aal)
    await fails(`${label} → ${fn} ditolak`, sql, params)
  }
  for (const [fn, sql, params] of SERVICE_ONLY) {
    await as(id, aal)
    await fails(`${label} → ${fn} (khusus server) ditolak`, sql, params)
  }
}
await as(U.admin, 'aal1')
await fails('admin aal1 → pesan 2FA', 'select pa_overview()', [], /2FA/)
await as(U.ownerA, 'aal2')
await fails('owner → pesan khusus admin', 'select pa_overview()', [], /admin platform/)
check('penolakan tidak menulis audit', (await auditCount()) === 0)

// Tabel platform tidak bisa dibaca/diubah langsung
for (const table of ['platform_admins', 'platform_audit_logs', 'subscription_invoices', 'platform_mrr_snapshots']) {
  await as(U.ownerA, 'aal2')
  await fails(`owner select langsung ${table} ditolak`, `select * from ${table}`)
  await as(U.admin, 'aal2')
  await fails(`admin pun tidak select langsung ${table} (hanya lewat fungsi)`, `select * from ${table}`)
}
await as(U.ownerA, 'aal2')
await fails('owner tidak bisa menjadikan dirinya admin', 'insert into platform_admins (user_id) values ($1)', [U.ownerA])
await fails('owner tidak bisa mengubah suspended_at kafenya', 'update cafes set suspended_at = null where id = $1', [cafeA])
await fails('owner tidak bisa mengubah langganannya', "update cafe_subscriptions set plan_code = 'enterprise' where cafe_id = $1", [cafeA])

// pa_whoami / is_platform_admin hanya tentang diri sendiri
await as(U.admin, 'aal1')
let who = (await one('select pa_whoami() w')).w
check('whoami admin aal1', who.is_admin === true && who.aal === 'aal1', J(who))
check('is_platform_admin false sebelum 2FA', (await one('select is_platform_admin() v')).v === false)
await as(U.admin, 'aal2')
check('is_platform_admin true setelah 2FA', (await one('select is_platform_admin() v')).v === true)
await as(U.ownerA, 'aal2')
who = (await one('select pa_whoami() w')).w
check('whoami owner bukan admin', who.is_admin === false, J(who))

// ---------- 2. Buat kafe + owner (service_role, seperti Edge Function) ----------
await asService()
await fails('create: aktor bukan admin ditolak', "select pa_cafe_create_for_owner($1, $2, 'Kopi Baru', 'Budi', 'pro', 14)", [U.ownerA, U.newOwner], /admin platform/)
await fails('create: aktor admin nonaktif ditolak', "select pa_cafe_create_for_owner($1, $2, 'Kopi Baru', 'Budi', 'pro', 14)", [U.admin2, U.newOwner], /admin platform/)
await fails('create: owner yang sudah punya kafe ditolak', "select pa_cafe_create_for_owner($1, $2, 'Kopi Baru', 'Budi', 'pro', 14)", [U.admin, U.ownerB], /kafe lain/)
await fails('create: paket tak dikenal ditolak', "select pa_cafe_create_for_owner($1, $2, 'Kopi Baru', 'Budi', 'gold', 14)", [U.admin, U.newOwner], /Paket/)
let before = await auditCount()
const created = (await one("select pa_cafe_create_for_owner($1, $2, 'Kopi Baru', 'Budi', 'pro', 14) r", [U.admin, U.newOwner])).r
const cafeN = created.cafe_id
await su()
const newProfile = await one('select role::text, cafe_id, full_name from profiles where id = $1', [U.newOwner])
check('create: profil owner terhubung kafe baru', newProfile?.role === 'owner' && newProfile.cafe_id === cafeN && newProfile.full_name === 'Budi', J(newProfile))
const newSub = await one('select plan_code, status, trial_ends_at > now() + interval \'13 days\' ok from cafe_subscriptions where cafe_id = $1', [cafeN])
check('create: langganan pro trial 14 hari', newSub?.plan_code === 'pro' && newSub.status === 'trialing' && newSub.ok, J(newSub))
check('create: 1 baris audit', (await auditCount()) === before + 1)
const createLog = await one("select actor_id, action, cafe_id from platform_audit_logs where action = 'cafe.create'")
check('create: audit mencatat aktor & kafe', createLog?.actor_id === U.admin && createLog.cafe_id === cafeN, J(createLog))
// Profil customer yang sudah ada (mis. dibuat trigger daftar) diubah jadi owner
await q("insert into profiles (id, cafe_id, full_name, role) values ($1, null, 'Tmp', 'customer')", [U.newOwner2])
await asService()
await works('create: profil customer lama → owner', "select pa_cafe_create_for_owner($1, $2, 'Kopi Dua', 'Sari', 'basic', 0)", [U.admin, U.newOwner2])
await su()
check('create: role customer berubah owner', (await one('select role::text r from profiles where id = $1', [U.newOwner2])).r === 'owner')

// ---------- 3. Baca dashboard ----------
await as(U.admin, 'aal2')
const overview = (await one('select pa_overview() o')).o
check('overview: total 4 kafe', Number(overview.total) === 4, J(overview))
check('overview: kafe lama (enterprise) aktif, kafe baru trial', Number(overview.active) === 2 && Number(overview.trial) === 1, J(overview))
check('overview: kafe trial 0 hari = habis (nonaktif)', Number(overview.expired) === 1, J(overview))
const list = (await one("select pa_cafes_list('baru') l")).l
check('list: cari nama', list.total === 1 && list.rows[0].name === 'Kopi Baru', J(list))
const listMail = (await one("select pa_cafes_list('newowner@') l")).l
check('list: cari email owner', listMail.total === 1, J(listMail))
const listTrial = (await one("select pa_cafes_list(null, 'trial', 'pro') l")).l
check('list: filter status & paket', listTrial.total === 1 && listTrial.rows[0].cafe_id === cafeN, J(listTrial))
check('list: like aman dari wildcard', (await one("select pa_cafes_list('%') l")).l.total === 0)
const detail = (await one('select pa_cafe_detail($1) d', [cafeA])).d
check('detail: pemakaian staff & produk', detail.usage.staff === 1 && detail.usage.products === 1, J(detail.usage))
check('detail: anggota kafe', detail.members.length === 2 && detail.members.some((m) => m.email === 'ownerA@contoh.id'), J(detail.members))
check('baca tidak menulis audit', (await auditCount()) === before + 2)

// ---------- 4. Suspend ----------
before = await auditCount()
await fails('suspend tanpa alasan ditolak', 'select pa_cafe_set_suspended($1, true, null)', [cafeA], /alasan/)
await works('suspend kafe A', "select pa_cafe_set_suspended($1, true, 'Belum bayar')", [cafeA])
check('suspend: 1 baris audit dengan before/after', (await auditCount()) === before + 1)
const suspendLog = await raw("select before, after, note from platform_audit_logs where action = 'cafe.suspend'")
check('suspend: before kosong, after terisi', suspendLog.before.suspended_at === null && suspendLog.after.suspended_reason === 'Belum bayar' && suspendLog.note === 'Belum bayar', J(suspendLog))
await fails('suspend dua kali ditolak', "select pa_cafe_set_suspended($1, true, 'lagi')", [cafeA], /sudah nonaktif/)
await su()
await fails('kafe nonaktif: insert pesanan ditolak', "insert into orders (cafe_id, total_amount) values ($1, 1000)", [cafeA], /dinonaktifkan/)
await as(U.ownerA, 'aal2')
const status = (await one('select cafe_platform_status($1) s', [cafeA])).s
check('owner melihat status nonaktif + alasan', status.suspended === true && status.suspended_reason === 'Belum bayar', J(status))
await as(U.ownerB, 'aal2')
await fails('owner B tidak bisa melihat status kafe A', 'select cafe_platform_status($1)', [cafeA])
await su()
check('kafe nonaktif: fitur turun ke basic', (await one('select (cafe_plan($1)).code c', [cafeA])).c === 'basic')
check('kafe nonaktif: data tetap ada', Number((await one('select count(*) n from products where cafe_id = $1', [cafeA])).n) === 1)
await as(U.admin, 'aal2')
await works('aktifkan kembali kafe A', 'select pa_cafe_set_suspended($1, false)', [cafeA])
await su()
await works('kafe aktif lagi: pesanan masuk', "insert into orders (cafe_id, total_amount) values ($1, 1000)", [cafeA])
check('kafe aktif lagi: paket kembali', (await one('select (cafe_plan($1)).code c', [cafeA])).c === 'enterprise')

// ---------- 5. Audit di-rollback bila gagal ----------
await as(U.admin, 'aal2')
before = await auditCount()
await db.exec('begin')
try {
  await q("select pa_cafe_set_suspended($1, true, 'uji rollback')", [cafeB])
  await q('select 1/0')
} catch { /* sengaja gagal */ }
await db.exec('rollback')
await su()
check('rollback: audit ikut batal', (await auditCount()) === before)
check('rollback: kafe tetap aktif', (await one('select suspended_at from cafes where id = $1', [cafeB])).suspended_at === null)

// ---------- 6. Paket ----------
await as(U.admin, 'aal2')
before = await auditCount()
await fails('paket: modul tak dikenal ditolak', "select pa_plan_upsert('growth', 'Growth', null, 250000, '{}'::jsonb, array['hack'])", [], /Modul/)
await fails('paket: batas tak valid ditolak', "select pa_plan_upsert('growth', 'Growth', null, 250000, '{\"staff\": 0}'::jsonb, '{}'::text[])", [], /Batas/)
await fails('paket: basic tidak bisa diarsipkan', "select pa_plan_upsert('basic', 'Basic', null, 149000, '{}'::jsonb, '{}'::text[], true, true)", [], /cadangan/)
await works('paket: buat Growth', "select pa_plan_upsert('growth', 'Growth', 'Tengah', 250000, '{\"staff\": 8, \"products\": 200}'::jsonb, array['inventory','loyalty','inventory'])")
const growth = (await one("select features, limits from (select (jsonb_array_elements(pa_plans_list())) p) x, jsonb_to_record(x.p) as r(code text, features text[], limits jsonb) where r.code = 'growth'"))
check('paket: modul tanpa duplikat', growth && growth.features.length === 2, J(growth))
await works('paket: ubah harga Growth', "select pa_plan_upsert('growth', 'Growth', 'Tengah', 275000, '{\"staff\": 8}'::jsonb, array['inventory'])")
await su()
const planLog2 = await one("select before ->> 'price_monthly' b, after ->> 'price_monthly' a from platform_audit_logs where action = 'plan.update' order by id desc limit 1")
check('paket: audit before/after harga', planLog2 && Number(planLog2.b) === 250000 && Number(planLog2.a) === 275000, J(planLog2))
check('paket: 2 baris audit', (await auditCount()) === before + 2)

// ---------- 7. Langganan ----------
await as(U.admin, 'aal2')
before = await auditCount()
await works('ganti paket kafe B → growth + harga khusus', "select pa_subscription_set_plan($1, 'growth', 200000)", [cafeB])
await works('beri trial kafe B 10 hari', 'select pa_subscription_trial($1, 10)', [cafeB])
await works('perpanjang kafe B 2 bulan', 'select pa_subscription_extend($1, 2)', [cafeB])
await fails('perpanjang 0 bulan ditolak', 'select pa_subscription_extend($1, 0)', [cafeB])
await su()
const subB = await one("select plan_code, status, price_override, current_period_end > now() + interval '2 months' ok from cafe_subscriptions where cafe_id = $1", [cafeB])
check('langganan B: growth aktif, mulai dari akhir trial', subB.plan_code === 'growth' && subB.status === 'active' && Number(subB.price_override) === 200000 && subB.ok, J(subB))
check('langganan: 3 baris audit', (await auditCount()) === before + 3)

// Masa tenggang
await q("update cafe_subscriptions set current_period_end = now() - interval '3 days' where cafe_id = $1", [cafeB])
check('tenggang: lewat 3 hari masih growth', (await one('select (cafe_plan($1)).code c', [cafeB])).c === 'growth')
await q("update cafe_subscriptions set current_period_end = now() - interval '8 days' where cafe_id = $1", [cafeB])
check('tenggang: lewat 8 hari turun basic', (await one('select (cafe_plan($1)).code c', [cafeB])).c === 'basic')
check('tenggang: period_end kosong tetap berlaku', (await one('select (cafe_plan($1)).code c', [cafeA])).c === 'enterprise')

// ---------- 8. Tagihan manual ----------
await as(U.admin, 'aal2')
before = await auditCount()
const inv = (await one('select pa_invoice_create($1, null, 3) i', [cafeB])).i
check('tagihan: nominal = harga khusus × 3', Number(inv.amount) === 600000 && inv.state === 'pending' && inv.plan_code === 'growth', J(inv))
check('tagihan: nomor terbentuk', /^INV-\d{4}-\d{5}$/.test(inv.number), inv.number)
await fails('tagihan: tandai lunas tanggal masa depan ditolak', "select pa_invoice_mark_paid($1, now() + interval '5 days')", [inv.id], /masa depan/)
await works('tagihan: tandai lunas manual', "select pa_invoice_mark_paid($1, now(), 'BCA 123')", [inv.id])
await fails('tagihan: lunas dua kali ditolak', 'select pa_invoice_mark_paid($1)', [inv.id], /sudah lunas/)
await fails('tagihan: batalkan yang lunas ditolak', 'select pa_invoice_void($1)', [inv.id], /belum dibayar/)
await su()
const subPaid = await one("select status, current_period_end > now() + interval '89 days' ok from cafe_subscriptions where cafe_id = $1", [cafeB])
check('lunas: langganan aktif +3 bulan', subPaid.status === 'active' && subPaid.ok, J(subPaid))
check('lunas: method manual_transfer', (await one('select method, payment_ref from subscription_invoices where id = $1', [inv.id])).method === 'manual_transfer')
check('tagihan: 2 baris audit (buat + lunas)', (await auditCount()) === before + 2)
const paidLog = await one("select before -> 'subscription' ->> 'status' b, after -> 'subscription' ->> 'status' a from platform_audit_logs where action = 'invoice.paid'")
check('lunas: audit memuat langganan sebelum/sesudah', paidLog.b === 'active' && paidLog.a === 'active', J(paidLog))
await as(U.admin, 'aal2')
const inv2 = (await one("select pa_invoice_create($1, 'pro', 1, 100000, 0) i", [cafeA])).i
await works('tagihan: batalkan', "select pa_invoice_void($1, 'salah')", [inv2.id])
const inv3 = (await one("select pa_invoice_create($1, 'pro', 1, 100000, 0) i", [cafeA])).i
await su()
await q("update subscription_invoices set due_at = now() - interval '1 day' where id = $1", [inv3.id])
await as(U.admin, 'aal2')
const invList = (await one("select pa_invoices_list(null, 'overdue') l")).l
check('tagihan: filter telat', invList.total === 1 && invList.rows[0].id === inv3.id && invList.summary.void === 1, J(invList.summary))
const ov2 = (await one('select pa_overview() o')).o
check('overview: pendapatan bulan ini & telat', Number(ov2.revenue_month) === 600000 && Number(ov2.overdue_count) === 1, J(ov2))

// ---------- 9. Log audit ----------
const audit = (await one("select pa_audit_list(null, 'invoice') a")).a
check('audit: filter aksi invoice', audit.rows.length > 0 && audit.rows.every((row) => row.action.startsWith('invoice.')), J(audit.rows.map((row) => row.action)))
check('audit: memuat nama kafe & aktor', audit.rows.some((row) => row.cafe_name === 'Kopi B' && row.actor_label === 'admin@contoh.id'), J(audit.rows[0]))

// ---------- 10. Owner: tagihan sendiri ----------
await as(U.ownerB, 'aal1')
const ownInv = (await one('select owner_invoices($1) i', [cafeB])).i
check('owner: lihat tagihan sendiri', ownInv.length === 1 && ownInv[0].provider_order_id === undefined, J(ownInv))
await fails('owner B tidak bisa lihat tagihan kafe A', 'select owner_invoices($1)', [cafeA])
await as(U.staffA, 'aal1')
await fails('staff tidak bisa lihat tagihan', 'select owner_invoices($1)', [cafeA])
await as(U.ownerA, 'aal1')
await fails('owner: minta tagihan saat ada tagihan admin belum dibayar ditolak', "select owner_invoice_request($1, 'basic', 3)", [cafeA], /belum dibayar/)
await as(U.newOwner, 'aal1')
await fails('owner: paket tidak publik ditolak', "select owner_invoice_request($1, 'enterprise', 1)", [cafeN], /tidak bisa dipilih/)
await fails('owner: lama tidak valid ditolak', "select owner_invoice_request($1, 'pro', 2)", [cafeN], /1, 3, 6/)
const req1 = (await one("select owner_invoice_request($1, 'pro', 1) i", [cafeN])).i
const req1b = (await one("select owner_invoice_request($1, 'pro', 1) i", [cafeN])).i
check('owner: minta tagihan sama → dipakai ulang', req1.id === req1b.id && Number(req1.amount) === 349000, J(req1))
const req2 = (await one("select owner_invoice_request($1, 'basic', 3) i", [cafeN])).i
await su()
check('owner: ganti pilihan → tagihan lama dibatalkan', (await one('select status from subscription_invoices where id = $1', [req1.id])).status === 'void' && Number(req2.amount) === 447000)

// ---------- 11. Gateway ----------
await asService()
await fails('gateway: owner lain tidak bisa siapkan tagihan', 'select pa_gateway_prepare($1, $2)', [req2.id, U.ownerA], /tidak ditemukan/)
const prep = (await one('select pa_gateway_prepare($1, $2) p', [req2.id, U.newOwner])).p
check('gateway: order id & nominal', prep.provider_order_id.startsWith(req2.number) && Number(prep.amount) === 447000 && prep.owner_email === 'newOwner@contoh.id', J(prep))
await q("select pa_gateway_save_checkout($1, 'https://snap/x')", [prep.provider_order_id])
const prep2 = (await one('select pa_gateway_prepare($1, $2) p', [req2.id, U.newOwner])).p
check('gateway: link dipakai ulang', prep2.reuse === true && prep2.checkout_url === 'https://snap/x', J(prep2))
check('gateway: lookup owner', (await one('select pa_gateway_lookup($1, $2) v', [req2.id, U.newOwner])).v === prep.provider_order_id)
check('gateway: lookup owner lain kosong', (await one('select pa_gateway_lookup($1, $2) v', [req2.id, U.ownerA])).v === null)
let applied = (await one("select pa_gateway_apply($1, 'pending', null, 447000, '{}'::jsonb) r", [prep.provider_order_id])).r
check('gateway: pending tidak melunasi', applied.paid === false, J(applied))
applied = (await one("select pa_gateway_apply($1, 'settlement', null, 1000, '{}'::jsonb) r", [prep.provider_order_id])).r
check('gateway: nominal kurang ditolak', applied.ok === false && applied.reason === 'amount_mismatch', J(applied))
applied = (await one("select pa_gateway_apply($1, 'capture', 'challenge', 447000, '{}'::jsonb) r", [prep.provider_order_id])).r
check('gateway: fraud challenge tidak melunasi', applied.paid === false, J(applied))
applied = (await one("select pa_gateway_apply($1, 'settlement', null, 447000, '{\"x\":1}'::jsonb) r", [prep.provider_order_id])).r
check('gateway: settlement melunasi', applied.paid === true && applied.already === false, J(applied))
applied = (await one("select pa_gateway_apply($1, 'settlement', null, 447000, '{}'::jsonb) r", [prep.provider_order_id])).r
check('gateway: webhook ulang idempoten', applied.paid === true && applied.already === true, J(applied))
check('gateway: order tak dikenal', (await one("select pa_gateway_apply('NOPE', 'settlement', null, 1, '{}'::jsonb) r")).r.reason === 'unknown_order')
await su()
const subN = await one("select plan_code, status, current_period_end > now() + interval '89 days' ok from cafe_subscriptions where cafe_id = $1", [cafeN])
check('gateway: langganan aktif basic 3 bulan', subN.plan_code === 'basic' && subN.status === 'active' && subN.ok, J(subN))
check('gateway: audit aktor midtrans', Number((await one("select count(*) n from platform_audit_logs where action = 'invoice.paid' and actor_label = 'midtrans'")).n) === 1)
await asService()
await fails('gateway: siapkan tagihan lunas ditolak', 'select pa_gateway_prepare($1, $2)', [req2.id, U.newOwner], /sudah lunas/)

// ---------- 12. Penagihan otomatis ----------
await su()
// Kafe Dua (trial 0 hari, paket basic berbayar) & kafe B (periode habis 5 hari lagi)
const cafe2 = (await one('select cafe_id from profiles where id = $1', [U.newOwner2])).cafe_id
await q("update cafe_subscriptions set current_period_end = now() + interval '5 days', status = 'active' where cafe_id = $1", [cafeB])
await q("update subscription_invoices set period_start = now() - interval '85 days', period_end = now() + interval '5 days' where cafe_id = $1 and status = 'paid'", [cafeB])
await q("update subscription_invoices set status = 'void' where cafe_id = $1 and status = 'pending'", [cafeA])
await q("update cafe_subscriptions set current_period_end = now() - interval '1 day', status = 'active', plan_code = 'pro' where cafe_id = $1", [cafeA])
await asService()
let run = (await one('select pa_billing_run() r')).r
await su()
const autoInv = await q("select cafe_id, amount, source from subscription_invoices where source = 'system' order by cafe_id")
check('otomatis: tagihan untuk B, Dua, dan A (lewat jatuh tempo)', run.invoices_created === 3 && autoInv.length === 3, J({ run, autoInv }))
check('otomatis: nominal B = harga khusus', Number(autoInv.find((row) => row.cafe_id === cafeB)?.amount) === 200000, J(autoInv))
check('otomatis: kafe Dua (trial habis) ditagih', autoInv.some((row) => row.cafe_id === cafe2))
check('otomatis: A ditandai past_due', run.marked_past_due === 1 && (await one('select status from cafe_subscriptions where cafe_id = $1', [cafeA])).status === 'past_due', J(run))
check('otomatis: kafe N (baru lunas 3 bulan) tidak ditagih', !autoInv.some((row) => row.cafe_id === cafeN))
await asService()
run = (await one('select pa_billing_run() r')).r
check('otomatis: dijalankan ulang tidak menggandakan', run.invoices_created === 0, J(run))
await su()
check('otomatis: audit aktor sistem', Number((await one("select count(*) n from platform_audit_logs where actor_label = 'sistem'")).n) === 3)
check('otomatis: snapshot MRR bulan ini', Number((await one('select count(*) n from platform_mrr_snapshots')).n) === 1)
// Kafe nonaktif tidak ditagih
await q("update subscription_invoices set status = 'void' where cafe_id = $1 and status = 'pending'", [cafe2])
await q("update cafes set suspended_at = now() where id = $1", [cafe2])
await asService()
run = (await one('select pa_billing_run() r')).r
check('otomatis: kafe nonaktif tidak ditagih', run.invoices_created === 0, J(run))

console.log(`\n${passed} lulus, ${failures.length} gagal`)
if (failures.length) {
  console.log(failures.map((failure) => `  ✗ ${failure}`).join('\n'))
  process.exit(1)
}
