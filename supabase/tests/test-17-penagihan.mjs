// Uji file usulan/17: nomor tagihan tanpa loncat, harga cabang, kredit, promo, referral, nonaktif & aktif otomatis,
// pengingat bertahap, order Midtrans lama, kuitansi, keuangan platform, dan hak akses semua fungsi baru.
// PGlite — TIDAK menyentuh database live.
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
const su = () => db.exec('reset role')
async function asService() {
  await db.exec('reset role')
  await q("select set_config('request.jwt.claim.sub', '', false)")
  await q("select set_config('request.jwt.claims', '', false)")
  await db.exec('set role service_role')
}
async function fails(name, sql, params = [], pattern) {
  try {
    await db.query(sql, params)
    failures.push(`${name} → seharusnya gagal`)
  } catch (error) {
    if (pattern && !pattern.test(error.message)) failures.push(`${name} → pesan: ${error.message}`)
    else passed += 1
  }
}
async function works(name, sql, params = []) {
  try {
    const rows = (await db.query(sql, params)).rows
    passed += 1
    return rows
  } catch (error) {
    failures.push(`${name} → ${error.message}`)
    return []
  }
}
const num = (value) => Number(value)

// ---------- Skema ----------
await db.exec(fs.readFileSync(new URL('./base-schema.sql', import.meta.url), 'utf8'))
await db.exec("set timezone to 'Asia/Jakarta'; create role service_role nologin bypassrls; grant usage on schema public, auth to service_role;")
await db.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant execute on function auth.jwt() to anon, authenticated, service_role;
  grant execute on function auth.uid() to service_role;`)
for (const file of ['04-owner-dashboard.sql', '05-inventori-supplier.sql', '06-pesanan-v2-pos.sql', '07-akuntansi.sql', '08-pelanggan-qr.sql',
  '09-payment-gateway.sql', '10-izin-langganan-keamanan.sql', '12-qris-statis.sql', '13-tamu-qr-meja.sql', '14-platform-admin.sql',
  '15-notifikasi-platform.sql', '16-kesehatan-analitik-tiket.sql']) await db.exec(usulan(file))

const U = {
  admin: '00000000-0000-0000-0000-0000000000e1', admin2: '00000000-0000-0000-0000-0000000000e2',
  ownerA: '00000000-0000-0000-0000-0000000000a1', staffA: '00000000-0000-0000-0000-0000000000a2',
  ownerB: '00000000-0000-0000-0000-0000000000b1', ownerN: '00000000-0000-0000-0000-0000000000c2',
  ownerS: '00000000-0000-0000-0000-0000000000d1', ownerW: '00000000-0000-0000-0000-0000000000d2', ownerM: '00000000-0000-0000-0000-0000000000d3',
  cust: '00000000-0000-0000-0000-0000000000c1',
}
for (const [key, id] of Object.entries(U)) await q('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@contoh.id`])
const cafe = async (name, days) => (await one(`insert into cafes (name, created_at) values ($1, now() - make_interval(days => $2)) returning id`, [name, days])).id

// Tagihan lama dari urutan file 14 (bulan berjalan) — nomor baru harus melanjutkan
const yymm = (await one("select to_char(now() at time zone 'Asia/Jakarta', 'YYMM') v")).v
const A = await cafe('Kopi Induk', 200)
const B = await cafe('Kopi Cabang', 100)
const N = await cafe('Kedai Baru', 5)
const S = await cafe('Kopi Telat', 200)
const W = await cafe('Kopi Hampir', 200)
const M = await cafe('Kopi Manual', 200)
await q(`insert into profiles (id, cafe_id, full_name, role) values
  ($1,$2,'Owner A','owner'), ($3,$2,'Staff A','staff'), ($4,$5,'Owner B','owner'), ($6,$7,'Owner N','owner'),
  ($8,$9,'Owner S','owner'), ($10,$11,'Owner W','owner'), ($12,$13,'Owner M','owner'), ($14,null,'Rani','customer')`,
  [U.ownerA, A, U.staffA, U.ownerB, B, U.ownerN, N, U.ownerS, S, U.ownerW, W, U.ownerM, M, U.cust])
await q("insert into platform_admins (user_id, full_name) values ($1, 'Admin Satu'), ($2, 'Admin Dua')", [U.admin, U.admin2])
await q('update platform_admins set is_active = false where user_id = $1', [U.admin2])
await q(`insert into subscription_invoices (number, cafe_id, plan_code, months, period_start, period_end, amount, status, due_at, paid_at, method)
  values ($1, $2, 'pro', 1, now() - interval '60 days', now() - interval '30 days', 349000, 'paid', now() - interval '60 days', now() - interval '59 days', 'manual_transfer')`,
  [`INV-${yymm}-00005`, A])

// ---------- Jalankan file 17 ----------
const result = await db.exec(usulan('17-penagihan-otomatis.sql'))
const verify = result.at(-1).rows
check('verifikasi: 6 tabel + 3 trigger, tanpa tabel tanpa RLS', verify.length === 9 && !verify.some((row) => row.kind === 'tanpa_rls'), J(verify))
try { await db.exec(usulan('17-penagihan-otomatis.sql')); passed += 1 } catch (error) { failures.push(`dijalankan ulang → ${error.message}`) }

// Kafe lama dapat kode referral; kafe baru otomatis
await su()
const codes = await q('select id, referral_code from cafes')
check('semua kafe punya kode referral unik', codes.every((row) => /^[A-Z]{2,4}[A-HJ-NP-Z2-9]{4}$/.test(row.referral_code)) && new Set(codes.map((row) => row.referral_code)).size === codes.length, J(codes))
const codeA = codes.find((row) => row.id === A).referral_code
check('kode referral A diawali huruf nama', codeA.startsWith('KOPI'), codeA)
const tmp = await cafe('Z', 1)
check('kafe baru: kode referral terisi (nama pendek → KAFE)', (await one('select referral_code v from cafes where id = $1', [tmp])).v.startsWith('KAFE'))
// Data lama: list_amount terisi
check('tagihan lama: list_amount = amount', num((await one("select list_amount v from subscription_invoices where number = $1", [`INV-${yymm}-00005`])).v) === 349000)

// ---------- B. Nomor tagihan ----------
const next = async () => (await one('select public.pa_next_invoice_number() v')).v
await db.exec('begin')
const n1 = await next()
await db.exec('rollback')
const n2 = await next()
const n3 = await next()
check('nomor melanjutkan urutan lama (00006)', n1 === `INV-${yymm}-00006`, n1)
check('transaksi batal tidak membuat nomor loncat', n2 === n1, `${n1} / ${n2}`)
check('nomor berikutnya berurutan', n3 === `INV-${yymm}-00007`, n3)
// Nomor yang terlanjur dipakai dilewati, bukan diduplikasi
await q(`insert into subscription_invoices (number, cafe_id, plan_code, months, period_start, period_end, amount, status, due_at)
  values ($1, $2, 'pro', 1, now(), now() + interval '1 month', 1000, 'void', now())`, [`INV-${yymm}-00008`, M])
check('nomor bentrok dilewati', (await next()) === `INV-${yymm}-00009`)

// ---------- Langganan awal ----------
// A & B: Pro, berakhir 5 hari lagi (masuk H-7) · N: Pro masa coba berakhir 5 hari lagi
// S: Pro, berakhir 15 hari lalu, tagihan menunggu · W: Pro, berakhir 12,5 hari lalu · M: nonaktif manual
for (const id of [A, B]) await q("update cafe_subscriptions set plan_code = 'pro', status = 'active', trial_ends_at = null, current_period_end = now() + interval '5 days' where cafe_id = $1", [id])
await q("update cafe_subscriptions set plan_code = 'pro', status = 'trialing', trial_ends_at = now() + interval '5 days', current_period_end = null where cafe_id = $1", [N])
await q("update cafe_subscriptions set plan_code = 'pro', status = 'past_due', trial_ends_at = null, current_period_end = now() - interval '15 days' where cafe_id = $1", [S])
await q("update cafe_subscriptions set plan_code = 'pro', status = 'past_due', trial_ends_at = null, current_period_end = now() - interval '12 days 12 hours' where cafe_id = $1", [W])
await q("update cafe_subscriptions set plan_code = 'pro', status = 'past_due', trial_ends_at = null, current_period_end = now() - interval '30 days' where cafe_id = $1", [M])
for (const [id, days] of [[S, 15], [W, 12], [M, 30]]) {
  await q(`insert into subscription_invoices (number, cafe_id, plan_code, months, period_start, period_end, amount, list_amount, status, due_at, source)
    values (public.pa_next_invoice_number(), $1, 'pro', 1, now() - make_interval(days => $2), now() - make_interval(days => $2) + interval '1 month', 349000, 349000, 'pending', now() - make_interval(days => $2), 'system')`, [id, days])
}
await q("update cafes set suspended_at = now() - interval '2 days', suspended_reason = 'Melanggar ketentuan' where id = $1", [M])
check('nonaktif manual: jenis = manual', (await one('select suspended_kind v from cafes where id = $1', [M])).v === 'manual')

// ---------- F. Grup multi-cabang ----------
await as(U.admin, 'aal2')
const group = (await works('admin membuat grup', "select public.pa_billing_group_upsert(null, 'Grup Kopi', null, 'Dua cabang') v"))[0]?.v
await works('A masuk grup', 'select public.pa_cafe_set_billing_group($1, $2)', [A, group.id])
const setB = (await works('B masuk grup', 'select public.pa_cafe_set_billing_group($1, $2) v', [B, group.id]))[0]?.v
check('B (cabang ke-2): diskon bawaan 15% → 296.650', setB?.branch_discount_pct === 15 && num(setB.monthly_price) === 296650, J(setB))
await su()
check('A (kafe pertama): harga normal', num((await one('select public.pa_plan_price($1, $2) v', [A, 'pro'])).v) === 349000)
check('MRR ikut diskon cabang', num((await one('select monthly_price v from public.pa_cafe_rows() where cafe_id = $1', [B])).v) === 296650)
await as(U.admin, 'aal2')
await works('diskon grup 20%', "select public.pa_billing_group_upsert($1, 'Grup Kopi', 20, null)", [group.id])
await su()
check('B: diskon grup 20% → 279.200', num((await one('select public.pa_plan_price($1, $2) v', [B, 'pro'])).v) === 279200)
await q('update cafe_subscriptions set price_override = 250000 where cafe_id = $1', [B])
check('harga khusus admin menang atas diskon cabang', num((await one('select public.pa_plan_price($1, $2) v', [B, 'pro'])).v) === 250000)
await q('update cafe_subscriptions set price_override = null where cafe_id = $1', [B])
await as(U.admin, 'aal2')
const groups = (await works('daftar grup', 'select public.pa_billing_groups_list() v'))[0]?.v
check('daftar grup: 2 kafe berurutan, diskon 0 & 20', J(groups?.groups?.[0]?.cafes?.map((c) => c.discount_pct)) === J([0, 20]), J(groups))
await fails('diskon grup 95% ditolak', "select public.pa_billing_group_upsert(null, 'Grup Besar', 95, null)", [], /0–90/)
await fails('nama grup 1 huruf ditolak', "select public.pa_billing_group_upsert(null, 'X', 10, null)", [], /minimal 2/)

// ---------- E. Referral ----------
await as(U.ownerN)
const infoN = (await works('owner N: info referral', 'select public.owner_referral_info($1) v', [N]))[0]?.v
check('N: boleh klaim (kafe baru, belum bayar)', infoN?.can_claim === true && infoN?.discount_pct === 20 && num(infoN?.reward_amount) === 50000, J(infoN))
const wrong = (await works('klaim kode salah → ok:false', "select public.owner_referral_claim($1, 'SALAH123') v", [N]))[0]?.v
check('kode salah: pesan jelas', wrong?.ok === false && /tidak dikenal/.test(wrong.error), J(wrong))
const self = (await works('klaim kode sendiri', 'select public.owner_referral_claim($1, $2) v', [N, codes.find((row) => row.id === N).referral_code]))[0]?.v
check('kode sendiri ditolak', self?.ok === false && /sendiri/.test(self.error), J(self))
const claim = (await works('klaim kode A (huruf kecil + spasi)', 'select public.owner_referral_claim($1, $2) v', [N, ` ${codeA.toLowerCase()} `]))[0]?.v
check('klaim berhasil: nama pengundang', claim?.ok === true && claim.referrer_name === 'Kopi Induk', J(claim))
const again = (await works('klaim kedua', 'select public.owner_referral_claim($1, $2) v', [N, codeA]))[0]?.v
check('klaim kedua ditolak', again?.ok === false && /sudah memakai/.test(again.error), J(again))
await as(U.ownerS)
const old = (await works('kafe lama klaim', 'select public.owner_referral_claim($1, $2) v', [S, codeA]))[0]?.v
check('kafe > 30 hari tidak bisa klaim', old?.ok === false && /30 hari/.test(old.error), J(old))
await fails('staff tidak bisa klaim', 'select public.owner_referral_claim($1, $2)', [A, 'X'], /owner/)
await as(U.staffA)
await fails('staff tidak bisa lihat info referral', 'select public.owner_referral_info($1)', [A], /owner/)

// ---------- G1. Penagihan harian: H-7 dengan harga cabang + referral ----------
await asService()
const run1 = (await works('service_role: pa_billing_run', 'select public.pa_billing_run() v'))[0]?.v
check('tagihan dibuat untuk A, B, N', run1?.invoices_created === 3, J(run1))
await su()
const inv = async (cafeId) => one("select * from subscription_invoices where cafe_id = $1 and status = 'pending' order by created_at desc limit 1", [cafeId])
const invA = await inv(A)
const invB = await inv(B)
const invN = await inv(N)
check('A: harga normal 349.000', num(invA.amount) === 349000 && num(invA.list_amount) === 349000, J(invA))
check('B: harga cabang 279.200', num(invB.amount) === 279200, J(invB))
check('N: diskon referral 20% → 279.200', num(invN.referral_discount) === 69800 && num(invN.amount) === 279200 && num(invN.list_amount) === 349000, J(invN))
check('nomor tagihan berurutan tanpa duplikat', new Set([invA.number, invB.number, invN.number]).size === 3 && [invA, invB, invN].every((row) => row.number.startsWith(`INV-${yymm}-`)))
check('S telat 15 hari dari periode: dinonaktifkan? belum (periode sebelum fitur dinyalakan)', run1?.suspended === 0, J(run1))

// ---------- D. Promo ----------
await as(U.admin, 'aal2')
const promo = (await works('admin membuat promo 50%', `select public.pa_promo_upsert(null, 'hemat50', 'Diskon pembukaan', 'percent', 50, array['pro'], 1, false, 2, 1, null, now() + interval '30 days', true) v`))[0]?.v
check('kode promo disimpan huruf besar', promo?.code === 'HEMAT50' && promo.state === 'active', J(promo))
await works('promo nominal 400rb', "select public.pa_promo_upsert(null, 'GRATIS', null, 'amount', 400000, null, 1, false, null, 1, null, null, true)")
await works('promo minimal 3 bulan', "select public.pa_promo_upsert(null, 'TIGABULAN', null, 'percent', 10, null, 3, false, null, 1, null, null, true)")
await works('promo basic saja', "select public.pa_promo_upsert(null, 'BASICSAJA', null, 'percent', 10, array['basic'], 1, false, null, 1, null, null, true)")
await works('promo berakhir', "select public.pa_promo_upsert(null, 'LEWAT', null, 'percent', 10, null, 1, false, null, 1, now() - interval '10 days', now() - interval '1 day', true)")
await works('promo pertama kali', "select public.pa_promo_upsert(null, 'PERTAMA', null, 'percent', 10, null, 1, true, null, 1, null, null, true)")
await fails('promo persen > 100 ditolak', "select public.pa_promo_upsert(null, 'XX1', null, 'percent', 150, null, 1, false, null, 1, null, null, true)", [], /1–100/)
await fails('kode promo tidak valid ditolak', "select public.pa_promo_upsert(null, 'a b', null, 'percent', 10, null, 1, false, null, 1, null, null, true)", [], /3–24/)
await fails('kode promo duplikat ditolak', "select public.pa_promo_upsert(null, 'HEMAT50', null, 'percent', 10, null, 1, false, null, 1, null, null, true)", [], /sudah dipakai/)
await fails('paket tidak dikenal ditolak', "select public.pa_promo_upsert(null, 'XX2', null, 'percent', 10, array['emas'], 1, false, null, 1, null, null, true)", [], /Paket/)

const applyPromo = async (cafeId, invoiceId, code) => (await one('select public.owner_invoice_apply_promo($1, $2, $3) v', [cafeId, invoiceId, code])).v
await as(U.ownerA)
// Halaman bayar sudah dibuat → order lama disimpan saat nominal berubah
await su()
await q("update subscription_invoices set provider = 'midtrans', provider_order_id = $2, checkout_url = 'https://bayar/x', checkout_created_at = now() where id = $1", [invA.id, `${invA.number}-OLD`])
await as(U.ownerA)
const pA = await applyPromo(A, invA.id, ' hemat50 ')
check('A: promo 50% → 174.500', pA?.ok === true && num(pA.invoice.amount) === 174500 && num(pA.invoice.promo_discount) === 174500 && pA.invoice.promo_code === 'HEMAT50', J(pA))
check('owner tidak melihat provider_order_id / promo_id', !('provider_order_id' in pA.invoice) && !('promo_id' in pA.invoice) && !('previous_order_ids' in pA.invoice))
await su()
const afterPromo = await one('select provider_order_id, checkout_url, previous_order_ids from subscription_invoices where id = $1', [invA.id])
check('nominal berubah: halaman bayar lama dilepas, order lama disimpan', afterPromo.provider_order_id === null && afterPromo.checkout_url === null && J(afterPromo.previous_order_ids) === J([`${invA.number}-OLD`]), J(afterPromo))
await as(U.ownerA)
for (const [code, pattern] of [['TIGABULAN', /minimal 3 bulan/], ['BASICSAJA', /paket ini/], ['LEWAT', /berakhir/], ['NGAWUR', /tidak dikenal/]]) {
  const res = await applyPromo(A, invA.id, code)
  check(`promo ${code} ditolak`, res?.ok === false && pattern.test(res.error), J(res))
}
const first = await applyPromo(A, invA.id, 'PERTAMA')
check('promo pembayaran pertama ditolak (A pernah bayar)', first?.ok === false && /pertama/.test(first.error), J(first))
check('promo gagal tidak mengubah tagihan', num((await applyPromo(A, invA.id, 'HEMAT50')).invoice.amount) === 174500)
await as(U.ownerN)
const pN = await applyPromo(N, invN.id, 'HEMAT50')
check('promo tidak bisa digabung diskon referral', pN?.ok === false && /referral/.test(pN.error), J(pN))
await as(U.ownerB)
check('B: promo 50% dari harga cabang', num((await applyPromo(B, invB.id, 'HEMAT50')).invoice.amount) === 139600)
await as(U.ownerS)
const quota = await applyPromo(S, (await (async () => { await su(); const row = await inv(S); await as(U.ownerS); return row })()).id, 'HEMAT50')
check('kuota promo (2) habis', quota?.ok === false && /Kuota/.test(quota.error), J(quota))
await as(U.ownerB)
const removed = await applyPromo(B, invB.id, '')
check('promo dilepas → kembali 279.200', removed?.ok === true && num(removed.invoice.amount) === 279200 && removed.invoice.promo_code === null, J(removed))
await as(U.ownerS)
const freed = await applyPromo(S, (await (async () => { await su(); const row = await inv(S); await as(U.ownerS); return row })()).id, 'HEMAT50')
check('kuota terbebas setelah promo dilepas', freed?.ok === true, J(freed))
await applyPromo(S, freed.invoice.id, '')
// Batas percobaan: 10 kode salah per jam
await as(U.ownerB)
for (let index = 0; index < 10; index += 1) await applyPromo(B, invB.id, `SALAH${index}`)
const limited = await applyPromo(B, invB.id, 'HEMAT50')
check('lebih dari 10 percobaan salah → dibatasi', limited?.ok === false && /Terlalu banyak/.test(limited.error), J(limited))
await su()
await q('delete from billing_code_attempts where cafe_id = $1', [B])
await as(U.ownerB)
await fails('owner B tidak bisa pasang promo di tagihan A', 'select public.owner_invoice_apply_promo($1, $2, $3)', [B, invA.id, 'HEMAT50'], /tidak ditemukan/)
await fails('owner B tidak bisa pakai cafe_id A', 'select public.owner_invoice_apply_promo($1, $2, $3)', [A, invA.id, 'HEMAT50'], /owner/)
// Sedang diproses Midtrans → tidak boleh diubah
await su()
await q("update subscription_invoices set provider_status = 'pending' where id = $1", [invB.id])
await as(U.ownerB)
await fails('tagihan diproses Midtrans: promo ditolak', 'select public.owner_invoice_apply_promo($1, $2, $3)', [B, invB.id, 'HEMAT50'], /diproses Midtrans/)
await su()
await q('update subscription_invoices set provider_status = null where id = $1', [invB.id])

// Webhook dengan order LAMA (nominal lama ≥ nominal baru) tetap melunasi tagihan A
await asService()
const oldPaid = (await works('webhook order lama', "select public.pa_gateway_apply($1, 'settlement', 'accept', 349000, '{}'::jsonb) v", [`${invA.number}-OLD`]))[0]?.v
check('order lama dikenali & lunas', oldPaid?.paid === true && oldPaid.already === false, J(oldPaid))
await su()
check('A lunas via gateway, promo terpakai', (await one('select status, method from subscription_invoices where id = $1', [invA.id])).status === 'paid')
await as(U.admin, 'aal2')
const promos = (await works('daftar promo', 'select public.pa_promos_list() v'))[0]?.v
const hemat = promos?.find((p) => p.code === 'HEMAT50')
check('promo: terpakai 1, diskon total 174.500', hemat?.used === 1 && num(hemat.discount_total) === 174500, J(hemat))
check('promo berakhir: state expired', promos?.find((p) => p.code === 'LEWAT')?.state === 'expired')
await fails('kode promo yang sudah dipakai tidak bisa diganti', "select public.pa_promo_upsert($1, 'HEMAT60', null, 'percent', 50, null, 1, false, 2, 1, null, null, true)", [hemat.id], /tidak bisa diganti/)

// ---------- Referral → kredit; kredit memotong tagihan ----------
await asService()
await works('N bayar via gateway', "select public.pa_gateway_apply('x', 'settlement', 'accept', 1, '{}'::jsonb)")
await su()
await q("update subscription_invoices set provider_order_id = 'ORD-N' where id = $1", [invN.id])
await asService()
const paidN = (await works('N lunas', "select public.pa_gateway_apply('ORD-N', 'settlement', 'accept', 279200, '{}'::jsonb) v"))[0]?.v
check('N lunas', paidN?.paid === true, J(paidN))
await su()
const ref = await one('select * from cafe_referrals where referred_cafe_id = $1', [N])
check('referral: status rewarded', ref.status === 'rewarded' && ref.invoice_id === invN.id, J(ref))
check('A dapat kredit 50.000', num((await one("select sum(amount) v from cafe_credit_ledger where cafe_id = $1 and kind = 'referral'", [A])).v) === 50000)
check('A dapat notifikasi kredit referral', Boolean(await one("select 1 from cafe_notifications where cafe_id = $1 and kind = 'referral_reward'", [A])))
check('audit: referral.rewarded & referral.claim', Number((await one("select count(*) v from platform_audit_logs where action in ('referral.rewarded', 'referral.claim')")).v) === 2)
// Bayar lagi tidak menambah hadiah dua kali
await q("update cafe_referrals set status = 'rewarded' where referred_cafe_id = $1", [N])
await as(U.ownerA)
const infoA = (await works('owner A: info referral', 'select public.owner_referral_info($1) v', [A]))[0]?.v
check('A: 1 referral, kredit 50.000, tidak bisa klaim', infoA?.referrals?.length === 1 && num(infoA.credit_available) === 50000 && infoA.can_claim === false && num(infoA.earned_total) === 50000, J(infoA))

// Admin menambah kredit B 300.000 → tagihan B 279.200 lunas dengan kredit
await as(U.admin, 'aal2')
await fails('kredit tanpa alasan ditolak', 'select public.pa_credit_adjust($1, 100000, null)', [B], /alasan/)
await fails('kurangi kredit melebihi saldo ditolak', 'select public.pa_credit_adjust($1, -1000, $2)', [B, 'koreksi'], /tidak cukup/)
const adj = (await works('admin tambah kredit B', 'select public.pa_credit_adjust($1, 300000, $2) v', [B, 'Kompensasi gangguan']))[0]?.v
await su()
const paidB = await one('select * from subscription_invoices where id = $1', [invB.id])
check('B: tagihan lunas dengan kredit (metode credit, total 0)', paidB.status === 'paid' && paidB.method === 'credit' && num(paidB.amount) === 0 && num(paidB.credit_amount) === 279200, J(paidB))
check('B: saldo kredit sisa 20.800', num(adj?.balance) === 300000 && num((await one('select sum(amount) v from cafe_credit_ledger where cafe_id = $1', [B])).v) === 20800, J(adj))
check('B: langganan diperpanjang', (await one("select status, current_period_end > now() + interval '20 days' ok from cafe_subscriptions where cafe_id = $1", [B])).ok === true)
check('audit: credit.adjust tercatat', Boolean(await one("select 1 from platform_audit_logs where action = 'credit.adjust' and cafe_id = $1", [B])))

// Kredit dipesan oleh tagihan menunggu (tidak dipakai dua kali)
await as(U.ownerB)
const reqB = (await works('owner B minta tagihan 3 bulan', "select public.owner_invoice_request($1, 'pro', 3) v", [B]))[0]?.v
check('tagihan owner: harga cabang ×3 − kredit 20.800', num(reqB?.list_amount) === 837600 && num(reqB?.credit_amount) === 20800 && num(reqB?.amount) === 816800, J(reqB))
await su()
check('kredit tersedia B = 0 selama dipesan', num((await one('select public.pa_credit_available($1) v', [B])).v) === 0)
await as(U.admin, 'aal2')
await works('admin batalkan tagihan B', 'select public.pa_invoice_void($1, $2)', [reqB.id, 'tes'])
await su()
check('dibatalkan → kredit kembali tersedia', num((await one('select public.pa_credit_available($1) v', [B])).v) === 20800)

// ---------- G2. Nonaktif otomatis ----------
await su()
await q("update platform_settings set billing_enforce_from = now() - interval '60 days'")
await as(U.ownerS)
const statusS = (await works('status platform S', 'select public.cafe_platform_status($1) v', [S]))[0]?.v
check('S: tanggal nonaktif otomatis sudah lewat', statusS?.suspend_at && new Date(statusS.suspend_at) < new Date(), J(statusS))
await asService()
const run2 = (await works('pa_daily_check (nonaktif + pengingat)', 'select public.pa_daily_check() v'))[0]?.v
check('1 kafe dinonaktifkan otomatis (S)', run2?.billing?.suspended === 1, J(run2?.billing))
await su()
const cafeS = await one('select suspended_at, suspended_kind, suspended_reason from cafes where id = $1', [S])
check('S: nonaktif karena tagihan', cafeS.suspended_at && cafeS.suspended_kind === 'billing' && /14 hari/.test(cafeS.suspended_reason), J(cafeS))
check('S: owner diberi tahu + email dipaksa', Boolean(await one("select 1 from cafe_notifications where cafe_id = $1 and kind = 'cafe_suspended'", [S]))
  && Boolean(await one("select 1 from notification_outbox where cafe_id = $1 and kind = 'cafe_suspended'", [S])))
check('S: admin diberi tahu', Boolean(await one("select 1 from platform_notifications where cafe_id = $1 and kind = 'cafe_suspended'", [S])))
check('S: audit cafe.suspend oleh sistem', (await one("select actor_label v from platform_audit_logs where action = 'cafe.suspend' and cafe_id = $1", [S]))?.v === 'sistem')
check('W (nonaktif dalam ≤ 2 hari): belum nonaktif', (await one('select suspended_at v from cafes where id = $1', [W])).v === null)
check('W: peringatan terakhir + email dipaksa', Boolean(await one("select 1 from cafe_notifications where cafe_id = $1 and kind = 'suspend_warning'", [W]))
  && Boolean(await one("select 1 from notification_outbox where cafe_id = $1 and kind = 'suspend_warning'", [W])))
check('W: pengingat telat 3 hari', Boolean(await one("select 1 from cafe_notifications where cafe_id = $1 and kind = 'invoice_overdue_3'", [W])))
check('M: nonaktif manual tidak diubah', (await one('select suspended_kind v from cafes where id = $1', [M])).v === 'manual')
await asService()
const run3 = (await works('pengecekan kedua', 'select public.pa_daily_check() v'))[0]?.v
check('pengecekan kedua: tidak ada notifikasi ganda', run3?.owner_notifications === 0 && run3?.billing?.suspended === 0, J(run3))
await su()
check('pesanan S ditolak saat nonaktif', await (async () => {
  try { await q("insert into orders (cafe_id, total_amount) values ($1, 1000)", [S]); return false } catch { return true }
})())

// Kafe nonaktif karena tagihan boleh membayar; nonaktif manual tidak
await as(U.ownerS)
const statusS2 = (await works('status S setelah nonaktif', 'select public.cafe_platform_status($1) v', [S]))[0]?.v
check('status S: suspended_kind billing', statusS2?.suspended === true && statusS2.suspended_kind === 'billing', J(statusS2))
await works('S (nonaktif tagihan) boleh minta tagihan', "select public.owner_invoice_request($1, 'pro', 1)", [S])
await as(U.ownerM)
await fails('M (nonaktif manual) tidak boleh', "select public.owner_invoice_request($1, 'pro', 1)", [M], /Hubungi Dailybrew/)

// Bayar → aktif lagi otomatis
await su()
const invS = await one("select * from subscription_invoices where cafe_id = $1 and status = 'pending' and source = 'system'", [S])
await as(U.admin, 'aal2')
await works('admin tandai lunas tagihan S', 'select public.pa_invoice_mark_paid($1, null, $2, null)', [invS.id, 'TRF-1'])
await su()
const cafeS2 = await one('select suspended_at, suspended_kind from cafes where id = $1', [S])
check('S: aktif lagi otomatis setelah lunas', cafeS2.suspended_at === null && cafeS2.suspended_kind === null, J(cafeS2))
check('S: audit cafe.unsuspend oleh sistem', (await one("select actor_label v from platform_audit_logs where action = 'cafe.unsuspend' and cafe_id = $1", [S]))?.v === 'sistem')
check('S: notifikasi aktif kembali (owner & admin)', Boolean(await one("select 1 from cafe_notifications where cafe_id = $1 and kind = 'cafe_reactivated'", [S]))
  && Boolean(await one("select 1 from platform_notifications where cafe_id = $1 and kind = 'cafe_reactivated'", [S])))
check('S: banner nonaktif kedaluwarsa', (await one("select expires_at <= now() v from cafe_notifications where cafe_id = $1 and kind = 'cafe_suspended'", [S])).v === true)
// M (manual) dibayar → tetap nonaktif
const invM = await one("select * from subscription_invoices where cafe_id = $1 and status = 'pending'", [M])
await as(U.admin, 'aal2')
await works('admin tandai lunas tagihan M', 'select public.pa_invoice_mark_paid($1, null, null, null)', [invM.id])
await su()
check('M: nonaktif manual tetap nonaktif setelah bayar', (await one('select suspended_at is not null v from cafes where id = $1', [M])).v === true)

// Admin membuka nonaktif tagihan W secara manual → ditunda 7 hari, tidak langsung nonaktif lagi
await q("update cafe_subscriptions set current_period_end = now() - interval '20 days' where cafe_id = $1", [W])
await asService()
await works('W dinonaktifkan', 'select public.pa_billing_run()')
await su()
check('W: nonaktif (tagihan)', (await one('select suspended_kind v from cafes where id = $1', [W])).v === 'billing')
await as(U.admin, 'aal2')
await works('admin membuka W', 'select public.pa_cafe_set_suspended($1, false, null)', [W])
await asService()
await works('pengecekan berikutnya', 'select public.pa_billing_run()')
await su()
check('W: tidak dinonaktifkan lagi selama ditunda', (await one('select suspended_at v from cafes where id = $1', [W])).v === null)
check('W: penundaan 7 hari tercatat', (await one("select billing_pause_until > now() + interval '6 days' v from cafe_subscriptions where cafe_id = $1", [W])).v === true)

// Fitur dimatikan → tidak ada penonaktifan
await q("update cafe_subscriptions set billing_pause_until = null where cafe_id = $1", [W])
await as(U.admin, 'aal2')
await works('admin mematikan nonaktif otomatis', `select public.pa_billing_settings_update('{"billing_suspend_enabled": false}'::jsonb)`)
await asService()
check('dimatikan: W tidak dinonaktifkan', (await one('select public.pa_billing_run() v')).v.suspended === 0)
await as(U.admin, 'aal2')
await works('admin menyalakan lagi', `select public.pa_billing_settings_update('{"billing_suspend_enabled": true}'::jsonb)`)
await asService()
check('dinyalakan lagi: tunggakan lama tidak ikut (enforce_from = sekarang)', (await one('select public.pa_billing_run() v')).v.suspended === 0)
await su()
check('enforce_from diperbarui', (await one("select billing_enforce_from > now() - interval '1 minute' v from platform_settings")).v === true)
check('audit: settings.billing', Number((await one("select count(*) v from platform_audit_logs where action = 'settings.billing'")).v) === 2)
await as(U.admin, 'aal2')
await fails('pengaturan: hari nonaktif 3 ditolak', `select public.pa_billing_settings_update('{"billing_suspend_after_days": 3}'::jsonb)`, [], /tidak valid/)
await fails('pengaturan: kunci tidak dikenal ditolak', `select public.pa_billing_settings_update('{"theme_color": "#000000"}'::jsonb)`, [], /tidak dikenal/)
await works('pengaturan penerbit kuitansi', `select public.pa_billing_settings_update('{"billing_company_name": "PT Dailybrew Indonesia", "billing_company_address": "Jakarta", "billing_tax_id": "01.234"}'::jsonb)`)

// ---------- H. Kuitansi ----------
await as(U.ownerA)
const receipt = (await works('owner A: kuitansi tagihan lunas', 'select public.invoice_receipt($1) v', [invA.id]))[0]?.v
check('kuitansi: nomor KW, penerbit, rincian promo', receipt?.receipt_number === `KW-${invA.number.slice(4)}` && receipt.issuer.name === 'PT Dailybrew Indonesia'
  && receipt.promo_code === 'HEMAT50' && num(receipt.amount) === 174500 && num(receipt.list_amount) === 349000 && receipt.cafe.name === 'Kopi Induk', J(receipt))
await as(U.ownerB)
await fails('owner B tidak bisa kuitansi A', 'select public.invoice_receipt($1)', [invA.id], /tidak ditemukan/)
await as(U.staffA)
await fails('staff tidak bisa kuitansi', 'select public.invoice_receipt($1)', [invA.id], /tidak ditemukan/)
await as(null)
await fails('anon tidak bisa kuitansi', 'select public.invoice_receipt($1)', [invA.id], /permission denied/)
await as(U.admin, 'aal2')
await works('admin (2FA) bisa kuitansi', 'select public.invoice_receipt($1)', [invA.id])
await as(U.admin, 'aal1')
await fails('admin tanpa 2FA tidak bisa kuitansi', 'select public.invoice_receipt($1)', [invA.id], /tidak ditemukan/)
await as(U.ownerW)
await fails('kuitansi tagihan belum lunas ditolak', 'select public.invoice_receipt($1)', [(await (async () => { await su(); const row = await inv(W); await as(U.ownerW); return row })()).id], /setelah tagihan lunas/)

// ---------- I. Keuangan platform ----------
await as(U.admin, 'aal2')
const fin = (await works('keuangan platform', 'select public.pa_finance_overview(6) v'))[0]?.v
check('keuangan: 6 bulan, bulan terakhir = bulan ini', fin?.months?.length === 6 && fin.months.at(-1).month.slice(0, 7) === new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7), J(fin?.months))
const collected = num(fin?.collected_month)
check('keuangan: kas masuk bulan ini = A 174.500 + N 279.200 + S + M', collected === 174500 + 279200 + 349000 + 349000, collected)
check('keuangan: diskon bulan ini = promo A + referral N', num(fin?.months?.at(-1)?.discounts) === 174500 + 69800, J(fin?.months?.at(-1)))
check('keuangan: kredit dipakai bulan ini 279.200', num(fin?.months?.at(-1)?.credits) === 279200, J(fin?.months?.at(-1)))
check('keuangan: metode gateway/manual/credit', ['gateway', 'manual_transfer', 'credit'].every((m) => fin?.methods?.some((row) => row.method === m)), J(fin?.methods))
check('keuangan: piutang & umur piutang', typeof fin?.aging?.d8_30?.amount !== 'undefined' && fin?.outstanding?.count >= 1, J(fin?.aging))
check('keuangan: saldo kredit beredar = 50.000 + 20.800', num(fin?.credit_outstanding) === 70800, fin?.credit_outstanding)
check('keuangan: promo teratas HEMAT50', fin?.promos?.[0]?.code === 'HEMAT50', J(fin?.promos))
check('keuangan: pengaturan ikut', fin?.settings?.billing_suspend_after_days === 14, J(fin?.settings))
const refs = (await works('daftar referral', 'select public.pa_referrals_list(50) v'))[0]?.v
check('referral: 1 rewarded, total hadiah 50.000', refs?.summary?.rewarded === 1 && num(refs.summary.reward_total) === 50000 && refs.rows[0]?.referrer_name === 'Kopi Induk', J(refs?.summary))
const billingB = (await works('penagihan kafe B', 'select public.pa_cafe_billing($1) v', [B]))[0]?.v
check('penagihan B: grup, diskon 20%, kredit 20.800, riwayat', billingB?.group?.name === 'Grup Kopi' && billingB.branch_discount_pct === 20 && num(billingB.credit_balance) === 20800 && billingB.ledger.length === 2, J(billingB))
const billingN = (await works('penagihan kafe N', 'select public.pa_cafe_billing($1) v', [N]))[0]?.v
check('penagihan N: diundang oleh A', billingN?.referred_by?.name === 'Kopi Induk', J(billingN?.referred_by))
await works('hapus grup', 'select public.pa_billing_group_delete($1)', [group.id])
await su()
check('hapus grup: kafe keluar grup, harga normal lagi', (await one('select billing_group_id v from cafes where id = $1', [B])).v === null && num((await one('select public.pa_plan_price($1, $2) v', [B, 'pro'])).v) === 349000)
check('audit: grup, promo, cabang tercatat', Number((await one("select count(*) v from platform_audit_logs where action in ('billing_group.create', 'billing_group.update', 'billing_group.delete', 'promo.create', 'cafe.billing_group', 'invoice.promo')")).v) >= 10)

// ---------- Hak akses ----------
const ADMIN_FNS = [
  ['pa_promos_list()', []], ['pa_referrals_list(10)', []], ['pa_cafe_billing($1)', [A]], ['pa_credit_adjust($1, 1000, $2)', [A, 'x']],
  ['pa_billing_groups_list()', []], ["pa_billing_group_upsert(null, 'Grup X', 10, null)", []], ['pa_billing_group_delete($1)', [A]],
  ['pa_cafe_set_billing_group($1, null)', [A]], [`pa_billing_settings_update('{}'::jsonb)`, []], ['pa_finance_overview(12)', []],
  ["pa_promo_upsert(null, 'ABC', null, 'percent', 10, null, 1, false, null, 1, null, null, true)", []],
]
for (const [who, id, aal] of [['owner', U.ownerA, 'aal2'], ['staff', U.staffA, 'aal1'], ['customer', U.cust, 'aal1'], ['admin tanpa 2FA', U.admin, 'aal1'], ['admin nonaktif', U.admin2, 'aal2']]) {
  await as(id, aal)
  for (const [fn, params] of ADMIN_FNS) await fails(`${who}: ${fn.split('(')[0]} ditolak`, `select public.${fn}`, params, /Khusus admin|2FA/)
}
await as(null)
for (const [fn, params] of ADMIN_FNS) await fails(`anon: ${fn.split('(')[0]} ditolak`, `select public.${fn}`, params, /permission denied/)
for (const fn of ['owner_referral_info($1)', 'owner_invoices($1)', "owner_referral_claim($1, 'X')"]) await fails(`anon: ${fn.split('(')[0]} ditolak`, `select public.${fn}`, [A], /permission denied/)
// Fungsi internal tertutup untuk authenticated & service_role
await as(U.ownerA)
for (const fn of ['pa_invoice_recalc($1)', 'pa_credit_available($1)', 'pa_invoice_recalc_cafe($1)', 'pa_suspend_due_at($1)', 'pa_branch_discount_pct($1)', 'pa_plan_price($1, \'pro\')']) {
  await fails(`owner: ${fn.split('(')[0]} tertutup`, `select public.${fn}`, [A], /permission denied/)
}
await fails('owner: pa_next_invoice_number tertutup', 'select public.pa_next_invoice_number()', [], /permission denied/)
await fails('owner: pa_billing_run tertutup', 'select public.pa_billing_run()', [], /permission denied/)
await asService()
await fails('service_role: pa_invoice_recalc tertutup', 'select public.pa_invoice_recalc($1)', [A], /permission denied/)
// Tabel baru tidak bisa dibaca/diubah langsung
await as(U.ownerA)
for (const table of ['billing_groups', 'platform_promo_codes', 'cafe_referrals', 'cafe_credit_ledger', 'billing_code_attempts', 'invoice_number_counters']) {
  await fails(`owner: baca ${table} langsung ditolak`, `select * from public.${table}`, [], /permission denied/)
}
await fails('owner tidak bisa ubah referral_code', "update public.cafes set referral_code = 'AAAA1111' where id = $1", [A], /permission denied/)
await fails('owner tidak bisa ubah suspended_kind', "update public.cafes set suspended_kind = null where id = $1", [A], /permission denied/)
await fails('owner tidak bisa pindah grup sendiri', 'update public.cafes set billing_group_id = null where id = $1', [A], /permission denied/)
await as(U.admin, 'aal2')
await fails('admin pun tidak bisa baca tabel langsung', 'select * from public.platform_promo_codes', [], /permission denied/)

await su()
console.log(`file 17: ${passed} lulus, ${failures.length} gagal`)
if (failures.length) {
  for (const line of failures) console.log(' ✗', line)
  process.exit(1)
}
