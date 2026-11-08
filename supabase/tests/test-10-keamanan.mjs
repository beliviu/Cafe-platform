// Uji file usulan/10: izin staff, langganan, pengetatan hak akses, dan isolasi antar-kafe menyeluruh.
// Postgres lokal (PGlite) — TIDAK menyentuh database live.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'

const ROOT = new URL('../usulan/', import.meta.url)
const usulan = (name) => fs.readFileSync(new URL(name, ROOT), 'utf8')
let passed = 0
const failures = []
const check = (name, ok, detail = '') => { if (ok) passed += 1; else failures.push(`${name}${detail !== '' ? ` → ${detail}` : ''}`) }
const J = (value) => JSON.stringify(value)

const db = new PGlite()
const su = () => db.exec('reset role')
async function as(userId) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ''])
  await db.exec(userId ? 'set role authenticated' : 'set role anon')
}
const q = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await q(sql, params))[0]
async function fails(name, sql, params, pattern) {
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
    await db.query(sql, params)
    passed += 1
  } catch (error) {
    failures.push(`${name} → ${error.message}`)
  }
}

await db.exec(fs.readFileSync(new URL('./base-schema.sql', import.meta.url), 'utf8'))
await db.exec("set timezone to 'Asia/Jakarta'")
await db.exec('create role service_role nologin bypassrls; grant usage on schema public, auth to service_role;')
for (const file of ['04-owner-dashboard.sql', '05-inventori-supplier.sql', '06-pesanan-v2-pos.sql', '07-akuntansi.sql', '08-pelanggan-qr.sql', '09-payment-gateway.sql']) await db.exec(usulan(file))

const U = {
  ownerA: '00000000-0000-0000-0000-0000000000a1', staffA: '00000000-0000-0000-0000-0000000000a2', staffA2: '00000000-0000-0000-0000-0000000000a3',
  ownerB: '00000000-0000-0000-0000-0000000000b1', staffB: '00000000-0000-0000-0000-0000000000b2', cust: '00000000-0000-0000-0000-0000000000c1',
  cust2: '00000000-0000-0000-0000-0000000000c2',
}
for (const id of Object.values(U)) await db.query('insert into auth.users (id) values ($1)', [id])
// Kafe A dibuat SEBELUM file 10 (kafe lama), kafe B juga
const cafeA = (await one("insert into cafes (name, accepted_payment_methods) values ('Kopi A', array['cash','qris','bank_transfer']) returning id")).id
const cafeB = (await one("insert into cafes (name) values ('Kopi B') returning id")).id
await db.query(`insert into profiles (id, cafe_id, full_name, role) values ($1,$2,'Owner A','owner'),($3,$2,'Staff A','staff'),($4,$2,'Staff A2','staff'),
  ($5,$6,'Owner B','owner'),($7,$6,'Staff B','staff'),($8,null,'Rani','customer'),($9,null,'Bagas','customer')`,
  [U.ownerA, cafeA, U.staffA, U.staffA2, U.ownerB, cafeB, U.staffB, U.cust, U.cust2])
const results = await db.exec(usulan('10-izin-langganan-keamanan.sql'))
const verify = results.at(-1).rows
check('verifikasi 8 baris & tidak ada tabel tanpa RLS', verify.length === 8 && !verify.some((row) => row.kind === 'tanpa_rls'), J(verify.filter((row) => row.kind === 'tanpa_rls')))
await db.exec(usulan('10-izin-langganan-keamanan.sql'))
passed += 1 // aman dijalankan ulang

// ---------- Data kafe A di semua modul ----------
await su()
const catA = (await one("insert into categories (cafe_id, name) values ($1, 'Kopi') returning id", [cafeA])).id
const latte = (await one("insert into products (cafe_id, category_id, name, price) values ($1,$2,'Latte',28000) returning id", [cafeA, catA])).id
const bread = (await one("insert into products (cafe_id, name, price) values ($1,'Roti',20000) returning id", [cafeA])).id
await db.query('update cafe_settings set loyalty_enabled = true, payment_gateway_enabled = true where cafe_id = $1', [cafeA])
await as(U.ownerA)
await q('select acc_setup($1, current_date, $2::jsonb)', [cafeA, J([{ code: '1-1100', amount: 100000 }, { code: '3-1000', amount: 100000 }])])
const milk = (await one("insert into ingredients (cafe_id, name, unit) values ($1,'Susu','ml') returning id", [cafeA])).id
await q('select inventory_stock_in($1, 1000, 20, null, null, null, true)', [milk])
const supplier = (await one("insert into suppliers (cafe_id, name) values ($1,'PT Susu') returning id", [cafeA])).id
await q('select purchase_order_save($1, null, $2, current_date, null, null, $3::jsonb)', [cafeA, supplier, J([{ ingredient_id: milk, quantity: 1, unit_label: 'liter', unit_size: 1000, unit_price: 20000 }])])
const rent = (await one("select id from accounts where cafe_id = $1 and code = '6-1100'", [cafeA])).id
await q("select expense_create($1, current_date, $2, 'Sewa', 500000, 'cash')", [cafeA, rent])
await q("insert into cafe_tables (cafe_id, label) values ($1, 'A1')", [cafeA])
await q("insert into vouchers (cafe_id, code, name, discount_type, discount_value, is_public) values ($1, 'RAHASIA', 'Rahasia', 'amount', 1000, false), ($1, 'PUBLIK', 'Publik', 'amount', 1000, true)", [cafeA])
await q("insert into staff_shifts (cafe_id, user_id, starts_at, ends_at) values ($1, $2, now(), now() + interval '8 hours')", [cafeA, U.staffA]).catch(() => null)
await as(U.staffA)
await q('select cashier_open($1, 50000)', [cafeA])
const posOrder = (await one("select place_order($1, $2::jsonb, 'pos') id", [cafeA, J([{ product_id: latte, quantity: 1 }])])).id
await q('select pos_record_payments($1, $2::jsonb)', [posOrder, J([{ method: 'cash', amount: 28000, tendered: 50000 }])])
await q("select refund_request($1, 1000, 'cash', 'tumpah')", [posOrder])
await q("select cashier_cash_move((select id from cashier_sessions where status = 'open' limit 1), 'out', 5000, 'es batu')")
await as(U.cust)
const appOrder = (await one('select customer_place_order($1, $2::jsonb) id', [cafeA, J([{ product_id: bread, quantity: 1 }])])).id
await q("select support_open($1, 'Halo', 'Tanya menu', null)", [cafeA])
await q('insert into wishlist_items (product_id) values ($1)', [latte])
await as(U.staffA)
for (const status of ['confirmed', 'preparing', 'ready', 'completed']) await q('update orders set order_status = $2 where id = $1', [appOrder, status])
await as(U.cust)
await q("select review_submit($1, $2, 5, 'Enak')", [appOrder, bread])
await su()
await db.exec('set role service_role')
await q("select pay_prepare_intent($1, $2, 'app')", [U.cust, appOrder]).catch(() => null) // sudah lunas? tidak — app belum bayar
await su()
const appOrder2 = await (async () => { await as(U.cust); return (await one('select customer_place_order($1, $2::jsonb) id', [cafeA, J([{ product_id: latte, quantity: 1 }])])).id })()
await su()
await db.exec('set role service_role')
await q("select pay_prepare_intent($1, $2, 'app')", [U.cust, appOrder2])
await su()

// ---------- A. Izin staff ----------
await as(U.staffA)
check('staff melihat katalog izin', (await q('select * from staff_permission_catalog()')).length === 9)
await fails('staff tidak bisa mengatur izin', "select staff_set_permissions($1, '{}')", [U.staffA2], /tidak ditemukan/)
await as(U.ownerB)
await fails('owner kafe lain tidak bisa mengatur izin staff A', "select staff_set_permissions($1, '{}')", [U.staffA], /tidak ditemukan/)
await as(U.ownerA)
await fails('izin tidak dikenal ditolak', "select staff_set_permissions($1, '{pos.sell,terbang}')", [U.staffA2], /tidak dikenal/)
await q("select staff_set_permissions($1, '{pos.sell}')", [U.staffA2]) // hanya boleh kasir
const perms = await q('select * from staff_permissions_list($1)', [cafeA])
check('daftar izin: staff A semua, staff A2 hanya kasir', perms.find((p) => p.user_id === U.staffA).all_permissions && J(perms.find((p) => p.user_id === U.staffA2).permissions) === J(['pos.sell']), J(perms))
await su()
check('log aktivitas izin', (await one("select count(*)::int c from audit_logs where entity = 'staff_permissions'")).c === 1)
await su()
await db.query('update cafe_settings set staff_max_discount_pct = 50 where cafe_id = $1', [cafeA])
await as(U.staffA2)
await works('staff A2 boleh membuka sesi kasir sendiri', 'select cashier_open($1, 10000)', [cafeA])
await works('staff A2 boleh membuat pesanan kasir', "select place_order($1, $2::jsonb, 'pos')", [cafeA, J([{ product_id: bread, quantity: 1 }])])
await fails('tanpa izin diskon', "select place_order($1, $2::jsonb, 'pos', null, null, null, null, $3::jsonb)", [cafeA, J([{ product_id: bread, quantity: 1 }]), J({ type: 'amount', value: 1000, reason: 'teman' })], /Beri diskon/)
const posOrder2 = (await one("select id from orders where cafe_id = $1 and source = 'pos' and order_status <> 'cancelled' order by created_at desc limit 1", [cafeA])).id
await fails('tanpa izin batalkan pesanan', "select staff_cancel_order($1, 'salah')", [posOrder2], /Batalkan pesanan/)
await fails('tanpa izin konfirmasi QRIS manual', "select staff_mark_order_paid($1, 'qris')", [posOrder2], /Konfirmasi non-tunai/)
await works('tunai tetap boleh tanpa izin non-tunai', "select staff_mark_order_paid($1, 'cash')", [posOrder2])
await fails('tanpa izin ajukan refund', "select refund_request($1, 1000, 'cash', 'tumpah')", [posOrder2], /Ajukan refund/)
await fails('tanpa izin kas laci', "select cashier_cash_move((select id from cashier_sessions where status = 'open' and opened_by = $1 limit 1), 'in', 1000, 'tambah')", [U.staffA2], /Kas masuk/)
await su() // tetap sebagai staff A2 (auth.uid), tanpa RLS skema tiruan
await fails('tanpa izin menu habis', 'update products set is_available = false where id = $1', [bread], /Atur menu habis/)
await as(U.staffA2)
await fails('tanpa izin jeda pesanan app', 'select cafe_set_ordering_paused($1, true)', [cafeA], /Jeda pesanan app/)
const ticket = (await (async () => { await su(); return one('select id from support_tickets limit 1') })()).id
await as(U.staffA2)
await fails('tanpa izin balas pelanggan', "select support_reply($1, 'halo')", [ticket], /Balas pelanggan/)
await as(U.ownerA)
await q("select staff_set_permissions($1, '{}')", [U.staffA2])
await as(U.staffA2)
await fails('tanpa izin kasir: pesanan POS ditolak', "select place_order($1, $2::jsonb, 'pos')", [cafeA, J([{ product_id: bread, quantity: 1 }])], /Kasir \(POS\)/)
await as(U.staffA)
await works('staff A (semua izin) bisa membalas pelanggan', "select support_reply($1, 'halo kak')", [ticket])
await works('staff A bisa menjeda pesanan app', 'select cafe_set_ordering_paused($1, false)', [cafeA])
await as(U.cust)
const custOrder = (await one('select customer_place_order($1, $2::jsonb) id', [cafeA, J([{ product_id: bread, quantity: 1 }])])).id
await works('customer tetap bisa membatalkan pesanannya (tidak terkena izin staff)', 'select customer_cancel_order($1)', [custOrder])
await as(U.ownerA)
await q('select staff_set_permissions($1, (select array_agg(key) from staff_permission_catalog()))', [U.staffA2])
await su()
check('semua izin dicentang → kembali null (semua)', (await one('select staff_permissions from profiles where id = $1', [U.staffA2])).staff_permissions === null)

// ---------- B. Langganan ----------
await su()
check('kafe lama → Enterprise aktif', (await one('select plan_code, status from cafe_subscriptions where cafe_id = $1', [cafeA])).plan_code === 'enterprise')
const cafeC = (await one("insert into cafes (name) values ('Kopi C') returning id")).id
const subC = await one('select plan_code, status, trial_ends_at from cafe_subscriptions where cafe_id = $1', [cafeC])
check('kafe baru → Pro masa coba 30 hari', subC.plan_code === 'pro' && subC.status === 'trialing' && subC.trial_ends_at > new Date(Date.now() + 29 * 86400000))
await as(U.ownerA)
let ent = (await one('select cafe_entitlements($1) e', [cafeA])).e
check('hak fitur kafe A: Enterprise, staff 2, tanpa batas', ent.plan.code === 'enterprise' && ent.usage.staff === 2 && J(ent.limits) === '{}' && ent.plans.length === 2, J(ent))
await as(U.ownerB)
await fails('hak fitur kafe lain ditolak', 'select cafe_entitlements($1)', [cafeA], /Hanya anggota/)
await as(U.ownerA)
await fails('owner tidak bisa mengubah paket sendiri', "select subscription_set($1, 'enterprise', 'active')", [cafeA], /permission denied/)
// Paket Basic untuk kafe B
await su()
await db.exec('set role service_role')
await q("select subscription_set($1, 'basic', 'active')", [cafeB])
await su()
await as(U.ownerB)
await fails('Basic: loyalti terkunci', 'update cafe_settings set loyalty_enabled = true where cafe_id = $1', [cafeB], /tidak termasuk paket/)
await fails('Basic: inventori terkunci', "insert into ingredients (cafe_id, name, unit) values ($1, 'Kopi', 'g')", [cafeB], /tidak termasuk paket/)
await fails('Basic: QRIS online terkunci', 'update cafe_settings set payment_gateway_enabled = true where cafe_id = $1', [cafeB], /tidak termasuk paket/)
await fails('Basic: pembukuan terkunci', "select acc_setup($1, current_date, '[]'::jsonb)", [cafeB], /tidak termasuk paket/)
await works('Basic: pengaturan lain tetap bisa diubah', 'update cafe_settings set tax_enabled = true where cafe_id = $1', [cafeB])
const tableRows = Array.from({ length: 10 }, (_, index) => `('${cafeB}', 'B${index + 1}')`).join(',')
await works('Basic: 10 meja boleh', `insert into cafe_tables (cafe_id, label) values ${tableRows}`)
await fails('Basic: meja ke-11 ditolak', "insert into cafe_tables (cafe_id, label) values ($1, 'B11')", [cafeB], /Batas paket tercapai \(10 meja\)/)
await su()
await db.query("insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000b3'), ('00000000-0000-0000-0000-0000000000b4'), ('00000000-0000-0000-0000-0000000000b5')")
await db.query("insert into profiles (id, cafe_id, full_name, role) values ('00000000-0000-0000-0000-0000000000b3', $1, 'S2', 'staff'), ('00000000-0000-0000-0000-0000000000b4', $1, 'S3', 'staff')", [cafeB])
await fails('Basic: staff aktif ke-4 ditolak (juga dari server/Edge Function)', "insert into profiles (id, cafe_id, full_name, role) values ('00000000-0000-0000-0000-0000000000b5', $1, 'S4', 'staff')", [cafeB], /3 staff aktif/)
await db.query("update profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000b4'")
await works('menonaktifkan staff membebaskan kuota', "insert into profiles (id, cafe_id, full_name, role) values ('00000000-0000-0000-0000-0000000000b5', $1, 'S4', 'staff')", [cafeB])
await fails('mengaktifkan lagi staff saat penuh ditolak', "update profiles set is_active = true where id = '00000000-0000-0000-0000-0000000000b4'", [], /Batas paket/)
// Masa coba habis → hanya fitur dasar
await db.exec('set role service_role')
await q("select subscription_set($1, 'pro', 'trialing')", [cafeC])
await su()
await db.query("update cafe_subscriptions set trial_ends_at = now() - interval '1 day' where cafe_id = $1", [cafeC])
await db.exec('set role authenticated')
check('masa coba habis → fitur Pro terkunci', (await one("select cafe_has_feature($1, 'loyalty') f", [cafeC])).f === false)
check('Enterprise punya semua fitur', (await one("select cafe_has_feature($1, 'payment_gateway') f", [cafeA])).f === true)
await su()
check('perubahan paket tercatat di log aktivitas', (await one("select count(*)::int c from audit_logs where entity = 'cafe_subscriptions' and cafe_id = $1", [cafeB])).c >= 1)

// ---------- C. Pengetatan hak akses ----------
await as(null)
await fails('anon tidak bisa menambah kategori', "insert into categories (cafe_id, name) values ($1, 'Spam')", [cafeA], /permission denied/)
await fails('anon tidak bisa menghapus produk', 'delete from products where cafe_id = $1', [cafeA], /permission denied/)
check('anon tetap bisa melihat menu', (await q('select 1 from products where cafe_id = $1', [cafeA])).length === 2)
await as(U.ownerA)
await fails('pengguna tidak bisa TRUNCATE (melewati RLS)', 'truncate table categories', [], /permission denied/)
await as(U.ownerB)
await q("update categories set name = 'Diretas' where cafe_id = $1", [cafeA]).catch(() => null)
await su()
check('owner kafe lain tidak bisa mengubah kategori', (await one('select name from categories where id = $1', [catA])).name === 'Kopi')
await as(U.cust)
await fails('customer tidak bisa mengubah izin sendiri', "update profiles set staff_permissions = '{}' where id = $1", [U.cust], /permission denied/)

// ---------- Penyisiran isolasi antar-kafe ----------
// Tabel yang memang publik (menu, meja tanpa token, pengaturan, voucher publik)
const PUBLIC = new Set(['categories', 'products', 'product_option_groups', 'product_options', 'cafe_settings', 'cafe_tables', 'vouchers'])
await su()
const tables = (await q(`select distinct c.table_name from information_schema.columns c join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema
  where c.table_schema = 'public' and c.column_name = 'cafe_id' and t.table_type = 'BASE TABLE' order by 1`)).map((row) => row.table_name)
const countsBefore = {}
for (const table of tables) countsBefore[table] = (await one(`select count(*)::int c from public.${table} where cafe_id = $1`, [cafeA])).c
const populated = tables.filter((table) => countsBefore[table] > 0)
check('penyisiran mencakup banyak tabel berisi data kafe A', populated.length >= 30, `${populated.length} tabel: ${populated.join(',')}`)
const leaks = []
for (const [label, user] of [['owner B', U.ownerB], ['staff B', U.staffB], ['customer lain', U.cust2], ['anon', null]]) {
  for (const table of tables) {
    await as(user)
    let rows = 0
    try {
      rows = (await one(`select count(*)::int c from public.${table} where cafe_id = $1`, [cafeA])).c
    } catch {
      rows = 0 // tidak punya hak baca sama sekali
    }
    if (rows > 0 && !(PUBLIC.has(table))) leaks.push(`${label} membaca ${table} (${rows})`)
    if (table === 'vouchers' && rows > 1) leaks.push(`${label} membaca voucher rahasia`)
    for (const statement of [`update public.${table} set cafe_id = cafe_id where cafe_id = $1`, `delete from public.${table} where cafe_id = $1`]) {
      try {
        const result = await db.query(statement, [cafeA])
        if (result.affectedRows > 0) leaks.push(`${label}: ${statement.split(' ')[0]} ${table} (${result.affectedRows})`)
      } catch {
        // ditolak = aman
      }
    }
  }
}
check('tidak ada kebocoran baca/ubah/hapus lintas kafe', leaks.length === 0, leaks.slice(0, 12).join('; '))
await su()
const changed = tables.filter((table) => countsBefore[table] !== undefined)
let intact = true
for (const table of changed) {
  const now = (await one(`select count(*)::int c from public.${table} where cafe_id = $1`, [cafeA])).c
  if (now !== countsBefore[table]) intact = false
}
check('data kafe A utuh setelah semua percobaan', intact)
// Customer: hanya data miliknya di kafe A
await as(U.cust2)
check('customer lain tidak melihat pesanan Rani', (await q('select 1 from orders where cafe_id = $1', [cafeA])).length === 0)
// Fungsi owner kafe A dipanggil owner B
await as(U.ownerB)
const today = (await one('select current_date::text d')).d
for (const [fn, args] of [
  ['acc_overview($1, $2::date, $2::date)', [cafeA, today]], ['acc_trial_balance($1, $2::date)', [cafeA, today]], ['loyalty_customers($1)', [cafeA]],
  ['cafe_tables_qr($1)', [cafeA]], ['payment_gateway_summary($1, $2::date, $2::date)', [cafeA, today]], ['staff_permissions_list($1)', [cafeA]],
  ['inventory_forecast($1)', [cafeA]], ['cafe_entitlements($1)', [cafeA]],
]) {
  await fails(`owner B tidak bisa memanggil ${fn.split('(')[0]} kafe A`, `select * from ${fn}`, args, /Hanya|owner|anggota|staff/i)
}

if (failures.length) {
  console.error(`\n${passed} lulus, ${failures.length} GAGAL:`)
  for (const failure of failures) console.error(` ✗ ${failure}`)
  process.exit(1)
}
console.log(`\n${passed} lulus, 0 gagal`)
