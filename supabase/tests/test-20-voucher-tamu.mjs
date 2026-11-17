// Uji file usulan/20 (voucher untuk tamu QR meja). PGlite — TIDAK menyentuh database live.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'

const usulan = (name) => fs.readFileSync(new URL(`../usulan/${name}`, import.meta.url), 'utf8')
let passed = 0
const failures = []
const check = (name, ok, detail = '') => { if (ok) passed += 1; else failures.push(`${name} → ${detail}`) }
const J = (value) => JSON.stringify(value)
const db = new PGlite()
const q = async (sql, params = []) => (await db.query(sql, params)).rows
async function as(id, anonymous = false) {
  await db.exec('reset role')
  await q("select set_config('request.jwt.claim.sub', $1, false)", [id || ''])
  await q("select set_config('request.jwt.claims', $1, false)", [id ? J({ sub: id, is_anonymous: anonymous }) : ''])
  await db.exec(id ? 'set role authenticated' : 'set role anon')
}
async function fails(name, sql, params, pattern) {
  try { await db.query(sql, params); failures.push(`${name} → seharusnya gagal`) } catch (error) {
    if (pattern && !pattern.test(error.message)) failures.push(`${name} → ${error.message}`); else passed += 1
  }
}

await db.exec(fs.readFileSync(new URL('./base-schema.sql', import.meta.url), 'utf8'))
await db.exec("set timezone to 'Asia/Jakarta'; create role service_role nologin bypassrls; grant usage on schema public, auth to service_role;")
await db.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant execute on function auth.jwt() to anon, authenticated;`)
for (const f of ['04-owner-dashboard.sql', '05-inventori-supplier.sql', '06-pesanan-v2-pos.sql', '07-akuntansi.sql', '08-pelanggan-qr.sql',
  '09-payment-gateway.sql', '10-izin-langganan-keamanan.sql', '12-qris-statis.sql', '13-tamu-qr-meja.sql']) await db.exec(usulan(f))

const U = { owner: '00000000-0000-0000-0000-0000000000a1', cust: '00000000-0000-0000-0000-0000000000c1', guest: '00000000-0000-0000-0000-0000000000d1', guest2: '00000000-0000-0000-0000-0000000000d2' }
for (const id of Object.values(U)) await q('insert into auth.users (id) values ($1)', [id])
const cafe = (await q("insert into cafes (name) values ('Kopi A') returning id"))[0].id
await q("insert into profiles (id, cafe_id, full_name, role) values ($1,$2,'O','owner'),($3,null,'R','customer'),($4,null,'Tamu Budi','customer'),($5,null,'Tamu Dewi','customer')", [U.owner, cafe, U.cust, U.guest, U.guest2])
// Voucher lama (sebelum file 20)
await q("insert into vouchers (cafe_id, code, name, discount_type, discount_value, is_public) values ($1, 'LAMA', 'Voucher lama', 'amount', 1000, true)", [cafe])
const prod = (await q("insert into products (cafe_id, name, price) values ($1,'Latte',28000) returning id", [cafe]))[0].id
const table = (await q("insert into cafe_tables (cafe_id, label) values ($1,'4') returning id, qr_token", [cafe]))[0]
const items = J([{ product_id: prod, quantity: 1 }])

// File 20
const result = await db.exec(usulan('20-voucher-tamu.sql'))
check('verifikasi: kolom audience ada', result.at(-1).rows.length === 1, J(result.at(-1).rows))
try { await db.exec(usulan('20-voucher-tamu.sql')); passed += 1 } catch (error) { failures.push(`dijalankan ulang → ${error.message}`) }
check('voucher lama otomatis khusus member', (await q("select audience from vouchers where code = 'LAMA'"))[0].audience === 'members')
await fails('audience tidak valid ditolak', "update vouchers set audience = 'semua' where code = 'LAMA'", [], /audience_check/)

await q("insert into vouchers (cafe_id, code, name, discount_type, discount_value, audience, usage_limit, per_customer_limit) values ($1, 'TAMU5', 'Diskon tamu', 'amount', 5000, 'all', 2, 1)", [cafe])

// Owner bisa mengatur audience lewat tabel (RLS owner)
await as(U.owner)
await q("update vouchers set audience = 'all' where code = 'LAMA'")
await q("update vouchers set audience = 'members' where code = 'LAMA'")
check('owner bisa mengubah audience', (await q("select audience from vouchers where code = 'LAMA'"))[0].audience === 'members')

// Belum ada sesi (anon): boleh cek voucher; 'members' ditolak dengan pesan jelas
await as(null)
const anonAll = (await q("select voucher_check($1, 'TAMU5', 28000) r", [cafe]))[0].r
check('tanpa sesi: voucher semua-pelanggan bisa dicek', anonAll.ok === true && Number(anonAll.discount) === 5000, J(anonAll))
const anonMember = (await q("select voucher_check($1, 'LAMA', 28000) r", [cafe]))[0].r
check('tanpa sesi: voucher member ditolak', anonMember.ok === false && /khusus member/.test(anonMember.message), J(anonMember))

// Sesi tamu
await as(U.guest, true)
const guestAll = (await q("select voucher_check($1, 'TAMU5', 28000) r", [cafe]))[0].r
check('tamu: voucher semua-pelanggan ok', guestAll.ok === true, J(guestAll))
const guestMember = (await q("select voucher_check($1, 'LAMA', 28000) r", [cafe]))[0].r
check('tamu: voucher member ditolak', guestMember.ok === false && /khusus member/.test(guestMember.message), J(guestMember))
await fails('tamu checkout pakai voucher member → ditolak', "select customer_place_order($1, $2::jsonb, 'dine_in', $3, null, null, null, null, 'LAMA')", [cafe, items, table.qr_token], /khusus member/)
await fails('tamu tetap tidak bisa tukar poin', "select customer_place_order($1, $2::jsonb, 'dine_in', $3, null, null, null, null, null, 1)", [cafe, items, table.qr_token], /Masuk ke akun customer untuk memakai poin/)
const guestOrder = (await q("select customer_place_order($1, $2::jsonb, 'dine_in', $3, null, null, null, null, 'tamu5') id", [cafe, items, table.qr_token]))[0].id
const order = (await q('select voucher_code, voucher_discount, subtotal_amount, discount_amount from orders where id = $1', [guestOrder]))[0]
check('tamu checkout pakai voucher semua-pelanggan → diskon masuk', order.voucher_code === 'TAMU5' && Number(order.voucher_discount) === 5000 && Number(order.discount_amount) === 5000, J(order))
const again = (await q("select voucher_check($1, 'TAMU5', 28000) r", [cafe]))[0].r
check('tamu yang sama: batas per pelanggan berlaku', again.ok === false && /sudah memakai/.test(again.message), J(again))
await fails('tamu pesan bawa pulang tetap ditolak', "select customer_place_order($1, $2::jsonb, 'takeaway')", [cafe, items], /hanya bisa lewat QR meja/)

// Tamu kedua memakai kuota terakhir, lalu kuota habis
await as(U.guest2, true)
await q("select customer_place_order($1, $2::jsonb, 'dine_in', $3, null, null, null, null, 'TAMU5')", [cafe, items, table.qr_token])
await as(U.cust)
const quota = (await q("select voucher_check($1, 'TAMU5', 28000) r", [cafe]))[0].r
check('kuota total tetap berlaku', quota.ok === false && /Kuota/.test(quota.message), J(quota))

// Member tetap bisa memakai voucher member
const member = (await q("select voucher_check($1, 'LAMA', 28000) r", [cafe]))[0].r
check('member: voucher khusus member ok', member.ok === true, J(member))
const custOrder = (await q("select customer_place_order($1, $2::jsonb, 'takeaway', null, null, null, null, null, 'LAMA') id", [cafe, items]))[0].id
check('member checkout pakai voucher member', (await q('select voucher_code from orders where id = $1', [custOrder]))[0].voucher_code === 'LAMA')

// Pembatalan tamu → voucher dikembalikan (perilaku file 08 tetap)
await as(U.guest, true)
await q('select customer_cancel_order($1)', [guestOrder]).catch(() => null)
await db.exec('reset role')
const red = (await q('select status from voucher_redemptions where order_id = $1', [guestOrder]))[0]
check('voucher tamu: redemption tercatat', Boolean(red), J(red))

console.log(`file 20: ${passed} lulus, ${failures.length} gagal`)
for (const failure of failures) console.log('  ✗ ' + failure)
process.exit(failures.length ? 1 : 0)
