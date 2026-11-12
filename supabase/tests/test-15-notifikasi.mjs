// Uji file usulan/15: notifikasi platform & owner, "Perlu tindakan", pengecekan harian (anti-duplikat),
// MRR dengan harga kustom, WhatsApp manual, pengaturan platform, pengumuman. PGlite — TIDAK menyentuh database live.
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
async function raw(sql, params = []) {
  const back = restore
  await db.exec('reset role')
  const rows = await q(sql, params)
  await back()
  return rows
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

// ---------- Skema ----------
await db.exec(fs.readFileSync(new URL('./base-schema.sql', import.meta.url), 'utf8'))
await db.exec("set timezone to 'Asia/Jakarta'; create role service_role nologin bypassrls; grant usage on schema public, auth to service_role;")
await db.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant execute on function auth.jwt() to anon, authenticated, service_role;
  grant execute on function auth.uid() to service_role;`)
for (const file of ['04-owner-dashboard.sql', '05-inventori-supplier.sql', '06-pesanan-v2-pos.sql', '07-akuntansi.sql', '08-pelanggan-qr.sql',
  '09-payment-gateway.sql', '10-izin-langganan-keamanan.sql', '12-qris-statis.sql', '13-tamu-qr-meja.sql', '14-platform-admin.sql']) await db.exec(usulan(file))

const U = {
  admin: '00000000-0000-0000-0000-0000000000e1', admin2: '00000000-0000-0000-0000-0000000000e2',
  ownerA: '00000000-0000-0000-0000-0000000000a1', staffA: '00000000-0000-0000-0000-0000000000a2',
  ownerB: '00000000-0000-0000-0000-0000000000b1', ownerC: '00000000-0000-0000-0000-0000000000c3',
  cust: '00000000-0000-0000-0000-0000000000c1', newOwner: '00000000-0000-0000-0000-0000000000f1',
}
for (const [key, id] of Object.entries(U)) await q('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@contoh.id`])
const cafeA = (await one("insert into cafes (name, created_at) values ('Kopi A', now() - interval '60 days') returning id")).id
const cafeB = (await one("insert into cafes (name, created_at) values ('Kopi B', now() - interval '60 days') returning id")).id
const cafeC = (await one("insert into cafes (name, created_at) values ('Kopi C', now() - interval '60 days') returning id")).id
await q(`insert into profiles (id, cafe_id, full_name, role) values ($1,$2,'Owner A','owner'),($3,$2,'Staff A','staff'),($4,$5,'Owner B','owner'),($6,$7,'Owner C','owner'),($8,null,'Rani','customer')`,
  [U.ownerA, cafeA, U.staffA, U.ownerB, cafeB, U.ownerC, cafeC, U.cust])
await q("insert into platform_admins (user_id, full_name) values ($1, 'Admin Satu'), ($2, 'Admin Dua')", [U.admin, U.admin2])
await q('update platform_admins set is_active = false where user_id = $1', [U.admin2])
// A: Enterprise aktif tanpa harga · B: Pro aktif berbayar · C: Pro masa coba habis 2 hari lagi
await q("update cafe_subscriptions set plan_code = 'enterprise', status = 'active', trial_ends_at = null, current_period_end = null where cafe_id = $1", [cafeA])
await q("update cafe_subscriptions set plan_code = 'pro', status = 'active', trial_ends_at = null, current_period_end = now() + interval '20 days' where cafe_id = $1", [cafeB])
await q("update cafe_subscriptions set plan_code = 'pro', status = 'trialing', trial_ends_at = now() + interval '2 days', current_period_end = null where cafe_id = $1", [cafeC])
// B & C ramai (pesanan kemarin), A sepi (pesanan terakhir 10 hari lalu)
await q("insert into orders (cafe_id, total_amount, created_at) values ($1, 1000, now() - interval '10 days'), ($2, 1000, now() - interval '1 day'), ($3, 1000, now() - interval '1 day')", [cafeA, cafeB, cafeC])

const result = await db.exec(usulan('15-notifikasi-platform.sql'))
const verify = result.at(-1).rows
check('verifikasi: 5 tabel + 1 trigger, tanpa tabel tanpa RLS', verify.length === 6 && !verify.some((row) => row.kind === 'tanpa_rls'), J(verify))
await db.exec(usulan('15-notifikasi-platform.sql'))
passed += 1 // aman dijalankan ulang
await su()

// ---------- 1. Hak akses fungsi admin ----------
const ADMIN_CALLS = [
  ['pa_action_items', 'select pa_action_items()'],
  ['pa_settings_get', 'select pa_settings_get()'],
  ['pa_settings_update', `select pa_settings_update('{"theme_color":"#000000"}'::jsonb)`],
  ['pa_cafe_set_owner_whatsapp', `select pa_cafe_set_owner_whatsapp('${cafeA}', '081234567890')`],
  ['pa_log_whatsapp', `select pa_log_whatsapp('${cafeA}', 'tagihan')`],
  ['pa_notifications_list', 'select pa_notifications_list()'],
  ['pa_notifications_mark_read', 'select pa_notifications_mark_read()'],
  ['pa_cafe_outbox', `select pa_cafe_outbox('${cafeA}')`],
  ['pa_announce', "select pa_announce('x', 'y')"],
  ['pa_announcements_list', 'select pa_announcements_list()'],
]
const SERVICE_ONLY = [
  ['pa_daily_check', 'select pa_daily_check()'],
  ['pa_action_rows', 'select * from pa_action_rows()'],
  ['pa_notify_admin', "select pa_notify_admin('x','info','x',null,null,null,null)"],
  ['pa_notify_owner', `select pa_notify_owner('${cafeA}','x','info','x',null,null,null)`],
  ['pa_cafe_create_for_owner (7)', `select pa_cafe_create_for_owner('${U.admin}', '${U.newOwner}', 'X', 'Y', 'pro', 7, null)`],
]
for (const [label, id, aal] of [['anon', null, 'aal1'], ['customer', U.cust, 'aal2'], ['staff', U.staffA, 'aal2'], ['owner', U.ownerA, 'aal2'], ['admin tanpa 2FA', U.admin, 'aal1'], ['admin nonaktif', U.admin2, 'aal2']]) {
  for (const [fn, sql] of ADMIN_CALLS) {
    await as(id, aal)
    await fails(`${label} → ${fn} ditolak`, sql)
  }
  for (const [fn, sql] of SERVICE_ONLY) {
    await as(id, aal)
    await fails(`${label} → ${fn} (khusus server) ditolak`, sql)
  }
}

// ---------- 2. Perlu tindakan ----------
await su()
const invB = (await one("insert into subscription_invoices (number, cafe_id, plan_code, period_start, period_end, amount, due_at) values ('INV-T-1', $1, 'pro', now(), now() + interval '1 month', 349000, now() - interval '3 days') returning id", [cafeB])).id
await as(U.admin, 'aal2')
const items = (await one('select pa_action_items() i')).i
const kinds = items.map((item) => `${item.kind}:${item.cafe_name}`)
check('perlu tindakan: urut telat → masa coba → sepi', J(kinds) === J(['invoice_overdue:Kopi B', 'trial_ending:Kopi C', 'idle_cafe:Kopi A']), J(kinds))
check('perlu tindakan: alasan telat 3 hari', /INV-T-1 telat 3 hari/.test(items[0].reason) && Number(items[0].amount) === 349000, items[0].reason)
check('perlu tindakan: masa coba 2 hari', /dalam 2 hari/.test(items[1].reason), items[1].reason)
check('perlu tindakan: sepi sejak tanggal', /Tanpa pesanan sejak/.test(items[2].reason), items[2].reason)
// Pembayaran gagal dari payment_events
await su()
await q("insert into payment_events (cafe_id, event_key, source, result, transaction_status) values ($1, 'ev-1', 'webhook', 'bad_signature', 'settlement'), ($1, 'ev-ok', 'webhook', 'paid', 'settlement')", [cafeB])
await as(U.admin, 'aal2')
const items2 = (await one('select pa_action_items() i')).i
check('perlu tindakan: webhook gagal masuk peringkat 2', items2[1]?.kind === 'payment_failed' && /tanda tangan/.test(items2[1].reason) && items2.filter((item) => item.kind === 'payment_failed').length === 1, J(items2.map((item) => item.kind)))

// ---------- 3. MRR dengan harga kustom ----------
let overview = (await one('select pa_overview() o')).o
check('MRR: enterprise tanpa harga = hanya Pro B', Number(overview.mrr) === 349000, overview.mrr)
check('MRR: daftar kafe tanpa harga', overview.unpriced.length === 1 && overview.unpriced[0].name === 'Kopi A', J(overview.unpriced))
check('ringkasan: jumlah perlu tindakan', Number(overview.action_count) === 4, overview.action_count)
check('ringkasan: riwayat pendapatan 12 bulan', overview.revenue_history.length === 12, overview.revenue_history?.length)
await works('beri harga kustom kafe A', 'select pa_subscription_set_plan($1, $2, 1500000)', [cafeA, 'enterprise'])
overview = (await one('select pa_overview() o')).o
check('MRR: harga kustom ikut dihitung', Number(overview.mrr) === 1849000 && overview.unpriced.length === 0, `${overview.mrr} ${J(overview.unpriced)}`)

// ---------- 4. WhatsApp ----------
check('normalize 0812-… → 62…', (await one("select normalize_wa('0812-3456 7890') v")).v === '6281234567890')
check('normalize +62 …', (await one("select normalize_wa('+62 812 3456 7890') v")).v === '6281234567890')
check('normalize 812…', (await one("select normalize_wa('81234567890') v")).v === '6281234567890')
check('normalize kosong → null', (await one("select normalize_wa('  ') v")).v === null)
await fails('normalize tidak valid', "select normalize_wa('12345')", [], /tidak valid/)
const auditBefore = Number((await raw('select count(*) n from platform_audit_logs'))[0].n)
await works('admin isi WA owner A', "select pa_cafe_set_owner_whatsapp($1, '0812 1111 2222')", [cafeA])
await works('admin catat klik WA', "select pa_log_whatsapp($1, 'tagihan', '6281211112222')", [cafeA])
const waLogs = await raw("select action, after from platform_audit_logs where action in ('cafe.owner_whatsapp', 'whatsapp.open') order by id")
check('WA: 2 baris audit (ubah nomor + klik)', waLogs.length === 2 && waLogs[1].after.template === 'tagihan' && Number((await raw('select count(*) n from platform_audit_logs'))[0].n) === auditBefore + 2, J(waLogs))
await as(U.ownerB, 'aal1')
check('owner isi WA sendiri', (await one("select owner_set_whatsapp($1, '0813 3333 4444') v", [cafeB])).v === '6281333334444')
await fails('owner B tidak bisa isi WA kafe A', "select owner_set_whatsapp($1, '0813 3333 4444')", [cafeA], /Hanya owner/)
await as(U.staffA, 'aal1')
await fails('staff tidak bisa isi WA owner', "select owner_set_whatsapp($1, '0813 3333 4444')", [cafeA], /Hanya owner/)
await as(U.ownerB, 'aal1')
await fails('owner tidak bisa update owner_whatsapp langsung', "update cafes set owner_whatsapp = '6281299999999' where id = $1", [cafeB])
// Kontak platform
await as(U.admin, 'aal2')
await fails('pengaturan: kunci tak dikenal ditolak', `select pa_settings_update('{"hack":1}'::jsonb)`, [], /tidak dikenal/)
await fails('pengaturan: warna tidak valid ditolak', `select pa_settings_update('{"theme_color":"merah"}'::jsonb)`)
await works('pengaturan: isi WA Dailybrew & tema', `select pa_settings_update('{"support_whatsapp":"0811 2222 3333","theme_color":"#4f8aa8","theme_color2":"#7a78c4"}'::jsonb)`)
const settings = (await one('select pa_settings_get() s')).s
check('pengaturan tersimpan & dinormalisasi', settings.support_whatsapp === '6281122223333' && settings.theme_color === '#4F8AA8', J(settings))
check('pengaturan: audit', (await raw("select count(*) n from platform_audit_logs where action = 'settings.update'"))[0].n == 1)
await as(U.ownerB, 'aal1')
const contact = (await one('select platform_contact($1) c', [cafeB])).c
check('owner membaca WA Dailybrew + WA sendiri', contact.support_whatsapp === '6281122223333' && contact.owner_whatsapp === '6281333334444', J(contact))
check('owner tidak melihat WA owner kafe lain', (await one('select platform_contact($1) c', [cafeA])).c.owner_whatsapp === null)
check('tema: owner tidak dapat (bukan admin)', (await one('select pa_theme() t')).t === null)
await as(U.admin, 'aal1')
check('tema: admin dapat walau belum 2FA', (await one('select pa_theme() t')).t?.color === '#4F8AA8')
await as(U.ownerB, 'aal1')
await fails('owner tidak bisa baca platform_settings langsung', 'select * from platform_settings')

// ---------- 5. Notifikasi otomatis dari audit ----------
await asService()
await works('buat kafe + owner + WA (7 argumen)', "select pa_cafe_create_for_owner($1, $2, 'Kopi Baru', 'Budi', 'pro', 14, '0857 1234 5678')", [U.admin, U.newOwner])
const cafeN = (await raw('select cafe_id from profiles where id = $1', [U.newOwner]))[0].cafe_id
check('kafe baru: WA owner tersimpan', (await raw('select owner_whatsapp from cafes where id = $1', [cafeN]))[0].owner_whatsapp === '6285712345678')
check('kafe baru: notifikasi admin', (await raw("select count(*) n from platform_notifications where kind = 'cafe_created' and cafe_id = $1", [cafeN]))[0].n == 1)
check('kafe baru: email ke admin aktif saja (1)', (await raw("select count(*) n from notification_outbox where kind = 'cafe_created'"))[0].n == 1
  && (await raw("select recipient from notification_outbox where kind = 'cafe_created'"))[0].recipient === 'admin@contoh.id')

// ---------- 6. Pengecekan harian + anti-duplikat ----------
await su()
// Tagihan C jatuh tempo besok, tagihan A 5 hari lagi
const invC = (await one("insert into subscription_invoices (number, cafe_id, plan_code, period_start, period_end, amount, due_at) values ('INV-T-2', $1, 'pro', now(), now() + interval '1 month', 349000, now() + interval '20 hours') returning id", [cafeC])).id
const invA = (await one("insert into subscription_invoices (number, cafe_id, plan_code, period_start, period_end, amount, due_at) values ('INV-T-3', $1, 'enterprise', now(), now() + interval '1 month', 1500000, now() + interval '5 days') returning id", [cafeA])).id
await asService()
const run1 = (await one('select pa_daily_check() r')).r
await su()
const ownerKinds = (await q('select kind, cafe_id from cafe_notifications order by kind')).map((row) => `${row.kind}:${row.cafe_id === cafeA ? 'A' : row.cafe_id === cafeB ? 'B' : row.cafe_id === cafeC ? 'C' : 'N'}`)
check('harian: notifikasi owner (A H-7, B telat, C H-1, C masa coba)', J(ownerKinds) === J(['invoice_due_1:C', 'invoice_due_7:A', 'invoice_overdue:B', 'trial_ending:C']), J(ownerKinds))
const adminKinds = (await q("select kind from platform_notifications where kind <> 'cafe_created' order by kind")).map((row) => row.kind)
check('harian: notifikasi admin (telat, sepi, gagal, masa coba)', J(adminKinds) === J(['idle_cafe', 'invoice_overdue', 'payment_failed', 'trial_ending']), J(adminKinds))
check('harian: hasil menghitung', run1.owner_notifications === 4 && run1.admin_notifications === 4 && run1.billing, J(run1))
check('harian: email owner (4 jenis bawaan) + email admin', Number((await one("select count(*) n from notification_outbox where audience = 'owner'")).n) === 4
  && Number((await one("select count(*) n from notification_outbox where audience = 'admin' and kind in ('invoice_overdue', 'payment_failed')")).n) === 2)
check('harian: masa coba owner kedaluwarsa saat masa coba habis', (await one("select expires_at > now() ok from cafe_notifications where kind = 'trial_ending'")).ok === true)
const before2 = { owner: Number((await one('select count(*) n from cafe_notifications')).n), admin: Number((await one('select count(*) n from platform_notifications')).n), out: Number((await one('select count(*) n from notification_outbox')).n) }
await asService()
const run2 = (await one('select pa_daily_check() r')).r
await su()
const after2 = { owner: Number((await one('select count(*) n from cafe_notifications')).n), admin: Number((await one('select count(*) n from platform_notifications')).n), out: Number((await one('select count(*) n from notification_outbox')).n) }
check('anti-duplikat: dijalankan ulang tidak menambah apa pun', J(before2) === J(after2) && run2.owner_notifications === 0 && run2.admin_notifications === 0, J({ before2, after2, run2 }))
// Tagihan B dibayar → banner telat owner hilang + notifikasi admin lunas
await as(U.admin, 'aal2')
await works('admin tandai lunas tagihan B', "select pa_invoice_mark_paid($1, now(), 'BCA')", [invB])
await su()
check('lunas: notifikasi admin', Number((await one("select count(*) n from platform_notifications where kind = 'invoice_paid'")).n) === 1)
await as(U.ownerB, 'aal1')
const ownerB = (await one('select owner_notifications($1) n', [cafeB])).n
check('lunas: banner telat owner B selesai', !ownerB.some((row) => row.kind === 'invoice_overdue'), J(ownerB))
// Tagihan A dibatalkan → banner H-7 hilang
await as(U.admin, 'aal2')
await works('admin batalkan tagihan A', 'select pa_invoice_void($1)', [invA])
await as(U.ownerA, 'aal1')
check('batal: banner H-7 owner A selesai', !(await one('select owner_notifications($1) n', [cafeA])).n.some((row) => row.kind === 'invoice_due_7'))

// ---------- 7. RLS notifikasi ----------
await as(U.ownerC, 'aal1')
const ownC = await q('select kind, cafe_id from cafe_notifications')
check('RLS: owner C hanya melihat notifikasi kafenya', ownC.length === 2 && ownC.every((row) => row.cafe_id === cafeC), J(ownC))
check('RLS: owner C fungsi notifikasi', (await one('select owner_notifications($1) n', [cafeC])).n.length === 2)
await fails('owner C tidak bisa baca notifikasi kafe B lewat fungsi', 'select owner_notifications($1)', [cafeB], /Hanya owner/)
check('RLS: owner C tidak melihat notifikasi admin', (await q('select * from platform_notifications')).length === 0)
await fails('RLS: owner tidak bisa tandai baca langsung', 'update cafe_notifications set read_at = now() where cafe_id = $1', [cafeC])
await fails('RLS: owner tidak bisa baca antrean email', 'select * from notification_outbox')
const cNote = (await one('select owner_notifications($1) n', [cafeC])).n[0]
await as(U.ownerB, 'aal1')
await fails('owner B tidak bisa menutup notifikasi kafe C', 'select owner_notification_dismiss($1)', [cNote.id], /tidak ditemukan/)
await as(U.staffA, 'aal1')
check('RLS: staff tidak melihat notifikasi owner', (await q('select * from cafe_notifications')).length === 0)
await fails('staff tidak bisa memanggil owner_notifications', 'select owner_notifications($1)', [cafeA], /Hanya owner/)
await as(U.ownerC, 'aal1')
await works('owner C menutup notifikasinya', 'select owner_notification_dismiss($1)', [cNote.id])
check('owner C: notifikasi tertutup tidak tampil lagi', (await one('select owner_notifications($1) n', [cafeC])).n.length === 1)
await as(U.admin, 'aal1')
check('RLS: admin tanpa 2FA tidak melihat notifikasi admin', (await q('select * from platform_notifications')).length === 0)
await as(U.admin, 'aal2')
const adminRows = await q('select id from platform_notifications')
check('RLS: admin 2FA melihat semua notifikasi admin', adminRows.length === 6, adminRows.length)
await fails('admin pun tidak bisa ubah langsung', 'update platform_notifications set read_at = now()')
const list = (await one('select pa_notifications_list() l')).l
check('daftar notifikasi: belum dibaca 6', Number(list.unread) === 6 && list.rows[0].cafe_name !== undefined, list.unread)
check('tandai 1 dibaca', (await one('select pa_notifications_mark_read(array[$1::bigint]) n', [adminRows[0].id])).n === 1)
check('tandai semua dibaca', (await one('select pa_notifications_mark_read() n')).n === 5)
check('belum dibaca 0', Number((await one('select pa_notifications_list() l')).l.unread) === 0)
const outboxA = (await one('select pa_cafe_outbox($1) o', [cafeA])).o
check('status email per kafe', outboxA.length === 1 && outboxA[0].status === 'pending' && outboxA[0].kind === 'invoice_due_7', J(outboxA))

// ---------- 8. Pengumuman ----------
await fails('pengumuman: judul wajib', "select pa_announce('', 'isi')", [], /wajib/)
await fails('pengumuman: daftar kafe kosong ditolak', "select pa_announce('x', 'y', '{}'::uuid[])", [], /minimal satu/)
const ann1 = (await one("select pa_announce('Libur', 'Server maintenance Minggu', array[$1::uuid], true) a", [cafeA])).a
check('pengumuman ke 1 kafe', ann1.recipients === 1, J(ann1))
const ann2 = (await one("select pa_announce('Fitur baru', 'Kini ada laporan baru') a")).a
check('pengumuman ke semua kafe (4)', ann2.recipients === 4, J(ann2))
await as(U.ownerA, 'aal1')
const notesA = (await one('select owner_notifications($1) n', [cafeA])).n.filter((row) => row.kind === 'announcement')
check('owner A menerima 2 pengumuman', notesA.length === 2, J(notesA))
await as(U.ownerB, 'aal1')
check('owner B hanya menerima pengumuman umum', (await one('select owner_notifications($1) n', [cafeB])).n.filter((row) => row.kind === 'announcement').length === 1)
await su()
check('pengumuman: email hanya bila dipilih (1 owner kafe A)', Number((await one("select count(*) n from notification_outbox where kind = 'announcement'")).n) === 1)
check('pengumuman: audit', Number((await one("select count(*) n from platform_audit_logs where action = 'announcement.create'")).n) === 2)
await as(U.admin, 'aal2')
const anns = (await one('select pa_announcements_list() a')).a
check('riwayat pengumuman', anns.length === 2 && anns[0].created_by_email === 'admin@contoh.id', J(anns.map((row) => row.title)))

// Kafe nonaktif tidak mendapat pengingat tagihan
await su()
await q("insert into subscription_invoices (number, cafe_id, plan_code, period_start, period_end, amount, due_at) values ('INV-T-4', $1, 'pro', now(), now() + interval '1 month', 1, now() - interval '1 day')", [cafeN])
await q('update cafes set suspended_at = now() where id = $1', [cafeN])
await asService()
await q('select pa_daily_check()')
await su()
check('kafe nonaktif tidak diberi pengingat tagihan', Number((await one("select count(*) n from cafe_notifications where cafe_id = $1 and kind like 'invoice%'", [cafeN])).n) === 0)

console.log(`\n${passed} lulus, ${failures.length} gagal`)
if (failures.length) {
  console.log(failures.map((failure) => `  ✗ ${failure}`).join('\n'))
  process.exit(1)
}
