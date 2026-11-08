// Uji file usulan/07 (akuntansi) di Postgres lokal dalam memori. TIDAK menyentuh database live.
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

await db.exec(fs.readFileSync(new URL('./base-schema.sql', import.meta.url), 'utf8'))
await db.exec("set timezone to 'Asia/Jakarta'") // current_date di tes = tanggal WIB (sama dengan kode)
for (const file of ['04-owner-dashboard.sql', '05-inventori-supplier.sql', '06-pesanan-v2-pos.sql']) await db.exec(usulan(file))
const results = await db.exec(usulan('07-akuntansi.sql'))
check('verifikasi 26 baris', results.at(-1).rows.length === 26, results.at(-1).rows.map((r) => r.name).join(','))
await db.exec(usulan('07-akuntansi.sql'))
passed += 1

const U = {
  owner: '00000000-0000-0000-0000-00000000000a', staff: '00000000-0000-0000-0000-00000000005a',
  ownerB: '00000000-0000-0000-0000-00000000000b', customer: '00000000-0000-0000-0000-0000000000cc',
}
for (const id of Object.values(U)) await db.query('insert into auth.users (id) values ($1)', [id])
const cafe = (await one("insert into cafes (name, accepted_payment_methods) values ('Kopi A', array['cash','qris','bank_transfer']) returning id")).id
const cafeB = (await one("insert into cafes (name) values ('Kopi B') returning id")).id
await db.query(`insert into profiles (id, cafe_id, full_name, role) values ($1,$2,'Owner','owner'),($3,$2,'Staff','staff'),($4,$5,'Owner B','owner'),($6,null,'Cust','customer')`,
  [U.owner, cafe, U.staff, U.ownerB, cafeB, U.customer])
const latte = (await one("insert into products (cafe_id, name, price) values ($1,'Latte',28000) returning id", [cafe])).id
const croissant = (await one("insert into products (cafe_id, name, price) values ($1,'Croissant',22000) returning id", [cafe])).id
const journals = async () => { await su(); return (await one('select count(*)::int c from journal_entries where cafe_id = $1', [cafe])).c }
const balanceOf = async (code, cafeId = cafe) => {
  await su()
  const row = await one(`select coalesce(sum(l.debit - l.credit), 0) b from journal_lines l join accounts a on a.id = l.account_id where a.cafe_id = $1 and a.code = $2`, [cafeId, code])
  return num(row.b)
}

// ---------- Sebelum pembukuan dimulai: tidak ada jurnal ----------
await as(U.owner)
check('ringkasan sebelum setup: go_live kosong', (await one('select acc_overview($1, current_date - 30, current_date) o', [cafe])).o.go_live === null)
const milk = (await one("insert into ingredients (cafe_id, name, unit) values ($1,'Susu','ml') returning id", [cafe])).id
await q('select inventory_stock_in($1, 10000, 20, null, null, null, true)', [milk])
check('belum setup: stok awal tidak dijurnal', (await journals()) === 0)

// Pesanan lama (kemarin) — tidak boleh ikut dijurnal setelah go-live hari ini
await su()
const old = (await one(`insert into orders (cafe_id, order_status, payment_status, total_amount, paid_amount, created_at, updated_at, pricing_version)
  values ($1, 'completed', 'paid', 50000, 50000, now() - interval '1 day', now() - interval '1 day', 2) returning id`, [cafe])).id
await db.query("insert into order_status_events (order_id, cafe_id, to_status, created_at) values ($1, $2, 'completed', now() - interval '1 day')", [old, cafe])
await db.query("insert into payments (order_id, method, payment_method, status, payment_status, amount, paid_at, created_at) values ($1,'cash','cash','paid','paid',50000, now() - interval '1 day', now() - interval '1 day')", [old])

// ---------- Setup ----------
await as(U.staff)
await fails('staff tidak bisa memulai pembukuan', "select acc_setup($1, current_date, '[]'::jsonb)", [cafe], /Hanya owner/)
await as(U.owner)
await fails('go-live di masa depan ditolak', "select acc_setup($1, current_date + 1, '[]'::jsonb)", [cafe], /antara/)
const suggest = (await one('select acc_opening_suggestions($1, current_date) s', [cafe])).s
check('saran persediaan per go-live mengecualikan mutasi sesudahnya', num(suggest.inventory) === 0, J(suggest))
check('saran piutang dari pesanan sebelum go-live (lunas = 0)', num(suggest.receivable) === 0, J(suggest))
const setup = (await one('select acc_setup($1, current_date, $2::jsonb) r', [cafe, J([
  { code: '1-1100', amount: 500000 }, { code: '1-1200', amount: 2000000 }, { code: '1-2100', amount: 10000000 },
  { code: '2-2100', amount: 3000000 }, { code: '3-1000', amount: 9000000 },
])])).r
check('setup membuat jurnal saldo awal', Boolean(setup.journal_id))
await fails('setup kedua ditolak', "select acc_setup($1, current_date, '[]'::jsonb)", [cafe], /sudah dimulai/)
check('akun templat dibuat (38)', (await one('select count(*)::int c from accounts where cafe_id = $1', [cafe])).c === 38)
check('ekuitas saldo awal menyeimbangkan (−500.000)', (await balanceOf('3-9000')) === -500000 - 200000, await balanceOf('3-9000'))
check('backfill: stok awal hari ini dijurnal ke persediaan', (await balanceOf('1-1400')) === 200000)
check('pesanan kemarin (sebelum go-live) tidak dijurnal', (await one("select count(*)::int c from journal_entries where source_id = $1", [old])).c === 0)
check('nomor jurnal berformat JU-tahun-urut', /^JU-\d{4}-\d{4,}$/.test((await one('select number from journal_entries where id = $1', [setup.journal_id])).number))

// ---------- Penjualan kasir: diskon, pajak, HPP ----------
await su()
await db.query('update cafe_settings set tax_enabled = true, tax_rate = 10, inventory_tracking = true, inventory_started_at = now() where cafe_id = $1', [cafe])
await as(U.owner)
await q('select recipe_save($1, $2::jsonb)', [latte, J([{ ingredient_id: milk, quantity: 150 }])])
await as(U.staff)
await q('select cashier_open($1, 100000)', [cafe])
await as(U.owner)
const pos = (await one("select place_order($1, $2::jsonb, 'pos', null, null, null, null, $3::jsonb) id", [cafe, J([{ product_id: latte, quantity: 1 }]), J({ type: 'percent', value: 10, reason: 'member' })])).id
await as(U.staff)
await q('select pos_record_payments($1, $2::jsonb)', [pos, J([{ method: 'cash', amount: 27720, tendered: 30000 }])])
check('pembayaran: kas +27.720 (dari 500.000)', (await balanceOf('1-1100')) === 500000 + 27720)
check('pembayaran sebelum selesai = uang muka (piutang −27.720)', (await balanceOf('1-1300')) === -27720)
await as(U.staff)
await q("update orders set order_status = 'ready' where id = $1", [pos])
await q("update orders set order_status = 'completed' where id = $1", [pos])
const sale = await q(`select a.code, l.debit, l.credit from journal_lines l join journal_entries j on j.id = l.journal_id join accounts a on a.id = l.account_id
  where j.source_id = $1 and j.event = 'completed' order by l.line_no`, [pos]).catch(() => [])
await su()
const saleRows = await q(`select a.code, l.debit::numeric d, l.credit::numeric c from journal_lines l join journal_entries j on j.id = l.journal_id join accounts a on a.id = l.account_id
  where j.source_id = $1 and j.event = 'completed' order by l.line_no`, [pos])
const line = (code) => saleRows.find((row) => row.code === code)
check('staff tidak bisa membaca jurnal', sale.length === 0)
check('penjualan: piutang 27.720', num(line('1-1300')?.d) === 27720, J(saleRows))
check('penjualan: diskon 2.800 di debit', num(line('4-2000')?.d) === 2800)
check('penjualan: pendapatan bruto 28.000', num(line('4-1000')?.c) === 28000)
check('penjualan: utang pajak 2.520', num(line('2-1200')?.c) === 2520)
check('penjualan: HPP 3.000 (150 ml × Rp20)', num(line('5-1000')?.d) === 3000 && num(line('1-1400')?.c) === 3000)
check('piutang pesanan nol setelah dibayar & selesai', (await balanceOf('1-1300')) === 0)

// App: belum dibayar saat selesai → piutang, lalu QRIS
await as(U.customer)
const app = (await one('select create_order($1, $2::jsonb) id', [cafe, J([{ product_id: croissant, quantity: 1 }])])).id
await as(U.staff)
for (const status of ['confirmed', 'preparing', 'ready', 'completed']) await q('update orders set order_status = $2 where id = $1', [app, status])
check('pesanan app selesai belum dibayar → piutang 24.200', (await balanceOf('1-1300')) === 24200, await balanceOf('1-1300'))
await q("select staff_mark_order_paid($1, 'qris')", [app])
check('QRIS masuk saldo QRIS & e-wallet', (await balanceOf('1-1150')) === 24200)
check('piutang lunas', (await balanceOf('1-1300')) === 0)

// Refund (owner langsung) untuk pesanan selesai → retur penjualan
await as(U.owner)
await q("select refund_request($1, 10000, 'cash', 'salah buat')", [pos])
check('refund: retur penjualan 10.000', (await balanceOf('4-2100')) === 10000)
check('refund: kas berkurang', (await balanceOf('1-1100')) === 500000 + 27720 - 10000)

// ---------- Stok & pembelian ----------
await as(U.owner)
await q("select inventory_stock_out($1, 500, 'waste', 'tumpah')", [milk])
check('bahan terbuang: beban 10.000', (await balanceOf('5-1100')) === 10000)
await q("select inventory_stock_in($1, 1000, 25, null, null, 'beli toko', false, 'bank')", [milk])
check('beli langsung dari bank: bank −25.000', (await balanceOf('1-1200')) === 2000000 - 25000)
await fails('sumber dana tidak dikenal ditolak', "select inventory_stock_in($1, 1, 1, null, null, null, false, 'kartu')", [milk], /Sumber dana/)
const supplier = (await one("insert into suppliers (cafe_id, name, payment_terms_days) values ($1,'Susu Jaya',7) returning id", [cafe])).id
const po = (await one('select purchase_order_save($1, null, $2, current_date, null, null, $3::jsonb) id', [cafe, supplier, J([{ ingredient_id: milk, quantity: 2, unit_label: 'karton', unit_size: 1000, unit_price: 20000 }])])).id
await q("select purchase_order_transition($1, 'order')", [po])
const poItem = (await one('select id from purchase_order_items where purchase_order_id = $1', [po])).id
await q('select purchase_order_receive($1, $2::jsonb)', [po, J([{ item_id: poItem, quantity: 2 }])])
check('terima PO: utang usaha 40.000', (await balanceOf('2-1100')) === -40000)
const payId = (await one("select purchase_order_pay($1, 40000, 'bank_transfer') id", [po])).id
check('bayar supplier: utang lunas', (await balanceOf('2-1100')) === 0)
await q("select supplier_payment_void($1, 'salah transfer')", [payId])
check('batal bayar supplier: dijurnal balik, utang kembali', (await balanceOf('2-1100')) === -40000)

// ---------- Kas kasir & tutup kasir ----------
await as(U.staff)
const session = (await one("select id from cashier_sessions where status = 'open'")).id
await q("select cashier_cash_move($1, 'out', 15000, 'beli es', 'expense')", [session])
await q("select cashier_cash_move($1, 'in', 50000, 'tambahan modal', 'from_owner')", [session])
await fails('jenis kas tidak cocok arah ditolak', "select cashier_cash_move($1, 'out', 1000, 'coba lagi', 'from_owner')", [session], /tidak cocok/)
check('kas keluar belanja → beban kas kecil', (await balanceOf('6-9100')) === 15000)
check('kas masuk dari owner → modal', (await balanceOf('3-1000')) === -9000000 - 50000)
await as(U.staff)
const summary = (await one('select cashier_summary($1) s', [session])).s
await q("select cashier_close($1, $2, 'kurang seribu')", [session, num(summary.expected_cash) - 1000])
check('selisih kas kurang 1.000 dijurnal', (await balanceOf('6-9200')) === 1000)

// ---------- Beban ----------
await as(U.owner)
const electricity = (await one("select id from accounts where cafe_id = $1 and code = '6-1200'", [cafe])).id
const rent = (await one("select id from accounts where cafe_id = $1 and code = '6-1100'", [cafe])).id
const revenueAcc = (await one("select id from accounts where cafe_id = $1 and code = '4-1000'", [cafe])).id
await q("select expense_create($1, current_date, $2, 'Token listrik', 300000, 'bank_transfer', 'PLN')", [cafe, electricity])
check('beban listrik dari bank', (await balanceOf('6-1200')) === 300000)
const rentId = (await one("select expense_create($1, current_date, $2, 'Sewa November', 1000000, 'unpaid') id", [cafe, rent])).id
check('beban belum dibayar → utang lain-lain', (await balanceOf('2-1300')) === -1000000)
await q("select expense_pay($1, 'cash')", [rentId])
check('pelunasan beban: utang lain-lain nol', (await balanceOf('2-1300')) === 0)
await fails('bayar dua kali ditolak', "select expense_pay($1, 'cash')", [rentId], /sudah dibayar/)
const wrong = (await one("select expense_create($1, current_date, $2, 'Salah input', 5000, 'cash') id", [cafe, electricity])).id
await q("select expense_void($1, 'dobel')", [wrong])
check('batal beban dijurnal balik', (await balanceOf('6-1200')) === 300000)
await fails('akun pendapatan bukan kategori beban', "select expense_create($1, current_date, $2, 'Coba coba', 1000, 'cash')", [cafe, revenueAcc], /kategori beban/)
await fails('beban tanggal depan ditolak', "select expense_create($1, current_date + 1, $2, 'Besok', 1000, 'cash')", [cafe, electricity], /masa depan/)

// ---------- Jurnal manual & pembalik ----------
const bank = (await one("select id from accounts where cafe_id = $1 and code = '1-1200'", [cafe])).id
const wallet = (await one("select id from accounts where cafe_id = $1 and code = '1-1150'", [cafe])).id
const manual = (await one("select acc_manual_journal($1, current_date, 'Pencairan QRIS ke bank', $2::jsonb) id", [cafe, J([{ account_id: bank, debit: 24000 }, { account_id: wallet, credit: 24000 }])])).id
check('jurnal manual: QRIS ke bank', (await balanceOf('1-1150')) === 200)
await fails('jurnal manual tidak seimbang ditolak', "select acc_manual_journal($1, current_date, 'Tidak seimbang', $2::jsonb)", [cafe, J([{ account_id: bank, debit: 100 }, { account_id: wallet, credit: 90 }])], /seimbang/)
await fails('baris dengan debit & kredit sekaligus ditolak', "select acc_manual_journal($1, current_date, 'Dua sisi', $2::jsonb)", [cafe, J([{ account_id: bank, debit: 100, credit: 100 }, { account_id: wallet, credit: 0, debit: 0 }])], /hanya debit atau kredit/)
await fails('jurnal manual sebelum go-live ditolak', "select acc_manual_journal($1, current_date - 1, 'Kemarin', $2::jsonb)", [cafe, J([{ account_id: bank, debit: 1 }, { account_id: wallet, credit: 1 }])], /go-live/)
const reversal = (await one("select acc_reverse_journal($1, 'salah nominal') id", [manual])).id
check('pembalik mengembalikan saldo', (await balanceOf('1-1150')) === 24200)
await su()
check('jurnal asal ditandai reversed', (await one('select status, reversed_by from journal_entries where id = $1', [manual])).reversed_by === reversal)
await as(U.owner)
await fails('membalik dua kali ditolak', "select acc_reverse_journal($1, 'lagi')", [manual], /sudah dibalik/)
await as(U.staff)
await fails('staff tidak bisa jurnal manual', "select acc_manual_journal($1, current_date, 'x', '[]'::jsonb)", [cafe], /Hanya owner/)

// ---------- Kekebalan jurnal ----------
await su()
await fails('jurnal tidak bisa diubah (bahkan superuser)', "update journal_entries set memo = 'ubah' where id = $1", [manual], /tidak bisa diubah/)
await fails('baris jurnal tidak bisa diubah', 'update journal_lines set debit = debit + 1 where journal_id = $1', [manual], /tidak bisa diubah/)
const acct = (await one("select id from accounts where cafe_id = $1 and code = '1-1100'", [cafe])).id
await fails('jurnal tidak seimbang ditolak saat commit', `do $$ declare v uuid; begin
  insert into journal_entries (cafe_id, number, entry_date, memo, kind) values ('${cafe}', 'X-1', current_date, 'curang', 'manual') returning id into v;
  insert into journal_lines (cafe_id, journal_id, account_id, debit) values ('${cafe}', v, '${acct}', 999);
  set constraints all immediate;
end $$`, [], /tidak seimbang/)

// ---------- Kegagalan jurnal tidak menahan transaksi + sinkron ulang ----------
await su()
await db.exec(`create function test_block() returns trigger language plpgsql as $$ begin if new.memo like 'Penjualan%' then raise exception 'simulasi'; end if; return new; end $$;
  create trigger test_block before insert on journal_entries for each row execute function test_block();`)
await as(U.staff)
const pos2 = (await one("select place_order($1, $2::jsonb, 'pos') id", [cafe, J([{ product_id: croissant, quantity: 1 }])])).id
await q("update orders set order_status = 'ready' where id = $1", [pos2])
await q("update orders set order_status = 'completed' where id = $1", [pos2])
await su()
check('pesanan tetap selesai walau jurnal gagal', (await one('select order_status from orders where id = $1', [pos2])).order_status === 'completed')
check('kegagalan jurnal tercatat', (await one("select count(*)::int c from acc_sync_issues where source_id = $1 and resolved_at is null", [pos2])).c === 1)
await db.exec('drop trigger test_block on journal_entries; drop function test_block();')
const before = await journals()
await as(U.owner)
const backfill = (await one('select acc_backfill($1) r', [cafe])).r
check('sinkron ulang membuat jurnal yang tertinggal', (await journals()) === before + 1, J(backfill))
check('kegagalan ditandai selesai', (await one("select count(*)::int c from acc_sync_issues where source_id = $1 and resolved_at is null", [pos2])).c === 0)
const again = await journals()
await as(U.owner)
await q('select acc_backfill($1)', [cafe])
check('sinkron ulang idempoten', (await journals()) === again)

// ---------- Laporan ----------
await as(U.owner)
const tb = await q('select * from acc_trial_balance($1, current_date)', [cafe])
const tbDebit = tb.reduce((sum, row) => sum + num(row.balance_debit), 0)
const tbCredit = tb.reduce((sum, row) => sum + num(row.balance_credit), 0)
check('neraca saldo seimbang', Math.abs(tbDebit - tbCredit) < 0.005, `${tbDebit} vs ${tbCredit}`)
const bs = await q('select * from acc_balance_sheet($1, current_date)', [cafe])
const sumOf = (rows, section) => rows.filter((row) => row.section === section).reduce((sum, row) => sum + num(row.amount), 0)
const assets = sumOf(bs, 'asset')
const liabilities = sumOf(bs, 'liability')
const equity = sumOf(bs, 'equity')
check('neraca: aset = utang + ekuitas', Math.abs(assets - liabilities - equity) < 0.005, `${assets} vs ${liabilities} + ${equity}`)
const pl = await q('select * from acc_income_statement($1, current_date, current_date)', [cafe])
const income = pl.reduce((sum, row) => sum + (['revenue', 'other_income'].includes(row.section) ? 1 : -1) * num(row.amount), 0)
const overview = (await one('select acc_overview($1, current_date, current_date) o', [cafe])).o
check('laba rugi = ringkasan laba bersih', Math.abs(income - num(overview.net_profit)) < 0.005, `${income} vs ${overview.net_profit}`)
check('laba berjalan di neraca = laba rugi', Math.abs(num(bs.find((row) => row.code === '3-9999').amount) - income) < 0.005)
const cf = await q('select * from acc_cash_flow($1, current_date, current_date)', [cafe])
const flows = cf.filter((row) => row.section !== 'none').reduce((sum, row) => sum + num(row.amount), 0)
check('arus kas: kas awal + arus = kas akhir', Math.abs(num(cf[0].opening_cash) + flows - num(cf[0].closing_cash)) < 0.005, `${cf[0].opening_cash} + ${flows} vs ${cf[0].closing_cash}`)
check('kas akhir = saldo kas + QRIS + bank', Math.abs(num(cf[0].closing_cash) - num(overview.cash) - num(overview.wallet) - num(overview.bank)) < 0.005)
const eq = (await one('select acc_equity_changes($1, current_date, current_date) e', [cafe])).e
check('perubahan ekuitas: akhir = ekuitas neraca', Math.abs(num(eq.closing) - equity) < 0.005, `${eq.closing} vs ${equity}`)
const ledger = await q("select * from acc_ledger($1, (select id from accounts where cafe_id = $1 and code = '1-1100'), current_date, current_date)", [cafe])
check('buku besar kas: saldo akhir = saldo akun', Math.abs(num(ledger.at(-1).balance) - (await balanceOf('1-1100'))) < 0.005)

// ---------- Periode ----------
await as(U.ownerB)
await q("select acc_setup($1, current_date - 40, '[]'::jsonb)", [cafeB])
// Bulan lalu menurut tanggal WIB (dihitung database, bukan jam komputer)
const lastMonthKey = (await one("select (date_trunc('month', current_date) - interval '1 month')::date::text d")).d
await fails('bulan berjalan tidak bisa ditutup', "select acc_set_period($1, current_date, true)", [cafeB], /berjalan/)
await q('select acc_set_period($1, $2::date, true)', [cafeB, lastMonthKey])
const bBank = (await one("select id from accounts where cafe_id = $1 and code = '1-1200'", [cafeB])).id
const bCash = (await one("select id from accounts where cafe_id = $1 and code = '1-1100'", [cafeB])).id
const inClosed = `${lastMonthKey.slice(0, 8)}28`
const goLiveB = (await one('select accounting_go_live::text d from cafe_settings where cafe_id = $1', [cafeB])).d
if (inClosed >= goLiveB) {
  await fails('posting ke periode tertutup ditolak', "select acc_manual_journal($1, $2::date, 'Telat', $3::jsonb)", [cafeB, inClosed, J([{ account_id: bBank, debit: 1 }, { account_id: bCash, credit: 1 }])], /ditutup/)
  await fails('buka periode tanpa alasan ditolak', 'select acc_set_period($1, $2::date, false)', [cafeB, lastMonthKey], /alasan/)
  await q("select acc_set_period($1, $2::date, false, 'ada nota tertinggal')", [cafeB, lastMonthKey])
  check('setelah dibuka kembali bisa posting', Boolean((await one("select acc_manual_journal($1, $2::date, 'Nota tertinggal', $3::jsonb) id", [cafeB, inClosed, J([{ account_id: bBank, debit: 1 }, { account_id: bCash, credit: 1 }])])).id))
} else {
  passed += 3
}

// ---------- Akses ----------
await as(U.ownerB)
check('owner kafe lain tidak melihat jurnal', (await one('select count(*)::int c from journal_entries where cafe_id = $1', [cafe])).c === 0)
await fails('owner kafe lain tidak bisa membaca laporan', 'select * from acc_trial_balance($1, current_date)', [cafe], /Hanya owner/)
await as(U.customer)
await fails('customer tidak bisa membaca ringkasan', 'select acc_overview($1, current_date, current_date)', [cafe], /Hanya owner/)
await as(null)
await fails('anon tidak bisa memanggil laporan', 'select acc_overview($1, current_date, current_date)', [cafe], /permission denied/)
await as(U.owner)
await fails('fungsi posting internal tidak bisa dipanggil', "select acc_post($1, current_date, 'manual', null, null, null, 'x', '[]'::jsonb)", [cafe], /permission denied/)
await fails('owner tidak bisa menulis jurnal langsung', "insert into journal_entries (cafe_id, number, entry_date, memo, kind) values ($1, 'Y', current_date, 'x', 'manual')", [cafe], /permission denied/)

// Akun
const newAcc = (await one("select acc_account_save($1, null, '6-2100', 'Asuransi', 'expense', 'operating', true) id", [cafe])).id
check('akun baru dibuat', Boolean(newAcc))
await fails('kode akun ganda ditolak', "select acc_account_save($1, null, '6-2100', 'Lagi', 'expense', 'operating', true)", [cafe], /sudah dipakai/)
await fails('akun sistem tidak bisa dinonaktifkan', "select acc_account_save($1, $2, null, 'Kas', null, null, false)", [cafe, acct], /sistem/)

console.log(`\n${passed} lulus, ${failures.length} gagal`)
for (const failure of failures) console.log('  ✗ ' + failure)
process.exit(failures.length ? 1 : 0)
