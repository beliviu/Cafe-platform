/*
 * KHUSUS DEV: data & RPC akuntansi tiruan untuk /preview/owner.
 * Meniru supabase/usulan/07-akuntansi.sql secara ringkas: jurnal seimbang, laporan dihitung dari jurnal.
 * Tambahkan ?finance=setup di URL pratinjau untuk melihat wizard "Mulai pembukuan".
 */
let seq = 9000
const uid = (prefix) => `${prefix}-${(seq += 1)}`
const fail = (message) => ({ data: null, error: { message } })
const ok = (data) => ({ data, error: null })
const DAY = 86400000

const SEED = [
  ['1-1100', 'Kas', 'asset', 'operating', true], ['1-1150', 'Saldo QRIS & e-wallet', 'asset', 'operating', true],
  ['1-1200', 'Bank', 'asset', 'operating', true], ['1-1300', 'Piutang & uang muka pesanan', 'asset', 'operating', false],
  ['1-1400', 'Persediaan bahan', 'asset', 'operating', false], ['1-1500', 'Biaya dibayar di muka', 'asset', 'operating', false],
  ['1-2100', 'Peralatan & perlengkapan kafe', 'asset', 'investing', false], ['1-2900', 'Akumulasi penyusutan', 'asset', 'investing', false],
  ['2-1100', 'Utang usaha (supplier)', 'liability', 'operating', false], ['2-1200', 'Utang pajak (PB1)', 'liability', 'operating', false],
  ['2-1300', 'Utang lain-lain & beban belum dibayar', 'liability', 'operating', false], ['2-2100', 'Pinjaman', 'liability', 'financing', false],
  ['3-1000', 'Modal pemilik', 'equity', 'financing', false], ['3-2000', 'Laba ditahan', 'equity', 'financing', false],
  ['3-3000', 'Prive (penarikan pemilik)', 'equity', 'financing', false], ['3-9000', 'Ekuitas saldo awal', 'equity', 'financing', false],
  ['4-1000', 'Penjualan', 'revenue', 'operating', false], ['4-1100', 'Pendapatan service charge', 'revenue', 'operating', false],
  ['4-1900', 'Pembulatan penjualan', 'revenue', 'operating', false], ['4-2000', 'Diskon penjualan', 'contra_revenue', 'operating', false],
  ['4-2100', 'Retur & refund penjualan', 'contra_revenue', 'operating', false], ['4-9100', 'Pendapatan lain-lain', 'other_income', 'operating', false],
  ['4-9200', 'Selisih kas lebih', 'other_income', 'operating', false], ['5-1000', 'HPP bahan', 'cogs', 'operating', false],
  ['5-1100', 'Bahan rusak, terbuang & kedaluwarsa', 'cogs', 'operating', false], ['5-1200', 'Pemakaian bahan non-penjualan', 'cogs', 'operating', false],
  ['5-1300', 'Selisih stok opname', 'cogs', 'operating', false], ['6-1000', 'Gaji & upah', 'expense', 'operating', false],
  ['6-1100', 'Sewa tempat', 'expense', 'operating', false], ['6-1200', 'Listrik, air & gas', 'expense', 'operating', false],
  ['6-1300', 'Internet & telepon', 'expense', 'operating', false], ['6-1400', 'Perlengkapan & kemasan non-stok', 'expense', 'operating', false],
  ['6-1500', 'Pemasaran & promosi', 'expense', 'operating', false], ['6-1600', 'Perawatan & perbaikan', 'expense', 'operating', false],
  ['6-1700', 'Biaya admin bank & pembayaran', 'expense', 'operating', false], ['6-1800', 'Penyusutan', 'expense', 'operating', false],
  ['6-9100', 'Beban lain-lain (kas kecil)', 'expense', 'operating', false], ['6-9200', 'Selisih kas kurang', 'other_expense', 'operating', false],
]
const DEBIT_NORMAL = new Set(['asset', 'contra_revenue', 'cogs', 'expense', 'other_expense'])
const CASH_FOR = { cash: '1-1100', qris: '1-1150', ewallet: '1-1150', bank_transfer: '1-1200', bank: '1-1200', unpaid: '2-1300', payable: '2-1300' }

const jakartaKey = (date) => new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10)
const addDays = (key, days) => new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)

function seedAccounts(cafeId) {
  return SEED.map(([code, name, type, cashFlow, isCash]) => ({
    id: `acc-${code}`, cafe_id: cafeId, code, name, type, cash_flow: cashFlow, is_cash: isCash, is_system: true, is_active: true, created_at: '2026-10-01T00:00:00Z',
  }))
}

/** Posting jurnal ke store (validasi seimbang + periode tertutup), meniru acc_post. */
function post(store, cafeId, { date, kind = 'auto', memo, lines, source = null, reversalOf = null }) {
  const accounts = new Map(store.accounts.map((account) => [account.code, account]))
  const resolved = lines.map((line) => ({ account_id: line.account_id || accounts.get(line.code)?.id, debit: Math.round((line.debit || 0) * 100) / 100, credit: Math.round((line.credit || 0) * 100) / 100, memo: line.memo || null }))
    .filter((line) => line.debit || line.credit)
  const debit = resolved.reduce((sum, line) => sum + line.debit, 0)
  const credit = resolved.reduce((sum, line) => sum + line.credit, 0)
  if (!resolved.length) return null
  if (Math.abs(debit - credit) > 0.004) throw new Error(`Jurnal tidak seimbang (debit ${debit}, kredit ${credit})`)
  const period = store.accounting_periods.find((row) => row.period_start === `${date.slice(0, 7)}-01`)
  if (period?.status === 'closed') throw new Error(`Periode ${date.slice(0, 7)} sudah ditutup`)
  const year = date.slice(0, 4)
  const count = store.journal_entries.filter((entry) => entry.number.startsWith(`JU-${year}`)).length + 1
  const entry = {
    id: uid('je'), cafe_id: cafeId, number: `JU-${year}-${String(count).padStart(4, '0')}`, entry_date: date, memo, kind,
    source_type: source, status: 'posted', reversal_of: reversalOf, reversed_by: null, total: debit,
    created_at: new Date(Date.parse(`${date}T03:00:00Z`) + count * 1000).toISOString(),
  }
  store.journal_entries.push(entry)
  resolved.forEach((line, index) => store.journal_lines.push({ id: uid('jl'), journal_id: entry.id, line_no: index + 1, ...line }))
  return entry
}

function reverse(store, entry, reason, date) {
  if (entry.status === 'reversed') throw new Error('Jurnal ini sudah dibalik')
  const lines = store.journal_lines.filter((line) => line.journal_id === entry.id)
  const reversal = post(store, entry.cafe_id, {
    date, kind: 'reversal', memo: `Pembalik ${entry.number}: ${reason}`, reversalOf: entry.id,
    lines: lines.map((line) => ({ account_id: line.account_id, debit: line.credit, credit: line.debit, memo: line.memo })),
  })
  Object.assign(entry, { status: 'reversed', reversed_by: reversal.id })
  return reversal
}

export function createFinanceFixtures({ cafeId, now = new Date(), setup = false }) {
  const store = { accounts: [], journal_entries: [], journal_lines: [], accounting_periods: [], expenses: [], acc_sync_issues: [] }
  if (setup) return { ...store, goLive: null }
  store.accounts = seedAccounts(cafeId)
  const today = jakartaKey(now)
  const goLive = `${addDays(today, -40).slice(0, 7)}-01`
  post(store, cafeId, {
    date: goLive, kind: 'opening', memo: 'Saldo awal pembukuan', source: 'opening',
    lines: [
      { code: '1-1100', debit: 2500000 }, { code: '1-1200', debit: 18000000 }, { code: '1-1400', debit: 3200000 }, { code: '1-2100', debit: 42000000 },
      { code: '2-1100', credit: 1800000 }, { code: '3-1000', credit: 50000000 }, { code: '3-9000', credit: 13900000 },
    ],
  })
  let random = 7
  const rand = () => { random = (random * 16807) % 2147483647; return (random - 1) / 2147483646 }
  for (let key = goLive; key <= today; key = addDays(key, 1)) {
    const weekday = new Date(`${key}T00:00:00Z`).getUTCDay()
    const sales = Math.round((1400000 + rand() * 900000 + (weekday === 0 || weekday === 6 ? 700000 : 0)) / 1000) * 1000
    const tax = Math.round(sales * 0.1)
    const discount = Math.round(sales * 0.02 / 1000) * 1000
    post(store, cafeId, { date: key, memo: `Penjualan harian ${key}`, source: 'order', lines: [{ code: '1-1300', debit: sales + tax - discount }, { code: '4-2000', debit: discount }, { code: '4-1000', credit: sales }, { code: '2-1200', credit: tax }] })
    const qris = Math.round((sales + tax - discount) * 0.62)
    post(store, cafeId, { date: key, memo: 'Pembayaran pesanan', source: 'payment', lines: [{ code: '1-1150', debit: qris }, { code: '1-1100', debit: sales + tax - discount - qris }, { code: '1-1300', credit: sales + tax - discount }] })
    post(store, cafeId, { date: key, memo: 'HPP penjualan', source: 'stock_movement', lines: [{ code: '5-1000', debit: Math.round(sales * 0.34) }, { code: '1-1400', credit: Math.round(sales * 0.34) }] })
    if (weekday === 2 || weekday === 5) {
      post(store, cafeId, { date: key, memo: 'Belanja bahan: susu, kopi, sirup', source: 'stock_movement', lines: [{ code: '1-1400', debit: 2900000 }, { code: '1-1100', credit: 1400000 }, { code: '2-1100', credit: 1500000 }] })
    }
    if (weekday === 1) {
      post(store, cafeId, { date: key, kind: 'manual', memo: 'Pencairan QRIS ke rekening', lines: [{ code: '1-1200', debit: 7200000 }, { code: '6-1700', debit: 50000 }, { code: '1-1150', credit: 7250000 }] })
      post(store, cafeId, { date: key, memo: 'Pembayaran supplier', source: 'supplier_payment', lines: [{ code: '2-1100', debit: 2600000 }, { code: '1-1200', credit: 2600000 }] })
    }
  }
  // Beban bulanan (lewat tabel expenses supaya halaman Beban terisi)
  const months = [...new Set([goLive.slice(0, 7), today.slice(0, 7)])]
  const expenseSeed = [
    ['6-1100', 'Sewa ruko', 6500000, 'bank_transfer', 'Pak Hendra', 1], ['6-1000', 'Gaji barista & kasir', 9600000, 'bank_transfer', null, 1],
    ['6-1200', 'Listrik PLN', 1350000, 'bank_transfer', 'PLN', 5], ['6-1200', 'Gas LPG 12 kg', 420000, 'cash', 'Agen Gas Jaya', 6],
    ['6-1300', 'Internet IndiHome', 450000, 'unpaid', 'Telkom', 7], ['6-1500', 'Iklan Instagram', 750000, 'ewallet', 'Meta', 9],
    ['6-1600', 'Servis mesin espresso', 1100000, 'unpaid', 'Teknisi Barista Pro', 12],
  ]
  for (const month of months) {
    for (const [code, description, amount, method, vendor, day] of expenseSeed) {
      const date = `${month}-${String(day).padStart(2, '0')}`
      if (date > today || date < goLive) continue
      const paid = method === 'unpaid' && month !== today.slice(0, 7)
      const row = {
        id: uid('exp'), cafe_id: cafeId, expense_date: date, account_id: `acc-${code}`, description, amount, payment_method: method, vendor,
        receipt_path: day % 2 ? `${cafeId}/nota-${day}.jpg` : null, status: 'posted', paid_on: paid ? addDays(date, 10) : null, paid_method: paid ? 'bank_transfer' : null,
        void_reason: null, voided_at: null, created_at: `${date}T04:00:00Z`,
      }
      store.expenses.push(row)
      post(store, cafeId, { date, memo: `Beban: ${description}`, source: 'expense', lines: [{ code, debit: amount, memo: vendor }, { code: CASH_FOR[method], credit: amount }] })
      if (paid) post(store, cafeId, { date: row.paid_on, memo: `Pelunasan beban: ${description}`, source: 'expense', lines: [{ code: '2-1300', debit: amount }, { code: '1-1200', credit: amount }] })
    }
  }
  // Satu jurnal salah input yang sudah dibalik
  const wrong = post(store, cafeId, { date: addDays(today, -3), kind: 'manual', memo: 'Setoran modal (salah nominal)', lines: [{ code: '1-1200', debit: 5000000 }, { code: '3-1000', credit: 5000000 }] })
  reverse(store, wrong, 'Salah nominal, seharusnya 500 ribu', addDays(today, -3))
  post(store, cafeId, { date: addDays(today, -3), kind: 'manual', memo: 'Setoran modal tambahan', lines: [{ code: '1-1200', debit: 500000 }, { code: '3-1000', credit: 500000 }] })
  store.accounting_periods.push({ id: uid('per'), cafe_id: cafeId, period_start: goLive, status: 'closed', closed_at: `${addDays(goLive, 33)}T02:00:00Z`, note: null })
  store.acc_sync_issues.push({ id: uid('iss'), cafe_id: cafeId, source_type: 'stock_movement', source_id: 'mv-x', message: 'Bahan "Sirup hazelnut" tanpa harga rata-rata', created_at: now.toISOString(), resolved_at: null })
  return { ...store, goLive }
}

/** Saldo debit/kredit per akun dalam rentang (from boleh null). */
function totals(store, from, to) {
  const entries = new Map(store.journal_entries.filter((entry) => (!from || entry.entry_date >= from) && entry.entry_date <= to).map((entry) => [entry.id, entry]))
  const map = new Map(store.accounts.map((account) => [account.id, { ...account, account_id: account.id, debit: 0, credit: 0 }]))
  for (const line of store.journal_lines) {
    if (!entries.has(line.journal_id)) continue
    const row = map.get(line.account_id)
    row.debit += line.debit
    row.credit += line.credit
  }
  return [...map.values()].sort((a, b) => (a.code < b.code ? -1 : 1))
}

const earnings = (rows) => rows.reduce((sum, row) => sum + (['revenue', 'other_income'].includes(row.type) ? row.credit - row.debit
  : ['contra_revenue', 'cogs', 'expense', 'other_expense'].includes(row.type) ? -(row.debit - row.credit) : 0), 0)

export function financeRpc(store, name, args) {
  const settings = store.cafe_settings[0]
  const cafeId = settings.cafe_id
  const today = jakartaKey(new Date())
  try {
    if (name === 'acc_overview') {
      if (!settings.accounting_go_live) return ok({ go_live: null })
      const pl = totals(store, args.p_from, args.p_to)
      const bal = totals(store, null, args.p_to)
      const by = (rows, type, sign = 1) => rows.filter((row) => row.type === type).reduce((sum, row) => sum + sign * (row.debit - row.credit), 0)
      const code = (code, sign = 1) => { const row = bal.find((item) => item.code === code); return row ? sign * (row.debit - row.credit) : 0 }
      const revenue = by(pl, 'revenue', -1); const contra = by(pl, 'contra_revenue'); const cogs = by(pl, 'cogs'); const expenses = by(pl, 'expense')
      const other = by(pl, 'other_income', -1) - by(pl, 'other_expense')
      return ok({
        go_live: settings.accounting_go_live, revenue, contra_revenue: contra, net_revenue: revenue - contra, cogs, gross_profit: revenue - contra - cogs,
        expenses, other, net_profit: revenue - contra - cogs - expenses + other,
        cash: code('1-1100'), wallet: code('1-1150'), bank: code('1-1200'), receivable: code('1-1300'), inventory: code('1-1400'),
        payable: code('2-1100', -1), tax_payable: code('2-1200', -1), assets: by(bal, 'asset'), liabilities: by(bal, 'liability', -1),
        equity: by(bal, 'equity', -1) + earnings(bal), issues: store.acc_sync_issues.filter((issue) => !issue.resolved_at).length,
      })
    }
    if (name === 'acc_income_statement') {
      return ok(totals(store, args.p_from, args.p_to).filter((row) => !['asset', 'liability', 'equity'].includes(row.type) && (row.debit || row.credit))
        .map((row) => ({ section: row.type, code: row.code, name: row.name, amount: ['revenue', 'other_income'].includes(row.type) ? row.credit - row.debit : row.debit - row.credit })))
    }
    if (name === 'acc_balance_sheet') {
      const rows = totals(store, null, args.p_as_of)
      return ok([
        ...rows.filter((row) => ['asset', 'liability', 'equity'].includes(row.type) && (row.debit || row.credit))
          .map((row) => ({ section: row.type, code: row.code, name: row.name, amount: row.type === 'asset' ? row.debit - row.credit : row.credit - row.debit })),
        { section: 'equity', code: '3-9999', name: 'Laba (rugi) berjalan', amount: earnings(rows) },
      ])
    }
    if (name === 'acc_trial_balance') {
      return ok(totals(store, null, args.p_as_of).filter((row) => row.debit || row.credit).map((row) => ({
        account_id: row.id, code: row.code, name: row.name, type: row.type, debit: row.debit, credit: row.credit,
        balance_debit: Math.max(row.debit - row.credit, 0), balance_credit: Math.max(row.credit - row.debit, 0),
      })))
    }
    if (name === 'acc_cash_flow') {
      const cashIds = new Set(store.accounts.filter((account) => account.is_cash).map((account) => account.id))
      const cashTotal = (from, to) => store.journal_lines.filter((line) => cashIds.has(line.account_id)).reduce((sum, line) => {
        const entry = store.journal_entries.find((item) => item.id === line.journal_id)
        return (!from || entry.entry_date >= from) && entry.entry_date <= to ? sum + line.debit - line.credit : sum
      }, 0)
      const opening = cashTotal(null, addDays(args.p_from, -1))
      const closing = cashTotal(null, args.p_to)
      const accounts = new Map(store.accounts.map((account) => [account.id, account]))
      const sums = new Map()
      for (const entry of store.journal_entries.filter((item) => item.entry_date >= args.p_from && item.entry_date <= args.p_to)) {
        const lines = store.journal_lines.filter((line) => line.journal_id === entry.id)
        if (!lines.some((line) => cashIds.has(line.account_id))) continue
        for (const line of lines.filter((item) => !cashIds.has(item.account_id))) sums.set(line.account_id, (sums.get(line.account_id) || 0) + line.credit - line.debit)
      }
      return ok([
        ...[...sums.entries()].filter(([, amount]) => Math.abs(amount) > 0.004).map(([id, amount]) => ({ section: accounts.get(id).cash_flow, code: accounts.get(id).code, name: accounts.get(id).name, amount, opening_cash: opening, closing_cash: closing })),
        { section: 'none', code: null, name: null, amount: 0, opening_cash: opening, closing_cash: closing },
      ].sort((a, b) => (a.section + (a.code || '') < b.section + (b.code || '') ? -1 : 1)))
    }
    if (name === 'acc_equity_changes') {
      const before = totals(store, null, addDays(args.p_from, -1))
      const period = totals(store, args.p_from, args.p_to)
      const opening = before.filter((row) => row.type === 'equity').reduce((sum, row) => sum + row.credit - row.debit, 0) + earnings(before)
      const pick = (codes, sign) => period.filter((row) => codes.includes(row.code)).reduce((sum, row) => sum + sign * (row.credit - row.debit), 0)
      const contributions = pick(['3-1000', '3-9000'], 1)
      const withdrawals = pick(['3-3000'], -1)
      const other = period.filter((row) => row.type === 'equity' && !['3-1000', '3-9000', '3-3000'].includes(row.code)).reduce((sum, row) => sum + row.credit - row.debit, 0)
      const net = earnings(period)
      return ok({ opening, contributions, withdrawals, other, net_income: net, closing: opening + contributions - withdrawals + other + net })
    }
    if (name === 'acc_ledger') {
      const account = store.accounts.find((item) => item.id === args.p_account_id)
      if (!account) return fail('Akun tidak ditemukan')
      const sign = DEBIT_NORMAL.has(account.type) ? 1 : -1
      const entries = new Map(store.journal_entries.map((entry) => [entry.id, entry]))
      const lines = store.journal_lines.filter((line) => line.account_id === account.id)
      const opening = lines.filter((line) => entries.get(line.journal_id).entry_date < args.p_from).reduce((sum, line) => sum + (line.debit - line.credit) * sign, 0)
      let balance = opening
      return ok(lines.map((line) => ({ line, entry: entries.get(line.journal_id) }))
        .filter(({ entry }) => entry.entry_date >= args.p_from && entry.entry_date <= args.p_to)
        .sort((a, b) => (a.entry.entry_date + a.entry.created_at < b.entry.entry_date + b.entry.created_at ? -1 : 1))
        .map(({ line, entry }) => {
          balance += (line.debit - line.credit) * sign
          return { journal_id: entry.id, entry_date: entry.entry_date, number: entry.number, memo: line.memo || entry.memo, kind: entry.kind, debit: line.debit, credit: line.credit, balance, opening }
        }))
    }
    if (name === 'acc_manual_journal') {
      if (args.p_date < settings.accounting_go_live) return fail('Tanggal sebelum mulai pembukuan')
      return ok(post(store, cafeId, { date: args.p_date, kind: 'manual', memo: args.p_memo, lines: args.p_lines }).id)
    }
    if (name === 'acc_reverse_journal') {
      const entry = store.journal_entries.find((item) => item.id === args.p_journal_id)
      if (!entry) return fail('Jurnal tidak ditemukan')
      if (entry.kind === 'reversal') return fail('Jurnal pembalik tidak bisa dibalik lagi')
      return ok(reverse(store, entry, args.p_reason, today).id)
    }
    if (name === 'acc_account_save') {
      if (!args.p_id) {
        if (store.accounts.some((account) => account.code === args.p_code)) return fail(`Kode akun ${args.p_code} sudah dipakai`)
        const row = { id: uid('acc'), cafe_id: cafeId, code: args.p_code, name: args.p_name, type: args.p_type, cash_flow: args.p_cash_flow || 'operating', is_cash: false, is_system: false, is_active: true }
        store.accounts.push(row)
        return ok(row.id)
      }
      const account = store.accounts.find((item) => item.id === args.p_id)
      if (account.is_system && args.p_is_active === false) return fail('Akun sistem tidak bisa dinonaktifkan')
      Object.assign(account, { name: args.p_name, is_active: args.p_is_active ?? account.is_active, cash_flow: account.is_system ? account.cash_flow : args.p_cash_flow || account.cash_flow })
      return ok(account.id)
    }
    if (name === 'acc_set_period') {
      const start = `${args.p_month.slice(0, 7)}-01`
      if (args.p_close && start >= `${today.slice(0, 7)}-01`) return fail('Bulan berjalan belum bisa ditutup')
      if (!args.p_close && (args.p_note || '').trim().length < 3) return fail('Tulis alasan membuka kembali periode')
      const row = store.accounting_periods.find((item) => item.period_start === start)
      const values = { status: args.p_close ? 'closed' : 'open', closed_at: new Date().toISOString(), note: args.p_note || null }
      if (row) Object.assign(row, values)
      else store.accounting_periods.push({ id: uid('per'), cafe_id: cafeId, period_start: start, ...values })
      return ok(values.status)
    }
    if (name === 'acc_backfill') {
      store.acc_sync_issues.forEach((issue) => { issue.resolved_at = new Date().toISOString() })
      return ok({ checked: store.journal_entries.length, failed: 0 })
    }
    if (name === 'acc_opening_suggestions') {
      const inventory = (store.ingredients || []).reduce((sum, row) => sum + Math.max(Number(row.on_hand), 0) * Number(row.avg_cost), 0)
      return ok({ inventory: Math.round(inventory), receivable: 0, payable: 1250000 })
    }
    if (name === 'acc_setup') {
      if (settings.accounting_go_live) return fail('Pembukuan sudah dimulai. Koreksi saldo awal lewat jurnal manual.')
      if (args.p_go_live > today) return fail('Tanggal mulai harus antara 1 tahun lalu dan hari ini')
      if (!store.accounts.length) store.accounts.push(...seedAccounts(cafeId))
      const types = new Map(store.accounts.map((account) => [account.code, account.type]))
      const lines = args.p_lines.filter((line) => Number(line.amount)).map((line) => (types.get(line.code) === 'asset' ? { code: line.code, debit: Number(line.amount) } : { code: line.code, credit: Number(line.amount) }))
      const debit = lines.reduce((sum, line) => sum + (line.debit || 0), 0)
      const credit = lines.reduce((sum, line) => sum + (line.credit || 0), 0)
      lines.push({ code: '3-9000', credit: debit - credit, debit: 0 })
      if (debit - credit < 0) { lines.pop(); lines.push({ code: '3-9000', debit: credit - debit }) }
      settings.accounting_go_live = args.p_go_live
      const entry = post(store, cafeId, { date: args.p_go_live, kind: 'opening', memo: 'Saldo awal pembukuan', source: 'opening', lines })
      return ok({ journal_id: entry?.id || null, backfill: { checked: 0, failed: 0 } })
    }
    if (name === 'expense_create') {
      if (args.p_date > today) return fail('Tanggal beban tidak boleh di masa depan')
      const account = store.accounts.find((item) => item.id === args.p_account_id)
      if (!account?.is_active) return fail('Pilih kategori beban yang valid')
      const row = {
        id: uid('exp'), cafe_id: cafeId, expense_date: args.p_date, account_id: account.id, description: args.p_description, amount: Number(args.p_amount),
        payment_method: args.p_method, vendor: args.p_vendor, receipt_path: args.p_receipt_path, status: 'posted', paid_on: null, paid_method: null,
        void_reason: null, voided_at: null, created_at: new Date().toISOString(),
      }
      store.expenses.push(row)
      if (args.p_date >= settings.accounting_go_live) {
        post(store, cafeId, { date: row.expense_date, memo: `Beban: ${row.description}`, source: 'expense', lines: [{ account_id: account.id, debit: row.amount, memo: row.vendor }, { code: CASH_FOR[row.payment_method], credit: row.amount }] })
      }
      return ok(row.id)
    }
    if (name === 'expense_pay') {
      const row = store.expenses.find((item) => item.id === args.p_expense_id)
      if (row.status !== 'posted' || row.payment_method !== 'unpaid' || row.paid_on) return fail('Beban ini sudah dibayar atau dibatalkan')
      Object.assign(row, { paid_on: args.p_date < row.expense_date ? row.expense_date : args.p_date, paid_method: args.p_method })
      post(store, cafeId, { date: row.paid_on, memo: `Pelunasan beban: ${row.description}`, source: 'expense', lines: [{ code: '2-1300', debit: row.amount }, { code: CASH_FOR[args.p_method], credit: row.amount }] })
      return ok(null)
    }
    if (name === 'expense_void') {
      const row = store.expenses.find((item) => item.id === args.p_expense_id)
      if (row.status === 'void') return fail('Beban ini sudah dibatalkan')
      if ((args.p_reason || '').trim().length < 3) return fail('Tulis alasan pembatalan')
      Object.assign(row, { status: 'void', void_reason: args.p_reason, voided_at: new Date().toISOString() })
      store.journal_entries.filter((entry) => entry.source_type === 'expense' && entry.status === 'posted' && entry.memo.endsWith(row.description))
        .forEach((entry) => reverse(store, entry, `Beban dibatalkan: ${args.p_reason}`, today))
      return ok(null)
    }
  } catch (caught) {
    return fail(caught.message)
  }
  return null
}
