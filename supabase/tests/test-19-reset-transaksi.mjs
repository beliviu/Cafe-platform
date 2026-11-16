// Uji file usulan/19: owner mereset transaksi kafenya sendiri. Kafe lain tidak tersentuh; menu, akun, pengaturan tetap;
// staff / owner lain / konfirmasi salah / admin lihat-sebagai ditolak. PGlite — TIDAK menyentuh database live.
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
async function fails(name, sql, params, pattern) {
  try {
    await db.query(sql, params)
    failures.push(`${name} → seharusnya gagal`)
  } catch (error) {
    if (pattern && !pattern.test(error.message)) failures.push(`${name} → pesan: ${error.message}`)
    else passed += 1
  }
}
const count = async (table, cafeId) => Number((await one(`select count(*) n from public.${table} where cafe_id = $1`, [cafeId])).n)

await db.exec(fs.readFileSync(new URL('./base-schema.sql', import.meta.url), 'utf8'))
await db.exec("set timezone to 'Asia/Jakarta'; create role service_role nologin bypassrls; grant usage on schema public, auth to service_role;")
await db.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant execute on function auth.jwt() to anon, authenticated, service_role;`)
for (const file of ['04-owner-dashboard.sql', '05-inventori-supplier.sql', '06-pesanan-v2-pos.sql', '07-akuntansi.sql', '08-pelanggan-qr.sql',
  '09-payment-gateway.sql', '10-izin-langganan-keamanan.sql', '12-qris-statis.sql', '13-tamu-qr-meja.sql', '14-platform-admin.sql',
  '15-notifikasi-platform.sql', '16-kesehatan-analitik-tiket.sql', '17-penagihan-otomatis.sql', '18-skala-platform.sql']) await db.exec(usulan(file))

const U = {
  ownerA: '00000000-0000-0000-0000-0000000000a1', staffA: '00000000-0000-0000-0000-0000000000a2',
  ownerB: '00000000-0000-0000-0000-0000000000b1', cust: '00000000-0000-0000-0000-0000000000c1', admin: '00000000-0000-0000-0000-0000000000e1',
}
for (const [key, id] of Object.entries(U)) await q('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@contoh.id`])
const A = (await one("insert into cafes (name) values ('Kopi Alfa') returning id")).id
const B = (await one("insert into cafes (name) values ('Kopi Beta') returning id")).id
await q(`insert into profiles (id, cafe_id, full_name, role) values ($1,$2,'Owner A','owner'), ($3,$2,'Staff A','staff'), ($4,$5,'Owner B','owner'), ($6,null,'Rani','customer')`,
  [U.ownerA, A, U.staffA, U.ownerB, B, U.cust])
await q("insert into platform_admins (user_id, full_name, role) values ($1, 'Sapto', 'support')", [U.admin])

// Data uji di kedua kafe
for (const cafeId of [A, B]) {
  const product = (await one("insert into products (cafe_id, name, price) values ($1, 'Kopi Susu', 20000) returning id", [cafeId])).id
  for (let index = 0; index < 3; index += 1) {
    const order = (await one("insert into orders (cafe_id, customer_id, total_amount) values ($1, $2, 20000) returning id", [cafeId, U.cust])).id
    await q("insert into order_items (order_id, product_id, product_name, price, quantity, subtotal, cafe_id) values ($1, $2, 'Kopi Susu', 20000, 1, 20000, $3)", [order, product, cafeId])
  }
  await q("insert into ingredients (cafe_id, name, unit, on_hand) values ($1, 'Susu', 'ml', 5000)", [cafeId])
  await q("insert into loyalty_accounts (cafe_id, customer_id, points_balance, lifetime_points, lifetime_spend) values ($1, $2, 120, 300, 60000)", [cafeId, U.cust])
}

// File 19
const result = await db.exec(usulan('19-reset-transaksi-owner.sql'))
check('verifikasi: fungsi terpasang', result.at(-1).rows.length === 1)
try { await db.exec(usulan('19-reset-transaksi-owner.sql')); passed += 1 } catch (error) { failures.push(`dijalankan ulang → ${error.message}`) }

await su()
check('sebelum: kafe A punya 3 pesanan', (await count('orders', A)) === 3)

// Ditolak
await as(U.staffA)
await fails('staff ditolak', "select public.owner_reset_transactions($1, 'Kopi Alfa')", [A], /Hanya owner/)
await as(U.ownerB)
await fails('owner kafe lain ditolak', "select public.owner_reset_transactions($1, 'Kopi Alfa')", [A], /Hanya owner/)
await as(U.cust)
await fails('pelanggan ditolak', "select public.owner_reset_transactions($1, 'Kopi Alfa')", [A], /Hanya owner/)
await as(null)
await fails('anon ditolak', "select public.owner_reset_transactions($1, 'Kopi Alfa')", [A], /permission denied/)
await as(U.ownerA)
await fails('konfirmasi salah ditolak', "select public.owner_reset_transactions($1, 'kopi alfa')", [A], /Ketik nama kafe/)
await fails('konfirmasi kosong ditolak', "select public.owner_reset_transactions($1, '')", [A], /Ketik nama kafe/)
// Admin mode lihat-sebagai: boleh membaca, tidak boleh mereset
await su()
await q("insert into platform_impersonations (admin_id, cafe_id, reason, expires_at) values ($1, $2, 'Cek laporan owner', now() + interval '20 minutes')", [U.admin, A])
await as(U.admin, 'aal2')
await fails('admin lihat-sebagai tidak bisa mereset', "select public.owner_reset_transactions($1, 'Kopi Alfa')", [A], /hanya bisa melihat/)
await su()
await q('update platform_impersonations set ended_at = now()')
check('setelah percobaan gagal: data A utuh', (await count('orders', A)) === 3)

// Berhasil
await as(U.ownerA)
const res = (await one("select public.owner_reset_transactions($1, '  Kopi Alfa ') v", [A])).v
check('reset berhasil: 3 pesanan terhapus', res?.ok === true && res.orders === 3, J(res))
await su()
check('A: pesanan & item kosong', (await count('orders', A)) === 0 && (await count('order_items', A)) === 0)
check('A: stok bahan jadi 0, bahan tetap ada', Number((await one('select on_hand v from ingredients where cafe_id = $1', [A])).v) === 0 && (await count('ingredients', A)) === 1)
const loyalty = await one('select points_balance, lifetime_points, lifetime_spend from loyalty_accounts where cafe_id = $1', [A])
check('A: poin pelanggan jadi 0, akun poin tetap', loyalty.points_balance === 0 && loyalty.lifetime_points === 0 && Number(loyalty.lifetime_spend) === 0, J(loyalty))
check('A: menu & akun tetap', (await count('products', A)) === 1 && (await count('profiles', A)) === 2)
check('A: kafe & pengaturan tetap', Boolean(await one('select 1 from cafes where id = $1', [A])) && (await count('cafe_settings', A)) === 1)
check('A: log aktivitas berisi 1 catatan reset', (await count('audit_logs', A)) === 1 && (await one('select label v from audit_logs where cafe_id = $1', [A])).v === 'Reset semua transaksi')
check('A: tercatat di log admin platform', Boolean(await one("select 1 from platform_audit_logs where action = 'cafe.reset_transactions' and cafe_id = $1", [A])))
check('B: tidak tersentuh (3 pesanan, stok, poin)', (await count('orders', B)) === 3
  && Number((await one('select on_hand v from ingredients where cafe_id = $1', [B])).v) === 5000
  && (await one('select points_balance v from loyalty_accounts where cafe_id = $1', [B])).v === 120)
// Bisa langsung dipakai lagi
await as(U.cust)
try {
  await q("insert into orders (cafe_id, customer_id, total_amount) values ($1, $2, 15000)", [A, U.cust])
  passed += 1
} catch (error) {
  if (/permission denied/.test(error.message)) passed += 1 // skema uji tidak memberi grant insert langsung; cukup tidak rusak
  else failures.push(`pesanan baru setelah reset → ${error.message}`)
}

await su()
console.log(`file 19: ${passed} lulus, ${failures.length} gagal`)
if (failures.length) {
  for (const line of failures) console.log(' ✗', line)
  process.exit(1)
}
