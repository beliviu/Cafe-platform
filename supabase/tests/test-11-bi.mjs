// Uji file usulan/11 (prediksi, analitik pelanggan, paket fakta advisor, log & kuota AI)
// + Edge Function advisor (kode asli) dengan Claude palsu. Postgres lokal (PGlite) — TIDAK menyentuh database live.
// Jalankan: node --experimental-strip-types --no-warnings test-11-bi.mjs
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const ROOT = new URL('../usulan/', import.meta.url)
const usulan = (name) => fs.readFileSync(new URL(name, ROOT), 'utf8')
let passed = 0
const failures = []
const check = (name, ok, detail = '') => { if (ok) passed += 1; else failures.push(`${name}${detail !== '' ? ` → ${detail}` : ''}`) }
const J = (value) => JSON.stringify(value)
const num = Number

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

await db.exec(fs.readFileSync(new URL('./base-schema.sql', import.meta.url), 'utf8'))
await db.exec("set timezone to 'Asia/Jakarta'")
await db.exec('create role service_role nologin bypassrls; grant usage on schema public, auth to service_role;')
for (const file of ['04-owner-dashboard.sql', '05-inventori-supplier.sql', '06-pesanan-v2-pos.sql', '07-akuntansi.sql', '08-pelanggan-qr.sql', '09-payment-gateway.sql']) await db.exec(usulan(file))

const U = {
  ownerA: '00000000-0000-0000-0000-0000000000a1', staffA: '00000000-0000-0000-0000-0000000000a2',
  ownerB: '00000000-0000-0000-0000-0000000000b1', ownerC: '00000000-0000-0000-0000-0000000000d1', ownerN: '00000000-0000-0000-0000-0000000000e1',
  cust1: '00000000-0000-0000-0000-0000000000c1', cust2: '00000000-0000-0000-0000-0000000000c2',
  cust3: '00000000-0000-0000-0000-0000000000c3', cust4: '00000000-0000-0000-0000-0000000000c4',
}
for (const id of Object.values(U)) await db.query('insert into auth.users (id) values ($1)', [id])
const cafeA = (await one("insert into cafes (name) values ('Kopi A') returning id")).id
const cafeB = (await one("insert into cafes (name) values ('Kopi B') returning id")).id
const cafeC = (await one("insert into cafes (name) values ('Kopi C') returning id")).id
await db.query(`insert into profiles (id, cafe_id, full_name, role) values ($1,$2,'Owner A','owner'),($3,$2,'Staff A','staff'),($4,$5,'Owner B','owner'),
  ($6,$7,'Owner C','owner'),($8,null,'Rani','customer'),($9,null,'Bagas','customer'),($10,null,'Sinta','customer'),($11,null,'Dimas','customer')`,
  [U.ownerA, cafeA, U.staffA, U.ownerB, cafeB, U.ownerC, cafeC, U.cust1, U.cust2, U.cust3, U.cust4])
await db.exec(usulan('10-izin-langganan-keamanan.sql'))
const results = await db.exec(usulan('11-bi-analitik.sql'))
check('verifikasi 7 baris', results.at(-1).rows.length === 7, results.at(-1).rows.map((r) => r.name).join(','))
await db.exec(usulan('11-bi-analitik.sql'))
passed += 1 // aman dijalankan ulang
{
  const plans = await q("select code, features, limits from plans order by sort_order")
  const byCode = Object.fromEntries(plans.map((plan) => [plan.code, plan]))
  check('Pro & Enterprise dapat ai_advisor, Basic tidak', byCode.pro.features.includes('ai_advisor') && byCode.enterprise.features.includes('ai_advisor') && !byCode.basic.features.includes('ai_advisor'))
  check('batas AI per hari: Pro 30, Enterprise 100', byCode.pro.limits.ai_daily === 30 && byCode.enterprise.limits.ai_daily === 100, J(plans))
  check('dijalankan ulang tidak menggandakan fitur', byCode.pro.features.filter((f) => f === 'ai_advisor').length === 1)
}

// ---------- Kafe A: pola stabil 70 hari (Sen–Kam 4, Jum 6, Sab 8, Minggu tutup), semua Latte Rp28.000 ----------
await su()
const latteA = (await one("insert into products (cafe_id, name, price) values ($1,'Latte',28000) returning id", [cafeA])).id
await db.query(`
  with d as (select g::date as day from generate_series(current_date - 70, current_date - 1, interval '1 day') g),
  n as (select day, generate_series(1, case extract(isodow from day)::int when 5 then 6 when 6 then 8 when 7 then 0 else 4 end) as k from d)
  insert into orders (cafe_id, order_status, payment_status, total_amount, paid_amount, created_at, updated_at, pricing_version, customer_id)
  select $1, 'completed', 'paid', 28000, 28000, (day + time '10:00') + k * interval '5 minutes', (day + time '10:00') + k * interval '5 minutes', 2,
         case when k = 1 then $2::uuid end
  from n`, [cafeA, U.cust1])
// Dibatalkan & belum lunas: tidak dihitung
await db.query(`insert into orders (cafe_id, order_status, payment_status, total_amount, created_at, pricing_version) values
  ($1, 'cancelled', 'unpaid', 999000, current_date - 3 + time '11:00', 2), ($1, 'completed', 'unpaid', 777000, current_date - 4 + time '11:00', 2)`, [cafeA])
await db.query("insert into order_items (order_id, product_id, product_name, price, unit_price, quantity, subtotal) select id, $2, 'Latte', 28000, 28000, 1, 28000 from orders where cafe_id = $1 and total_amount = 28000", [cafeA, latteA])
check('total pesanan tetap Rp28.000 setelah item', num((await one('select count(*) n from orders where cafe_id = $1 and total_amount <> 28000 and payment_status = \'paid\'', [cafeA])).n) === 0)

const perDay = { 1: 4, 2: 4, 3: 4, 4: 4, 5: 6, 6: 8, 7: 0 }
const isoDow = (dateText) => { const day = new Date(`${dateText}T00:00:00Z`).getUTCDay(); return day === 0 ? 7 : day }
await as(U.ownerA)
const fc = (await one('select bi_sales_forecast($1, 14) f', [cafeA])).f
check('prediksi: basis ok, riwayat 56 hari', fc.basis === 'ok' && fc.history_days === 56, J({ basis: fc.basis, days: fc.history_days, reason: fc.reason }))
check('prediksi harian 14 hari', fc.daily.length === 14)
check('prediksi harian = pola hari (tepat)', fc.daily.every((row) => num(row.revenue) === perDay[isoDow(row.day)] * 28000), J(fc.daily.map((row) => [row.day, row.revenue])))
check('Minggu (tutup) diprediksi 0', fc.daily.filter((row) => isoDow(row.day) === 7).every((row) => num(row.revenue) === 0))
check('pola stabil → rentang = nilai (sigma 0)', num(fc.sigma) === 0 && fc.daily.every((row) => num(row.low) === num(row.high)))
check('uji mundur meleset 0%', num(fc.backtest_wape) === 0, fc.backtest_wape)
check('prediksi jumlah pesanan per hari', fc.daily.every((row) => num(row.orders) === perDay[isoDow(row.day)]))
check('hari ini menyertakan aktual (0, belum ada pesanan)', num(fc.daily[0].actual) === 0)
check('4 minggu & 2 bulan', fc.weekly.length === 4 && fc.monthly.length === 2)
check('minggu depan penuh = 30 pesanan × Rp28.000', num(fc.weekly[1].projection) === 840000 && num(fc.weekly[1].actual) === 0, J(fc.weekly[1]))
{
  // Minggu ini: aktual hari yang lewat + prediksi sisanya = pola penuh
  const week = fc.weekly[0]
  check('minggu ini: aktual + sisa = 840.000', num(week.actual) + num(week.forecast_rest) === 840000 && num(week.projection) === 840000, J(week))
  check('minggu lalu aktual tercatat', num(week.previous_actual) === 840000, week.previous_actual)
  check('minggu depan: pembanding kosong (minggu ini belum selesai)', fc.weekly[1].previous_actual === null, fc.weekly[1].previous_actual)
  const month = fc.monthly[0]
  check('bulan ini: proyeksi = aktual + sisa', num(month.projection) === num(month.actual) + num(month.forecast_rest), J(month))
  check('bulan depan: tanpa aktual & tanpa pembanding bulan lalu (belum selesai)', num(fc.monthly[1].actual) === 0 && fc.monthly[1].previous_month_actual === null, J(fc.monthly[1]))
  check('tahun lalu tidak ada data → null', month.last_year_actual === null)
}
{
  const last7 = fc.comparisons.find((row) => row.key === 'last_7')
  const last28 = fc.comparisons.find((row) => row.key === 'last_28')
  check('7 hari terakhir vs sebelumnya: 0%', num(last7.revenue) === 840000 && num(last7.previous_revenue) === 840000 && num(last7.change_pct) === 0, J(last7))
  check('28 hari: tidak termasuk batal & belum lunas', num(last28.revenue) === 3360000, J(last28))
}
check('riwayat grafik s/d hari ini', fc.history.at(-1).day === fc.today && fc.history.length === 29, fc.history.length)

const demand = await q('select * from bi_product_demand($1, 7)', [cafeA])
check('permintaan produk: Latte 30 per 7 hari', num(demand[0].forecast_quantity) === 30 && num(demand[0].quantity_28) === 120, J(demand[0]))
check('permintaan produk: tren 0%', num(demand[0].trend_pct) === 0 && demand[0].basis === 'ok', J(demand[0]))

// ---------- Kafe B: data kurang ----------
await su()
await db.query(`insert into orders (cafe_id, order_status, payment_status, total_amount, created_at, pricing_version)
  select $1, 'completed', 'paid', 20000, current_date - g + time '09:00', 2 from generate_series(1, 5) g`, [cafeB])
await as(U.ownerB)
const fcB = (await one('select bi_sales_forecast($1) f', [cafeB])).f
check('data kurang: tidak menebak', fcB.basis === 'data_kurang' && fcB.daily.length === 0 && /14 hari/.test(fcB.reason), J(fcB))
check('data kurang: perbandingan aktual tetap ada', fcB.comparisons.find((row) => row.key === 'last_7').revenue === 100000)
check('data kurang: permintaan produk tanpa prediksi', (await q('select basis, forecast_quantity from bi_product_demand($1)', [cafeB])).every((row) => row.basis === 'data_kurang' && row.forecast_quantity === null))

// ---------- Akses ----------
await as(U.staffA)
await fails('staff tidak bisa melihat prediksi', 'select bi_sales_forecast($1)', [cafeA], /Hanya owner/)
await fails('staff tidak bisa melihat analitik pelanggan', 'select bi_customer_analytics($1, current_date - 30, current_date)', [cafeA], /Hanya owner/)
await fails('staff tidak bisa melihat paket fakta', 'select bi_advisor_facts($1)', [cafeA], /Hanya owner/)
await as(U.ownerB)
await fails('owner kafe lain ditolak (prediksi)', 'select bi_sales_forecast($1)', [cafeA], /Hanya owner/)
await fails('owner kafe lain ditolak (pelanggan)', 'select bi_customer_analytics($1, current_date - 30, current_date)', [cafeA], /Hanya owner/)
await fails('owner kafe lain ditolak (permintaan)', 'select * from bi_product_demand($1)', [cafeA], /Hanya owner/)
await as(U.cust1)
await fails('customer ditolak', 'select bi_advisor_facts($1)', [cafeA], /Hanya owner/)
await as(null)
await fails('anonim ditolak', 'select bi_sales_forecast($1)', [cafeA], /permission denied/)
await fails('anonim tidak bisa memanggil fungsi internal', 'select * from bi_daily($1, current_date - 3, current_date)', [cafeA], /permission denied/)
await as(U.ownerA)
await fails('fungsi internal tidak untuk pengguna', 'select * from bi_daily($1, current_date - 3, current_date)', [cafeA], /permission denied/)
await fails('rentang terbalik ditolak', 'select bi_customer_analytics($1, current_date, current_date - 5)', [cafeA], /tidak valid/)

// ---------- Kafe C: penjualan turun, profit, stok, beban, pelanggan ----------
await su()
const prod = {}
for (const [key, name, price] of [['latte', 'Latte', 28000], ['crois', 'Croissant', 22000], ['teh', 'Teh', 15000], ['matcha', 'Matcha', 30000]]) {
  prod[key] = (await one('insert into products (cafe_id, name, price) values ($1,$2,$3) returning id', [cafeC, name, price])).id
}
await as(U.ownerC)
const ing = {}
for (const [key, name, unit, min] of [['milk', 'Susu', 'ml', 1000], ['coffee', 'Kopi', 'g', 500], ['butter', 'Mentega', 'g', 500], ['matcha', 'Bubuk matcha', 'g', 100]]) {
  ing[key] = (await one('insert into ingredients (cafe_id, name, unit, min_stock) values ($1,$2,$3,$4) returning id', [cafeC, name, unit, min])).id
}
for (const [key, qty, cost] of [['milk', 50000, 20], ['coffee', 10000, 200], ['butter', 100, 150], ['matcha', 1000, 1500]]) {
  await q('select inventory_stock_in($1, $2, $3, null, null, null, true)', [ing[key], qty, cost])
}
await su()
for (const [product, ingredient, qty] of [['latte', 'milk', 150], ['latte', 'coffee', 18], ['crois', 'butter', 30], ['matcha', 'matcha', 10], ['matcha', 'milk', 150]]) {
  await db.query('insert into recipe_items (cafe_id, product_id, ingredient_id, quantity) values ($1,$2,$3,$4)', [cafeC, prod[product], ing[ingredient], qty])
}
const PRICE = { latte: 28000, crois: 22000, teh: 15000, matcha: 30000 }
async function sale(dayAgo, minute, product, customer = null) {
  const id = (await one(`insert into orders (cafe_id, order_status, payment_status, total_amount, paid_amount, created_at, updated_at, pricing_version, customer_id)
    values ($1, 'completed', 'paid', $2, $2, current_date - $3::int + time '09:00' + $4 * interval '1 minute', current_date - $3::int + time '09:00' + $4 * interval '1 minute', 2, $5) returning id`,
  [cafeC, PRICE[product], dayAgo, minute, customer])).id
  await db.query('insert into order_items (order_id, product_id, product_name, price, unit_price, quantity, subtotal) values ($1,$2,$3,$4,$4,1,$4)',
    [id, prod[product], { latte: 'Latte', crois: 'Croissant', teh: 'Teh', matcha: 'Matcha' }[product], PRICE[product]])
}
// Periode lalu (P) = 20..14 hari lalu: 5 Latte, 3 Croissant, 2 Teh / hari. Periode ini (C) = 13..7 hari lalu: 3 Latte, 3 Croissant, 2 Teh, 1 Matcha.
for (let day = 0; day < 7; day += 1) {
  const p = 20 - day
  const c = 13 - day
  let m = 0
  for (let i = 0; i < 5; i += 1) await sale(p, (m += 1), 'latte', i === 0 && day === 0 ? U.cust1 : i === 0 && day === 3 ? U.cust2 : null)
  for (let i = 0; i < 3; i += 1) await sale(p, (m += 1), 'crois')
  for (let i = 0; i < 2; i += 1) await sale(p, (m += 1), 'teh')
  m = 0
  for (let i = 0; i < 3; i += 1) await sale(c, (m += 1), 'latte', i === 0 && (day === 0 || day === 2) ? U.cust1 : i === 0 && day === 5 ? U.cust3 : null)
  for (let i = 0; i < 3; i += 1) await sale(c, (m += 1), 'crois')
  for (let i = 0; i < 2; i += 1) await sale(c, (m += 1), 'teh')
  await sale(c, (m += 1), 'matcha')
}
await sale(45, 1, 'teh', U.cust4) // pelanggan lama, tidak aktif
// Beban (file 07): pembukuan mulai 25 hari lalu
await as(U.ownerC)
await q('select acc_setup($1, current_date - 25, $2::jsonb)', [cafeC, J([{ code: '1-1100', amount: 5000000 }, { code: '3-1000', amount: 5000000 }])])
const acct = async (code) => (await one('select id from accounts where cafe_id = $1 and code = $2', [cafeC, code])).id
const listrik = await acct('6-1200')
const sewa = await acct('6-1100')
await q("select expense_create($1, current_date - 17, $2, 'Listrik Oktober', 300000, 'cash')", [cafeC, listrik])
await q("select expense_create($1, current_date - 10, $2, 'Listrik November', 450000, 'cash')", [cafeC, listrik])
await q("select expense_create($1, current_date - 9, $2, 'Sewa November', 1000000, 'bank_transfer')", [cafeC, sewa])

const facts = (await one('select bi_advisor_facts($1, current_date - 13, current_date - 7) f', [cafeC])).f
{
  const rev = facts.revenue
  check('fakta: periode & pembanding sama panjang', facts.period.days === 7 && rev.comparison === 'previous_equal_period' && facts.period.partial_today === false, J(facts.period))
  check('fakta: penjualan ini 1.470.000 vs lalu 1.652.000', num(rev.current.revenue) === 1470000 && num(rev.previous.revenue) === 1652000, J([rev.current.revenue, rev.previous.revenue]))
  check('fakta: perubahan −182.000 (−11,0%)', num(rev.change) === -182000 && num(rev.change_pct) === -11, J([rev.change, rev.change_pct]))
  check('fakta: efek pesanan + efek keranjang = perubahan', num(rev.effect_orders) + num(rev.effect_basket) === num(rev.change) && num(rev.effect_orders) === -165200, J([rev.effect_orders, rev.effect_basket]))
  check('fakta: produk turun terbesar = Latte −392.000', rev.products.decreases[0].name === 'Latte' && num(rev.products.decreases[0].change) === -392000, J(rev.products.decreases))
  check('fakta: produk naik = Matcha +210.000', rev.products.increases[0].name === 'Matcha' && num(rev.products.increases[0].change) === 210000, J(rev.products.increases))
  check('fakta: kanal app 63 vs 70 pesanan', rev.by_channel[0].channel === 'app' && num(rev.by_channel[0].current_orders) === 63 && num(rev.by_channel[0].previous_orders) === 70, J(rev.by_channel))
  check('fakta: per hari 7 baris', rev.by_weekday.length === 7)

  const profit = facts.profit
  const top = Object.fromEntries(profit.top_profit.map((row) => [row.name, row]))
  check('profit: Latte estimasi HPP 6.600 → laba 449.400, margin 76,4%', num(top.Latte?.gross_profit) === 449400 && num(top.Latte?.margin_pct) === 76.4 && top.Latte?.basis === 'estimasi', J(top.Latte))
  check('profit: Matcha margin 40%', num(top.Matcha?.margin_pct) === 40, J(top.Matcha))
  check('profit: margin tertinggi Croissant', profit.top_margin[0].name === 'Croissant' && num(profit.top_margin[0].margin_pct) === 79.5, J(profit.top_margin))
  check('profit: margin terendah Matcha', profit.low_margin[0].name === 'Matcha', J(profit.low_margin))
  check('profit: Teh tanpa resep tidak diberi margin palsu', profit.without_recipe.includes('Teh') && !profit.top_profit.some((row) => row.name === 'Teh'), J(profit.without_recipe))
  check('profit: total laba hanya produk ber-HPP', num(profit.totals.gross_profit) === 449400 + 21 * 17500 + 7 * 12000 && num(profit.totals.revenue_without_recipe) === 14 * 15000, J(profit.totals))

  check('stok: mentega di bawah minimum', facts.stock.low.length === 1 && facts.stock.low[0].name === 'Mentega' && facts.stock.low[0].below_minimum === true, J(facts.stock))
  check('stok: basis estimasi (pelacakan mati)', facts.stock.basis === 'estimasi', facts.stock.basis)

  const exp = facts.expenses
  const listrikRow = exp.by_account?.find((row) => row.account === 'Listrik, air & gas')
  check('beban: listrik naik 150.000 (50%)', num(listrikRow?.change) === 150000 && num(listrikRow?.change_pct) === 50, J(exp.by_account))
  check('beban: total 1.450.000 vs 300.000, terbesar sewa', num(exp.total) === 1450000 && num(exp.previous_total) === 300000 && exp.by_account[0].account === 'Sewa tempat', J(exp))
  check('beban: pembelian bahan di luar periode = 0', num(exp.purchases) === 0 && num(exp.previous_purchases) === 0, J([exp.purchases, exp.previous_purchases]))

  const promo = facts.promote
  check('promosi: Croissant lalu Latte (margin tinggi, terjual ≤ median / turun)', promo.basis === 'ok' && J(promo.candidates.map((row) => row.name)) === J(['Croissant', 'Latte']), J(promo))
  check('promosi: alasan Latte termasuk penjualan turun', promo.candidates[1]?.reasons.includes('penjualan_turun'), J(promo.candidates[1]))
  check('promosi: rating ikut bila ulasan ada (file 08)', 'rating' in (promo.candidates[0] || {}), J(promo.candidates[0]))

  const cs = facts.customers
  check('pelanggan: 2 pelanggan, 1 baru, 1 kembali', num(cs.summary.customers) === 2 && num(cs.summary.new_customers) === 1 && num(cs.summary.returning_customers) === 1, J(cs.summary))
  check('pelanggan: retensi 50% (1 dari 2)', num(cs.retention.previous_customers) === 2 && num(cs.retention.retained) === 1 && num(cs.retention.rate_pct) === 50, J(cs.retention))
  check('pelanggan (untuk AI): tanpa daftar nama', cs.inactive.people === null && !J(facts).includes('Dimas') && !J(facts).includes('Rani'), J(cs.inactive))
  check('kualitas data: 1 produk tanpa resep, pelacakan mati, go-live tercatat', facts.data_quality.products_without_recipe === 1 && facts.data_quality.inventory_tracking === false && facts.data_quality.accounting_go_live, J(facts.data_quality))
}
{
  // Bulan berjalan: pembanding = tanggal yang sama bulan lalu
  const mtd = (await one("select bi_advisor_facts($1) f", [cafeC])).f
  check('default: bulan ini s/d hari ini, pembanding bulan lalu', mtd.revenue.comparison === 'same_days_previous_month' && mtd.period.partial_today === true, J(mtd.period))
}
{
  const ca = (await one('select bi_customer_analytics($1, current_date - 13, current_date - 7) c', [cafeC])).c
  check('analitik: frekuensi 1×:1, 2–3×:1', ca.frequency.find((row) => row.bucket === '1').customers === 1 && ca.frequency.find((row) => row.bucket === '2-3').customers === 1, J(ca.frequency))
  check('analitik: pesanan tanpa akun 60 dari 63', ca.summary.guest_orders === 60 && ca.summary.account_orders === 3, J(ca.summary))
  check('analitik: tidak aktif 30–59 hari = 1 (Dimas)', ca.inactive.d30_59 === 1 && ca.inactive.people.length === 1 && ca.inactive.people[0].full_name === 'Dimas' && ca.inactive.people[0].days_since === 45, J(ca.inactive))
  check('analitik: produk favorit pelanggan ber-akun = Latte, 2 pembeli, 1 pembeli ulang', ca.products[0].name === 'Latte' && ca.products[0].buyers === 2 && ca.products[0].repeat_buyers === 1, J(ca.products))
  check('analitik: kohort per bulan pertama', Array.isArray(ca.cohorts) && ca.cohorts.reduce((sum, row) => sum + row.size, 0) === 4, J(ca.cohorts))
  check('analitik: median jarak antar-pesanan', ca.interval.customers >= 1 && ca.interval.median_days > 0, J(ca.interval))
}

// ---------- Log & kuota AI ----------
await as(U.ownerC)
let quota = (await one('select bi_advisor_quota($1) q', [cafeC])).q
check('kafe lama (Enterprise): AI boleh, 100/hari', quota.allowed === true && quota.limit === 100 && quota.remaining === 100, J(quota))
await fails('owner tidak bisa menulis log langsung', "insert into ai_advisor_logs (cafe_id, question) values ($1, 'Halo apa kabar')", [cafeC], /permission denied/)
await q("select bi_advisor_log($1, 'Kenapa omzet turun?', 'Karena pesanan turun.', 'answered', 'claude-opus-5-5', 1200, 300, current_date - 13, current_date - 7)", [cafeC])
await q("select bi_advisor_log($1, 'Gagal', null, 'error', 'claude-opus-5-5', null, null, null, null)", [cafeC])
quota = (await one('select bi_advisor_quota($1) q', [cafeC])).q
check('kuota berkurang 1 (error tidak dihitung)', quota.used === 1 && quota.remaining === 99, J(quota))
check('owner melihat log kafenya', (await q('select * from ai_advisor_logs where cafe_id = $1', [cafeC])).length === 2)
await as(U.ownerB)
check('owner kafe lain tidak melihat log', (await q('select * from ai_advisor_logs where cafe_id = $1', [cafeC])).length === 0)
await fails('owner kafe lain tidak bisa menulis log', "select bi_advisor_log($1, 'Tes tes', null, 'answered', null, null, null, null, null)", [cafeC], /Hanya owner/)
await as(U.staffA)
await fails('staff tidak bisa cek kuota', 'select bi_advisor_quota($1)', [cafeA], /Hanya owner/)
await as(null)
await fails('anonim tidak bisa membaca log', 'select * from ai_advisor_logs', [], /permission denied/)

// Kafe baru (setelah file 10) = Pro coba → 30/hari; Basic → tidak boleh
await su()
const cafeN = (await one("insert into cafes (name) values ('Kopi Baru') returning id")).id
await db.query("insert into profiles (id, cafe_id, full_name, role) values ($1,$2,'Owner N','owner')", [U.ownerN, cafeN])
await as(U.ownerN)
check('kafe baru (Pro coba): 30/hari', (await one('select bi_advisor_quota($1) q', [cafeN])).q.limit === 30)
await su()
await db.exec('set role service_role')
await db.query("select subscription_set($1, 'basic', 'active')", [cafeN])
await as(U.ownerN)
check('paket Basic: AI tidak boleh', (await one('select bi_advisor_quota($1) q', [cafeN])).q.allowed === false)
check('paket Basic: prediksi tetap bisa', (await one('select bi_sales_forecast($1) f', [cafeN])).f.basis === 'data_kurang')

// ---------- Edge Function advisor (kode asli, Claude palsu) ----------
const TOKENS = { 'tok-ownerC': U.ownerC, 'tok-ownerB': U.ownerB, 'tok-staffA': U.staffA, 'tok-ownerN': U.ownerN }
const claudeCalls = []
let claudeMode = 'ok'
class FakeAPIError extends Error { constructor(status, message) { super(message); this.status = status } }
class FakeRateLimitError extends FakeAPIError {}
class FakeAuthenticationError extends FakeAPIError {}
class FakePermissionDeniedError extends FakeAPIError {}
class FakeBadRequestError extends FakeAPIError {}
class FakeAnthropic {
  constructor(options) { this.options = options }
  beta = {
    messages: {
      create: async (params) => {
        claudeCalls.push({ params, options: this.options })
        if (claudeMode === 'rate') throw new FakeRateLimitError(429, 'rate limited')
        if (claudeMode === 'auth') throw new FakeAuthenticationError(401, 'bad key')
        if (claudeMode === 'refusal') return { model: params.model, stop_reason: 'refusal', content: [], usage: { input_tokens: 900, output_tokens: 0 } }
        return {
          model: params.model, stop_reason: 'end_turn',
          content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Penjualan turun Rp182.000 (−11,0%) terutama karena jumlah pesanan turun.' }],
          usage: { input_tokens: 4200, output_tokens: 180, cache_read_input_tokens: 0 },
        }
      },
    },
  }
}
Object.assign(FakeAnthropic, { APIError: FakeAPIError, RateLimitError: FakeRateLimitError, AuthenticationError: FakeAuthenticationError, PermissionDeniedError: FakePermissionDeniedError, BadRequestError: FakeBadRequestError })

globalThis.__stub = {
  Anthropic: FakeAnthropic,
  createClient: (_url, _key, options = {}) => {
    const token = (options.global?.headers?.Authorization || '').replace('Bearer ', '')
    const userId = TOKENS[token]
    return {
      auth: { getUser: async () => (userId ? { data: { user: { id: userId } }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } }) },
      rpc: async (name, args = {}) => {
        const keys = Object.keys(args)
        const values = keys.map((key) => (args[key] !== null && typeof args[key] === 'object' ? JSON.stringify(args[key]) : args[key]))
        try {
          await as(userId)
          return { data: (await db.query(`select public.${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(', ')}) as r`, values)).rows[0].r, error: null }
        } catch (error) {
          return { data: null, error: { message: error.message } }
        } finally {
          await db.exec('reset role')
        }
      },
    }
  },
}
const ENV = { SUPABASE_URL: 'http://local', SUPABASE_ANON_KEY: 'anon', ANTHROPIC_API_KEY: 'sk-test' }
let handler
globalThis.Deno = { env: { get: (key) => ENV[key] }, serve: (fn) => { handler = fn } }
const source = fs.readFileSync(new URL('../functions/advisor/index.ts', import.meta.url), 'utf8')
  .replace("import { createClient } from 'npm:@supabase/supabase-js@2.49.1'", 'const { createClient } = (globalThis as any).__stub')
  .replace("import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0'", 'const Anthropic = (globalThis as any).__stub.Anthropic')
check('stub import terpasang', !source.includes('npm:'))
const tmp = new URL('./.tmp-advisor-fn.ts', import.meta.url)
fs.writeFileSync(tmp, source)
await import(pathToFileURL(tmp.pathname.replace(/^\/([A-Za-z]:)/, '$1')).href)
fs.unlinkSync(tmp)

const call = async (token, body) => {
  const response = await handler(new Request('http://local/functions/v1/advisor', { method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  return { status: response.status, body: await response.json().catch(() => null) }
}
const logCount = async () => { await su(); return num((await one('select count(*) n from ai_advisor_logs where cafe_id = $1', [cafeC])).n) }

{
  const before = await logCount()
  const ok = await call('tok-ownerC', { cafe_id: cafeC, question: 'Kenapa omzet minggu itu turun?', from: '2099-01-01', to: '2099-01-31' })
  check('advisor: rentang tidak valid ditolak database', ok.status === 400 && /tidak valid/.test(ok.body.error), J(ok))
  const ans = await call('tok-ownerC', { cafe_id: cafeC, question: 'Kenapa omzet minggu itu turun?' })
  check('advisor: owner mendapat jawaban', ans.status === 200 && /Rp182\.000/.test(ans.body.answer) && ans.body.model === 'claude-opus-5-5', J(ans))
  check('advisor: sisa kuota dilaporkan', ans.body.remaining === 98, ans.body.remaining)
  const params = claudeCalls.at(-1).params
  check('advisor: model, effort, fallback, cache system prompt', params.model === 'claude-opus-5-5' && params.output_config.effort === 'medium' && params.fallbacks === 'default'
    && params.betas.includes('server-side-fallback-2026-07-01') && params.system[0].cache_control.type === 'ephemeral', J({ ...params, messages: undefined }))
  const content = params.messages[0].content
  check('advisor: data kafe dikirim dari database (angka asli)', content.includes('<DATA_KAFE>') && content.includes('"revenue"') && content.includes('Kenapa omzet minggu itu turun?'))
  check('advisor: tidak ada nama pelanggan ke AI', !/Dimas|Rani|Bagas|Sinta/.test(content))
  check('advisor: tidak memakai temperature (ditolak model baru)', !('temperature' in params) && !('thinking' in params))
  check('advisor: kunci API dari secret', claudeCalls.at(-1).options.apiKey === 'sk-test')
  check('advisor: jawaban & token dicatat', (await logCount()) === before + 1)
  await su()
  const last = await one('select * from ai_advisor_logs where cafe_id = $1 order by created_at desc limit 1', [cafeC])
  check('advisor: log berisi token & periode', last.status === 'answered' && last.input_tokens === 4200 && last.output_tokens === 180 && last.period_from !== null, J(last))
}
{
  check('advisor: tanpa token ditolak', (await call(null, { cafe_id: cafeC, question: 'Halo halo' })).status === 401)
  check('advisor: token palsu ditolak', (await call('tok-palsu', { cafe_id: cafeC, question: 'Halo halo' })).status === 401)
  const other = await call('tok-ownerB', { cafe_id: cafeC, question: 'Berapa omzet kafe C?' })
  check('advisor: owner kafe lain ditolak, AI tidak dipanggil', other.status === 403 && claudeCalls.length === 1, J(other))
  const staff = await call('tok-staffA', { cafe_id: cafeA, question: 'Berapa omzet?' })
  check('advisor: staff ditolak', staff.status === 403, J(staff))
  const basic = await call('tok-ownerN', { cafe_id: cafeN, question: 'Berapa omzet?' })
  check('advisor: paket Basic ditolak dengan pesan upgrade', basic.status === 403 && basic.body.hint === 'plan_feature', J(basic))
  check('advisor: pertanyaan kosong ditolak', (await call('tok-ownerC', { cafe_id: cafeC, question: ' ' })).status === 400)
  check('advisor: pertanyaan > 500 karakter ditolak', (await call('tok-ownerC', { cafe_id: cafeC, question: 'a'.repeat(501) })).status === 400)
}
{
  claudeMode = 'refusal'
  const refused = await call('tok-ownerC', { cafe_id: cafeC, question: 'Pertanyaan yang ditolak' })
  check('advisor: penolakan AI ditangani', refused.status === 422 && refused.body.hint === 'ai_refused', J(refused))
  claudeMode = 'rate'
  const busy = await call('tok-ownerC', { cafe_id: cafeC, question: 'Kenapa omzet turun?' })
  check('advisor: rate limit → 503 sibuk', busy.status === 503 && busy.body.hint === 'ai_busy', J(busy))
  claudeMode = 'auth'
  const badKey = await call('tok-ownerC', { cafe_id: cafeC, question: 'Kenapa omzet turun?' })
  check('advisor: kunci salah → 502', badKey.status === 502 && badKey.body.hint === 'ai_key_invalid', J(badKey))
  await su()
  const statuses = (await q('select status from ai_advisor_logs where cafe_id = $1 order by created_at', [cafeC])).map((row) => row.status)
  check('advisor: penolakan & error tercatat', statuses.filter((s) => s === 'refused').length === 1 && statuses.filter((s) => s === 'error').length === 3, J(statuses))
  claudeMode = 'ok'
  delete ENV.ANTHROPIC_API_KEY
  const off = await call('tok-ownerC', { cafe_id: cafeC, question: 'Kenapa omzet turun?' })
  check('advisor: tanpa ANTHROPIC_API_KEY → 503 ai_not_configured', off.status === 503 && off.body.hint === 'ai_not_configured', J(off))
  ENV.ANTHROPIC_API_KEY = 'sk-test'
}
{
  // Kuota habis
  await su()
  await db.query("insert into ai_advisor_logs (cafe_id, question, status) select $1, 'isi kuota', 'answered' from generate_series(1, 120)", [cafeC])
  const callsBefore = claudeCalls.length
  const limited = await call('tok-ownerC', { cafe_id: cafeC, question: 'Kenapa omzet turun?' })
  check('advisor: kuota habis → 429, AI tidak dipanggil', limited.status === 429 && limited.body.hint === 'quota' && claudeCalls.length === callsBefore, J(limited))
}

// Isolasi: tabel baru punya RLS
await su()
check('ai_advisor_logs memakai RLS', (await one("select relrowsecurity r from pg_class where relname = 'ai_advisor_logs'")).r === true)

console.log(`\n${passed} lulus, ${failures.length} gagal`)
if (failures.length) {
  for (const failure of failures) console.log(`  ✗ ${failure}`)
  process.exit(1)
}
