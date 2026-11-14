// Uji file usulan/16: skor kesehatan, progres setup, sinyal upgrade, analitik MRR (pergerakan, cohort, ringkasan),
// linimasa & catatan, tiket bantuan + RLS, dan bahwa owner/staff/customer/anon tidak bisa memanggil fungsi admin.
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
let restore = async () => {}
const su = async () => { restore = async () => db.exec('reset role'); await db.exec('reset role') }
async function as(id, aal = 'aal1') {
  restore = () => as(id, aal)
  await db.exec('reset role')
  await q("select set_config('request.jwt.claim.sub', $1, false)", [id || ''])
  await q("select set_config('request.jwt.claims', $1, false)", [id ? J({ sub: id, aal }) : ''])
  await db.exec(id ? 'set role authenticated' : 'set role anon')
}
async function asService() {
  restore = asService
  await db.exec('reset role')
  await q("select set_config('request.jwt.claim.sub', '', false)")
  await q("select set_config('request.jwt.claims', '', false)")
  await db.exec('set role service_role')
}
async function raw(sql, params = []) {
  const back = restore
  await db.exec('reset role')
  const rows = await q(sql, params)
  await back()
  return rows
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

// ---------- Skema ----------
await db.exec(fs.readFileSync(new URL('./base-schema.sql', import.meta.url), 'utf8'))
await db.exec("set timezone to 'Asia/Jakarta'; create role service_role nologin bypassrls; grant usage on schema public, auth to service_role;")
await db.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant execute on function auth.jwt() to anon, authenticated, service_role;
  grant execute on function auth.uid() to service_role;`)
for (const file of ['04-owner-dashboard.sql', '05-inventori-supplier.sql', '06-pesanan-v2-pos.sql', '07-akuntansi.sql', '08-pelanggan-qr.sql',
  '09-payment-gateway.sql', '10-izin-langganan-keamanan.sql', '12-qris-statis.sql', '13-tamu-qr-meja.sql', '14-platform-admin.sql',
  '15-notifikasi-platform.sql']) await db.exec(usulan(file))

const U = {
  admin: '00000000-0000-0000-0000-0000000000e1', admin2: '00000000-0000-0000-0000-0000000000e2', admin3: '00000000-0000-0000-0000-0000000000e3',
  ownerA: '00000000-0000-0000-0000-0000000000a1', staffA: '00000000-0000-0000-0000-0000000000a2',
  ownerB: '00000000-0000-0000-0000-0000000000b1', ownerC: '00000000-0000-0000-0000-0000000000c3', ownerD: '00000000-0000-0000-0000-0000000000d1',
  cust: '00000000-0000-0000-0000-0000000000c1',
  s1: '00000000-0000-0000-0000-0000000000f1', s2: '00000000-0000-0000-0000-0000000000f2', s3: '00000000-0000-0000-0000-0000000000f3',
}
for (const [key, id] of Object.entries(U)) await q('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@contoh.id`])
const cafe = async (name, days) => (await one(`insert into cafes (name, created_at) values ($1, now() - make_interval(days => $2)) returning id`, [name, days])).id
const A = await cafe('Kopi Sehat', 120)
const B = await cafe('Kopi Lesu', 120)
const C = await cafe('Kedai Baru', 9)
const D = await cafe('Kopi Biasa', 120)
await q(`insert into profiles (id, cafe_id, full_name, role) values
  ($1,$2,'Owner A','owner'), ($3,$2,'Staff A','staff'), ($4,$5,'Owner B','owner'), ($6,$7,'Owner C','owner'), ($8,$9,'Owner D','owner'), ($10,null,'Rani','customer')`,
  [U.ownerA, A, U.staffA, U.ownerB, B, U.ownerC, C, U.ownerD, D, U.cust])
await q("insert into platform_admins (user_id, full_name) values ($1, 'Admin Satu'), ($2, 'Admin Dua'), ($3, 'Admin Tiga')", [U.admin, U.admin2, U.admin3])
await q('update platform_admins set is_active = false where user_id = $1', [U.admin2])

// A & B & D: Pro aktif · C: Basic masa coba (batas staff 3)
for (const id of [A, B, D]) await q("update cafe_subscriptions set plan_code = 'pro', status = 'active', trial_ends_at = null, current_period_end = now() + interval '20 days' where cafe_id = $1", [id])
await q("update cafe_subscriptions set plan_code = 'basic', status = 'trialing', trial_ends_at = now() + interval '20 days', current_period_end = null where cafe_id = $1", [C])

// Pesanan: A naik (10 vs 8, pos + app), B turun 80% (2 vs 10), D stabil (6 vs 6)
async function orders(cafeId, count, fromDays, toDays, source = 'app') {
  for (let index = 0; index < count; index += 1) {
    const ageDays = fromDays + ((toDays - fromDays) * index) / Math.max(1, count)
    await q("insert into orders (cafe_id, total_amount, source, created_at) values ($1, 25000, $2, now() - make_interval(secs => $3))", [cafeId, source, Math.round(ageDays * 86400)])
  }
}
await orders(A, 5, 1, 12, 'app'); await orders(A, 5, 1, 12, 'pos'); await orders(A, 8, 15, 27)
await orders(B, 2, 2, 10); await orders(B, 10, 15, 27)
await orders(D, 6, 1, 12); await orders(D, 6, 15, 27)
await q("insert into orders (cafe_id, total_amount, source, order_status, created_at) values ($1, 1000, 'app', 'cancelled', now() - interval '1 day')", [B])
// Login owner
await q("update auth.users set last_sign_in_at = now() - interval '1 day' where id = $1", [U.ownerA])
await q("update auth.users set last_sign_in_at = now() - interval '20 days' where id = $1", [U.ownerB])
await q("update auth.users set last_sign_in_at = now() - interval '2 days' where id = $1", [U.ownerC])
await q("update auth.users set last_sign_in_at = now() - interval '10 days' where id = $1", [U.ownerD])
// Modul A: inventori + keuangan
await q("insert into ingredients (cafe_id, name, unit) values ($1, 'Susu', 'ml')", [A])
await q("update cafe_settings set accounting_go_live = current_date where cafe_id = $1", [A])
// Tagihan: B telat 4 hari; D pernah bayar telat sekali
await q(`insert into subscription_invoices (number, cafe_id, plan_code, months, period_start, period_end, amount, status, due_at)
  values ('INV-T-1', $1, 'pro', 1, now(), now() + interval '1 month', 349000, 'pending', now() - interval '4 days')`, [B])
await q(`insert into subscription_invoices (number, cafe_id, plan_code, months, period_start, period_end, amount, status, due_at, paid_at, method)
  values ('INV-T-2', $1, 'pro', 1, now() - interval '40 days', now() - interval '10 days', 349000, 'paid', now() - interval '40 days', now() - interval '30 days', 'manual_transfer')`, [D])

// ---------- Jalankan file 16 ----------
const result = await db.exec(usulan('16-kesehatan-analitik-tiket.sql'))
const verify = result.at(-1).rows
check('verifikasi: 7 tabel + 2 trigger, tanpa tabel tanpa RLS', verify.length === 9 && !verify.some((row) => row.kind === 'tanpa_rls'), J(verify))
await works('file 16 aman dijalankan ulang', 'select 1') // placeholder agar urutan pesan rapi
try { await db.exec(usulan('16-kesehatan-analitik-tiket.sql')); passed += 1 } catch (error) { failures.push(`dijalankan ulang → ${error.message}`) }

// ---------- A. Skor kesehatan ----------
await su()
const score = async (id) => (await one('select public.pa_health_score($1) v', [id])).v
const sA = await score(A)
const sB = await score(B)
const sC = await score(C)
const sD = await score(D)
check('A: skor 100, Sehat', sA.score === 100 && sA.label === 'healthy', J(sA))
check('A: 4 modul terpakai', J(sA.components.modules.used.sort()) === J(['app', 'finance', 'inventory', 'pos']), J(sA.components.modules))
check('A: pesanan 10 vs 8', sA.components.orders.last_14 === 10 && sA.components.orders.prev_14 === 8, J(sA.components.orders))
check('B: pesanan dibatalkan tidak dihitung', sB.components.orders.last_14 === 2, J(sB.components.orders))
check('B: skor 18 (8 + 5 + 5 + 0), Berisiko', sB.score === 18 && sB.label === 'risk', J(sB))
check('B: alasan pesanan turun 80%', sB.reasons.includes('Pesanan turun 80%'), J(sB.reasons))
check('B: alasan login 20 hari', sB.reasons.includes('Owner terakhir login 20 hari lalu'), J(sB.reasons))
check('B: alasan tagihan telat 4 hari', sB.reasons.includes('Tagihan telat 4 hari'), J(sB.reasons))
check('C: tanpa pesanan → 0 + login 25 + 0 modul + belum ditagih 20 = 45', sC.score === 45 && sC.label === 'risk', J(sC))
check('C: alasan belum ada pesanan', sC.reasons.includes('Belum ada pesanan 28 hari terakhir'), J(sC.reasons))
check('D: 35 + 12 + 5 + 13 = 65, Pantau', sD.score === 65 && sD.label === 'watch', J(sD))
check('D: alasan 1 kali bayar telat', sD.reasons.includes('1 kali bayar telat dalam 6 bulan'), J(sD.reasons))
const labels = await one('select public.pa_health_label(75) a, public.pa_health_label(74) b, public.pa_health_label(50) c, public.pa_health_label(49) d')
check('batas label: 75 Sehat, 74 & 50 Pantau, 49 Berisiko', labels.a === 'healthy' && labels.b === 'watch' && labels.c === 'watch' && labels.d === 'risk', J(labels))

// Hitung harian: 1 baris per kafe per hari, notifikasi "berisiko" sekali
await q('delete from platform_notifications')
await q('delete from cafe_health_daily')
// Kemarin B sudah berisiko → tidak ada notifikasi baru untuk B; C baru masuk berisiko → 1 notifikasi
await q("insert into cafe_health_daily (cafe_id, day, score, label) values ($1, (now() at time zone 'Asia/Jakarta')::date - 1, 30, 'risk')", [B])
await q("insert into cafe_health_daily (cafe_id, day, score, label) values ($1, (now() at time zone 'Asia/Jakarta')::date - 1, 80, 'healthy')", [C])
await su()
const run1 = (await one('select public.pa_health_run() v')).v
const run2 = (await one('select public.pa_health_run() v')).v
await su()
check('pa_health_run menilai 4 kafe', run1.scored === 4, J(run1))
check('kafe baru berisiko → 1 notifikasi (B sudah berisiko kemarin)', run1.new_risk === 1 && run2.new_risk === 0, `${J(run1)} ${J(run2)}`)
const todayRows = await one("select count(*)::int n from cafe_health_daily where day = (now() at time zone 'Asia/Jakarta')::date")
check('dijalankan 2× → tetap 1 baris per kafe hari ini', todayRows.n === 4, J(todayRows))
const riskNote = await q("select title from platform_notifications where kind = 'health_risk'")
check('notifikasi berisiko untuk Kedai Baru', riskNote.length === 1 && riskNote[0].title === 'Kafe berisiko: Kedai Baru', J(riskNote))

// ---------- B. Progres setup ----------
const setup = async (id) => (await one('select public.pa_setup_json($1) v', [id])).v
let sc = await setup(C)
check('C: 0/8, macet di "Identitas dan logo"', sc.done === 0 && sc.total === 8 && sc.stuck_step === 'Identitas dan logo', J(sc))
await q("update cafe_setup_state set changed_at = now() - interval '5 days' where cafe_id = $1", [C])
sc = await setup(C)
check('C: macet 5 hari (dari state terakhir)', sc.stuck_days === 5, J(sc))
await q("update cafes set logo_url = 'https://x/logo.png', address = 'Jl. Braga 1', opening_hours = '{\"mon\": {\"open\": \"08:00\"}}' where id = $1", [C])
sc = await setup(C)
check('C: identitas & jam buka selesai → macet di Pajak, hitung ulang dari sekarang', sc.done === 2 && sc.stuck_key === 'charges' && sc.stuck_days === 0, J(sc))
await q('update cafe_settings set tax_rate = 11 where cafe_id = $1', [C])
check('menyimpan pengaturan pajak (walau pajak tidak dinyalakan) menandai langkah Pajak', (await setup(C)).steps.find((step) => step.key === 'charges').done)
const cat = (await one("insert into categories (cafe_id, name) values ($1, 'Kopi') returning id", [C])).id
for (const name of ['Latte', 'Americano']) await q('insert into products (cafe_id, category_id, name, price) values ($1, $2, $3, 20000)', [C, cat, name])
check('2 produk belum cukup untuk langkah menu', !(await setup(C)).steps.find((step) => step.key === 'menu').done)
await q("insert into products (cafe_id, category_id, name, price) values ($1, $2, 'Mocha', 22000)", [C, cat])
await q("insert into cafe_tables (cafe_id, label) values ($1, 'A1')", [C])
await q("insert into profiles (id, cafe_id, full_name, role) values ($1, $2, 'Kasir C', 'staff')", [U.s1, C])
await q("update cafe_settings set qris_image_url = 'https://x/qris.png' where cafe_id = $1", [C])
sc = await setup(C)
check('C: 7/8, tinggal Struk', sc.done === 7 && sc.stuck_key === 'receipt', J(sc))
await q('update cafe_settings set receipt_paper_mm = 80 where cafe_id = $1', [C])
sc = await setup(C)
check('C: 8/8 setelah struk disimpan', sc.done === 8 && sc.stuck_step === null && sc.stuck_days === null, J(sc))
await q('select public.pa_setup_refresh()')
const state = await one('select done_count, changed_at > now() - interval \'1 minute\' fresh from cafe_setup_state where cafe_id = $1', [C])
check('pa_setup_refresh mencatat kemajuan', state.done_count === 8 && state.fresh, J(state))

// ---------- C. Sinyal upgrade ----------
await q("insert into profiles (id, cafe_id, full_name, role) values ($1, $2, 'Kasir C2', 'staff'), ($3, $2, 'Kasir C3', 'staff')", [U.s2, C, U.s3])
await as(U.admin, 'aal2')
let actions = await q('select public.pa_action_items(50) v')
let upgrade = actions[0].v.filter((item) => item.kind === 'upgrade_signal')
check('Basic 3 dari 3 staff → sinyal upgrade', upgrade.length === 1 && upgrade[0].cafe_id === C && /Memakai 3 dari 3 staff \(100%\)/.test(upgrade[0].reason), J(upgrade))
// Terbentur fitur terkunci
await as(U.ownerD)
await works('owner D mencatat fitur terkunci', "select public.owner_log_plan_block($1, 'feature', 'Inventori')", [D])
await works('kejadian sama dalam 10 menit diabaikan', "select public.owner_log_plan_block($1, 'feature', 'Inventori')", [D])
await fails('jenis tidak dikenal ditolak', "select public.owner_log_plan_block($1, 'lainnya', 'x')", [D], /tidak dikenal/)
await fails('owner D tidak bisa mencatat untuk kafe lain', "select public.owner_log_plan_block($1, 'feature', 'x')", [A], /anggota/)
await as(U.cust)
await fails('customer tidak bisa mencatat', "select public.owner_log_plan_block($1, 'feature', 'x')", [D], /anggota/)
await as(U.staffA)
await works('staff kafe sendiri boleh mencatat', "select public.owner_log_plan_block($1, 'limit', 'Meja')", [A])
check('1 kejadian (bukan 2) setelah duplikat', (await raw('select count(*)::int n from plan_block_events where cafe_id = $1', [D]))[0].n === 1)
await as(U.ownerD)
await q("select public.owner_log_plan_block($1, 'feature', 'Keuangan')", [D])
await q("select public.owner_log_plan_block($1, 'limit', 'Produk')", [D])
await as(U.admin, 'aal2')
actions = await q('select public.pa_action_items(50) v')
upgrade = actions[0].v.filter((item) => item.kind === 'upgrade_signal' && item.cafe_id === D)
check('3× terbentur dalam 14 hari → sinyal upgrade D', upgrade.length === 1 && /Terbentur fitur paket 3×/.test(upgrade[0].reason), J(upgrade))
check('isi "Perlu tindakan" lama tetap ada (tagihan telat B)', actions[0].v.some((item) => item.kind === 'invoice_overdue' && item.cafe_id === B))
await su()
await q('delete from platform_notifications')
await asService()
const day1 = (await one('select public.pa_daily_check() v')).v
const day2 = (await one('select public.pa_daily_check() v')).v
await su()
check('pa_daily_check memuat hasil kesehatan', day1.health && day1.health.scored === 4, J(day1.health))
const upgradeNotes = await q("select count(*)::int n from platform_notifications where kind = 'upgrade_signal'")
check('notifikasi upgrade sekali per minggu (2 kali jalan → 2 kafe, bukan 4)', upgradeNotes[0].n === 2, `${J(upgradeNotes)} ${J(day2)}`)

// ---------- D. Analitik MRR ----------
await as(U.admin, 'aal2')
const month = (offset) => q("select (date_trunc('month', now() at time zone 'Asia/Jakarta') + make_interval(months => $1))::date::text m", [offset]).then((rows) => rows[0].m)
// Data belum cukup: hanya bulan ini (dari isi awal)
let summary = (await one('select public.pa_analytics_summary() v')).v
check('data belum cukup → enough=false + keterangan LTV', summary.enough === false && typeof summary.ltv_note === 'string', J(summary))
let mrr = (await one('select public.pa_analytics_mrr(12) v')).v
check('pergerakan MRR: 12 bulan; berisi bulan ini + 1 bulan dari tagihan lunas', mrr.months.length === 12 && mrr.months_with_data === 2, J({ n: mrr.months.length, w: mrr.months_with_data }))
// Isi riwayat: m-4 A 100rb · m-3 A 100rb, B 200rb · m-2 A 100rb, B 300rb (naik), E 150rb (baru) · m-1 A 100rb, B 250rb (turun), E 0 (berhenti)
await su()
const E = await cafe('Kopi Singgah', 200)
await q('delete from cafe_mrr_monthly where month < $1', [await month(0)])
const rows = [[A, -4, 100000], [A, -3, 100000], [B, -3, 200000], [A, -2, 100000], [B, -2, 300000], [E, -2, 150000], [A, -1, 100000], [B, -1, 250000], [E, -1, 0]]
for (const [cafeId, offset, value] of rows) await q("insert into cafe_mrr_monthly (cafe_id, month, mrr, source) values ($1, $2, $3, 'invoice')", [cafeId, await month(offset), value])
await as(U.admin, 'aal2')
mrr = (await one('select public.pa_analytics_mrr(6) v')).v
const byMonth = Object.fromEntries(mrr.months.map((item) => [item.month, item]))
const m2 = byMonth[await month(-2)]
const m1 = byMonth[await month(-1)]
const m3 = byMonth[await month(-3)]
check('m-3: B baru 200rb, awal 100rb, akhir 300rb', Number(m3.new) === 200000 && Number(m3.start_mrr) === 100000 && Number(m3.end_mrr) === 300000, J(m3))
check('m-2: baru 150rb (E), naik 100rb (B)', Number(m2.new) === 150000 && Number(m2.expansion) === 100000 && Number(m2.churn) === 0, J(m2))
check('m-1: turun -50rb (B), berhenti -150rb (E)', Number(m1.contraction) === -50000 && Number(m1.churn) === -150000 && m1.churned_cafes === 1, J(m1))
check('akhir = awal + baru + naik + turun + berhenti (m-1)',
  Number(m1.end_mrr) === Number(m1.start_mrr) + Number(m1.new) + Number(m1.expansion) + Number(m1.contraction) + Number(m1.churn), J(m1))
check('pergerakan MRR sekarang cukup', mrr.enough === true && mrr.months_with_data >= 4, J({ w: mrr.months_with_data }))
const cohort = (await one('select public.pa_analytics_cohort(12) v')).v
const monthM2 = await month(-2)
const monthM4 = await month(-4)
const cohortE = cohort.cohorts.find((item) => item.month === monthM2)
const cohortA = cohort.cohorts.find((item) => item.month === monthM4)
check('cohort m-4 (A): 1 kafe, bertahan 100% di bulan ke-3', cohortA && cohortA.size === 1 && cohortA.cells.find((cell) => cell.offset === 3).pct === 100, J(cohortA))
check('cohort m-2 (E): bertahan 100% → 0% bulan berikutnya', cohortE && cohortE.cells[0].pct === 100 && cohortE.cells[1].pct === 0, J(cohortE))
summary = (await one('select public.pa_analytics_summary() v')).v
check('ringkasan: 4 bulan data → cukup', summary.enough === true && summary.months_with_data === 4, J(summary))
// Churn 3 bulan penuh terakhir: m-1 1/3 berhenti, m-2 0/2, m-3 0/1 → rata-rata 0,1111
check('tingkat berhenti bulanan rata-rata 3 bulan = 0,1111', Number(summary.churn_rate) === 0.1111 && summary.churn_months === 3, J(summary))
check('LTV = ARPA / churn', summary.ltv === null || Math.round(Number(summary.arpa) / 0.1111) === Number(summary.ltv), J(summary))
// Isi awal dari tagihan lunas tidak menimpa data yang sudah ada
await su()
await q(`insert into subscription_invoices (number, cafe_id, plan_code, months, period_start, period_end, amount, status, due_at, paid_at, method)
  values ('INV-T-3', $1, 'pro', 3, ($2::date)::timestamp at time zone 'Asia/Jakarta', (($2::date)::timestamp at time zone 'Asia/Jakarta') + interval '3 months', 900000, 'paid', now() - interval '200 days', now() - interval '199 days', 'manual_transfer')`, [D, await month(-7)])
await q('select public.pa_mrr_backfill()')
const backfill = await q('select month, mrr::int mrr from cafe_mrr_monthly where cafe_id = $1 and month >= $2 and month < $3 order by month', [D, await month(-7), await month(-3)])
check('isi awal dari tagihan lunas 3 bulan → 3 bulan × 300rb', backfill.length === 3 && backfill.every((row) => row.mrr === 300000), J(backfill))
const before = await one('select mrr::int mrr from cafe_mrr_monthly where cafe_id = $1 and month = $2', [B, await month(-1)])
await q('select public.pa_mrr_backfill()')
check('isi awal tidak menimpa data yang sudah ada', (await one('select mrr::int mrr from cafe_mrr_monthly where cafe_id = $1 and month = $2', [B, await month(-1)])).mrr === before.mrr)

// ---------- E. Tiket bantuan & RLS ----------
await as(U.ownerA)
const ticket = (await one("select public.owner_ticket_create($1, 'pesanan', 'Pesanan dobel', 'Ada pesanan masuk dua kali', array[$2]) v", [A, `${A}/foto.jpg`])).v
check('owner A membuat tiket bernomor TKT-', /^TKT-\d{5}$/.test(ticket.number) && ticket.status === 'new', J(ticket))
await fails('lampiran di folder kafe lain ditolak', "select public.owner_ticket_create($1, 'menu', 'Judul ok', 'isi', array[$2])", [A, `${B}/x.jpg`], /Lampiran/)
await fails('lebih dari 3 lampiran ditolak', "select public.owner_ticket_create($1, 'menu', 'Judul ok', 'isi', array[$2,$2,$2,$2])", [A, `${A}/x.jpg`], /3 lampiran/)
await fails('path dengan .. ditolak', "select public.owner_ticket_create($1, 'menu', 'Judul ok', 'isi', array[$2])", [A, `${A}/../x.jpg`], /Lampiran/)
await fails('kategori tidak dikenal ditolak', "select public.owner_ticket_create($1, 'gosip', 'Judul ok', 'isi')", [A], /kategori/)
await fails('judul terlalu pendek ditolak', "select public.owner_ticket_create($1, 'menu', 'ab', 'isi')", [A], /Judul/)
await fails('owner A tidak bisa membuat tiket untuk kafe B', "select public.owner_ticket_create($1, 'menu', 'Judul ok', 'isi')", [B], /owner kafe ini/)
await fails('owner tidak bisa insert langsung ke tabel tiket', "insert into platform_tickets (number, cafe_id, category, title) values ('X', $1, 'menu', 'abc')", [A], /permission denied/)
check('notifikasi admin "tiket baru"', (await raw("select count(*)::int n from platform_notifications where kind = 'ticket_new' and link = $1", [`/tiket/${ticket.id}`]))[0].n === 1)
const ownList = (await one('select public.owner_tickets($1) v', [A])).v
check('owner A melihat tiketnya (tanpa info penugasan internal)', ownList.length === 1 && !('assigned_to' in ownList[0]) && !('admin_unread' in ownList[0]), J(ownList[0]))
check('RLS: owner A membaca tiket & pesan kafenya', (await q('select count(*)::int n from platform_tickets'))[0].n === 1 && (await q('select count(*)::int n from platform_ticket_messages'))[0].n === 1)
await as(U.ownerB)
check('RLS: owner B tidak melihat tiket kafe A', (await q('select count(*)::int n from platform_tickets'))[0].n === 0 && (await q('select count(*)::int n from platform_ticket_messages'))[0].n === 0)
await fails('owner B tidak bisa membuka tiket kafe A', 'select public.owner_ticket_detail($1)', [ticket.id], /tidak ditemukan/)
await fails('owner B tidak bisa membalas tiket kafe A', "select public.owner_ticket_reply($1, 'halo')", [ticket.id], /tidak ditemukan/)
await fails('owner B tidak bisa melihat daftar tiket kafe A', 'select public.owner_tickets($1)', [A], /owner kafe ini/)
await as(U.staffA)
check('RLS: staff kafe A tidak melihat tiket', (await q('select count(*)::int n from platform_tickets'))[0].n === 0)
await fails('staff tidak bisa membuat tiket', "select public.owner_ticket_create($1, 'menu', 'Judul ok', 'isi')", [A], /owner kafe ini/)
await as(U.cust)
check('RLS: customer tidak melihat tiket', (await q('select count(*)::int n from platform_tickets'))[0].n === 0)
await as(null)
await fails('anon tidak bisa membaca tabel tiket', 'select * from platform_tickets', [], /permission denied/)
await fails('anon tidak bisa membuat tiket', "select public.owner_ticket_create($1, 'menu', 'Judul ok', 'isi')", [A], /permission denied/)
await as(U.admin, 'aal1')
check('RLS: admin tanpa 2FA tidak melihat tiket', (await q('select count(*)::int n from platform_tickets'))[0].n === 0)

await as(U.admin, 'aal2')
check('RLS: admin (2FA) melihat semua tiket', (await q('select count(*)::int n from platform_tickets'))[0].n === 1)
let inbox = (await one("select public.pa_tickets_list(null, null, 50, 0) v")).v
check('kotak masuk: 1 baru, belum dibaca', inbox.counts.new === 1 && inbox.counts.unread === 1 && inbox.rows[0].cafe_name === 'Kopi Sehat', J(inbox.counts))
check('pencarian tiket berdasarkan nama kafe', (await one("select public.pa_tickets_list(null, 'sehat', 50, 0) v")).v.total === 1)
let detail = (await one('select public.pa_ticket_detail($1) v', [ticket.id])).v
check('detail admin: pesan + data kafe + daftar admin aktif', detail.messages.length === 1 && detail.cafe.name === 'Kopi Sehat' && detail.admins.length === 2, J(detail.admins))
check('membuka detail menandai sudah dibaca admin', (await one("select public.pa_tickets_list(null, null, 50, 0) v")).v.counts.unread === 0)
await fails('tidak bisa ditugaskan ke admin nonaktif', "select public.pa_ticket_update($1, null, null, $2)", [ticket.id, U.admin2], /admin aktif/)
await works('ubah prioritas & tugaskan ke Admin Tiga', "select public.pa_ticket_update($1, null, 'high', $2)", [ticket.id, U.admin3])
const reply = (await one("select public.pa_ticket_reply($1, 'Sudah kami cek, pesanan dobel dihapus.') v", [ticket.id])).v
check('balasan admin: diproses, waktu respons pertama tercatat, owner belum baca', reply.status === 'in_progress' && reply.first_response_at && reply.owner_unread === true, J(reply))
check('penugasan tidak tertimpa oleh balasan', reply.assigned_to === U.admin3, J(reply.assigned_to))
check('notifikasi owner "balasan tiket"', (await raw("select count(*)::int n from cafe_notifications where cafe_id = $1 and kind = 'ticket_reply'", [A]))[0].n === 1)
inbox = (await one("select public.pa_tickets_list(null, null, 50, 0) v")).v
check('rata-rata waktu respons pertama terhitung', inbox.avg_first_response_minutes !== null, J(inbox))
await as(U.ownerA)
detail = (await one('select public.owner_ticket_detail($1) v', [ticket.id])).v
check('owner melihat balasan dengan nama Admin Satu', detail.messages.length === 2 && detail.messages[1].author_name === 'Admin Satu', J(detail.messages))
check('membuka tiket menandai dibaca owner', (await one('select public.owner_tickets($1) v', [A])).v[0].owner_unread === false)
await as(U.admin, 'aal2')
await works('admin menandai selesai', "select public.pa_ticket_update($1, 'resolved')", [ticket.id])
check('notifikasi owner "tiket selesai"', (await raw("select count(*)::int n from cafe_notifications where cafe_id = $1 and kind = 'ticket_resolved'", [A]))[0].n === 1)
await as(U.ownerA)
const reopened = (await one("select public.owner_ticket_reply($1, 'Masih terjadi lagi pagi ini') v", [ticket.id])).v
check('balasan owner membuka lagi tiket selesai', reopened.status === 'in_progress' && reopened.resolved_at === null && reopened.admin_unread === undefined, J(reopened))
check('admin dapat notifikasi balasan owner', (await raw("select count(*)::int n from platform_notifications where kind = 'ticket_reply'"))[0].n === 1)
const audit = await raw("select action from platform_audit_logs where entity = 'ticket' order by id")
check('aksi admin tiket tercatat di log audit', audit.map((row) => row.action).join(',') === 'ticket.update,ticket.reply,ticket.update', J(audit))
// Batas 10 tiket per hari
for (let index = 0; index < 9; index += 1) await q("select public.owner_ticket_create($1, 'lainnya', $2, 'isi')", [A, `Tiket nomor ${index}`])
await fails('tiket ke-11 dalam sehari ditolak', "select public.owner_ticket_create($1, 'lainnya', 'Satu lagi', 'isi')", [A], /10 tiket/)

// ---------- F. Linimasa & catatan ----------
await as(U.admin, 'aal2')
await fails('catatan kosong ditolak', "select public.pa_cafe_note_add($1, '   ')", [A], /Catatan/)
await works('admin menambah catatan internal', "select public.pa_cafe_note_add($1, 'Owner minta dihubungi sore hari')", [A])
await su()
await q("insert into cafe_health_daily (cafe_id, day, score, label, computed_at) values ($1, (now() at time zone 'Asia/Jakarta')::date - 3, 90, 'healthy', now() - interval '3 days'), ($1, (now() at time zone 'Asia/Jakarta')::date - 2, 60, 'watch', now() - interval '2 days') on conflict do nothing", [A])
await as(U.admin, 'aal2')
await q("select public.pa_log_whatsapp($1, 'setup', '6281200000000')", [A])
const timeline = (await one('select public.pa_cafe_timeline($1, 200) v', [A])).v
const kinds = new Set(timeline.map((item) => item.kind))
check('linimasa memuat daftar, catatan, tiket, WA, perubahan skor', ['signup', 'note', 'ticket', 'whatsapp', 'health'].every((kind) => kinds.has(kind)), J([...kinds]))
check('linimasa urut terbaru di atas', timeline.every((item, index) => index === 0 || item.at <= timeline[index - 1].at))
const note = timeline.find((item) => item.kind === 'note')
check('catatan memuat isi & nama admin', note.detail.body === 'Owner minta dihubungi sore hari' && note.actor === 'Admin Satu', J(note))
check('catatan tidak muncul dua kali (audit + tabel)', timeline.filter((item) => item.kind === 'note').length === 1)
const healthChange = timeline.find((item) => item.kind === 'health' && item.detail.prev_label === 'healthy')
check('perubahan skor: Sehat → Pantau', healthChange.detail.prev_label === 'healthy' && healthChange.detail.label === 'watch', J(healthChange))
await as(U.ownerA)
await fails('owner tidak bisa membaca catatan internal', 'select * from cafe_notes', [], /permission denied/)
await fails('owner tidak bisa membaca skor kesehatan', 'select * from cafe_health_daily', [], /permission denied/)
await fails('owner tidak bisa membaca MRR per kafe', 'select * from cafe_mrr_monthly', [], /permission denied/)

// ---------- G. Ringkasan untuk beranda (kontrak dengan UI) ----------
await as(U.admin, 'aal2')
const overview = (await one('select public.pa_health_overview(5) v')).v
check('ringkasan kesehatan: hitungan + kafe tidak sehat urut skor terendah', overview.counts && overview.rows.length >= 1 && overview.rows.every((row, index) => index === 0 || row.score >= overview.rows[index - 1].score), J(overview))
check('baris ringkasan memuat alasan gabungan', typeof overview.rows[0].reason === 'string' && overview.rows[0].reason.length > 0, J(overview.rows[0]))
const map = (await one('select public.pa_health_map() v')).v
check('peta skor per kafe untuk daftar kafe', map[A] && typeof map[A].score === 'number', J(map[A]))
const cafeHealth = (await one('select public.pa_cafe_health($1, 90) v', [A])).v
check('detail kesehatan kafe: terbaru + riwayat + setup', cafeHealth.latest && cafeHealth.history.length >= 3 && cafeHealth.setup.total === 8, J({ h: cafeHealth.history.length }))
await su()
await q("update cafe_subscriptions set plan_code = 'pro', status = 'trialing', trial_ends_at = now() + interval '10 days' where cafe_id = $1", [D])
await as(U.admin, 'aal2')
const progress = (await one('select public.pa_setup_progress(5) v')).v
const rowD = progress.find((row) => row.cafe_id === D)
check('progres setup: kafe masa coba belum lengkap (D & kafe baru E), bukan C yang 8/8 atau A yang aktif', rowD && rowD.owner_name === 'Owner D' && progress.length === 2 && !progress.some((row) => row.cafe_id === C || row.cafe_id === A), J(progress.map((row) => [row.cafe_name, row.done])))
check('progres setup memuat langkah macet', rowD.stuck_step === 'Identitas dan logo' && rowD.total === 8, J(rowD))

// ---------- H. Fungsi admin tertutup untuk peran lain ----------
const adminCalls = [
  ['pa_health_overview', 'select public.pa_health_overview(5)', []],
  ['pa_health_map', 'select public.pa_health_map()', []],
  ['pa_cafe_health', 'select public.pa_cafe_health($1, 30)', [A]],
  ['pa_setup_progress', 'select public.pa_setup_progress(5)', []],
  ['pa_analytics_mrr', 'select public.pa_analytics_mrr(12)', []],
  ['pa_analytics_cohort', 'select public.pa_analytics_cohort(12)', []],
  ['pa_analytics_summary', 'select public.pa_analytics_summary()', []],
  ['pa_cafe_note_add', "select public.pa_cafe_note_add($1, 'x')", [A]],
  ['pa_cafe_timeline', 'select public.pa_cafe_timeline($1, 10)', [A]],
  ['pa_tickets_list', 'select public.pa_tickets_list(null, null, 10, 0)', []],
  ['pa_ticket_detail', 'select public.pa_ticket_detail($1)', [ticket.id]],
  ['pa_ticket_reply', "select public.pa_ticket_reply($1, 'x')", [ticket.id]],
  ['pa_ticket_update', "select public.pa_ticket_update($1, 'resolved')", [ticket.id]],
]
for (const [who, id, aal] of [['owner', U.ownerA, 'aal2'], ['staff', U.staffA, 'aal2'], ['customer', U.cust, 'aal2'], ['admin tanpa 2FA', U.admin, 'aal1'], ['admin nonaktif', U.admin2, 'aal2']]) {
  await as(id, aal)
  for (const [name, sql, params] of adminCalls) await fails(`${who} tidak bisa memanggil ${name}`, sql, params, /Khusus admin platform|2FA/)
}
await as(null)
for (const [name, sql, params] of adminCalls) await fails(`anon tidak bisa memanggil ${name}`, sql, params, /permission denied/)
await as(U.admin, 'aal2')
for (const name of ['pa_health_score($1)', 'pa_setup_json($1)', 'pa_setup_refresh()', 'pa_health_run()', 'pa_snapshot_cafe_mrr()', 'pa_mrr_backfill()']) {
  await fails(`fungsi internal ${name.split('(')[0]} tertutup bahkan untuk admin`, `select public.${name}`, name.includes('$1') ? [A] : [], /permission denied/)
}
await as(U.ownerA)
await fails('owner tidak bisa menjalankan pengecekan harian', 'select public.pa_daily_check()', [], /permission denied/)

// ---------- Hasil ----------
await db.close()
console.log(`file 16: ${passed} lulus, ${failures.length} gagal`)
if (failures.length) {
  for (const failure of failures) console.log('  ✗', failure)
  process.exit(1)
}
