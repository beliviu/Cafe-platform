// Uji file usulan/13 (tamu QR meja). PGlite — TIDAK menyentuh database live.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'

const usulan = (name) => fs.readFileSync(new URL(`../usulan/${name}`, import.meta.url), 'utf8')
let passed = 0
const failures = []
const check = (name, ok, detail = '') => { if (ok) passed += 1; else failures.push(`${name} → ${detail}`) }
const db = new PGlite()
const q = async (sql, params = []) => (await db.query(sql, params)).rows
async function as(id, anonymous = false) {
  await db.exec('reset role')
  await q("select set_config('request.jwt.claim.sub', $1, false)", [id || ''])
  await q("select set_config('request.jwt.claims', $1, false)", [id ? JSON.stringify({ sub: id, is_anonymous: anonymous }) : ''])
  await db.exec(id ? 'set role authenticated' : 'set role anon')
}
async function fails(name, sql, params, pattern) {
  try { await db.query(sql, params); failures.push(`${name} → seharusnya gagal`) } catch (error) {
    if (pattern && !pattern.test(error.message)) failures.push(`${name} → ${error.message}`); else passed += 1
  }
}

await db.exec(fs.readFileSync(new URL('./base-schema.sql', import.meta.url), 'utf8'))
await db.exec("set timezone to 'Asia/Jakarta'; create role service_role nologin bypassrls; grant usage on schema public, auth to service_role;")
// auth.jwt() seperti di Supabase
await db.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant execute on function auth.jwt() to anon, authenticated;`)
for (const f of ['04-owner-dashboard.sql', '05-inventori-supplier.sql', '06-pesanan-v2-pos.sql', '07-akuntansi.sql', '08-pelanggan-qr.sql', '09-payment-gateway.sql', '10-izin-langganan-keamanan.sql', '12-qris-statis.sql']) await db.exec(usulan(f))
const result = await db.exec(usulan('13-tamu-qr-meja.sql'))
check('verifikasi 1 baris', result.at(-1).rows.length === 1, JSON.stringify(result.at(-1).rows))
await db.exec(usulan('13-tamu-qr-meja.sql'))
passed += 1 // aman dijalankan ulang

const U = { staff: '00000000-0000-0000-0000-0000000000a2', owner: '00000000-0000-0000-0000-0000000000a1', cust: '00000000-0000-0000-0000-0000000000c1', guest: '00000000-0000-0000-0000-0000000000d1', guest2: '00000000-0000-0000-0000-0000000000d2' }
for (const id of Object.values(U)) await q('insert into auth.users (id) values ($1)', [id])
const cafe = (await q("insert into cafes (name) values ('Kopi A') returning id"))[0].id
await q("insert into profiles (id, cafe_id, full_name, role) values ($1,$2,'O','owner'),($3,$2,'S','staff'),($4,null,'R','customer'),($5,null,'Tamu Budi','customer'),($6,null,null,'customer')", [U.owner, cafe, U.staff, U.cust, U.guest, U.guest2])
const prod = (await q("insert into products (cafe_id, name, price) values ($1,'Latte',28000) returning id", [cafe]))[0].id
const table = (await q("insert into cafe_tables (cafe_id, label) values ($1,'4') returning id, qr_token", [cafe]))[0]
const items = JSON.stringify([{ product_id: prod, quantity: 1 }])

await as(U.guest, true)
await fails('tamu pesan bawa pulang → ditolak', 'select customer_place_order($1, $2::jsonb, $3)', [cafe, items, 'takeaway'], /hanya bisa lewat QR meja/)
await fails('tamu lewat create_order lama → ditolak', 'select create_order($1, $2::jsonb)', [cafe, items], /hanya bisa lewat QR meja/)
const guestOrder = (await q("select customer_place_order($1, $2::jsonb, 'dine_in', $3) id", [cafe, items, table.qr_token]))[0].id
check('tamu pesan lewat QR meja → berhasil', Boolean(guestOrder))
const own = await q('select id, table_label from orders where id = $1', [guestOrder])
check('tamu bisa melihat pesanannya sendiri', own.length === 1 && own[0].table_label === '4', JSON.stringify(own))
check('tamu bisa melihat item pesanannya', (await q('select id from order_items where order_id = $1', [guestOrder])).length === 1)
await q('select customer_use_static_qris($1)', [guestOrder]).catch(() => null) // QRIS belum dipasang → boleh gagal

await as(U.guest2, true)
check('tamu lain tidak bisa melihat pesanan tamu pertama', (await q('select id from orders where id = $1', [guestOrder])).length === 0)

await as(U.cust)
const custOrder = (await q("select customer_place_order($1, $2::jsonb, 'takeaway') id", [cafe, items]))[0].id
check('pelanggan login tetap bisa pesan bawa pulang', Boolean(custOrder))

await as(U.staff)
const seen = await q('select id from orders where id = $1', [guestOrder])
check('staff melihat pesanan tamu', seen.length === 1)
await q('select staff_mark_order_paid($1, $2)', [guestOrder, 'cash']).catch((error) => failures.push(`staff tandai lunas pesanan tamu → ${error.message}`))
await db.exec('reset role')
check('pesanan tamu lunas', (await q('select payment_status from orders where id = $1', [guestOrder]))[0].payment_status === 'paid')

console.log(`\n${passed} lulus, ${failures.length} gagal`)
for (const failure of failures) console.log('  ✗ ' + failure)
process.exit(failures.length ? 1 : 0)
