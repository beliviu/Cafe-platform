// Uji file usulan/21: rincian harga checkout HARUS sama dengan pesanan yang benar-benar dibuat. PGlite — tidak menyentuh live.
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
const su = async () => { await db.exec('reset role') }

await db.exec(fs.readFileSync(new URL('./base-schema.sql', import.meta.url), 'utf8'))
await db.exec("set timezone to 'Asia/Jakarta'; create role service_role nologin bypassrls; grant usage on schema public, auth to service_role;")
await db.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant execute on function auth.jwt() to anon, authenticated;`)
for (const f of ['04-owner-dashboard.sql', '05-inventori-supplier.sql', '06-pesanan-v2-pos.sql', '07-akuntansi.sql', '08-pelanggan-qr.sql',
  '09-payment-gateway.sql', '10-izin-langganan-keamanan.sql', '12-qris-statis.sql', '13-tamu-qr-meja.sql', '20-voucher-tamu.sql']) await db.exec(usulan(f))
const result = await db.exec(usulan('21-rincian-harga-checkout.sql'))
check('verifikasi 1 baris', result.at(-1).rows.length === 1)
try { await db.exec(usulan('21-rincian-harga-checkout.sql')); passed += 1 } catch (error) { failures.push(`dijalankan ulang → ${error.message}`) }

const U = { cust: '00000000-0000-0000-0000-0000000000c1', guest: '00000000-0000-0000-0000-0000000000d1' }
for (const id of Object.values(U)) await q('insert into auth.users (id) values ($1)', [id])
const cafe = (await q("insert into cafes (name) values ('Kopi A') returning id"))[0].id
await q("insert into profiles (id, cafe_id, full_name, role) values ($1,null,'Rani','customer'),($2,null,'Tamu Budi','customer')", [U.cust, U.guest])
await q('insert into cafe_settings (cafe_id) values ($1) on conflict (cafe_id) do nothing', [cafe])
const latte = (await q("insert into products (cafe_id, name, price) values ($1,'Latte',28000) returning id", [cafe]))[0].id
const toast = (await q("insert into products (cafe_id, name, price) values ($1,'Roti',15500) returning id", [cafe]))[0].id
const size = (await q("insert into product_option_groups (product_id, name, selection_type, is_required, sort_order) values ($1,'Ukuran','single',true,1) returning id", [latte]))[0].id
const [regular, large] = (await q("insert into product_options (group_id, name, price_delta, is_default, sort_order) values ($1,'Regular',0,true,1),($1,'Large',6000,false,2) returning id", [size])).map((row) => row.id)
const extra = (await q("insert into product_option_groups (product_id, name, selection_type, is_required, sort_order) values ($1,'Tambahan','multiple',false,2) returning id", [latte]))[0].id
const shot = (await q("insert into product_options (group_id, name, price_delta, sort_order) values ($1,'Extra shot',5000,1) returning id", [extra]))[0].id
const table = (await q("insert into cafe_tables (cafe_id, label) values ($1,'4') returning qr_token", [cafe]))[0]
await q("insert into vouchers (cafe_id, code, name, discount_type, discount_value, max_discount, audience, per_customer_limit) values ($1,'HEMAT10','Diskon 10%','percent',10,8000,'all',50)", [cafe])
await q("insert into loyalty_accounts (cafe_id, customer_id, points_balance, lifetime_points) values ($1,$2,500,500)", [cafe, U.cust])

const fields = ['subtotal_amount', 'voucher_discount', 'points_discount', 'service_charge_amount', 'tax_amount', 'rounding_amount', 'total_amount']
async function compare(name, { user, anonymous = false, items, voucher = null, points = 0, tableToken = null, orderType = 'takeaway' }) {
  await as(user, anonymous)
  const quote = (await q('select customer_quote_order($1, $2::jsonb, $3, $4) r', [cafe, J(items), voucher, points]))[0].r
  const id = (await q("select customer_place_order($1, $2::jsonb, $3, $4, null, null, null, null, $5, $6) id", [cafe, J(items), tableToken ? 'dine_in' : orderType, tableToken, voucher, points]))[0].id
  await su()
  const order = (await q(`select ${fields.join(', ')} from orders where id = $1`, [id]))[0]
  const pairs = [['subtotal', 'subtotal_amount'], ['points_discount', 'points_discount'], ['service', 'service_charge_amount'], ['tax', 'tax_amount'], ['rounding', 'rounding_amount'], ['total', 'total_amount']]
  const diff = pairs.filter(([a, b]) => Number(quote[a]) !== Number(order[b])).map(([a, b]) => `${a} ${quote[a]} ≠ ${order[b]}`)
  if (Number(quote.voucher?.discount || 0) !== Number(order.voucher_discount)) diff.push(`voucher ${quote.voucher?.discount} ≠ ${order.voucher_discount}`)
  check(name, diff.length === 0, diff.join('; '))
  return quote
}

const items = [{ product_id: latte, quantity: 2, option_ids: [large, shot] }, { product_id: toast, quantity: 1 }]
// 1. Tanpa pajak/service
const plain = await compare('tanpa pajak: rincian = pesanan', { user: U.cust, items })
check('subtotal memakai varian (2×(28000+6000+5000)+15500)', Number(plain.subtotal) === 93500, J(plain))
// 2. Service + pajak + pembulatan
await q('update cafe_settings set service_charge_enabled = true, service_charge_rate = 5, tax_enabled = true, tax_rate = 11, tax_inclusive = false, rounding_unit = 100 where cafe_id = $1', [cafe])
const taxed = await compare('service 5% + pajak 11% + pembulatan', { user: U.cust, items })
check('total berbeda dari subtotal (pajak/service tampil)', Number(taxed.total) > Number(taxed.subtotal) && Number(taxed.service) > 0 && Number(taxed.tax) > 0, J(taxed))
// 3. Voucher + poin
await q('update cafe_settings set loyalty_enabled = true where cafe_id = $1', [cafe])
const settings = (await q('select loyalty_min_redeem, loyalty_point_value from cafe_settings where cafe_id = $1', [cafe]))[0]
const both = await compare('voucher + poin', { user: U.cust, items, voucher: 'HEMAT10', points: Math.max(settings.loyalty_min_redeem, 10) })
check('voucher maks Rp8.000 terpakai', Number(both.voucher.discount) === 8000 && both.voucher.ok === true, J(both.voucher))
// 4. Pajak termasuk harga
await q('update cafe_settings set tax_inclusive = true, service_charge_taxable = false where cafe_id = $1', [cafe])
await compare('pajak termasuk harga, service tidak kena pajak', { user: U.cust, items, voucher: 'HEMAT10' })
// 5. Varian bawaan (tanpa pilih ukuran)
const defaults = await compare('grup wajib kosong → pilihan bawaan', { user: U.cust, items: [{ product_id: latte, quantity: 1 }] })
check('harga bawaan = 28000', Number(defaults.subtotal) === 28000, J(defaults))
// 6. Tamu QR meja dengan voucher
await compare('tamu QR meja + voucher', { user: U.guest, anonymous: true, items, voucher: 'HEMAT10', tableToken: table.qr_token })

// Tamu belum punya sesi (anon) tetap bisa melihat rincian; poin ditolak dengan pesan
await as(null)
const anonQuote = (await q('select customer_quote_order($1, $2::jsonb, $3, $4) r', [cafe, J(items), 'HEMAT10', 50]))[0].r
check('tanpa sesi: rincian tersedia, poin tidak dipakai', Number(anonQuote.total) > 0 && anonQuote.points === 0 && /Masuk/.test(anonQuote.points_message || ''), J(anonQuote))
const badVoucher = (await q('select customer_quote_order($1, $2::jsonb, $3) r', [cafe, J(items), 'NGAWUR']))[0].r
check('voucher salah: diskon 0 + pesan', badVoucher.voucher.ok === false && Number(badVoucher.voucher.discount) === 0 && /tidak ditemukan/.test(badVoucher.voucher.message), J(badVoucher.voucher))

// Item habis dicatat sebagai masalah, bukan error
await su()
await q('update products set is_available = false where id = $1', [toast])
await as(U.cust)
const soldOut = (await q('select customer_quote_order($1, $2::jsonb) r', [cafe, J(items)]))[0].r
check('item habis → problems', soldOut.problems.length === 1 && /habis/.test(soldOut.problems[0].message), J(soldOut.problems))
// Harga menu berubah → rincian ikut harga terbaru
await su()
await q('update products set is_available = true, price = 17000 where id = $1', [toast])
await as(U.cust)
const repriced = (await q('select customer_quote_order($1, $2::jsonb) r', [cafe, J([{ product_id: toast, quantity: 1 }])]))[0].r
check('harga terbaru dipakai', Number(repriced.lines[0].unit_price) === 17000, J(repriced.lines))
await su()

console.log(`file 21: ${passed} lulus, ${failures.length} gagal`)
for (const failure of failures) console.log('  ✗ ' + failure)
process.exit(failures.length ? 1 : 0)
