// Uji file usulan/12 (QRIS statis merchant). PGlite — TIDAK menyentuh database live.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'

const usulan = (name) => fs.readFileSync(new URL(`../usulan/${name}`, import.meta.url), 'utf8')
let passed = 0
const failures = []
const check = (name, ok, detail = '') => { if (ok) passed += 1; else failures.push(`${name} → ${detail}`) }
const db = new PGlite()
const q = async (sql, params = []) => (await db.query(sql, params)).rows
async function as(id) {
  await db.exec('reset role')
  await q("select set_config('request.jwt.claim.sub', $1, false)", [id || ''])
  await db.exec(id ? 'set role authenticated' : 'set role anon')
}
async function fails(name, sql, params, pattern) {
  try { await db.query(sql, params); failures.push(`${name} → seharusnya gagal`) } catch (error) {
    if (pattern && !pattern.test(error.message)) failures.push(`${name} → ${error.message}`); else passed += 1
  }
}

await db.exec(fs.readFileSync(new URL('./base-schema.sql', import.meta.url), 'utf8'))
await db.exec("set timezone to 'Asia/Jakarta'; create role service_role nologin bypassrls; grant usage on schema public, auth to service_role;")
for (const f of ['04-owner-dashboard.sql', '05-inventori-supplier.sql', '06-pesanan-v2-pos.sql', '07-akuntansi.sql', '08-pelanggan-qr.sql', '09-payment-gateway.sql', '10-izin-langganan-keamanan.sql']) await db.exec(usulan(f))
const result = await db.exec(usulan('12-qris-statis.sql'))
check('verifikasi 2 baris', result.at(-1).rows.length === 2, JSON.stringify(result.at(-1).rows))
await db.exec(usulan('12-qris-statis.sql'))
passed += 1 // aman dijalankan ulang

const U = { owner: '00000000-0000-0000-0000-0000000000a1', staff: '00000000-0000-0000-0000-0000000000a2', cust: '00000000-0000-0000-0000-0000000000c1', cust2: '00000000-0000-0000-0000-0000000000c2' }
for (const id of Object.values(U)) await q('insert into auth.users (id) values ($1)', [id])
const cafe = (await q("insert into cafes (name) values ('Kopi A') returning id"))[0].id
await q("insert into profiles (id, cafe_id, full_name, role) values ($1,$2,'O','owner'),($3,$2,'S','staff'),($4,null,'R','customer'),($5,null,'B','customer')", [U.owner, cafe, U.staff, U.cust, U.cust2])
const prod = (await q("insert into products (cafe_id, name, price) values ($1,'Latte',28000) returning id", [cafe]))[0].id
const URL_OK = 'https://x.supabase.co/storage/v1/object/public/cafe-assets/a/qris.png'
const place = async () => { await as(U.cust); return (await q('select customer_place_order($1, $2::jsonb) id', [cafe, JSON.stringify([{ product_id: prod, quantity: 1 }])]))[0].id }

const early = await place()
await fails('belum ada QRIS → ditolak', 'select customer_use_static_qris($1)', [early], /belum memasang QRIS/)

await as(U.staff)
await q('update cafe_settings set qris_image_url = $1 where cafe_id = $2', [URL_OK, cafe])
await as(null); await db.exec('reset role')
check('staff tidak bisa memasang QRIS', (await q('select qris_image_url from cafe_settings where cafe_id = $1', [cafe]))[0].qris_image_url === null)
await as(U.owner)
await fails('URL bukan https ditolak', 'update cafe_settings set qris_image_url = $1 where cafe_id = $2', ['http://contoh/qris.png', cafe], /check/)
await q('update cafe_settings set qris_image_url = $1 where cafe_id = $2', [URL_OK, cafe])
await as(null)
check('pelanggan tanpa login bisa melihat QRIS (untuk app)', (await q('select qris_image_url from cafe_settings where cafe_id = $1', [cafe]))[0]?.qris_image_url === URL_OK)

const order = await place()
await as(U.cust2)
await fails('pelanggan lain ditolak', 'select customer_use_static_qris($1)', [order], /tidak ditemukan/)
await as(U.cust)
await q('select customer_use_static_qris($1)', [order])
await db.exec('reset role')
const row = (await q('select payment_method, payment_status from orders where id = $1', [order]))[0]
check('pesanan ditandai QRIS & belum lunas', row.payment_method === 'qris' && row.payment_status !== 'paid', JSON.stringify(row))

await as(U.staff)
await q("select staff_mark_order_paid($1, 'qris')", [order])
await db.exec('reset role')
check('staff menandai lunas setelah cek mutasi', (await q('select payment_status from orders where id = $1', [order]))[0].payment_status === 'paid')
await as(U.cust)
await fails('pesanan lunas tidak bisa diubah', 'select customer_use_static_qris($1)', [order], /sudah dibayar/)
await as(null)
await fails('anonim ditolak', 'select customer_use_static_qris($1)', [order], /permission denied/)

console.log(`\n${passed} lulus, ${failures.length} gagal`)
if (failures.length) { failures.forEach((failure) => console.log(`  ✗ ${failure}`)); process.exit(1) }
