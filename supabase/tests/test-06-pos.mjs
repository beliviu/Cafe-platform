// Uji file usulan/06 (pesanan v2 & POS) di Postgres lokal dalam memori. TIDAK menyentuh database live.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'

const ROOT = new URL('../usulan/', import.meta.url)
const usulan = (name) => fs.readFileSync(new URL(name, ROOT), 'utf8')
const db = new PGlite()
let passed = 0
const failures = []
const check = (name, ok, detail = '') => { if (ok) passed += 1; else failures.push(`${name}${detail !== '' ? ` → ${detail}` : ''}`) }
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
const num = Number
const J = (value) => JSON.stringify(value)

// ---------- Skema live + 04 + 05; pesanan lama dibuat sebelum 06 ----------
await db.exec(fs.readFileSync(new URL('./base-schema.sql', import.meta.url), 'utf8'))
await db.exec(usulan('04-owner-dashboard.sql'))
await db.exec(usulan('05-inventori-supplier.sql'))

const U = {
  owner: '00000000-0000-0000-0000-00000000000a', staff: '00000000-0000-0000-0000-00000000005a',
  staff2: '00000000-0000-0000-0000-00000000005b', ownerB: '00000000-0000-0000-0000-00000000000b',
  customer: '00000000-0000-0000-0000-0000000000cc', customer2: '00000000-0000-0000-0000-0000000000cd',
}
for (const id of Object.values(U)) await db.query('insert into auth.users (id) values ($1)', [id])
const cafe = (await one("insert into cafes (name, accepted_payment_methods) values ('Kopi A', array['cash','qris','bank_transfer']) returning id")).id
const cafeB = (await one("insert into cafes (name) values ('Kopi B') returning id")).id
await db.query(`insert into profiles (id, cafe_id, full_name, role) values
  ($1,$2,'Owner','owner'),($3,$2,'Staff','staff'),($4,$2,'Staff Dua','staff'),($5,$6,'Owner B','owner'),($7,null,'Cust','customer'),($8,null,'Cust2','customer')`,
[U.owner, cafe, U.staff, U.staff2, U.ownerB, cafeB, U.customer, U.customer2])
const latte = (await one("insert into products (cafe_id, name, price) values ($1,'Latte',28000) returning id", [cafe])).id
const croissant = (await one("insert into products (cafe_id, name, price) values ($1,'Croissant',22000) returning id", [cafe])).id
const tehB = (await one("insert into products (cafe_id, name, price) values ($1,'Teh B',15000) returning id", [cafeB])).id

// Pesanan lama (sebelum 06): lunas, total dari trigger lama
await as(U.customer)
const legacy = (await one('select create_order($1, $2::jsonb, $3, null) id', [cafe, J([{ product_id: croissant, quantity: 2 }]), 'cash'])).id
await su()
await db.query("update orders set payment_status = 'paid' where id = $1", [legacy])
const legacyNumber = (await one('select order_number from orders where id = $1', [legacy])).order_number

// ---------- Jalankan 06 (dua kali: idempoten) ----------
const results = await db.exec(usulan('06-pesanan-v2-pos.sql'))
const verify = results.at(-1).rows
check('verifikasi 21 baris', verify.length === 21, verify.map((r) => r.name).join(','))
await db.exec(usulan('06-pesanan-v2-pos.sql'))
passed += 1

const legacyRow = await one('select total_amount, paid_amount, pricing_version, source, order_number from orders where id = $1', [legacy])
check('pesanan lama: total tetap', num(legacyRow.total_amount) === 44000)
check('pesanan lama: paid_amount diisi', num(legacyRow.paid_amount) === 44000)
check('pesanan lama: versi 1 & sumber app', legacyRow.pricing_version === 1 && legacyRow.source === 'app')
check('pesanan lama: nomor tidak diubah', legacyRow.order_number === legacyNumber)
await db.query('insert into order_items (order_id, product_id, product_name, price, quantity) values ($1,$2,$3,$4,$5)', [legacy, latte, 'Latte', 28000, 1])
check('trigger total lama tetap jalan untuk versi 1', num((await one('select total_amount from orders where id = $1', [legacy])).total_amount) === 72000)
await db.query('delete from order_items where order_id = $1 and product_name = $2', [legacy, 'Latte'])
check('hapus item versi 1 menghitung ulang total', num((await one('select total_amount from orders where id = $1', [legacy])).total_amount) === 44000)

// ---------- Varian ----------
await as(U.owner)
const gSize = (await one("insert into product_option_groups (product_id, name, is_required, sort_order) values ($1,'Ukuran',true,0) returning id", [latte])).id
const gAdd = (await one("insert into product_option_groups (product_id, name, selection_type, max_select, sort_order) values ($1,'Tambahan','multiple',2,1) returning id", [latte])).id
const regular = (await one("insert into product_options (group_id, name, price_delta, is_default, sort_order) values ($1,'Regular',0,true,0) returning id", [gSize])).id
const large = (await one("insert into product_options (group_id, name, price_delta, sort_order) values ($1,'Large',5000,1) returning id", [gSize])).id
const shot = (await one("insert into product_options (group_id, name, price_delta, sort_order) values ($1,'Extra shot',6000,0) returning id", [gAdd])).id
const oat = (await one("insert into product_options (group_id, name, price_delta, is_available, sort_order) values ($1,'Oat',7000,false,1) returning id", [gAdd])).id

// ---------- App lewat create_order (pembungkus) ----------
await as(U.customer)
const appOrder = (await one('select create_order($1, $2::jsonb, $3, $4) id', [cafe, J([{ product_id: latte, quantity: 2 }]), 'cash', 'less ice'])).id
const app = await one('select * from orders where id = $1', [appOrder])
check('app: sumber app, status pending, versi 2', app.source === 'app' && app.order_status === 'pending' && app.pricing_version === 2)
check('app: grup wajib terisi bawaan (Regular)', (await one('select product_name, price from order_items where order_id = $1', [appOrder])).product_name === 'Latte (Regular)')
check('app: total 56000', num(app.total_amount) === 56000 && num(app.subtotal_amount) === 56000)
check('app: nomor pesanan UUID (tidak bentrok antar kafe)', /^[0-9a-f-]{36}$/.test(app.order_number), app.order_number)
check('app: snapshot varian tersimpan', (await one('select count(*)::int c from order_item_options where order_id = $1', [appOrder])).c === 1)
await fails('app: diskon ditolak', 'select place_order($1, $2::jsonb, $3, null, null, null, null, $4::jsonb)', [cafe, J([{ product_id: croissant, quantity: 1 }]), 'app', J({ type: 'amount', value: 1000, reason: 'promo' })], /kasir/)
await as(U.staff)
await fails('staff tidak bisa memesan lewat jalur app', 'select place_order($1, $2::jsonb)', [cafe, J([{ product_id: croissant, quantity: 1 }])], /customer/)

// ---------- Pajak, service, pembulatan (POS) ----------
await su()
await db.query('update cafe_settings set tax_enabled = true, tax_rate = 10, service_charge_enabled = true, service_charge_rate = 5, service_charge_taxable = true, rounding_unit = 500 where cafe_id = $1', [cafe])
await as(U.staff)
const posItems = J([{ product_id: latte, quantity: 1, option_ids: [large, shot], notes: 'panas' }])
const pos1 = (await one("select place_order($1, $2::jsonb, 'pos', 'takeaway', null, 'Budi') id", [cafe, posItems])).id
const p1 = await one('select * from orders where id = $1', [pos1])
check('POS: harga varian 39000', num(p1.subtotal_amount) === 39000, p1.subtotal_amount)
check('POS: service 1950', num(p1.service_charge_amount) === 1950)
check('POS: pajak 4095 (dari subtotal + service)', num(p1.tax_amount) === 4095, p1.tax_amount)
check('POS: total dibulatkan 45000, pembulatan −45', num(p1.total_amount) === 45000 && num(p1.rounding_amount) === -45, `${p1.total_amount} ${p1.rounding_amount}`)
check('POS: status langsung diproses, tamu tersimpan', p1.order_status === 'preparing' && p1.guest_name === 'Budi' && p1.customer_id === null)
check('POS: nama item memuat varian berurutan', (await one('select product_name from order_items where order_id = $1', [pos1])).product_name === 'Latte (Large, Extra shot)')
check('POS: trigger lama tidak menimpa total', num((await one('select total_amount from orders where id = $1', [pos1])).total_amount) === 45000)

await fails('varian produk lain ditolak', "select place_order($1, $2::jsonb, 'pos')", [cafe, J([{ product_id: croissant, quantity: 1, option_ids: [large] }])], /tidak cocok/)
await fails('dua pilihan di grup tunggal ditolak', "select place_order($1, $2::jsonb, 'pos')", [cafe, J([{ product_id: latte, quantity: 1, option_ids: [regular, large] }])], /Terlalu banyak/)
await fails('pilihan habis ditolak', "select place_order($1, $2::jsonb, 'pos')", [cafe, J([{ product_id: latte, quantity: 1, option_ids: [oat] }])], /sedang habis/)
await fails('jumlah 0 ditolak', "select place_order($1, $2::jsonb, 'pos')", [cafe, J([{ product_id: latte, quantity: 0 }])], /1–99/)

// ---------- Diskon ----------
await fails('staff diskon melebihi batas 0%', "select place_order($1, $2::jsonb, 'pos', null, null, null, null, $3::jsonb)",
  [cafe, J([{ product_id: croissant, quantity: 1 }]), J({ type: 'percent', value: 10, reason: 'member' })], /batas staff/)
await fails('diskon tanpa alasan ditolak', "select place_order($1, $2::jsonb, 'pos', null, null, null, null, $3::jsonb)",
  [cafe, J([{ product_id: croissant, quantity: 1 }]), J({ type: 'percent', value: 10 })], /alasan/)
await su()
await db.query('update cafe_settings set staff_max_discount_pct = 10, tax_enabled = false, service_charge_enabled = false, rounding_unit = 0 where cafe_id = $1', [cafe])
await as(U.staff)
const disc = (await one("select place_order($1, $2::jsonb, 'pos', null, null, null, null, $3::jsonb) id", [cafe, J([{ product_id: croissant, quantity: 2 }]), J({ type: 'percent', value: 10, reason: 'member' })])).id
const d = await one('select subtotal_amount, discount_amount, total_amount, discount_by from orders where id = $1', [disc])
check('diskon staff 10%: 44000 − 4400 = 39600', num(d.discount_amount) === 4400 && num(d.total_amount) === 39600 && d.discount_by === U.staff, J(d))
await as(U.owner)
const disc2 = (await one("select place_order($1, $2::jsonb, 'pos', null, null, null, null, $3::jsonb) id", [cafe, J([{ product_id: croissant, quantity: 1 }]), J({ type: 'amount', value: 50000, reason: 'kompensasi' })])).id
check('diskon owner dibatasi subtotal (gratis)', num((await one('select total_amount from orders where id = $1', [disc2])).total_amount) === 0)

// ---------- Anti-dobel ----------
await as(U.staff)
const key = 'pos-abc-123456'
const k1 = (await one("select place_order($1, $2::jsonb, 'pos', null, null, null, null, null, null, $3) id", [cafe, J([{ product_id: croissant, quantity: 1 }]), key])).id
const k2 = (await one("select place_order($1, $2::jsonb, 'pos', null, null, null, null, null, null, $3) id", [cafe, J([{ product_id: croissant, quantity: 1 }]), key])).id
check('kunci sama → pesanan sama', k1 === k2)
await su()
check('hanya satu pesanan untuk kunci itu', (await one('select count(*)::int c from orders where idempotency_key = $1', [key])).c === 1)

// ---------- Meja ----------
const table = (await one("insert into cafe_tables (cafe_id, label) values ($1, '7') returning id", [cafe])).id
const tableB = (await one("insert into cafe_tables (cafe_id, label) values ($1, '1') returning id", [cafeB])).id
await as(U.staff)
const tOrder = (await one("select place_order($1, $2::jsonb, 'pos', null, $3) id", [cafe, J([{ product_id: croissant, quantity: 1 }]), table])).id
const t = await one('select order_type, table_label from orders where id = $1', [tOrder])
check('meja: otomatis makan di tempat + label', t.order_type === 'dine_in' && t.table_label === '7')
await fails('meja kafe lain ditolak', "select place_order($1, $2::jsonb, 'pos', null, $3)", [cafe, J([{ product_id: croissant, quantity: 1 }]), tableB], /Meja/)

// ---------- Stok: cadangan, tolak, lepas, pakai ----------
await as(U.owner)
const espresso = (await one("insert into ingredients (cafe_id, name, unit) values ($1,'Espresso','g') returning id", [cafe])).id
const milk = (await one("insert into ingredients (cafe_id, name, unit) values ($1,'Susu','ml') returning id", [cafe])).id
await q('select inventory_stock_in($1, 100, 300, null, null, null, true)', [espresso])
await q('select inventory_stock_in($1, 1000, 20, null, null, null, true)', [milk])
await q('select recipe_save($1, $2::jsonb)', [latte, J([{ ingredient_id: espresso, quantity: 18 }, { ingredient_id: milk, quantity: 150 }, { ingredient_id: milk, quantity: 50, option_id: large }])])
await q('select inventory_set_tracking($1, true)', [cafe])
await as(U.staff)
const big = (await one("select place_order($1, $2::jsonb, 'pos') id", [cafe, J([{ product_id: latte, quantity: 5, option_ids: [large] }])])).id
await su()
let milkRow = await one('select on_hand, reserved from ingredients where id = $1', [milk])
check('cadangan susu 1000 (5 × (150+50))', num(milkRow.reserved) === 1000 && num(milkRow.on_hand) === 1000, J(milkRow))
const ordersBefore = (await one('select count(*)::int c from orders')).c
await as(U.customer)
await fails('checkout ditolak saat stok kurang', 'select create_order($1, $2::jsonb)', [cafe, J([{ product_id: latte, quantity: 1 }])], /Stok tidak cukup untuk Latte/)
check('pesanan gagal tidak tersimpan', (await (async () => { await su(); return (await one('select count(*)::int c from orders')).c })()) === ordersBefore)
await as(U.customer)
let avail = (await q('select * from product_availability($1)', [cafe])).find((row) => row.product_id === latte)
check('app: latte HABIS karena stok, porsi disembunyikan', avail.available === false && avail.reason === 'stock' && avail.portions === null, J(avail))
await as(null)
check('anon bisa membaca ketersediaan', (await q('select * from product_availability($1)', [cafe])).length === 2)
await as(U.owner)
avail = (await q('select * from product_availability($1)', [cafe])).find((row) => row.product_id === latte)
check('owner melihat porsi 0', num(avail.portions) === 0)
await as(U.staff)
await q("select staff_cancel_order($1, 'salah input')", [big])
await su()
milkRow = await one('select reserved from ingredients where id = $1', [milk])
check('batal melepas cadangan', num(milkRow.reserved) === 0)
await as(U.staff)
const two = (await one("select place_order($1, $2::jsonb, 'pos') id", [cafe, J([{ product_id: latte, quantity: 2, option_ids: [large] }])])).id
await q("update orders set order_status = 'ready' where id = $1", [two])
await q("update orders set order_status = 'completed' where id = $1", [two])
await su()
milkRow = await one('select on_hand, reserved from ingredients where id = $1', [milk])
check('selesai: susu terpotong 400, cadangan 0', num(milkRow.on_hand) === 600 && num(milkRow.reserved) === 0, J(milkRow))
check('selesai: mutasi pemakaian per item & bahan', (await one("select count(*)::int c from stock_movements where order_id = $1 and movement_type = 'sale'", [two])).c === 2)
check('cadangan ditandai terpakai', (await one('select count(*)::int c from stock_reservations where order_id = $1 and consumed_at is not null', [two])).c === 2)
await as(U.staff)
const hold = (await one("select place_order($1, $2::jsonb, 'pos') id", [cafe, J([{ product_id: latte, quantity: 1 }])])).id
await as(U.owner)
const reservedBefore = num((await one('select reserved from ingredients where id = $1', [milk])).reserved)
await q('select inventory_set_tracking($1, false)', [cafe])
check('pelacakan dimatikan melepas cadangan', reservedBefore === 150 && num((await one('select reserved from ingredients where id = $1', [milk])).reserved) === 0, reservedBefore)
await q('select inventory_set_tracking($1, true)', [cafe])
void hold

// ---------- Sesi kasir & pembayaran ----------
await as(U.staff)
await fails('tunai tanpa sesi kasir ditolak', 'select pos_record_payments($1, $2::jsonb)', [pos1, J([{ method: 'cash', amount: 45000 }])], /sesi kasir/)
const session = (await one('select cashier_open($1, 100000, $2) id', [cafe, 'shift pagi'])).id
await fails('buka sesi kedua ditolak', 'select cashier_open($1, 0)', [cafe], /masih punya sesi/)
await fails('metode di luar pengaturan ditolak', 'select pos_record_payments($1, $2::jsonb)', [pos1, J([{ method: 'ewallet', amount: 45000 }])], /tidak diterima/)
await fails('bayar melebihi tagihan ditolak', 'select pos_record_payments($1, $2::jsonb)', [pos1, J([{ method: 'qris', amount: 50000 }])], /melebihi/)
await fails('uang diterima kurang ditolak', 'select pos_record_payments($1, $2::jsonb)', [pos1, J([{ method: 'cash', amount: 45000, tendered: 40000 }])], /kurang/)
const paid = await one('select * from pos_record_payments($1, $2::jsonb)', [pos1, J([{ method: 'qris', amount: 20000, reference: 'QR-77' }, { method: 'cash', amount: 25000, tendered: 50000 }])])
check('split: lunas, metode split', paid.payment_status === 'paid' && paid.payment_method === 'split' && num(paid.paid_amount) === 45000, J({ s: paid.payment_status, m: paid.payment_method }))
await su()
const cashPay = await one("select change_amount, tendered_amount, cashier_session_id, recorded_by from payments where order_id = $1 and method = 'cash'", [pos1])
check('kembalian 25000 & sesi tercatat', num(cashPay.change_amount) === 25000 && cashPay.cashier_session_id === session && cashPay.recorded_by === U.staff)
await as(U.staff)
await q('select pos_record_payments($1, $2::jsonb)', [pos1, J([{ method: 'cash', amount: 45000 }])])
await su()
check('bayar ulang pesanan lunas tidak dobel', (await one("select count(*)::int c from payments where order_id = $1 and status = 'paid'", [pos1])).c === 2)
await as(U.staff)
const part = await one('select payment_status, paid_amount from pos_record_payments($1, $2::jsonb)', [disc, J([{ method: 'qris', amount: 10000 }])])
check('bayar sebagian: belum lunas', part.payment_status === 'unpaid' && num(part.paid_amount) === 10000)
const rest = await one("select payment_status, paid_amount, payment_method from staff_mark_order_paid($1, 'cash')", [disc])
check('papan staff melunasi sisa', rest.payment_status === 'paid' && num(rest.paid_amount) === 39600 && rest.payment_method === 'split', J(rest))
await as(U.staff2)
const legacyPaid = await one("select payment_status from staff_mark_order_paid($1, 'cash')", [appOrder])
check('tandai lunas tanpa sesi tetap bisa (alur lama)', legacyPaid.payment_status === 'paid')
check('staff lain tidak melihat sesi orang lain', (await q('select id from cashier_sessions')).length === 0)
await as(U.staff)
await q("select cashier_cash_move($1, 'out', 5000, 'beli es batu')", [session])
await fails('kas keluar tanpa keterangan ditolak', "select cashier_cash_move($1, 'out', 5000, '')", [session], /keterangan/)
let summary = (await one('select cashier_summary($1) s', [session])).s
check('kas seharusnya = 100000 + 25000 + 10000? (tunai papan) − 5000', num(summary.expected_cash) === 100000 + 25000 + 29600 - 5000, J(summary))
check('ringkasan per metode', num(summary.by_method.qris) === 30000 && num(summary.by_method.cash) === 54600, J(summary.by_method))

// ---------- Refund ----------
await q("update orders set order_status = 'ready' where id = $1", [pos1])
await q("update orders set order_status = 'completed' where id = $1", [pos1])
const pos1Item = (await one('select id from order_items where order_id = $1', [pos1])).id
await su()
const milkBefore = num((await one('select on_hand from ingredients where id = $1', [milk])).on_hand)
await as(U.staff)
const req = await one('select * from refund_request($1, 20000, $2, $3, true, $4::jsonb)', [pos1, 'cash', 'minuman tumpah', J([{ order_item_id: pos1Item, quantity: 1 }])])
check('staff mengajukan → menunggu', req.status === 'requested')
await fails('refund melebihi sisa (dengan pengajuan tertunda)', "select refund_request($1, 30000, 'cash', 'lagi')", [pos1], /maksimal/)
await fails('staff tidak bisa menyetujui', 'select refund_decide($1, true)', [req.id], /owner/)
await as(U.owner)
await fails('tolak tanpa alasan ditolak', 'select refund_decide($1, false)', [req.id], /alasan/)
const approved = await one('select * from refund_decide($1, true)', [req.id])
check('owner menyetujui', approved.status === 'approved')
await su()
const afterRefund = await one('select refunded_amount, payment_status from orders where id = $1', [pos1])
check('refund sebagian: status tetap lunas', num(afterRefund.refunded_amount) === 20000 && afterRefund.payment_status === 'paid', J(afterRefund))
check('stok kembali (mutasi refund)', num((await one('select on_hand from ingredients where id = $1', [milk])).on_hand) === milkBefore + 200)
check('baris pembayaran refund tercatat', (await one("select count(*)::int c from payments where order_id = $1 and status = 'refunded'", [pos1])).c === 1)
await as(U.staff)
summary = (await one('select cashier_summary($1) s', [session])).s
check('refund tunai mengurangi kas seharusnya', num(summary.cash_refunds) === 20000 && num(summary.expected_cash) === 149600 - 20000, J(summary))
await as(U.owner)
const full = await one("select * from refund_request($1, 25000, 'qris', 'batal semua')", [pos1])
check('owner mengajukan = langsung disetujui', full.status === 'approved')
check('refund penuh → status refunded', (await one('select payment_status from orders where id = $1', [pos1])).payment_status === 'refunded')
await fails('pesanan belum dibayar tidak bisa direfund', "select refund_request($1, 1000, 'cash', 'coba')", [tOrder], /belum dibayar/)

// ---------- Tutup kasir & serah terima ----------
await as(U.staff)
await fails('tutup dengan selisih tanpa catatan ditolak', 'select cashier_close($1, 120000)', [session], /selisih/)
await fails('serah terima ke customer ditolak', "select cashier_close($1, 129600, null, $2, 'lanjut')", [session, U.customer], /anggota tim/)
const closed = (await one("select cashier_close($1, 129000, 'kurang 600 kembalian', $2, 'Pesanan meja 7 belum diantar') s", [session, U.staff2])).s
check('tutup: selisih −600', num(closed.difference) === -600 && closed.status === 'closed', J(closed))
await fails('sesi tertutup tidak bisa kas keluar', "select cashier_cash_move($1, 'out', 1000, 'coba lagi')", [session], /ditutup/)
await as(U.owner)
check('owner melihat semua sesi', (await q('select id from cashier_sessions')).length === 1)
await as(U.staff2)
const handover = await one('select handover_note, counted_cash from cashier_sessions')
check('penerima serah terima melihat catatan & kas', handover?.handover_note === 'Pesanan meja 7 belum diantar' && num(handover.counted_cash) === 129000, J(handover))

// ---------- Pesanan ditahan ----------
await as(U.staff)
await q("insert into pos_held_orders (cafe_id, label, cart) values ($1, 'Meja 3', $2::jsonb)", [cafe, J({ items: [{ product_id: latte, quantity: 1 }] })])
await as(U.ownerB)
check('kafe lain tidak melihat hold', (await q('select id from pos_held_orders')).length === 0)
await fails('kafe lain tidak bisa menyimpan hold ke kafe A', "insert into pos_held_orders (cafe_id, label, cart) values ($1, 'x', '{}'::jsonb)", [cafe], /row-level security/)
await as(U.customer)
await fails('customer tidak bisa menyimpan hold', "insert into pos_held_orders (cafe_id, label, cart) values ($1, 'x', '{}'::jsonb)", [cafe], /row-level security/)

// ---------- Akses ----------
await as(U.ownerB)
await fails('owner kafe lain tidak bisa membuat pesanan POS kafe A', "select place_order($1, $2::jsonb, 'pos')", [cafe, J([{ product_id: croissant, quantity: 1 }])], /Hanya staff/)
await fails('owner kafe lain tidak bisa membayar pesanan kafe A', 'select pos_record_payments($1, $2::jsonb)', [disc2, J([{ method: 'qris', amount: 1 }])], /Hanya staff/)
await fails('produk kafe lain ditolak', "select place_order($1, $2::jsonb, 'pos')", [cafeB, J([{ product_id: latte, quantity: 1 }])], /tidak ditemukan/)
await as(U.customer2)
check('customer lain tidak melihat varian pesanan orang lain', (await q('select id from order_item_options')).length === 0)
await as(U.customer)
check('customer melihat varian pesanannya', (await q('select id from order_item_options')).length === 1)
await fails('customer tidak bisa mencatat pembayaran', 'select pos_record_payments($1, $2::jsonb)', [appOrder, J([{ method: 'cash', amount: 1 }])], /Hanya staff/)
await as(null)
await fails('anon tidak bisa membuat pesanan', "select place_order($1, $2::jsonb, 'pos')", [cafe, J([])], /permission denied/)
await as(U.customer)
await fails('fungsi internal tidak bisa dipanggil', "select pos_apply_payments($1, '[]'::jsonb, false)", [appOrder], /permission denied/)
void tehB

console.log(`\n${passed} lulus, ${failures.length} gagal`)
for (const failure of failures) console.log('  ✗ ' + failure)
process.exit(failures.length ? 1 : 0)
