/*
 * Laporan keuangan dari jurnal: laba rugi, neraca, arus kas, perubahan ekuitas, neraca saldo.
 * Ekspor Excel/CSV dan PDF (jendela cetak).
 */
import { useCallback, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { Download, FileSpreadsheet, FileText, Printer } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Badge, Button, Card, EmptyState, ErrorState, Menu, SegmentedControl, SkeletonRows, useToast } from '../../components/ui/index.js'
import { PeriodPicker } from '../../components/finance/PeriodPicker.jsx'
import { formatDate, formatRupiah } from '../../lib/format.js'
import { buildBalanceSheet, buildCashFlow, buildIncomeStatement, percentLabel, periodFor, periodLabel, printReport } from '../../lib/finance.js'
import { exportRows, useLoader } from '../../lib/inventory.js'
import { rpc } from '../../lib/pos.js'

const REPORTS = [
  { value: 'income', label: 'Laba rugi' },
  { value: 'balance', label: 'Neraca' },
  { value: 'cashflow', label: 'Arus kas' },
  { value: 'equity', label: 'Perubahan ekuitas' },
  { value: 'trial', label: 'Neraca saldo' },
]
const TITLES = Object.fromEntries(REPORTS.map((report) => [report.value, report.label]))
const dateLabel = (key) => formatDate(`${key}T00:00:00+07:00`)

export function ReportsPage() {
  const { cafe, finance } = useOutletContext()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const report = REPORTS.some((item) => item.value === params.get('report')) ? params.get('report') : 'income'
  const [period, setPeriod] = useState(() => ({ ...periodFor('this-month'), key: 'this-month' }))
  const asOf = ['balance', 'trial'].includes(report)
  const from = period.from < finance.goLive ? finance.goLive : period.from

  const load = useCallback(async () => {
    const args = { p_cafe_id: cafe.id }
    if (report === 'income') return rpc(supabase, 'acc_income_statement', { ...args, p_from: from, p_to: period.to })
    if (report === 'balance') return rpc(supabase, 'acc_balance_sheet', { ...args, p_as_of: period.to })
    if (report === 'cashflow') return rpc(supabase, 'acc_cash_flow', { ...args, p_from: from, p_to: period.to })
    if (report === 'equity') return rpc(supabase, 'acc_equity_changes', { ...args, p_from: from, p_to: period.to })
    return rpc(supabase, 'acc_trial_balance', { ...args, p_as_of: period.to })
  }, [cafe.id, from, period.to, report, supabase])
  const { data, error, reload, loading } = useLoader(load)
  const subtitle = asOf ? `Per ${dateLabel(period.to)}` : periodLabel({ from, to: period.to })
  const lines = data ? reportLines(report, data) : []

  async function handleExport(format) {
    try {
      await exportRows(lines.map((line) => ({ label: line.code ? `${line.code} ${line.label}` : line.label, amount: line.amount ?? null, debit: line.debit ?? null, credit: line.credit ?? null })),
        report === 'trial'
          ? [{ key: 'label', header: 'Akun', width: 40 }, { key: 'debit', header: 'Debit', number: true, format: '#,##0', width: 16 }, { key: 'credit', header: 'Kredit', number: true, format: '#,##0', width: 16 }]
          : [{ key: 'label', header: TITLES[report], width: 46 }, { key: 'amount', header: 'Rp', number: true, format: '#,##0;(#,##0)', width: 18 }],
        `${TITLES[report].toLowerCase().replace(/\s+/g, '-')}-${asOf ? period.to : `${from}_${period.to}`}`, format, TITLES[report])
    } catch (caught) {
      toast({ tone: 'error', title: 'Ekspor gagal', description: caught.message })
    }
  }

  function handlePrint() {
    const printable = report === 'trial'
      ? lines.map((line) => ({ ...line, label: `${line.code ? `${line.code} ` : ''}${line.label}${line.debit ? ` · D ${formatRupiah(line.debit)}` : ''}${line.credit ? ` · K ${formatRupiah(line.credit)}` : ''}`, amount: undefined }))
      : lines.map((line) => ({ ...line, label: line.code ? `${line.code} ${line.label}` : line.label }))
    if (!printReport({ title: TITLES[report], subtitle, cafeName: cafe.name, lines: printable })) {
      toast({ tone: 'error', title: 'Jendela cetak diblokir', description: 'Izinkan pop-up untuk situs ini.' })
    }
  }

  return (
    <div className="inv-page">
      <section className="toolbar" aria-label="Pilih laporan">
        <SegmentedControl label="Laporan" value={report} onChange={(value) => setParams({ report: value })} options={REPORTS} />
      </section>
      <section className="toolbar" aria-label="Periode laporan">
        <PeriodPicker value={period} onChange={setPeriod} minDate={finance.goLive} single={asOf} />
        <span className="text-muted">{subtitle}</span>
        <span className="toolbar-end fin-actions">
          <Button variant="secondary" icon={Printer} onClick={handlePrint} disabled={!data}>PDF</Button>
          <Menu
            label="Ekspor laporan"
            trigger={({ props }) => <Button variant="secondary" icon={Download} disabled={!data} {...props}>Ekspor</Button>}
            items={[
              { label: 'Excel (.xlsx)', icon: FileSpreadsheet, onSelect: () => handleExport('xlsx') },
              { label: 'CSV', icon: FileText, onSelect: () => handleExport('csv') },
            ]}
          />
        </span>
      </section>

      <Card className={`fin-report${loading && data ? ' is-refreshing' : ''}`}>
        {error ? <ErrorState message={error} onRetry={reload} />
          : !data ? <SkeletonRows rows={10} label="Menyusun laporan" />
            : <ReportView report={report} data={data} lines={lines} subtitle={subtitle} cafeName={cafe.name} />}
      </Card>
    </div>
  )
}

/** Baris seragam untuk tampilan, ekspor, dan PDF. */
function reportLines(report, data) {
  if (report === 'income') {
    const statement = buildIncomeStatement(data)
    return statement.groups.flatMap((group) => (group.subtotal
      ? [{ label: group.subtotal + (group.ratio !== undefined && group.ratio !== null ? ` (${percentLabel(group.ratio)})` : ''), amount: group.value, kind: group.final ? 'final' : 'total' }]
      : group.rows.length ? [
        { label: group.title, kind: 'head' },
        ...group.rows.map((row) => ({ code: row.code, label: row.name, amount: group.negative ? -Number(row.amount) : Number(row.amount), indent: true })),
      ] : []))
  }
  if (report === 'balance') {
    const sheet = buildBalanceSheet(data)
    const section = (title, rows, total, totalLabel) => [
      { label: title, kind: 'head' },
      ...rows.map((row) => ({ code: row.code === '3-9999' ? null : row.code, label: row.name, amount: Number(row.amount), indent: true })),
      { label: totalLabel, amount: total, kind: 'total' },
    ]
    return [
      ...section('Aset', sheet.assets, sheet.totalAssets, 'Total aset'),
      ...section('Kewajiban', sheet.liabilities, sheet.totalLiabilities, 'Total kewajiban'),
      ...section('Ekuitas', sheet.equity, sheet.totalEquity, 'Total ekuitas'),
      { label: 'Total kewajiban + ekuitas', amount: sheet.totalLiabilities + sheet.totalEquity, kind: 'final' },
    ]
  }
  if (report === 'cashflow') {
    const flow = buildCashFlow(data)
    return [
      { label: 'Kas & setara kas awal periode', amount: flow.opening, kind: 'total' },
      ...flow.sections.flatMap((section) => (section.rows.length ? [
        { label: section.title, kind: 'head' },
        ...section.rows.map((row) => ({ code: row.code, label: row.name, amount: Number(row.amount), indent: true })),
        { label: `Kas bersih dari aktivitas ${section.title.replace('Arus kas ', '')}`, amount: section.total, kind: 'total' },
      ] : [])),
      { label: 'Kenaikan (penurunan) kas', amount: flow.change, kind: 'total' },
      { label: 'Kas & setara kas akhir periode', amount: flow.closing, kind: 'final' },
    ]
  }
  if (report === 'equity') {
    return [
      { label: 'Ekuitas awal periode', amount: Number(data.opening), kind: 'total' },
      { label: 'Setoran modal & saldo awal', amount: Number(data.contributions), indent: true },
      { label: 'Laba (rugi) bersih periode', amount: Number(data.net_income), indent: true },
      { label: 'Prive (penarikan pemilik)', amount: -Number(data.withdrawals), indent: true },
      ...(Number(data.other) ? [{ label: 'Perubahan ekuitas lain', amount: Number(data.other), indent: true }] : []),
      { label: 'Ekuitas akhir periode', amount: Number(data.closing), kind: 'final' },
    ]
  }
  const rows = data.map((row) => ({ code: row.code, label: row.name, debit: Number(row.balance_debit) || null, credit: Number(row.balance_credit) || null }))
  return [
    ...rows,
    { label: 'Total', kind: 'final', debit: rows.reduce((sum, row) => sum + (row.debit || 0), 0), credit: rows.reduce((sum, row) => sum + (row.credit || 0), 0) },
  ]
}

function ReportView({ report, data, lines }) {
  if (report === 'balance') {
    const sheet = buildBalanceSheet(data)
    return (
      <>
        <div className="fin-report-head">
          {sheet.balanced ? <Badge tone="green" dot={false}>Seimbang: aset = kewajiban + ekuitas</Badge> : <Badge tone="red" dot={false}>Tidak seimbang</Badge>}
        </div>
        <ReportTable lines={lines} />
      </>
    )
  }
  if (report === 'trial') {
    const total = lines.at(-1)
    return (
      <>
        <div className="fin-report-head">
          {Math.abs(total.debit - total.credit) < 0.5 ? <Badge tone="green" dot={false}>Debit = kredit</Badge> : <Badge tone="red" dot={false}>Tidak seimbang</Badge>}
        </div>
        {lines.length <= 1 ? <EmptyState compact title="Belum ada jurnal" description="Neraca saldo muncul setelah ada transaksi." /> : (
          <table className="fin-table">
            <thead><tr><th scope="col">Akun</th><th scope="col" className="num">Debit</th><th scope="col" className="num">Kredit</th></tr></thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={line.code || index} className={line.kind ? `is-${line.kind}` : ''}>
                  <td>{line.code && <span className="fin-code">{line.code}</span>}{line.label}</td>
                  <td className="num tabular">{line.debit ? formatRupiah(line.debit) : ''}</td>
                  <td className="num tabular">{line.credit ? formatRupiah(line.credit) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </>
    )
  }
  if (!lines.some((line) => line.amount)) return <EmptyState compact title="Belum ada angka di periode ini" description="Pilih periode lain, atau tunggu transaksi berikutnya." />
  return <ReportTable lines={lines} />
}

function ReportTable({ lines }) {
  return (
    <table className="fin-table">
      <tbody>
        {lines.map((line, index) => (
          <tr key={`${line.label}-${index}`} className={line.kind ? `is-${line.kind}` : ''}>
            {line.kind === 'head' ? <th scope="rowgroup" colSpan={2}>{line.label}</th> : (
              <>
                <td className={line.indent ? 'is-indent' : ''}>{line.code && <span className="fin-code">{line.code}</span>}{line.label}</td>
                <td className={`num tabular${Number(line.amount) < 0 ? ' is-negative' : ''}`}>{line.amount === undefined ? '' : formatRupiah(line.amount)}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
