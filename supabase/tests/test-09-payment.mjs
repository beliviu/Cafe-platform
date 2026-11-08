// Uji file usulan/09 + Edge Function payments (kode asli) dengan Postgres lokal (PGlite) dan Midtrans palsu.
// TIDAK menyentuh database live maupun Midtrans. Jalankan: node --experimental-strip-types test-09-payment.mjs
import { PGlite } from '@electric-sql/pglite'
import crypto from 'node:crypto'
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
await db.exec("set timezone to 'Asia/Jakarta'") // current_date di tes = tanggal WIB (sama dengan kode)
await db.exec('create role service_role nologin bypassrls; grant usage on schema public, auth to service_role;')
for (const file of ['04-owner-dashboard.sql', '05-inventori-supplier.sql', '06-pesanan-v2-pos.sql', '07-akuntansi.sql', '08-pelanggan-qr.sql']) await db.exec(usulan(file))
const results = await db.exec(usulan('09-payment-gateway.sql'))
check('verifikasi 10 baris', results.at(-1).rows.length === 10, results.at(-1).rows.map((r) => r.name).join(','))
await db.exec(usulan('09-payment-gateway.sql'))
passed += 1 // aman dijalankan ulang

const U = {
  owner: '00000000-0000-0000-0000-00000000000a', staff: '00000000-0000-0000-0000-00000000005a',
  cust: '00000000-0000-0000-0000-0000000000c1', cust2: '00000000-0000-0000-0000-0000000000c2',
}
for (const id of Object.values(U)) await db.query('insert into auth.users (id) values ($1)', [id])
const cafe = (await one("insert into cafes (name, accepted_payment_methods) values ('Kopi A', array['cash','qris']) returning id")).id
await db.query(`insert into profiles (id, cafe_id, full_name, role) values ($1,$2,'Owner','owner'),($3,$2,'Staff','staff'),($4,null,'Rani','customer'),($5,null,'Bagas','customer')`,
  [U.owner, cafe, U.staff, U.cust, U.cust2])
const latte = (await one("insert into products (cafe_id, name, price) values ($1,'Latte',28000) returning id", [cafe])).id
await db.query('update cafe_settings set tax_enabled = true, tax_rate = 10 where cafe_id = $1', [cafe])
await as(U.owner)
await q('select acc_setup($1, current_date, $2::jsonb)', [cafe, J([{ code: '1-1100', amount: 100000 }, { code: '3-1000', amount: 100000 }])])
const newOrder = async (who = U.cust, qty = 1) => { await as(who); return (await one('select customer_place_order($1, $2::jsonb) id', [cafe, J([{ product_id: latte, quantity: qty }])])).id }
const order = async (id) => { await su(); return one('select * from orders where id = $1', [id]) }
const balanceOf = async (code) => { await su(); return num((await one(`select coalesce(sum(l.debit - l.credit), 0) b from journal_lines l join accounts a on a.id = l.account_id where a.cafe_id = $1 and a.code = $2`, [cafe, code])).b) }

// ---------- Midtrans palsu ----------
const SERVER_KEY = 'SB-Mid-server-TEST'
const gateway = new Map() // provider order id → { status, gross, txid }
const gatewayLog = []
let refundMode = 'ok'
let chargeMode = 'ok'
globalThis.fetch = async (input, init = {}) => {
  const target = new URL(String(input))
  const body = init.body ? JSON.parse(init.body) : null
  gatewayLog.push(`${init.method} ${target.pathname}`)
  const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  if (init.headers?.Authorization !== `Basic ${Buffer.from(`${SERVER_KEY}:`).toString('base64')}`) return reply(401, { status_code: '401' })
  if (target.pathname === '/v2/charge') {
    if (chargeMode === 'fail') return reply(400, { status_code: '400', status_message: 'QRIS sedang gangguan' })
    const id = body.transaction_details.order_id
    gateway.set(id, { status: 'pending', gross: body.transaction_details.gross_amount, txid: `tx-${id}` })
    return reply(200, {
      status_code: '201', transaction_status: 'pending', transaction_id: `tx-${id}`, order_id: id, gross_amount: `${body.transaction_details.gross_amount}.00`,
      qr_string: `00020101021226${id}`, actions: [{ name: 'generate-qr-code', method: 'GET', url: `https://api.sandbox.midtrans.com/v2/qris/tx-${id}/qr-code` }],
      expiry_time: '2099-01-01 10:00:00',
    })
  }
  const match = target.pathname.match(/^\/v2\/([^/]+)\/(status|cancel|refund)$/)
  if (match) {
    const id = decodeURIComponent(match[1])
    const tx = gateway.get(id)
    if (!tx) return reply(404, { status_code: '404', status_message: 'Transaction not found' })
    if (match[2] === 'cancel') { tx.status = 'cancel'; return reply(200, { status_code: '200' }) }
    if (match[2] === 'refund') {
      if (refundMode === 'fail') return reply(412, { status_code: '412', status_message: 'Refund belum diaktifkan' })
      tx.refunds = [...(tx.refunds || []), body]
      return reply(200, { status_code: '200', status_message: 'Success, refund request is approved', refund_chargeback_id: tx.refunds.length + 100, refund_amount: `${body.amount}.00`, refund_key: body.refund_key })
    }
    return reply(200, { status_code: tx.status === 'settlement' ? '200' : '201', transaction_status: tx.status, transaction_id: tx.txid, order_id: id, gross_amount: `${tx.gross}.00`, fraud_status: 'accept' })
  }
  return reply(404, { status_code: '404' })
}

// ---------- Supabase tiruan (RPC → PGlite sebagai service_role) ----------
const TOKENS = { 'tok-owner': U.owner, 'tok-staff': U.staff, 'tok-cust': U.cust, 'tok-cust2': U.cust2 }
globalThis.__stub = {
  createClient: (_url, _key, options = {}) => ({
    auth: { getUser: async () => { const token = (options.global?.headers?.Authorization || '').replace('Bearer ', ''); const id = TOKENS[token]; return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } } } },
    rpc: async (name, args = {}) => {
      const keys = Object.keys(args)
      const values = keys.map((key) => (args[key] !== null && typeof args[key] === 'object' ? JSON.stringify(args[key]) : args[key]))
      const call = `public.${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(', ')})`
      try {
        await db.exec('reset role')
        await db.query("select set_config('request.jwt.claim.sub', '', false)")
        await db.exec('set role service_role')
        if (name === 'pay_reconcile_targets') return { data: (await db.query(`select * from ${call}`, values)).rows, error: null }
        return { data: (await db.query(`select ${call} as r`, values)).rows[0].r, error: null }
      } catch (error) {
        return { data: null, error: { message: error.message, hint: error.hint } }
      } finally {
        await db.exec('reset role')
      }
    },
  }),
}
const ENV = { SUPABASE_URL: 'http://local', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', MIDTRANS_SERVER_KEY: SERVER_KEY, MIDTRANS_ENV: 'sandbox' }
let handler
globalThis.Deno = { env: { get: (key) => ENV[key] }, serve: (fn) => { handler = fn } }
const source = fs.readFileSync(new URL('../functions/payments/index.ts', import.meta.url), 'utf8')
  .replace("import { createClient } from 'npm:@supabase/supabase-js@2.49.1'", 'const { createClient } = (globalThis as any).__stub')
const tmp = new URL('./.tmp-payments-fn.ts', import.meta.url)
fs.writeFileSync(tmp, source)
await import(pathToFileURL(tmp.pathname.replace(/^\/([A-Za-z]:)/, '$1')).href)
fs.unlinkSync(tmp)

const call = async (token, body) => {
  const response = await handler(new Request('http://local/functions/v1/payments', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  return { status: response.status, body: await response.json().catch(() => null) }
}
const sign = (orderId, statusCode, gross) => crypto.createHash('sha512').update(`${orderId}${statusCode}${gross}${SERVER_KEY}`).digest('hex')
const webhook = async (note, signature) => {
  const response = await handler(new Request('http://local/functions/v1/payments?webhook=midtrans', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...note, signature_key: signature ?? sign(note.order_id, note.status_code, note.gross_amount) }),
  }))
  return response.status
}

// ---------- Gateway nonaktif ----------
const o1 = await newOrder()
let res = await call('tok-cust', { action: 'create', order_id: o1 })
check('gateway nonaktif → 409', res.status === 409 && res.body.hint === 'gateway_disabled', J(res))
await su()
await db.query('update cafe_settings set payment_gateway_enabled = true where cafe_id = $1', [cafe])

// ---------- Buat QRIS ----------
await as(U.cust)
await fails('authenticated tidak bisa memanggil fungsi server', "select pay_apply_status('x','x','settlement',null,1,'{}'::jsonb,'webhook',true)", [], /permission denied/)
res = await call('tok-cust2', { action: 'create', order_id: o1 })
check('customer lain tidak bisa membuat tagihan', res.status === 400 && /tidak ditemukan/.test(res.body.error), J(res))
res = await call('tok-nope', { action: 'create', order_id: o1 })
check('token tidak valid → 401', res.status === 401)
res = await call('tok-cust', { action: 'create', order_id: o1 })
const intent1 = res.body.intent
check('tagihan QRIS dibuat: 30.800 (28.000 + pajak), QR tersedia', res.status === 200 && num(intent1.amount) === 30800 && intent1.status === 'pending' && intent1.qr_string && intent1.qr_url, J(res))
check('pilihan bayar pesanan jadi QRIS, belum lunas', (await order(o1)).payment_method === 'qris' && (await order(o1)).payment_status === 'unpaid')
res = await call('tok-cust', { action: 'create', order_id: o1 })
check('buat lagi → tagihan yang sama dipakai ulang', res.body.reused === true && res.body.intent.id === intent1.id)
await as(U.cust)
check('customer bisa melihat tagihannya (RLS)', (await q('select status from payment_intents where order_id = $1', [o1])).length === 1)
await as(U.cust2)
check('customer lain tidak melihat tagihan', (await q('select 1 from payment_intents')).length === 0)

// ---------- Webhook ----------
const pid = intent1.provider_order_id
let status = await webhook({ order_id: pid, status_code: '200', gross_amount: '30800.00', transaction_status: 'settlement' }, 'palsu')
check('webhook tanda tangan palsu → 401, tidak lunas', status === 401 && (await order(o1)).payment_status === 'unpaid')
await su()
check('webhook palsu tercatat', (await one("select count(*)::int c from payment_events where result = 'bad_signature'")).c === 1)
status = await webhook({ order_id: pid, status_code: '200', gross_amount: '30800.00', transaction_status: 'settlement', transaction_id: `tx-${pid}` })
check('tanda tangan valid tapi Midtrans bilang masih pending → TIDAK lunas', status === 200 && (await order(o1)).payment_status === 'unpaid')
gateway.get(pid).status = 'settlement'
status = await webhook({ order_id: pid, status_code: '200', gross_amount: '30800.00', transaction_status: 'settlement', transaction_id: `tx-${pid}` })
let row = await order(o1)
check('settlement terverifikasi → pesanan lunas', status === 200 && row.payment_status === 'paid' && num(row.paid_amount) === 30800, J({ s: row.payment_status, p: row.paid_amount }))
await su()
const pays = await q("select * from payments where order_id = $1 and status = 'paid'", [o1])
check('satu baris pembayaran gateway (QRIS)', pays.length === 1 && pays[0].verification === 'gateway' && pays[0].method === 'qris' && pays[0].reference === `tx-${pid}`)
await webhook({ order_id: pid, status_code: '200', gross_amount: '30800.00', transaction_status: 'settlement', transaction_id: `tx-${pid}` })
await webhook({ order_id: pid, status_code: '200', gross_amount: '30800.00', transaction_status: 'settlement', transaction_id: `tx-${pid}` })
await su()
check('webhook dobel tidak membuat pembayaran dobel', (await one("select count(*)::int c from payments where order_id = $1 and status = 'paid'", [o1])).c === 1)
gateway.get(pid).status = 'expire'
await webhook({ order_id: pid, status_code: '407', gross_amount: '30800.00', transaction_status: 'expire' })
check('status expire setelah lunas diabaikan', (await order(o1)).payment_status === 'paid')
check('jurnal: QRIS masuk Saldo QRIS & e-wallet', (await balanceOf('1-1150')) === 30800)
await su()
check('notifikasi "Pembayaran diterima" untuk customer', (await q("select 1 from notifications where user_id = $1 and title = 'Pembayaran diterima'", [U.cust])).length === 1)
res = await call('tok-cust', { action: 'create', order_id: o1 })
check('pesanan lunas tidak bisa dibuatkan tagihan lagi', res.status === 400 && /sudah lunas/.test(res.body.error))

// ---------- Nominal berubah → tagihan lama ditutup ----------
const o2 = await newOrder(U.cust, 2)
res = await call('tok-cust', { action: 'create', order_id: o2 })
const oldPid = res.body.intent.provider_order_id
await as(U.staff)
await q('select cashier_open($1, 50000)', [cafe])
await q("select pos_record_payments($1, $2::jsonb)", [o2, J([{ method: 'cash', amount: 10000, tendered: 10000 }])])
res = await call('tok-cust', { action: 'create', order_id: o2 })
check('sisa tagihan berubah → tagihan baru (51.600)', res.body.intent.provider_order_id !== oldPid && num(res.body.intent.amount) === 51600, J(res.body))
check('tagihan lama dibatalkan di Midtrans', gateway.get(oldPid).status === 'cancel')
await su()
check('tagihan lama berstatus expired', (await one('select status from payment_intents where provider_order_id = $1', [oldPid])).status === 'expired')

// ---------- Sudah dibayar cara lain lalu QRIS juga masuk → ditandai perlu ditinjau ----------
const newPid = res.body.intent.provider_order_id
await as(U.staff)
await q("select pos_record_payments($1, $2::jsonb)", [o2, J([{ method: 'cash', amount: 51600, tendered: 51600 }])])
gateway.get(newPid).status = 'settlement'
await webhook({ order_id: newPid, status_code: '200', gross_amount: '51600.00', transaction_status: 'settlement' })
await su()
const review = await one('select status, review_reason, payment_id from payment_intents where provider_order_id = $1', [newPid])
check('bayar ganda → lunas di gateway, ditandai perlu refund, tanpa baris pembayaran ganda', review.status === 'paid' && /kembalikan dana/.test(review.review_reason) && review.payment_id === null, J(review))
check('total dibayar pesanan tidak melebihi tagihan', num((await order(o2)).paid_amount) === 61600)

// ---------- Webhook terlambat → cek status manual ----------
const o3 = await newOrder()
res = await call('tok-cust', { action: 'create', order_id: o3 })
gateway.get(res.body.intent.provider_order_id).status = 'settlement'
res = await call('tok-cust', { action: 'status', order_id: o3 })
check('cek status: lunas tanpa webhook', res.body.changed === 1 && (await order(o3)).payment_status === 'paid', J(res))
res = await call('tok-cust2', { action: 'status', order_id: o3 })
check('cek status pesanan orang lain ditolak', res.status === 400)

// ---------- Kedaluwarsa & rekonsiliasi kafe ----------
const o4 = await newOrder()
res = await call('tok-cust', { action: 'create', order_id: o4 })
gateway.get(res.body.intent.provider_order_id).status = 'expire'
res = await call('tok-cust', { action: 'reconcile', cafe_id: cafe })
check('customer tidak bisa rekonsiliasi kafe', res.status === 400)
res = await call('tok-staff', { action: 'reconcile', cafe_id: cafe })
await su()
check('rekonsiliasi staff: tagihan kedaluwarsa', res.status === 200 && (await one('select status from payment_intents where order_id = $1 and status <> $2', [o4, 'creating'])).status === 'expired', J(res))
res = await call('tok-cust', { action: 'create', order_id: o4 })
check('tagihan baru setelah kedaluwarsa', res.status === 200 && res.body.intent.status === 'pending')

// ---------- Kasir (POS) ----------
await as(U.staff)
const pos = (await one("select place_order($1, $2::jsonb, 'pos') id", [cafe, J([{ product_id: latte, quantity: 1 }])])).id
res = await call('tok-cust', { action: 'create', order_id: pos, source: 'pos' })
check('customer tidak bisa membuat QR kasir', res.status === 400)
res = await call('tok-staff', { action: 'create', order_id: pos, source: 'pos' })
check('staff membuat QRIS dinamis di kasir', res.status === 200 && res.body.intent.status === 'pending')

// ---------- Gagal charge ----------
const o5 = await newOrder()
chargeMode = 'fail'
res = await call('tok-cust', { action: 'create', order_id: o5 })
await su()
check('charge ditolak gateway → 502, tagihan gagal', res.status === 502 && (await one('select status, failure_message from payment_intents where order_id = $1', [o5])).status === 'failed', J(res))
chargeMode = 'ok'
res = await call('tok-cust', { action: 'create', order_id: o5 })
check('coba lagi setelah gagal → tagihan baru', res.status === 200)

// ---------- Refund lewat gateway ----------
res = await call('tok-staff', { action: 'refund', order_id: o1, amount: 10000, reason: 'Salah menu' })
check('staff tidak bisa refund gateway', res.status === 400 && /Hanya owner/.test(res.body.error))
res = await call('tok-owner', { action: 'refund', order_id: o1, amount: 50000, reason: 'Kebanyakan' })
check('refund melebihi pembayaran ditolak', res.status === 400 && /maksimal/.test(res.body.error), J(res))
res = await call('tok-owner', { action: 'refund', order_id: o1, amount: 10000, reason: 'Es kurang' })
await su()
const r1 = await one("select r.status, r.method, pr.status pr_status, p.verification from refunds r join payment_refunds pr on pr.refund_id = r.id left join payments p on p.refund_id = r.id where r.order_id = $1", [o1])
check('refund owner sukses: disetujui, tercatat gateway', res.status === 200 && r1.status === 'approved' && r1.method === 'qris' && r1.pr_status === 'succeeded' && r1.verification === 'gateway', J(r1))
check('Midtrans menerima refund_key = id refund', gateway.get(pid).refunds?.[0]?.refund_key === res.body.refund_id && gateway.get(pid).refunds[0].amount === 10000)
check('pesanan: dikembalikan 10.000', num((await order(o1)).refunded_amount) === 10000)
// Pengajuan staff lalu owner mengembalikan lewat gateway
await as(U.staff)
const req = await one("select * from refund_request($1, 5000, 'qris', 'sedotan kurang')", [o1])
check('pengajuan staff menunggu owner', req.status === 'requested')
refundMode = 'fail'
res = await call('tok-owner', { action: 'refund', refund_id: req.id })
await su()
check('gateway menolak refund → 502, pengajuan tetap menunggu', res.status === 502 && (await one('select status from refunds where id = $1', [req.id])).status === 'requested'
  && (await one('select status from payment_refunds where refund_id = $1', [req.id])).status === 'failed', J(res))
refundMode = 'ok'
res = await call('tok-owner', { action: 'refund', refund_id: req.id })
await su()
check('coba lagi → refund disetujui', res.status === 200 && (await one('select status from refunds where id = $1', [req.id])).status === 'approved')
res = await call('tok-owner', { action: 'refund', refund_id: req.id })
check('refund yang sama tidak dikirim dua kali', res.status === 200 && gateway.get(pid).refunds.length === 2, J(gateway.get(pid).refunds?.length))
res = await call('tok-owner', { action: 'refund', order_id: o2, amount: 1000, reason: 'uji tunai' })
check('jurnal: saldo QRIS = 2 pembayaran gateway − 2 refund (46.600)', (await balanceOf('1-1150')) === 30800 + 30800 - 10000 - 5000, await balanceOf('1-1150'))
check('pesanan tunai tidak bisa refund lewat gateway', res.status === 400 && /tidak dibayar lewat QRIS online/.test(res.body.error), J(res))

// ---------- Ringkasan & akses ----------
await as(U.owner)
const summary = (await one("select payment_gateway_summary($1, (now() at time zone 'Asia/Jakarta')::date, (now() at time zone 'Asia/Jakarta')::date) s", [cafe])).s
check('ringkasan owner: lunas, perlu ditinjau, refund', summary.paid_count === 3 && summary.review_count === 1 && num(summary.refunded_amount) === 15000 && summary.last_webhook_at, J(summary))
check('owner melihat log event', (await q('select 1 from payment_events')).length > 5)
await as(U.staff)
check('staff tidak melihat log event', (await q('select 1 from payment_events')).length === 0)
await fails('staff tidak bisa melihat ringkasan', 'select payment_gateway_summary($1, current_date, current_date)', [cafe], /Hanya owner/)
check('kunci server tidak pernah ada di database', !(await (async () => { await su(); return J(await q('select payload from payment_events')) })()).includes(SERVER_KEY))

if (failures.length) {
  console.error(`\n${passed} lulus, ${failures.length} GAGAL:`)
  for (const failure of failures) console.error(` ✗ ${failure}`)
  process.exit(1)
}
console.log(`\n${passed} lulus, 0 gagal`)
