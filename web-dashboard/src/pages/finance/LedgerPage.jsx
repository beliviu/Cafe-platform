/*
 * Buku besar: mutasi satu akun dengan saldo awal dan saldo berjalan (RPC acc_ledger).
 */
import { useCallback, useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { Download } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Badge, Button, Card, EmptyState, ErrorState, SkeletonRows, useToast } from '../../components/ui/index.js'
import { PeriodPicker } from '../../components/finance/PeriodPicker.jsx'
import { formatDate, formatRupiah } from '../../lib/format.js'
import { ACCOUNT_TYPES, JOURNAL_KINDS, periodFor, periodLabel } from '../../lib/finance.js'
import { exportRows, useLoader } from '../../lib/inventory.js'
import { rpc } from '../../lib/pos.js'

const dateOnly = (key) => formatDate(`${key}T00:00:00+07:00`)

export function LedgerPage() {
  const { cafe, finance } = useOutletContext()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const accountId = params.get('account') || finance.accounts.find((account) => account.code === '1-1100')?.id || finance.accounts[0]?.id
  const account = finance.accounts.find((item) => item.id === accountId)
  const [period, setPeriod] = useState(() => ({ ...periodFor('this-month'), key: 'this-month' }))
  const from = period.from < finance.goLive ? finance.goLive : period.from

  const grouped = useMemo(() => Object.entries(ACCOUNT_TYPES).map(([type, meta]) => ({
    label: meta.label, accounts: finance.accounts.filter((item) => item.type === type),
  })).filter((group) => group.accounts.length), [finance.accounts])

  const load = useCallback(() => (accountId
    ? rpc(supabase, 'acc_ledger', { p_cafe_id: cafe.id, p_account_id: accountId, p_from: from, p_to: period.to })
    : Promise.resolve([])), [accountId, cafe.id, from, period.to, supabase])
  const { data, error, reload, loading } = useLoader(load)
  const opening = data?.length ? Number(data[0].opening) : null
  const closing = data?.length ? Number(data.at(-1).balance) : opening

  async function handleExport() {
    try {
      await exportRows((data || []).map((row) => ({ date: row.entry_date, number: row.number, memo: row.memo, debit: Number(row.debit) || null, credit: Number(row.credit) || null, balance: Number(row.balance) })), [
        { key: 'date', header: 'Tanggal', width: 12 }, { key: 'number', header: 'No. jurnal', width: 16 }, { key: 'memo', header: 'Keterangan', width: 40 },
        { key: 'debit', header: 'Debit', number: true, format: '#,##0', width: 14 }, { key: 'credit', header: 'Kredit', number: true, format: '#,##0', width: 14 },
        { key: 'balance', header: 'Saldo', number: true, format: '#,##0;(#,##0)', width: 16 },
      ], `buku-besar-${account?.code}-${from}_${period.to}`, 'xlsx', 'Buku besar')
    } catch (caught) {
      toast({ tone: 'error', title: 'Ekspor gagal', description: caught.message })
    }
  }

  return (
    <div className="inv-page">
      <section className="toolbar" aria-label="Pilih akun">
        <span className="ui-select-wrap fin-account-select">
          <label htmlFor="ledger-account" className="sr-only">Akun</label>
          <select id="ledger-account" className="ui-select" value={accountId || ''} onChange={(event) => setParams({ account: event.target.value }, { replace: true })}>
            {grouped.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.accounts.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}{item.is_active ? '' : ' (nonaktif)'}</option>)}
              </optgroup>
            ))}
          </select>
        </span>
        <PeriodPicker value={period} onChange={setPeriod} minDate={finance.goLive} />
        <Button variant="secondary" icon={Download} className="toolbar-end" disabled={!data?.length} onClick={handleExport}>Excel</Button>
      </section>

      <Card padding="none" className={`table-card${loading && data ? ' is-refreshing' : ''}`}>
        <div className="table-card-head fin-ledger-head">
          <div>
            <strong>{account ? `${account.code} · ${account.name}` : 'Pilih akun'}</strong>
            <small className="text-muted">{periodLabel({ from, to: period.to })}{account ? ` · ${ACCOUNT_TYPES[account.type]?.label}` : ''}</small>
          </div>
          {data?.length > 0 && (
            <dl className="fin-ledger-sums">
              <div><dt>Saldo awal</dt><dd className="tabular">{formatRupiah(opening)}</dd></div>
              <div><dt>Saldo akhir</dt><dd className="tabular">{formatRupiah(closing)}</dd></div>
            </dl>
          )}
        </div>
        {error ? <ErrorState message={error} onRetry={reload} />
          : !data ? <SkeletonRows rows={6} label="Memuat buku besar" />
            : !data.length ? <EmptyState compact title="Tidak ada mutasi di periode ini" description="Saldo akun tidak berubah pada rentang ini." />
              : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead><tr><th scope="col">Tanggal</th><th scope="col">Jurnal</th><th scope="col">Keterangan</th><th scope="col" className="num">Debit</th><th scope="col" className="num">Kredit</th><th scope="col" className="num">Saldo</th></tr></thead>
                    <tbody>
                      {data.map((row, index) => (
                        <tr key={`${row.journal_id}-${index}`}>
                          <td className="tabular nowrap">{dateOnly(row.entry_date)}</td>
                          <td className="tabular nowrap">{row.number}{row.kind !== 'auto' && <Badge tone="neutral" size="sm" dot={false} className="inv-inline-badge">{JOURNAL_KINDS[row.kind]}</Badge>}</td>
                          <td>{row.memo}</td>
                          <td className="num tabular">{Number(row.debit) ? formatRupiah(row.debit) : ''}</td>
                          <td className="num tabular">{Number(row.credit) ? formatRupiah(row.credit) : ''}</td>
                          <td className={`num tabular${Number(row.balance) < 0 ? ' inv-low' : ''}`}>{formatRupiah(row.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
      </Card>
    </div>
  )
}
