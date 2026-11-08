/*
 * Jurnal umum: daftar jurnal (otomatis, manual, saldo awal, pembalik), detail baris,
 * jurnal manual (wajib seimbang), dan pembalik (jurnal tidak pernah diedit/dihapus).
 */
import { useCallback, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { ChevronDown, ChevronRight, Download, FilePlus2, FileSpreadsheet, FileText, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import {
  Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, IconButton, Menu, Pagination, RupiahInput, SearchInput, Select,
  SkeletonRows, TextField, useToast,
} from '../../components/ui/index.js'
import { PeriodPicker } from '../../components/finance/PeriodPicker.jsx'
import { fetchAllRows, friendlyError } from '../../lib/db.js'
import { formatDate, formatRupiah, jakartaDateKey } from '../../lib/format.js'
import { JOURNAL_KINDS, periodFor } from '../../lib/finance.js'
import { exportRows, useLoader } from '../../lib/inventory.js'
import { rpc } from '../../lib/pos.js'

const PAGE_SIZE = 40
const KIND_TONES = { auto: 'neutral', manual: 'blue', opening: 'green', reversal: 'amber' }
const dateOnly = (key) => formatDate(`${key}T00:00:00+07:00`)

export function JournalPage() {
  const { cafe, finance } = useOutletContext()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [period, setPeriod] = useState(() => ({ ...periodFor('this-month'), key: 'this-month' }))
  const [kind, setKind] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(() => new Set())
  const [dialog, setDialog] = useState(null)
  const accounts = useMemo(() => new Map(finance.accounts.map((account) => [account.id, account])), [finance.accounts])

  const load = useCallback(async () => {
    const entries = await fetchAllRows(() => supabase.from('journal_entries')
      .select('id, number, entry_date, memo, kind, source_type, status, reversal_of, reversed_by, total, created_at')
      .eq('cafe_id', cafe.id).gte('entry_date', period.from).lte('entry_date', period.to)
      .order('entry_date', { ascending: false }).order('created_at', { ascending: false }))
    if (entries.error) throw new Error(friendlyError(entries.error))
    return entries.data
  }, [cafe.id, period.from, period.to, supabase])
  const { data, error, reload, loading } = useLoader(load)

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id')
    return (data || []).filter((entry) => (kind === 'all' || entry.kind === kind)
      && (!needle || `${entry.number} ${entry.memo}`.toLocaleLowerCase('id').includes(needle)))
  }, [data, kind, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function toggle(id) {
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleExport(format) {
    try {
      const ids = filtered.map((entry) => entry.id)
      const lines = []
      for (let index = 0; index < ids.length; index += 150) {
        const { data: chunk, error: chunkError } = await supabase.from('journal_lines').select('journal_id, account_id, debit, credit, memo, line_no').in('journal_id', ids.slice(index, index + 150))
        if (chunkError) throw new Error(friendlyError(chunkError))
        lines.push(...(chunk || []))
      }
      const byId = new Map(filtered.map((entry) => [entry.id, entry]))
      const rowsOut = lines.sort((a, b) => (byId.get(a.journal_id).entry_date < byId.get(b.journal_id).entry_date ? -1 : 1) || a.line_no - b.line_no).map((line) => {
        const entry = byId.get(line.journal_id)
        const account = accounts.get(line.account_id)
        return { date: entry.entry_date, number: entry.number, memo: entry.memo, kind: JOURNAL_KINDS[entry.kind], account: account ? `${account.code} ${account.name}` : '', debit: Number(line.debit) || null, credit: Number(line.credit) || null, note: line.memo || '' }
      })
      await exportRows(rowsOut, [
        { key: 'date', header: 'Tanggal', width: 12 }, { key: 'number', header: 'No. jurnal', width: 16 }, { key: 'memo', header: 'Keterangan', width: 34 },
        { key: 'kind', header: 'Jenis', width: 12 }, { key: 'account', header: 'Akun', width: 32 },
        { key: 'debit', header: 'Debit', number: true, format: '#,##0', width: 14 }, { key: 'credit', header: 'Kredit', number: true, format: '#,##0', width: 14 },
        { key: 'note', header: 'Catatan baris', width: 20 },
      ], `jurnal-umum-${period.from}_${period.to}`, format, 'Jurnal umum')
    } catch (caught) {
      toast({ tone: 'error', title: 'Ekspor gagal', description: caught.message })
    }
  }

  return (
    <div className="inv-page">
      <section className="toolbar" aria-label="Filter jurnal">
        <PeriodPicker value={period} onChange={(value) => { setPeriod(value); setPage(1) }} minDate={finance.goLive} />
        <SearchInput value={query} onChange={(value) => { setQuery(value); setPage(1) }} placeholder="Cari nomor atau keterangan…" label="Cari jurnal" className="toolbar-search" />
        <Select hideLabel label="Jenis jurnal" value={kind} onChange={(event) => { setKind(event.target.value); setPage(1) }}
          options={[{ value: 'all', label: 'Semua jenis' }, ...Object.entries(JOURNAL_KINDS).map(([value, label]) => ({ value, label }))]} />
        <span className="toolbar-end fin-actions">
          <Menu
            label="Ekspor jurnal"
            trigger={({ props }) => <Button variant="secondary" icon={Download} disabled={!filtered.length} {...props}>Ekspor</Button>}
            items={[
              { label: 'Excel (.xlsx)', icon: FileSpreadsheet, onSelect: () => handleExport('xlsx') },
              { label: 'CSV', icon: FileText, onSelect: () => handleExport('csv') },
            ]}
          />
          <Button icon={FilePlus2} onClick={() => setDialog({ type: 'manual' })}>Jurnal manual</Button>
        </span>
      </section>

      <Card padding="none" className={`table-card${loading && data ? ' is-refreshing' : ''}`}>
        {error ? <ErrorState message={error} onRetry={reload} />
          : !data ? <SkeletonRows rows={8} label="Memuat jurnal" />
            : !filtered.length ? <EmptyState compact title="Belum ada jurnal di periode ini" description="Jurnal otomatis muncul saat pesanan selesai, pembayaran, stok, PO, kas kasir, dan beban." />
              : (
                <>
                  <ol className="fin-journals">
                    {rows.map((entry) => (
                      <JournalRow key={entry.id} entry={entry} open={open.has(entry.id)} onToggle={() => toggle(entry.id)} accounts={accounts}
                        onReverse={() => setDialog({ type: 'reverse', entry })} />
                    ))}
                  </ol>
                  <Pagination page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} itemLabel="jurnal" />
                </>
              )}
      </Card>

      {dialog?.type === 'manual' && <ManualJournalDrawer cafe={cafe} accounts={finance.accounts} goLive={finance.goLive} onClose={() => setDialog(null)} onSaved={reload} />}
      {dialog?.type === 'reverse' && <ReverseDialog entry={dialog.entry} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload() }} />}
    </div>
  )
}

function JournalRow({ entry, open, onToggle, accounts, onReverse }) {
  const { supabase } = useAuth()
  const [lines, setLines] = useState(null)
  async function toggle() {
    onToggle()
    if (!lines) {
      const { data } = await supabase.from('journal_lines').select('id, account_id, debit, credit, memo, line_no').eq('journal_id', entry.id).order('line_no')
      setLines(data || [])
    }
  }
  return (
    <li className={`fin-journal${entry.status === 'reversed' ? ' is-reversed' : ''}`}>
      <button type="button" className="fin-journal-head" onClick={toggle} aria-expanded={open}>
        {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
        <span className="tabular fin-journal-date">{dateOnly(entry.entry_date)}</span>
        <span className="fin-journal-memo"><strong>{entry.memo}</strong><small className="tabular">{entry.number}</small></span>
        <Badge tone={KIND_TONES[entry.kind]} size="sm" dot={false}>{JOURNAL_KINDS[entry.kind]}</Badge>
        {entry.status === 'reversed' && <Badge tone="neutral" size="sm" dot={false}>Dibalik</Badge>}
        <strong className="tabular fin-journal-total">{formatRupiah(entry.total)}</strong>
      </button>
      {open && (
        <div className="fin-journal-body">
          {!lines ? <SkeletonRows rows={2} label="Memuat baris" /> : (
            <table className="fin-table is-compact">
              <thead><tr><th scope="col">Akun</th><th scope="col" className="num">Debit</th><th scope="col" className="num">Kredit</th></tr></thead>
              <tbody>
                {lines.map((line) => {
                  const account = accounts.get(line.account_id)
                  return (
                    <tr key={line.id}>
                      <td className={Number(line.credit) ? 'is-indent' : ''}><span className="fin-code">{account?.code}</span>{account?.name}{line.memo ? <small className="cell-sub">{line.memo}</small> : null}</td>
                      <td className="num tabular">{Number(line.debit) ? formatRupiah(line.debit) : ''}</td>
                      <td className="num tabular">{Number(line.credit) ? formatRupiah(line.credit) : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {entry.status === 'posted' && entry.kind !== 'reversal' && (
            <div className="fin-journal-actions">
              <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onReverse}>Buat jurnal pembalik</Button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function ReverseDialog({ entry, onClose, onDone }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  return (
    <ConfirmDialog
      title={`Balik ${entry.number}?`}
      description={entry.kind === 'auto'
        ? 'Ini jurnal otomatis dari transaksi. Membaliknya menghapus efeknya dari laporan — lakukan hanya bila transaksinya memang salah dan tidak akan dikoreksi lewat fitur lain.'
        : 'Jurnal pembalik dibuat dengan debit/kredit ditukar, bertanggal hari ini. Jurnal asli tetap tersimpan.'}
      confirmLabel="Buat pembalik"
      onClose={onClose}
      onConfirm={async () => {
        if (reason.trim().length < 3) {
          setError('Tulis alasan')
          return false
        }
        await rpc(supabase, 'acc_reverse_journal', { p_journal_id: entry.id, p_reason: reason.trim() })
        toast({ tone: 'success', title: `${entry.number} dibalik` })
        onDone()
        return true
      }}
    >
      <TextField label="Alasan" value={reason} maxLength={200} error={error} onChange={(event) => { setReason(event.target.value); setError('') }} />
    </ConfirmDialog>
  )
}

let rowSeed = 0
const newRow = () => ({ key: `r${(rowSeed += 1)}`, account_id: '', debit: '', credit: '', memo: '' })

function ManualJournalDrawer({ cafe, accounts, goLive, onClose, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const today = jakartaDateKey()
  const [date, setDate] = useState(today)
  const [memo, setMemo] = useState('')
  const [rows, setRows] = useState(() => [newRow(), newRow()])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const active = accounts.filter((account) => account.is_active)
  const debit = rows.reduce((sum, row) => sum + (Number(row.debit) || 0), 0)
  const credit = rows.reduce((sum, row) => sum + (Number(row.credit) || 0), 0)
  const balanced = debit > 0 && Math.abs(debit - credit) < 0.005

  function update(key, patch) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
    setError('')
  }

  async function save() {
    const filled = rows.filter((row) => row.account_id || row.debit || row.credit)
    if (memo.trim().length < 3) return setError('Tulis keterangan jurnal')
    if (filled.length < 2) return setError('Minimal 2 baris')
    if (filled.some((row) => !row.account_id)) return setError('Pilih akun di setiap baris')
    if (filled.some((row) => (Number(row.debit) > 0) === (Number(row.credit) > 0))) return setError('Setiap baris isi debit ATAU kredit')
    if (!balanced) return setError(`Belum seimbang: selisih ${formatRupiah(Math.abs(debit - credit))}`)
    setSaving(true)
    try {
      await rpc(supabase, 'acc_manual_journal', {
        p_cafe_id: cafe.id, p_date: date, p_memo: memo.trim(),
        p_lines: filled.map((row) => ({ account_id: row.account_id, debit: Number(row.debit) || 0, credit: Number(row.credit) || 0, memo: row.memo || null })),
      })
      toast({ tone: 'success', title: 'Jurnal manual diposting', description: formatRupiah(debit) })
      onSaved()
      onClose()
    } catch (caught) {
      setError(caught.message)
      setSaving(false)
    }
    return undefined
  }

  return (
    <Drawer title="Jurnal manual" description="Untuk pencairan QRIS ke bank, setoran/penarikan pemilik, penyusutan, koreksi saldo awal, dll. Wajib seimbang." size="lg"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <span className={`fin-balance${balanced ? ' is-ok' : ''}`}>Debit {formatRupiah(debit)} · Kredit {formatRupiah(credit)}</span>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={save} loading={saving} disabled={!balanced}>Posting jurnal</Button>
        </>
      )}>
      <div className="inv-form">
        <div className="inv-form-row">
          <TextField label="Tanggal" type="date" value={date} min={goLive} max={today} onChange={(event) => event.target.value && setDate(event.target.value)} />
          <TextField label="Keterangan" value={memo} maxLength={300} onChange={(event) => { setMemo(event.target.value); setError('') }} placeholder="Mis. Pencairan QRIS ke rekening BCA" />
        </div>
        <div className="fin-lines" role="table" aria-label="Baris jurnal">
          <div className="fin-line is-head" role="row"><span>Akun</span><span>Debit</span><span>Kredit</span><span>Catatan</span><span /></div>
          {rows.map((row) => (
            <div key={row.key} className="fin-line" role="row">
              <Select hideLabel label="Akun" value={row.account_id} onChange={(event) => update(row.key, { account_id: event.target.value })}
                options={[{ value: '', label: 'Pilih akun…' }, ...active.map((account) => ({ value: account.id, label: `${account.code} · ${account.name}` }))]} />
              <RupiahInput hideLabel label="Debit" placeholder="Debit" value={row.debit} onChange={(value) => update(row.key, { debit: value, credit: value ? '' : row.credit })} />
              <RupiahInput hideLabel label="Kredit" placeholder="Kredit" value={row.credit} onChange={(value) => update(row.key, { credit: value, debit: value ? '' : row.debit })} />
              <TextField hideLabel label="Catatan baris" placeholder="Catatan (opsional)" value={row.memo} maxLength={200} onChange={(event) => update(row.key, { memo: event.target.value })} />
              <IconButton icon={Trash2} size="sm" variant="danger" label="Hapus baris" disabled={rows.length <= 2} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))} />
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setRows((current) => [...current, newRow()])}>Tambah baris</Button>
        </div>
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </div>
    </Drawer>
  )
}
