/*
 * Keuangan: label akun, penyusun laporan, cetak PDF (jendela cetak browser).
 * Semua angka berasal dari fungsi laporan di database (file 07) — bukan hitungan bebas di browser.
 */
import { formatDate, formatRupiah, jakartaDateKey } from './format.js'

export const ACCOUNT_TYPES = {
  asset: { label: 'Aset', normal: 'debit' },
  liability: { label: 'Kewajiban', normal: 'credit' },
  equity: { label: 'Ekuitas', normal: 'credit' },
  revenue: { label: 'Pendapatan', normal: 'credit' },
  contra_revenue: { label: 'Pengurang pendapatan', normal: 'debit' },
  cogs: { label: 'Harga pokok', normal: 'debit' },
  expense: { label: 'Beban operasional', normal: 'debit' },
  other_income: { label: 'Pendapatan lain', normal: 'credit' },
  other_expense: { label: 'Beban lain', normal: 'debit' },
}
export const ACCOUNT_TYPE_OPTIONS = Object.entries(ACCOUNT_TYPES).map(([value, meta]) => ({ value, label: meta.label }))
export const CASH_FLOW_LABELS = { operating: 'Operasional', investing: 'Investasi', financing: 'Pendanaan' }
export const JOURNAL_KINDS = { auto: 'Otomatis', manual: 'Manual', opening: 'Saldo awal', reversal: 'Pembalik' }

export const EXPENSE_METHODS = [
  { value: 'cash', label: 'Tunai (kas)' },
  { value: 'bank_transfer', label: 'Transfer bank' },
  { value: 'qris', label: 'QRIS' },
  { value: 'ewallet', label: 'E-wallet' },
  { value: 'unpaid', label: 'Belum dibayar (utang)' },
]

/** Saldo alami akun: aset & beban = debit − kredit, sisanya kredit − debit. */
export function naturalBalance(type, debit, credit) {
  return ACCOUNT_TYPES[type]?.normal === 'debit' ? Number(debit) - Number(credit) : Number(credit) - Number(debit)
}

const sum = (rows) => rows.reduce((total, row) => total + Number(row.amount), 0)

/** Baris laba rugi (dari acc_income_statement) → bagian & subtotal. */
export function buildIncomeStatement(rows) {
  const by = (section) => rows.filter((row) => row.section === section)
  const revenue = by('revenue')
  const contra = by('contra_revenue')
  const cogs = by('cogs')
  const expense = by('expense')
  const otherIncome = by('other_income')
  const otherExpense = by('other_expense')
  const netRevenue = sum(revenue) - sum(contra)
  const gross = netRevenue - sum(cogs)
  const operating = gross - sum(expense)
  const net = operating + sum(otherIncome) - sum(otherExpense)
  return {
    groups: [
      { title: 'Pendapatan', rows: revenue, total: sum(revenue) },
      { title: 'Pengurang pendapatan', rows: contra, total: -sum(contra), negative: true },
      { subtotal: 'Pendapatan bersih', value: netRevenue },
      { title: 'Harga pokok penjualan', rows: cogs, total: -sum(cogs), negative: true },
      { subtotal: 'Laba kotor', value: gross, ratio: netRevenue ? gross / netRevenue : null },
      { title: 'Beban operasional', rows: expense, total: -sum(expense), negative: true },
      { subtotal: 'Laba operasional', value: operating },
      { title: 'Pendapatan & beban lain', rows: [...otherIncome, ...otherExpense.map((row) => ({ ...row, amount: -Number(row.amount) }))], total: sum(otherIncome) - sum(otherExpense) },
      { subtotal: 'Laba bersih', value: net, ratio: netRevenue ? net / netRevenue : null, final: true },
    ],
    netRevenue, gross, operating, net,
  }
}

export function buildBalanceSheet(rows) {
  const by = (section) => rows.filter((row) => row.section === section && (Number(row.amount) !== 0 || row.code === '3-9999'))
  const assets = by('asset')
  const liabilities = by('liability')
  const equity = by('equity')
  return {
    assets, liabilities, equity,
    totalAssets: sum(assets), totalLiabilities: sum(liabilities), totalEquity: sum(equity),
    balanced: Math.abs(sum(assets) - sum(liabilities) - sum(equity)) < 0.5,
  }
}

export function buildCashFlow(rows) {
  const first = rows[0] || { opening_cash: 0, closing_cash: 0 }
  const sections = ['operating', 'investing', 'financing'].map((key) => {
    const list = rows.filter((row) => row.section === key)
    return { key, title: `Arus kas ${CASH_FLOW_LABELS[key].toLowerCase()}`, rows: list, total: sum(list) }
  })
  const change = sections.reduce((total, section) => total + section.total, 0)
  return { sections, opening: Number(first.opening_cash), closing: Number(first.closing_cash), change }
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))

/**
 * Cetak laporan sebagai PDF lewat jendela cetak browser ("Simpan sebagai PDF").
 * lines = [{ label, amount?, kind?: 'head' | 'total' | 'final' | 'row', indent? }]
 */
export function printReport({ title, subtitle, cafeName, lines, note }) {
  const win = window.open('', 'dailybrew-report', 'width=900,height=1000')
  if (!win) return false
  const body = lines.map((line) => {
    if (line.kind === 'head') return `<tr class="head"><td colspan="2">${escapeHtml(line.label)}</td></tr>`
    const amount = line.amount === undefined || line.amount === null ? '' : formatRupiah(line.amount)
    return `<tr class="${line.kind || 'row'}"><td style="padding-left:${line.indent ? 18 : 0}px">${escapeHtml(line.label)}</td><td class="n">${escapeHtml(amount)}</td></tr>`
  }).join('')
  win.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${escapeHtml(title)} — ${escapeHtml(cafeName)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font: 12px/1.5 system-ui, sans-serif; color: #1f1a17; }
  h1 { margin: 0; font-size: 20px; } .muted { color: #6b625b; }
  header { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 12px; margin-bottom: 14px; border-bottom: 2px solid #1f1a17; }
  table { width: 100%; border-collapse: collapse; } td { padding: 5px 4px; border-bottom: 1px solid #eee; }
  .n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr.head td { padding-top: 14px; font-weight: 700; border-bottom: 1px solid #ccc; }
  tr.total td { font-weight: 700; }
  tr.final td { font-size: 14px; font-weight: 800; border-top: 2px solid #1f1a17; border-bottom: 0; }
  footer { margin-top: 24px; font-size: 11px; }
</style></head><body>
  <header><div><h1>${escapeHtml(title)}</h1><div class="muted">${escapeHtml(subtitle)}</div></div><div class="n"><strong>${escapeHtml(cafeName)}</strong></div></header>
  <table>${body}</table>
  <footer class="muted">${note ? `${escapeHtml(note)}<br>` : ''}Dicetak ${escapeHtml(formatDate(new Date().toISOString()))} · angka dari jurnal pembukuan</footer>
  <script>window.onload = () => window.print()</${'script'}>
</body></html>`)
  win.document.close()
  return true
}

export const percentLabel = (ratio) => (ratio === null || ratio === undefined ? '' : `${(ratio * 100).toFixed(1).replace('.', ',')}%`)

/* ---------- Periode laporan ---------- */
export const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
export const pad = (value) => String(value).padStart(2, '0')
const lastDay = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate()

export function periodFor(key, today = jakartaDateKey()) {
  const [year, month] = today.split('-').map(Number)
  if (key === 'this-month') return { from: `${year}-${pad(month)}-01`, to: today }
  if (key === 'last-month') {
    const y = month === 1 ? year - 1 : year
    const m = month === 1 ? 12 : month - 1
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` }
  }
  if (key === 'last-3') {
    const start = new Date(Date.UTC(year, month - 3, 1))
    return { from: start.toISOString().slice(0, 10), to: today }
  }
  if (key === 'this-year') return { from: `${year}-01-01`, to: today }
  if (key === 'last-year') return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` }
  if (key.startsWith('m:')) {
    const [y, m] = key.slice(2).split('-').map(Number)
    const end = `${y}-${pad(m)}-${pad(lastDay(y, m))}`
    return { from: `${y}-${pad(m)}-01`, to: end > today ? today : end }
  }
  return { from: `${year}-${pad(month)}-01`, to: today }
}

export function periodLabel(value) {
  const [fy, fm, fd] = value.from.split('-').map(Number)
  const [ty, tm, td] = value.to.split('-').map(Number)
  if (fd === 1 && fy === ty && fm === tm) return `${MONTHS[fm - 1]} ${fy}${td !== lastDay(ty, tm) ? ` (s.d. ${td})` : ''}`
  return `${fd} ${MONTHS[fm - 1].slice(0, 3)} ${fy} – ${td} ${MONTHS[tm - 1].slice(0, 3)} ${ty}`
}

