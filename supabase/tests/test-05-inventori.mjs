// Uji file usulan/05 di Postgres lokal dalam memori (PGlite). TIDAK menyentuh database live.
// Jalankan: cd supabase/tests && npm install && npm test
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'

const ROOT = new URL('../usulan/', import.meta.url)
const db = new PGlite()
let passed = 0
const failures = []

function check(name, condition, detail = '') {
  if (condition) passed += 1
  else failures.push(`${name}${detail ? ` → ${detail}` : ''}`)
}
async function su() {
  await db.exec('reset role')
}
async function as(userId) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ''])
  await db.exec(userId ? 'set role authenticated' : 'set role anon')
}
async function q(sql, params = []) {
  return (await db.query(sql, params)).rows
}
async function one(sql, params = []) {
  return (await q(sql, params))[0]
}
async function fails(name, sql, params, pattern) {
  try {
    await db.query(sql, params)
    failures.push(`${name} → seharusnya gagal tetapi berhasil`)
  } catch (error) {
    if (pattern && !pattern.test(error.message)) failures.push(`${name} → pesan tidak sesuai: ${error.message}`)
    else passed += 1
  }
}
const num = (value) => Number(value)

const usulan = (name) => fs.readFileSync(new URL(name, ROOT), 'utf8')
await db.exec(fs.readFileSync(new URL('./base-schema.sql', import.meta.url), 'utf8'))
await db.exec("set timezone to 'Asia/Jakarta'") // current_date di tes = tanggal WIB (sama dengan kode)
await db.exec(usulan('04-owner-dashboard.sql'))
const results = await db.exec(usulan('05-inventori-supplier.sql'))
const verify = results.at(-1).rows
check('verifikasi 26 baris', verify.length === 26, `dapat ${verify.length}: ${verify.map((r) => r.name).join(',')}`)

// Jalankan ulang file 05: harus aman (idempoten)
await db.exec(usulan('05-inventori-supplier.sql'))
passed += 1

// ---------- Data dasar ----------
const U = {
  ownerA: '00000000-0000-0000-0000-00000000000a',
  staffA: '00000000-0000-0000-0000-00000000005a',
  ownerB: '00000000-0000-0000-0000-00000000000b',
  customer: '00000000-0000-0000-0000-0000000000cc',
}
await su()
for (const id of Object.values(U)) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${id.slice(-2)}@x.id`])
const cafeA = (await one("insert into cafes (name) values ('Kopi A') returning id")).id
const cafeB = (await one("insert into cafes (name) values ('Kopi B') returning id")).id
await db.query("insert into profiles (id, cafe_id, full_name, role) values ($1,$2,'Owner A','owner'),($3,$2,'Staff A','staff'),($4,$5,'Owner B','owner'),($6,null,'Cust','customer')",
  [U.ownerA, cafeA, U.staffA, U.ownerB, cafeB, U.customer])
check('cafe_settings otomatis untuk kafe baru', (await one('select count(*)::int c from cafe_settings where cafe_id in ($1,$2)', [cafeA, cafeB])).c === 2)
const latte = (await one("insert into products (cafe_id, name, price) values ($1,'Es Kopi Susu',28000) returning id", [cafeA])).id
const croissant = (await one("insert into products (cafe_id, name, price) values ($1,'Croissant',25000) returning id", [cafeA])).id
const productB = (await one("insert into products (cafe_id, name, price) values ($1,'Teh B',15000) returning id", [cafeB])).id

// ---------- Master data oleh owner A ----------
await as(U.ownerA)
const supplier = (await one("insert into suppliers (cafe_id, name, payment_terms_days) values ($1,'Susu Segar Jaya',14) returning id", [cafeA])).id
const ing = {}
for (const [key, name, unit] of [['espresso', 'Biji kopi', 'g'], ['milk', 'Susu segar', 'ml'], ['cup', 'Cup 16oz', 'pcs']]) {
  ing[key] = (await one('insert into ingredients (cafe_id, name, unit, min_stock, default_supplier_id) values ($1,$2,$3,$4,$5) returning id',
    [cafeA, name, unit, key === 'milk' ? 2000 : 10, key === 'milk' ? supplier : null])).id
}
await fails('klien tidak bisa mengisi on_hand saat insert', 'insert into ingredients (cafe_id, name, unit, on_hand) values ($1,$2,$3,$4)', [cafeA, 'Curang', 'g', 999], /permission denied/)
await fails('klien tidak bisa ubah on_hand langsung', 'update ingredients set on_hand = 5 where id = $1', [ing.cup], /permission denied/)
await fails('nama bahan ganda ditolak', 'insert into ingredients (cafe_id, name, unit) values ($1,$2,$3)', [cafeA, ' susu SEGAR', 'ml'], /duplicate|unique/)

// ---------- Stok awal & pembelian, harga rata-rata ----------
await q('select inventory_stock_in($1, 1000, 300, null, null, $2, true)', [ing.espresso, 'stok awal'])
await q("select inventory_stock_in($1, 5000, 20, (current_date + 10), null, 'stok awal', true)", [ing.milk])
await q("select inventory_stock_in($1, 100, 1000, null, null, 'stok awal', true)", [ing.cup])
await q("select inventory_stock_in($1, 2000, 25, (current_date + 3), $2, 'beli pasar')", [ing.milk, supplier])
let milk = await one('select on_hand, avg_cost from ingredients where id = $1', [ing.milk])
check('saldo susu 7000', num(milk.on_hand) === 7000, milk.on_hand)
check('harga rata-rata tertimbang 21.4286', num(milk.avg_cost) === 21.4286, milk.avg_cost)
check('2 batch kedaluwarsa', (await one('select count(*)::int c from ingredient_batches where ingredient_id = $1', [ing.milk])).c === 2)
await fails('stok masuk 0 ditolak', 'select inventory_stock_in($1, 0, 10)', [ing.cup], /lebih dari 0/)
await fails('harga minus ditolak', 'select inventory_stock_in($1, 5, -1)', [ing.cup], /Harga per satuan/)

// ---------- Varian & resep ----------
const group = (await one("insert into product_option_groups (product_id, name) values ($1,'Ukuran') returning id", [latte])).id
const large = (await one("insert into product_options (group_id, name, price_delta) values ($1,'Large',5000) returning id", [group])).id
const recipe = [
  { ingredient_id: ing.espresso, quantity: 18 },
  { ingredient_id: ing.milk, quantity: 150 },
  { ingredient_id: ing.cup, quantity: 1 },
  { ingredient_id: ing.milk, quantity: 50, option_id: large },
]
check('resep tersimpan 4 baris', (await one('select recipe_save($1, $2::jsonb) as n', [latte, JSON.stringify(recipe)])).n === 4)
await fails('bahan ganda di resep ditolak', 'select recipe_save($1, $2::jsonb)', [latte, JSON.stringify([...recipe, { ingredient_id: ing.cup, quantity: 2 }])], /dua kali/)
check('resep lama utuh setelah gagal', (await one('select count(*)::int c from recipe_items where product_id = $1', [latte])).c === 4)
await fails('takaran 0 ditolak', 'select recipe_save($1, $2::jsonb)', [latte, JSON.stringify([{ ingredient_id: ing.cup, quantity: 0 }])], /lebih dari 0/)

const costing = await q('select * from inventory_product_costing($1)', [cafeA])
const latteCost = costing.find((row) => row.product_id === latte)
check('HPP latte 9614.29', num(latteCost.cost_per_portion) === 9614.29, latteCost.cost_per_portion)
check('margin latte 65.7%', num(latteCost.margin_pct) === 65.7, latteCost.margin_pct)
check('porsi tersedia latte 46 (dibatasi susu)', num(latteCost.portions_available) === 46 && latteCost.limiting_ingredient === 'Susu segar',
  `${latteCost.portions_available} ${latteCost.limiting_ingredient}`)
check('croissant tanpa resep', costing.find((row) => row.product_id === croissant).recipe_lines === 0)

// ---------- Pesanan selesai → pemakaian bahan ----------
async function makeOrder(items, { status = 'ready', createdAt = null } = {}) {
  await su()
  const order = (await one(`insert into orders (cafe_id, order_status, total_amount, created_at)
    values ($1, $2, 0, coalesce($3::timestamptz, now())) returning id`, [cafeA, status, createdAt])).id
  for (const [productId, name, price, qty] of items) {
    await db.query('insert into order_items (cafe_id, order_id, product_id, product_name, price, quantity, subtotal) values ($1,$2,$3,$4,$5,$6,$7)',
      [cafeA, order, productId, name, price, qty, price * qty])
  }
  return order
}
const order1 = await makeOrder([[latte, 'Es Kopi Susu', 28000, 2], [croissant, 'Croissant', 25000, 1]])
await as(U.staffA)
await q("update orders set order_status = 'completed' where id = $1", [order1])
await su()
check('tanpa pelacakan: tidak ada pemakaian', (await one('select count(*)::int c from stock_movements where order_id = $1', [order1])).c === 0)

await as(U.ownerA)
await q('select inventory_set_tracking($1, true)', [cafeA])
const order2 = await makeOrder([[latte, 'Es Kopi Susu', 28000, 2], [croissant, 'Croissant', 25000, 1]])
await as(U.staffA)
await q("update orders set order_status = 'completed' where id = $1", [order2])
await su()
const sales = await q("select ingredient_id, quantity from stock_movements where order_id = $1 and movement_type = 'sale'", [order2])
check('3 baris pemakaian', sales.length === 3, sales.length)
check('biji kopi −36', num(sales.find((s) => s.ingredient_id === ing.espresso).quantity) === -36)
check('susu −300', num(sales.find((s) => s.ingredient_id === ing.milk).quantity) === -300)
check('pemakaian idempoten', (await one('select inv_consume_order($1) n', [order2])).n === 0)
const milkBatches = await q('select remaining from ingredient_batches where ingredient_id = $1 order by expires_at', [ing.milk])
check('batch tercepat kedaluwarsa dipakai dulu (FEFO)', num(milkBatches[0].remaining) === 1700 && num(milkBatches[1].remaining) === 5000,
  milkBatches.map((b) => b.remaining).join('/'))

// Stok boleh minus dari pesanan (pesanan tidak terhalang)
const orderBig = await makeOrder([[latte, 'Es Kopi Susu', 28000, 120]])
await as(U.staffA)
await q("update orders set order_status = 'completed' where id = $1", [orderBig])
await su()
check('cup minus setelah pesanan besar', num((await one('select on_hand from ingredients where id = $1', [ing.cup])).on_hand) === -22)
check('pesanan besar tetap selesai', (await one('select order_status from orders where id = $1', [orderBig])).order_status === 'completed')

// Kegagalan pencatatan stok tidak menggagalkan pesanan
await db.exec(`create function test_fail() returns trigger language plpgsql as $$ begin raise exception 'simulasi gagal'; end $$;
  create trigger test_fail before insert on stock_movements for each row when (new.movement_type = 'sale') execute function test_fail();`)
const orderFail = await makeOrder([[latte, 'Es Kopi Susu', 28000, 1]])
await as(U.staffA)
await q("update orders set order_status = 'completed' where id = $1", [orderFail])
await su()
check('pesanan tetap selesai saat stok gagal', (await one('select order_status from orders where id = $1', [orderFail])).order_status === 'completed')
check('kegagalan tercatat', (await one('select count(*)::int c from inventory_sync_issues where order_id = $1', [orderFail])).c === 1)
check('tidak ada mutasi setengah jadi', (await one('select count(*)::int c from stock_movements where order_id = $1', [orderFail])).c === 0)
await db.exec('drop trigger test_fail on stock_movements; drop function test_fail();')

// ---------- Stok keluar, penyesuaian, opname ----------
await as(U.ownerA)
await fails('stok keluar melebihi stok ditolak', "select inventory_stock_out($1, 1, 'waste')", [ing.cup], /tidak cukup/)
await q("select inventory_stock_in($1, 20000, 22, null, $2, 'isi ulang')", [ing.milk, supplier])
check('stok minus diisi: harga rata-rata = harga baru', num((await one('select avg_cost from ingredients where id = $1', [ing.milk])).avg_cost) === 22)
const milkBeforeOut = num((await one('select on_hand from ingredients where id = $1', [ing.milk])).on_hand)
await q("select inventory_stock_out($1, 100, 'expired', 'basi')", [ing.milk])
check('stok keluar mengurangi 100', num((await one('select on_hand from ingredients where id = $1', [ing.milk])).on_hand) === milkBeforeOut - 100)
const balanceOk = await one(`select bool_and(i.on_hand = coalesce(m.total, 0)) ok from ingredients i
  left join (select ingredient_id, sum(quantity) total from stock_movements group by ingredient_id) m on m.ingredient_id = i.id
  where i.cafe_id = $1`, [cafeA])
check('saldo bahan = jumlah semua mutasi', balanceOk.ok === true)
await fails('penyesuaian tanpa alasan ditolak', "select inventory_adjust($1, 50, '')", [ing.cup], /alasan/)
await q("select inventory_adjust($1, 50, 'hitung ulang cup')", [ing.cup])
check('cup jadi 50', num((await one('select on_hand from ingredients where id = $1', [ing.cup])).on_hand) === 50)
const espressoBefore = num((await one('select on_hand from ingredients where id = $1', [ing.milk])).on_hand)
const countId = (await one('select inventory_post_count($1, $2::jsonb, $3) id', [cafeA,
  JSON.stringify([{ ingredient_id: ing.milk, counted: espressoBefore }, { ingredient_id: ing.cup, counted: 47 }]), 'opname mingguan'])).id
const countMoves = await q('select ingredient_id, quantity from stock_movements where stock_count_id = $1', [countId])
check('opname: hanya selisih yang jadi mutasi', countMoves.length === 1 && num(countMoves[0].quantity) === -3, JSON.stringify(countMoves))
const countRow = await one('select line_count, difference_value from stock_counts where id = $1', [countId])
check('opname: 2 baris, nilai selisih −3000', countRow.line_count === 2 && num(countRow.difference_value) === -3000, JSON.stringify(countRow))
await fails('opname angka minus ditolak', 'select inventory_post_count($1, $2::jsonb)', [cafeA, JSON.stringify([{ ingredient_id: ing.cup, counted: -1 }])], /minus/)

// ---------- Purchase order ----------
const poItems = [{ ingredient_id: ing.milk, quantity: 2, unit_label: 'karton', unit_size: 12000, unit_price: 180000 }]
const po = (await one('select purchase_order_save($1, null, $2, current_date, null, $3, $4::jsonb) id', [cafeA, supplier, 'mingguan', JSON.stringify(poItems)])).id
const poRow = await one('select po_number, total_amount, status from purchase_orders where id = $1', [po])
check('nomor PO berurutan', /^PO-\d{4}-0001$/.test(poRow.po_number), poRow.po_number)
check('total PO 360000', num(poRow.total_amount) === 360000)
await fails('PO draf tidak bisa dibayar', "select purchase_order_pay($1, 1000, 'cash')", [po], /draf/)
await q("select purchase_order_transition($1, 'order')", [po])
const item = (await one('select id from purchase_order_items where purchase_order_id = $1', [po])).id
const milkBeforePo = await one('select on_hand, avg_cost from ingredients where id = $1', [ing.milk])
check('terima sebagian → partial', (await one("select purchase_order_receive($1, $2::jsonb) s", [po, JSON.stringify([{ item_id: item, quantity: 1, expires_at: null }])])).s === 'partial')
const milkAfterPo = await one('select on_hand from ingredients where id = $1', [ing.milk])
check('stok susu +12000', num(milkAfterPo.on_hand) - num(milkBeforePo.on_hand) === 12000)
await fails('terima melebihi sisa ditolak', 'select purchase_order_receive($1, $2::jsonb)', [po, JSON.stringify([{ item_id: item, quantity: 2 }])], /melebihi/)
await fails('terima tanpa baris valid ditolak', 'select purchase_order_receive($1, $2::jsonb)', [po, JSON.stringify([{ item_id: ing.cup, quantity: 1 }])], /Isi jumlah/)
await fails('batalkan PO yang sudah diterima ditolak', "select purchase_order_transition($1, 'cancel')", [po], /Tutup PO/)
check('terima sisa → received', (await one('select purchase_order_receive($1, $2::jsonb) s', [po, JSON.stringify([{ item_id: item, quantity: 1 }])])).s === 'received')
const poDone = await one(`select received_amount, due_date, (due_date - (now() at time zone 'Asia/Jakarta')::date) as terms from purchase_orders where id = $1`, [po])
check('nilai diterima 360000 & jatuh tempo +14 hari', num(poDone.received_amount) === 360000 && poDone.terms === 14, JSON.stringify(poDone))
check('katalog supplier diperbarui', num((await one('select last_price from supplier_items where supplier_id = $1 and ingredient_id = $2', [supplier, ing.milk])).last_price) === 180000)
const pay = (await one("select purchase_order_pay($1, 200000, 'bank_transfer', current_date, 'TRX-1') id", [po])).id
await fails('bayar melebihi sisa utang ditolak', "select purchase_order_pay($1, 200000, 'cash')", [po], /melebihi/)
await fails('void tanpa alasan ditolak', "select supplier_payment_void($1, '')", [pay], /alasan/)
await q("select supplier_payment_void($1, 'salah input')", [pay])
check('void mengembalikan utang', num((await one('select paid_amount from purchase_orders where id = $1', [po])).paid_amount) === 0)
await fails('void dua kali ditolak', "select supplier_payment_void($1, 'lagi')", [pay], /sudah dibatalkan/)
const draft = (await one('select purchase_order_save($1, null, $2, current_date, null, null, $3::jsonb) id', [cafeA, supplier, JSON.stringify(poItems)])).id
check('draf bisa dihapus', (await one("select purchase_order_transition($1, 'delete') s", [draft])).s === 'deleted')

// ---------- Profit produk & perkiraan ----------
const profit = await q("select * from inventory_product_profitability($1, now() - interval '1 day', now() + interval '1 day')", [cafeA])
const latteProfit = profit.find((row) => row.product_id === latte)
check('profit latte: biaya aktual dari mutasi', num(latteProfit.actual_cost) > 0 && num(latteProfit.estimated_cost) > 0,
  JSON.stringify(latteProfit))
check('croissant tanpa resep = belum berbiaya', num(profit.find((row) => row.product_id === croissant).uncosted_quantity) === 2)
let forecast = await q('select * from inventory_forecast($1, 28)', [cafeA])
check('perkiraan menolak menebak (< 7 hari data)', forecast.every((row) => row.basis === 'data_kurang' && row.avg_daily_usage === null))
for (let day = 2; day <= 10; day += 1) {
  await makeOrder([[latte, 'Es Kopi Susu', 28000, 10]], { status: 'completed', createdAt: new Date(Date.now() - day * 86400000).toISOString() })
}
await as(U.ownerA)
forecast = await q('select * from inventory_forecast($1, 28)', [cafeA])
const espressoForecast = forecast.find((row) => row.ingredient_id === ing.espresso)
check('perkiraan memakai estimasi resep', espressoForecast.basis === 'estimasi' && num(espressoForecast.avg_daily_usage) > 0, JSON.stringify(espressoForecast))
check('hari berjualan tidak melebihi rentang', espressoForecast.active_days <= 28, espressoForecast.active_days)

// ---------- Keamanan & isolasi ----------
await as(U.ownerB)
check('owner B tidak melihat bahan kafe A', (await q('select id from ingredients')).length === 0)
check('owner B tidak melihat mutasi kafe A', (await q('select id from stock_movements')).length === 0)
await fails('owner B tidak bisa stok masuk ke kafe A', 'select inventory_stock_in($1, 1, 1)', [ing.cup], /Hanya owner/)
await fails('owner B tidak bisa ubah resep kafe A', 'select recipe_save($1, $2::jsonb)', [latte, '[]'], /Hanya owner/)
await fails('owner B tidak bisa melihat HPP kafe A', 'select * from inventory_product_costing($1)', [cafeA], /Hanya owner/)
await fails('owner B tidak bisa insert bahan ke kafe A', "insert into ingredients (cafe_id, name, unit) values ($1, 'x', 'g')", [cafeA], /row-level security/)
const supplierB = (await one("insert into suppliers (cafe_id, name) values ($1, 'Supp B') returning id", [cafeB])).id
await fails('owner B tidak bisa pakai bahan A di resep B', 'select recipe_save($1, $2::jsonb)', [productB, JSON.stringify([{ ingredient_id: ing.cup, quantity: 1 }])], /tidak ditemukan/)
await as(U.ownerA)
await fails('katalog supplier lintas kafe ditolak', 'insert into supplier_items (supplier_id, ingredient_id) values ($1, $2)', [supplierB, ing.cup], /row-level security|tidak ditemukan/)
await fails('supplier default lintas kafe ditolak', 'update ingredients set default_supplier_id = $1 where id = $2', [supplierB, ing.cup], /tidak ditemukan/)
await fails('satuan tidak bisa diubah setelah ada riwayat', "update ingredients set unit = 'ml' where id = $1", [ing.cup], /Satuan/)
await fails('bahan dengan riwayat tidak bisa dihapus', 'delete from ingredients where id = $1', [ing.cup], /foreign key|violates/)
await fails('mutasi tidak bisa diubah klien', 'update stock_movements set quantity = 1', [], /permission denied/)
await su()
await fails('mutasi tidak bisa diubah walau superuser', 'update stock_movements set quantity = 1', [], /tidak bisa diubah/)
await as(U.staffA)
check('staff tidak melihat bahan', (await q('select id from ingredients')).length === 0)
await fails('staff tidak bisa stok masuk', 'select inventory_stock_in($1, 1, 1)', [ing.cup], /Hanya owner/)
await as(U.customer)
await fails('customer tidak bisa lihat perkiraan', 'select * from inventory_forecast($1)', [cafeA], /Hanya owner/)
await as(null)
await fails('anon tidak bisa baca bahan', 'select * from ingredients', [], /permission denied/)
await fails('anon tidak bisa panggil RPC', 'select inventory_stock_in($1, 1, 1)', [ing.cup], /permission denied/)

// ---------- Log aktivitas & pengaturan ----------
await su()
const entities = (await q('select distinct entity from audit_logs where cafe_id = $1', [cafeA])).map((row) => row.entity)
for (const entity of ['suppliers', 'ingredients', 'purchase_orders', 'supplier_payments', 'recipe']) {
  check(`log aktivitas: ${entity}`, entities.includes(entity), entities.join(','))
}
check('log PO berlabel nomor PO', (await one("select label from audit_logs where entity = 'purchase_orders' limit 1")).label?.startsWith('PO-'))
check('perubahan stok tidak membanjiri log', (await one("select count(*)::int c from audit_logs where entity = 'ingredients' and action = 'update'")).c <= 1)
await as(U.ownerA)
await q('select inventory_set_tracking($1, false)', [cafeA])
check('matikan pelacakan menghapus tanggal mulai', (await one('select inventory_tracking, inventory_started_at from cafe_settings where cafe_id = $1', [cafeA])).inventory_started_at === null)

console.log(`\n${passed} lulus, ${failures.length} gagal`)
for (const failure of failures) console.log('  ✗ ' + failure)
process.exit(failures.length ? 1 : 0)
