// Uji file usulan/08 (aplikasi customer & QR meja) di Postgres lokal dalam memori. TIDAK menyentuh database live.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'

const ROOT = new URL('../usulan/', import.meta.url)
const usulan = (name) => fs.readFileSync(new URL(name, ROOT), 'utf8')
let passed = 0
const failures = []
const check = (name, ok, detail = '') => { if (ok) passed += 1; else failures.push(`${name}${detail !== '' ? ` → ${detail}` : ''}`) }
const J = (value) => JSON.stringify(value)
const num = Number

// ---------- 08 bisa dijalankan tanpa 07 ----------
{
  const lite = new PGlite()
  await lite.exec(fs.readFileSync(new URL('./base-schema.sql', import.meta.url), 'utf8'))
  await lite.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant execute on function auth.jwt() to anon, authenticated;`)
  for (const file of ['04-owner-dashboard.sql', '05-inventori-supplier.sql', '06-pesanan-v2-pos.sql']) await lite.exec(usulan(file))
  const result = await lite.exec(usulan('08-pelanggan-qr.sql'))
  check('tanpa 07: verifikasi 32 baris', result.at(-1).rows.length === 32, result.at(-1).rows.length)
  await lite.close()
}

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
await db.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant execute on function auth.jwt() to anon, authenticated;`)
await db.exec("set timezone to 'Asia/Jakarta'") // current_date di tes = tanggal WIB (sama dengan kode)
for (const file of ['04-owner-dashboard.sql', '05-inventori-supplier.sql', '06-pesanan-v2-pos.sql', '07-akuntansi.sql']) await db.exec(usulan(file))
const results = await db.exec(usulan('08-pelanggan-qr.sql'))
check('verifikasi 32 baris', results.at(-1).rows.length === 32, results.at(-1).rows.map((r) => r.name).join(','))
await db.exec(usulan('08-pelanggan-qr.sql'))
passed += 1 // aman dijalankan ulang

const U = {
  owner: '00000000-0000-0000-0000-00000000000a', staff: '00000000-0000-0000-0000-00000000005a', ownerB: '00000000-0000-0000-0000-00000000000b',
  cust: '00000000-0000-0000-0000-0000000000c1', cust2: '00000000-0000-0000-0000-0000000000c2',
}
for (const id of Object.values(U)) await db.query('insert into auth.users (id) values ($1)', [id])
const cafe = (await one("insert into cafes (name, accepted_payment_methods) values ('Kopi A', array['cash','qris']) returning id")).id
const cafeB = (await one("insert into cafes (name) values ('Kopi B') returning id")).id
await db.query(`insert into profiles (id, cafe_id, full_name, role) values ($1,$2,'Owner','owner'),($3,$2,'Staff','staff'),($4,$5,'Owner B','owner'),
  ($6,null,'Rani Putri','customer'),($7,null,'Bagas','customer')`, [U.owner, cafe, U.staff, U.ownerB, cafeB, U.cust, U.cust2])
const latte = (await one("insert into products (cafe_id, name, price) values ($1,'Latte',28000) returning id", [cafe])).id
const bread = (await one("insert into products (cafe_id, name, price) values ($1,'Roti',20000) returning id", [cafe])).id
const tableA = (await one("insert into cafe_tables (cafe_id, label) values ($1,'A1') returning id, qr_token", [cafe]))
const tableB = (await one("insert into cafe_tables (cafe_id, label) values ($1,'B1') returning id, qr_token", [cafeB]))
const setSettings = async (sql, params = [cafe]) => { await su(); await db.query(`update cafe_settings set ${sql} where cafe_id = $1`, params) }
const place = (args) => one(`select customer_place_order($1, $2::jsonb, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10) id`, [
  args.cafe ?? cafe, J(args.items ?? [{ product_id: latte, quantity: 1 }]), args.type ?? null, args.table ?? null, args.notes ?? null,
  args.method ?? 'cash', args.key ?? null, args.at ?? null, args.voucher ?? null, args.points ?? 0,
])
const order = async (id) => { await su(); return one('select * from orders where id = $1', [id]) }
const advance = async (id, ...statuses) => { await as(U.staff); for (const status of statuses) await q('update orders set order_status = $2 where id = $1', [id, status]) }

// ---------- B. QR meja ----------
check('meja lama/baru otomatis punya token 32 karakter', /^[0-9a-f]{32}$/.test(tableA.qr_token))
await as(null)
await fails('token QR tidak bisa dibaca publik', 'select qr_token from cafe_tables', [], /permission denied/)
check('kolom meja lain tetap bisa dibaca publik', (await q('select label from cafe_tables where cafe_id = $1', [cafe])).length === 1)
const resolved = (await one('select table_qr_resolve($1) r', [tableA.qr_token])).r
check('resolve QR: kafe & meja benar', resolved.cafe_id === cafe && resolved.label === 'A1' && resolved.cafe_name === 'Kopi A', J(resolved))
check('resolve QR palsu = null', (await one("select table_qr_resolve('0123456789abcdef0123') r")).r === null)
await as(U.staff)
const staffQr = await q('select * from cafe_tables_qr($1)', [cafe])
check('staff melihat meja tanpa token', staffQr.length === 1 && staffQr[0].qr_token === null)
await as(U.ownerB)
await fails('owner kafe lain tidak bisa melihat QR', 'select * from cafe_tables_qr($1)', [cafe], /Hanya staff atau owner/)
await fails('owner kafe lain tidak bisa mengganti QR', 'select table_qr_rotate($1)', [tableA.id], /tidak ditemukan/)
await as(U.owner)
check('owner melihat token', (await one('select qr_token from cafe_tables_qr($1)', [cafe])).qr_token === tableA.qr_token)
const rotated = (await one('select table_qr_rotate($1) t', [tableA.id])).t
check('ganti QR menghasilkan token baru', rotated !== tableA.qr_token)
check('token lama tidak berlaku', (await one('select table_qr_resolve($1) r', [tableA.qr_token])).r === null)
tableA.qr_token = rotated

// ---------- A. Status kafe ----------
await as(null)
let status = (await one('select cafe_status($1) s', [cafe])).s
check('jam buka belum diatur → buka', status.open === true && status.accepting === true && status.hours_set === false, J(status))
check('estimasi awal = 10 menit', status.prep_minutes === 10, status.prep_minutes)
const keys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const wib = new Date(Date.now() + 7 * 3600000)
const todayKey = keys[(wib.getUTCDay() + 6) % 7]
const allDay = Object.fromEntries(keys.map((key) => [key, { closed: false, open: '00:01', close: '00:00' }]))
const closedToday = { ...allDay, [todayKey]: { closed: true, open: '08:00', close: '22:00' } }
await su()
await db.query('update cafes set opening_hours = $2::jsonb where id = $1', [cafe, J(closedToday)])
await as(null)
status = (await one('select cafe_status($1) s', [cafe])).s
check('hari ini libur → tutup + jadwal buka berikut', status.open === false && status.accepting === false && Boolean(status.next_open), J(status))
await as(U.cust)
await fails('checkout saat tutup ditolak', 'select customer_place_order($1, $2::jsonb)', [cafe, J([{ product_id: latte, quantity: 1 }])], /Kafe sedang tutup/)
await fails('app lama (create_order) juga ditolak saat tutup', 'select create_order($1, $2::jsonb)', [cafe, J([{ product_id: latte, quantity: 1 }])], /Kafe sedang tutup/)
const tomorrow10 = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate() + 1, 3, 0)).toISOString() // 10:00 WIB besok
await fails('terjadwal ditolak bila fitur nonaktif', 'select customer_place_order($1, $2::jsonb, null, null, null, null, null, $3::timestamptz)', [cafe, J([{ product_id: latte, quantity: 1 }]), tomorrow10], /belum menerima pesanan terjadwal/)
await setSettings('scheduled_orders_enabled = true')
await as(U.cust)
const scheduled = (await place({ at: tomorrow10 })).id
let row = await order(scheduled)
check('pesanan terjadwal tersimpan & estimasi = jadwal', row.scheduled_for?.toISOString() === tomorrow10 && row.estimated_ready_at?.toISOString() === tomorrow10)
await as(U.cust)
await fails('jadwal < 15 menit ditolak', 'select customer_place_order($1, $2::jsonb, null, null, null, null, null, now() + interval \'5 minutes\')', [cafe, J([{ product_id: latte, quantity: 1 }])], /minimal 15 menit/)
// Waktu ±7 hari lagi (selalu dalam batas jadwal); hari itu dibuat libur
const nextWeek = new Date(Date.now() + 7 * 86400000 - 3600000)
const nextWeekKey = keys[(new Date(nextWeek.getTime() + 7 * 3600000).getUTCDay() + 6) % 7]
await su()
await db.query('update cafes set opening_hours = $2::jsonb where id = $1', [cafe, J({ ...allDay, [nextWeekKey]: { closed: true, open: '08:00', close: '22:00' } })])
await as(U.cust)
const todayNoon = nextWeek.toISOString()
await fails('jadwal saat kafe libur ditolak', 'select customer_place_order($1, $2::jsonb, null, null, null, null, null, $3::timestamptz)', [cafe, J([{ product_id: latte, quantity: 1 }]), todayNoon], /tutup pada jam/)
await su()
await db.query('update cafes set opening_hours = $2::jsonb where id = $1', [cafe, J(allDay)])
await setSettings("ordering_paused = false")
await as(U.staff)
await q("select cafe_set_ordering_paused($1, true, 'Antrean penuh')", [cafe])
await as(U.cust)
await fails('dijeda → checkout ditolak dengan pesan kafe', 'select customer_place_order($1, $2::jsonb)', [cafe, J([{ product_id: latte, quantity: 1 }])], /Antrean penuh/)
await as(U.cust)
await fails('customer tidak bisa menjeda', 'select cafe_set_ordering_paused($1, false)', [cafe], /Hanya staff/)
await as(U.staff)
await q('select cafe_set_ordering_paused($1, false)', [cafe])
check('log aktivitas mencatat jeda', (await (async () => { await su(); return one("select count(*)::int c from audit_logs where label like 'Pesanan app%'") })()).c === 2)

// ---------- QR checkout ----------
await as(U.cust)
await fails('QR kafe lain ditolak', 'select customer_place_order($1, $2::jsonb, null, $3)', [cafe, J([{ product_id: latte, quantity: 1 }]), tableB.qr_token], /milik kafe lain/)
await fails('QR palsu ditolak', 'select customer_place_order($1, $2::jsonb, null, $3)', [cafe, J([{ product_id: latte, quantity: 1 }]), 'ffffffffffffffffffffffffffffffff'], /QR meja tidak valid/)
const tableOrder = (await place({ table: tableA.qr_token, key: 'qr-key-0001' })).id
row = await order(tableOrder)
check('pesanan QR: meja & makan di tempat otomatis', row.table_id === tableA.id && row.table_label === 'A1' && row.order_type === 'dine_in')
check('estimasi siap terisi (≥ 10 menit)', row.estimated_ready_at && row.estimated_ready_at.getTime() - Date.now() > 9 * 60000)
await as(U.cust)
check('kunci sama → pesanan sama', (await place({ table: tableA.qr_token, key: 'qr-key-0001' })).id === tableOrder)
await as(U.owner)
check('keterisian meja: 1 pesanan aktif', (await one('select active_orders from cafe_tables_qr($1) where table_id = $2', [cafe, tableA.id])).active_orders === 1)
await su()
await db.query('update cafe_tables set is_active = false where id = $1', [tableA.id])
await as(U.cust)
await fails('meja nonaktif ditolak', 'select customer_place_order($1, $2::jsonb, null, $3)', [cafe, J([{ product_id: latte, quantity: 1 }]), tableA.qr_token], /sedang tidak dipakai/)
await su()
await db.query('update cafe_tables set is_active = true where id = $1', [tableA.id])
await setSettings('qr_ordering_enabled = false')
await as(U.cust)
await fails('QR dimatikan kafe → ditolak', 'select customer_place_order($1, $2::jsonb, null, $3)', [cafe, J([{ product_id: latte, quantity: 1 }]), tableA.qr_token], /dinonaktifkan/)
await setSettings('qr_ordering_enabled = true')

// ---------- D. Pembatalan ----------
await as(U.cust2)
await fails('customer lain tidak bisa membatalkan', 'select customer_cancel_order($1)', [tableOrder], /tidak ditemukan/)
await as(U.cust)
await q("select customer_cancel_order($1, 'salah meja')", [tableOrder])
row = await order(tableOrder)
check('dibatalkan customer: alasan & pembatal tercatat', row.order_status === 'cancelled' && row.cancelled_by === 'customer' && row.cancel_reason === 'salah meja')
const confirmed = (await (async () => { await as(U.cust); return place({}) })()).id
await advance(confirmed, 'confirmed')
await as(U.cust)
await fails('sudah diterima kafe → tidak bisa batal sendiri', 'select customer_cancel_order($1)', [confirmed], /sudah diproses/)
await as(U.staff)
await q("select staff_cancel_order($1, 'bahan habis')", [confirmed])
check('dibatalkan kafe tercatat "cafe"', (await order(confirmed)).cancelled_by === 'cafe')

// ---------- Notifikasi ----------
await as(U.cust)
const inbox = await q('select title, body, data from notifications order by created_at')
check('notifikasi: diterima + dibatalkan kafe (pembatalan sendiri tidak dinotifikasi)', inbox.length === 2 && /diterima/.test(inbox[0].title) && /bahan habis/.test(inbox[1].body), J(inbox))
await as(U.cust2)
check('notifikasi orang lain tidak terlihat', (await q('select 1 from notifications')).length === 0)
await as(U.cust)
check('tandai dibaca', (await one('select notifications_mark_read() n')).n === 2)
await fails('token push tidak valid ditolak', "select push_register('abc', 'android')", [], /tidak valid/)
await q("select push_register('ExponentPushToken[abc123XYZ]', 'android')")
await as(U.cust2)
await q("select push_register('ExponentPushToken[abc123XYZ]', 'ios')")
await su()
check('token pindah ke akun yang masuk terakhir', (await one("select user_id from push_tokens where token = 'ExponentPushToken[abc123XYZ]'")).user_id === U.cust2)

// ---------- E. Voucher ----------
await as(U.owner)
await q(`insert into vouchers (cafe_id, code, name, discount_type, discount_value, max_discount, min_subtotal, usage_limit, per_customer_limit, is_public)
  values ($1, 'HEMAT10', 'Hemat 10%', 'percent', 10, 5000, 25000, 2, 1, true), ($1, 'RAHASIA', 'Voucher rahasia', 'amount', 15000, null, 0, null, 1, false)`, [cafe])
await fails('kode huruf kecil ditolak', "insert into vouchers (cafe_id, code, name, discount_type, discount_value) values ($1, 'abc', 'Kecil', 'amount', 1000)", [cafe], /check/)
await as(U.cust)
check('customer hanya melihat voucher publik', (await q('select code from vouchers')).map((v) => v.code).join() === 'HEMAT10')
check('cek voucher: di bawah minimal', /Minimal belanja Rp 25.000/.test((await one("select voucher_check($1, 'hemat10', 20000) r", [cafe])).r.message))
check('cek voucher: 10% dari 28.000 = 2.800', num((await one("select voucher_check($1, 'HEMAT10', 28000) r", [cafe])).r.discount) === 2800)
check('cek voucher: maks 5.000', num((await one("select voucher_check($1, 'HEMAT10', 90000) r", [cafe])).r.discount) === 5000)
await setSettings('tax_enabled = true, tax_rate = 10')
await as(U.cust)
await fails('voucher di bawah minimal ditolak saat checkout', "select customer_place_order($1, $2::jsonb, null, null, null, null, null, null, 'HEMAT10')", [cafe, J([{ product_id: bread, quantity: 1 }])], /Minimal belanja/)
const vOrder = (await place({ voucher: 'hemat10', key: 'voucher-key-01' })).id
row = await order(vOrder)
check('voucher: diskon 2.800, pajak dari 25.200, total 27.720', num(row.discount_amount) === 2800 && num(row.voucher_discount) === 2800 && num(row.tax_amount) === 2520 && num(row.total_amount) === 27720, J({ d: row.discount_amount, t: row.tax_amount, total: row.total_amount }))
check('alasan diskon menyebut voucher', row.discount_reason === 'Voucher HEMAT10' && row.voucher_code === 'HEMAT10')
await as(U.cust)
await place({ voucher: 'HEMAT10', key: 'voucher-key-01' })
await su()
check('retry dengan kunci sama tidak memakai kuota lagi', (await one('select count(*)::int c from voucher_redemptions')).c === 1)
await as(U.cust)
await fails('batas per customer', "select customer_place_order($1, $2::jsonb, null, null, null, null, null, null, 'HEMAT10')", [cafe, J([{ product_id: latte, quantity: 1 }])], /sudah memakai/)
await q("select customer_cancel_order($1)", [vOrder])
await su()
check('batal → voucher dilepas', (await one('select status from voucher_redemptions where order_id = $1', [vOrder])).status === 'released')
await as(U.cust)
const vOrder2 = (await place({ voucher: 'HEMAT10' })).id
await as(U.cust2)
await place({ voucher: 'RAHASIA' })
await as(U.cust2)
await su()
await db.query("update vouchers set usage_limit = 1 where code = 'HEMAT10'")
await as(U.cust2)
await fails('kuota habis', "select customer_place_order($1, $2::jsonb, null, null, null, null, null, null, 'HEMAT10')", [cafe, J([{ product_id: latte, quantity: 1 }])], /Kuota voucher/)
await su()
check('log aktivitas voucher', (await one("select count(*)::int c from audit_logs where entity = 'vouchers'")).c >= 2)

// Akuntansi (07) membaca diskon voucher apa adanya
await as(U.owner)
await q('select acc_setup($1, current_date, $2::jsonb)', [cafe, J([{ code: '1-1100', amount: 100000 }, { code: '3-1000', amount: 100000 }])])
await advance(vOrder2, 'confirmed', 'preparing', 'ready', 'completed')
await su()
const sale = await q(`select a.code, l.debit::numeric d, l.credit::numeric c from journal_lines l join journal_entries j on j.id = l.journal_id join accounts a on a.id = l.account_id
  where j.source_id = $1 and j.event = 'completed'`, [vOrder2])
check('jurnal penjualan: diskon voucher 2.800 ke 4-2000', num(sale.find((r) => r.code === '4-2000')?.d) === 2800, J(sale))

// ---------- F. Loyalti ----------
await as(U.cust)
check('loyalti nonaktif', (await one('select loyalty_me($1) r', [cafe])).r.enabled === false)
await setSettings("loyalty_enabled = true, loyalty_tiers = '[{\"name\":\"Bronze\",\"min_spend\":0,\"multiplier\":1},{\"name\":\"Silver\",\"min_spend\":100000,\"multiplier\":2}]'::jsonb")
const big = async (who, qty, extra = {}) => { await as(who); return (await place({ items: [{ product_id: latte, quantity: qty }], ...extra })).id }
const o1 = await big(U.cust, 4) // 112.000 + pajak 10% = 123.200 → 12 poin
await advance(o1, 'confirmed', 'preparing', 'ready', 'completed')
await as(U.cust)
let me = (await one('select loyalty_me($1) r', [cafe])).r
check('poin dari pesanan selesai (123.200 → 12)', me.balance === 12, J(me))
check('naik ke Silver setelah belanja ≥ 100rb', me.tier.name === 'Silver')
const completedNote = (await one("select body from notifications where data->>'order_id' = $1 and data->>'status' = 'completed'", [o1])).body
check('notifikasi selesai menyebut poin', /12 poin/.test(completedNote), completedNote)
const o2 = await big(U.cust, 4)
await advance(o2, 'confirmed', 'preparing', 'ready', 'completed')
await as(U.cust)
me = (await one('select loyalty_me($1) r', [cafe])).r
check('Silver: poin ×2 (12 + 24 = 36)', me.balance === 36, me.balance)
await advance(o2) // tidak ada perubahan
await su()
await db.query("update orders set notes = 'x' where id = $1", [o2])
check('poin tidak dobel', (await one("select count(*)::int c from loyalty_ledger where order_id = $1 and kind = 'earn'", [o2])).c === 1)
await as(U.cust)
await fails('tukar di bawah minimal (50) ditolak', 'select customer_place_order($1, $2::jsonb, null, null, null, null, null, null, null, 10)', [cafe, J([{ product_id: latte, quantity: 1 }])], /Minimal tukar 50/)
await as(U.owner)
await fails('penyesuaian tanpa alasan ditolak', 'select loyalty_adjust($1, $2, 30, null)', [cafe, U.cust], /alasan/)
await q("select loyalty_adjust($1, $2, 30, 'bonus ulang tahun')", [cafe, U.cust])
await as(U.cust)
await fails('customer tidak bisa menyesuaikan poin', "select loyalty_adjust($1, $2, 100, 'curang')", [cafe, U.cust], /Hanya owner/)
await fails('poin melebihi saldo ditolak', 'select customer_place_order($1, $2::jsonb, null, null, null, null, null, null, null, 500)', [cafe, J([{ product_id: latte, quantity: 2 }])], /Poin tidak cukup/)
const redeemOrder = (await place({ items: [{ product_id: latte, quantity: 2 }], points: 66 })).id
row = await order(redeemOrder)
check('tukar poin dibatasi 50% subtotal: 56.000 → maks 28.000 = 280 poin, minta 66 → 66 poin = 6.600', row.points_redeemed === 66 && num(row.points_discount) === 6600 && num(row.discount_amount) === 6600, J({ p: row.points_redeemed, d: row.points_discount }))
await as(U.cust)
check('saldo berkurang 66', (await one('select loyalty_me($1) r', [cafe])).r.balance === 0)
await q('select customer_cancel_order($1)', [redeemOrder])
check('batal → poin kembali', (await one('select loyalty_me($1) r', [cafe])).r.balance === 66)
// Refund disetujui → poin pesanan itu dikurangi sebanding
await as(U.staff)
await q('select cashier_open($1, 50000)', [cafe])
await q("select pos_record_payments($1, $2::jsonb)", [o1, J([{ method: 'cash', amount: 123200 }])])
await as(U.owner)
const refund = await one("select * from refund_request($1, 61600, 'cash', 'setengah tumpah')", [o1])
if (refund.status !== 'approved') await q('select refund_decide($1, true)', [refund.id])
await as(U.cust)
me = (await one('select loyalty_me($1) r', [cafe])).r
check('refund 50% → 6 poin dikurangi', me.balance === 60, me.balance)
const history = await q('select kind, points from loyalty_ledger order by created_at')
check('riwayat poin lengkap', history.map((h) => h.kind).join() === 'earn,earn,adjust,redeem,redeem_return,refund', history.map((h) => h.kind).join())
await as(U.cust2)
check('riwayat poin orang lain tidak terlihat', (await q('select 1 from loyalty_ledger')).length === 0)
await as(U.owner)
const members = await q('select * from loyalty_customers($1)', [cafe])
check('owner melihat daftar member dengan nama', members.some((m) => m.full_name === 'Rani Putri' && m.points_balance === 60))

// ---------- G. Pesan ulang ----------
await su()
await db.query('update products set price = 30000 where id = $1', [latte])
const grp = (await one("insert into product_option_groups (cafe_id, product_id, name, selection_type, is_required) values ($1,$2,'Ukuran','single',false) returning id", [cafe, latte])).id
const large = (await one("insert into product_options (cafe_id, group_id, name, price_delta) values ($1,$2,'Large',5000) returning id", [cafe, grp])).id
await as(U.cust)
const withOption = (await place({ items: [{ product_id: latte, quantity: 1, option_ids: [large] }, { product_id: bread, quantity: 2 }] })).id
await su()
await db.query('update products set price = 32000 where id = $1', [latte])
await db.query('update products set is_available = false where id = $1', [bread])
await as(U.cust)
const reorder = await q('select * from customer_reorder_items($1)', [withOption])
const rl = reorder.find((r) => r.product_id === latte)
const rb = reorder.find((r) => r.product_id === bread)
check('pesan ulang: varian tetap, harga terkini 37.000', rl.option_ids.length === 1 && num(rl.unit_price) === 37000 && num(rl.old_unit_price) === 35000 && rl.note === 'Harga berubah', J(rl))
check('pesan ulang: menu habis ditandai', rb.available === false && rb.note === 'Sedang habis')
await as(U.cust2)
await fails('pesan ulang pesanan orang lain ditolak', 'select * from customer_reorder_items($1)', [withOption], /tidak ditemukan/)
await su()
await db.query('update products set is_available = true where id = $1', [bread])

// ---------- H. Ulasan & wishlist ----------
await as(U.cust)
await fails('ulasan sebelum selesai ditolak', 'select review_submit($1, $2, 5)', [withOption, latte], /setelah pesanan selesai/)
await fails('ulasan menu yang tidak dipesan ditolak', 'select review_submit($1, $2, 5)', [o1, bread], /tidak ada di pesanan/)
await q("select review_submit($1, $2, 4, 'Enak, agak manis')", [o1, latte])
await q("select review_submit($1, $2, 5, 'Mantap')", [o1, latte])
await as(U.cust2)
await fails('ulasan pesanan orang lain ditolak', 'select review_submit($1, $2, 1)', [o1, latte], /tidak ditemukan/)
await as(null)
let summary = await one('select * from product_rating_summary($1) where product_id = $2', [cafe, latte])
check('ulasan diperbarui, bukan dobel (1 ulasan, 5.0)', summary.reviews === 1 && num(summary.rating) === 5, J(summary))
const pub = await one('select * from product_reviews_public($1)', [latte])
check('nama pengulas disingkat', pub.reviewer === 'Rani P.' && pub.comment === 'Mantap', pub.reviewer)
await as(U.staff)
const reviewId = (await (async () => { await su(); return one('select id from product_reviews') })()).id
await as(U.staff)
await fails('staff tidak bisa memoderasi', 'select review_moderate($1, true)', [reviewId], /tidak ditemukan/)
await as(U.owner)
await q("select review_moderate($1, true, 'Terima kasih!')", [reviewId])
await as(null)
check('ulasan disembunyikan tidak dihitung', (await q('select * from product_rating_summary($1)', [cafe])).length === 0)
await as(U.cust)
await q('insert into wishlist_items (product_id) values ($1)', [latte])
check('wishlist: kafe diisi dari produk', (await one('select cafe_id, customer_id from wishlist_items')).cafe_id === cafe)
await as(U.cust2)
check('wishlist orang lain tidak terlihat', (await q('select 1 from wishlist_items')).length === 0)

// ---------- I. Bantuan ----------
await as(U.cust)
const ticket = (await one("select support_open($1, 'Pesanan kurang', 'Croissant tidak ada', $2) id", [cafe, o1])).id
await as(U.cust2)
check('tiket orang lain tidak terlihat', (await q('select 1 from support_tickets')).length === 0)
await fails('membalas tiket orang lain ditolak', "select support_reply($1, 'halo')", [ticket], /tidak ditemukan/)
await as(U.staff)
check('staff melihat tiket kafe', (await q('select 1 from support_tickets')).length === 1)
await q("select support_reply($1, 'Maaf, kami antar sekarang')", [ticket])
await as(U.cust)
check('status tiket: dijawab', (await one('select status from support_tickets where id = $1', [ticket])).status === 'answered')
check('balasan kafe masuk notifikasi', (await q("select 1 from notifications where kind = 'support'")).length === 1)
check('percakapan 2 pesan', (await q('select 1 from support_messages where ticket_id = $1', [ticket])).length === 2)
await as(U.ownerB)
check('owner kafe lain tidak melihat tiket', (await q('select 1 from support_tickets')).length === 0)

if (failures.length) {
  console.error(`\n${passed} lulus, ${failures.length} GAGAL:`)
  for (const failure of failures) console.error(` ✗ ${failure}`)
  process.exit(1)
}
console.log(`\n${passed} lulus, 0 gagal`)
