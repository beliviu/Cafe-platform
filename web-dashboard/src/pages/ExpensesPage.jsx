/*
 * Beban operasional: catat beban (sewa, listrik, gaji, dll.) + foto nota, lunasi beban yang masih utang,
 * batalkan (jurnal dibalik), ringkasan per kategori, ekspor. Semua dijurnal otomatis oleh server.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { Ban, Banknote, Download, FileSpreadsheet, FileText, MoreHorizontal, Paperclip, Plus, ReceiptText } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, Dialog, Drawer, EmptyState, ErrorState, IconButton, Menu, PageHeader, Pagination, RupiahInput,
  SearchInput, Select, SkeletonRows, StatCard, TextField, useToast,
} from '../components/ui/index.js'
import { PeriodPicker } from '../components/finance/PeriodPicker.jsx'
import { fetchAllRows, FINANCE_REQUIRED, friendlyError } from '../lib/db.js'
import { formatNumber, formatRupiah, jakartaDateKey } from '../lib/format.js'
import { EXPENSE_METHODS, percentLabel, periodFor } from '../lib/finance.js'
import { dateOnly, exportRows, useLoader, useOwnerBase } from '../lib/inventory.js'
import { rpc } from '../lib/pos.js'

const BUCKET = 'expense-receipts'
const PAGE_SIZE = 30
const RECEIPT_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }
const METHOD_LABELS = Object.fromEntries(EXPENSE_METHODS.map((method) => [method.value, method.label]))
const PAID_METHODS = EXPENSE_METHODS.filter((method) => method.value !== 'unpaid')
const EXPENSE_COLUMNS = 'id, expense_date, account_id, description, amount, payment_method, vendor, receipt_path, status, paid_on, paid_method, void_reason, created_at'

/** Akun yang boleh dipakai sebagai kategori beban (sesuai validasi expense_create). */
function categoryGroups(accounts) {
  const active = accounts.filter((account) => account.is_active)
  return [
    { label: 'Beban operasional', accounts: active.filter((account) => account.type === 'expense') },
    { label: 'Beban lain-lain', accounts: active.filter((account) => account.type === 'other_expense') },
    { label: 'Pembelian aset', accounts: active.filter((account) => account.type === 'asset' && account.cash_flow === 'investing') },
  ].filter((group) => group.accounts.length)
}

export function ExpensesPage() {
  const context = useOutletContext()
  return (
    <div className="page page-wide">
      <PageHeader eyebrow="Keuangan" title="Beban" description="Sewa, listrik, gaji, dan pengeluaran lain. Setiap beban langsung masuk jurnal dan laporan laba rugi." />
      {context.features?.finance ? <ExpensesData cafe={context.cafe} /> : <Card><EmptyState title="Belum tersedia" description={FINANCE_REQUIRED} /></Card>}
    </div>
  )
}

function ExpensesData({ cafe }) {
  const { supabase } = useAuth()
  const base = useOwnerBase()
  const load = useCallback(async () => {
    const [settings, accounts] = await Promise.all([
      supabase.from('cafe_settings').select('accounting_go_live').eq('cafe_id', cafe.id).maybeSingle(),
      supabase.from('accounts').select('id, code, name, type, cash_flow, is_active').eq('cafe_id', cafe.id).order('code'),
    ])
    const failure = settings.error || accounts.error
    if (failure) throw new Error(friendlyError(failure))
    return { goLive: settings.data?.accounting_go_live || null, accounts: accounts.data || [] }
  }, [cafe.id, supabase])
  const { data, error, reload } = useLoader(load)

  if (error && !data) return <Card><ErrorState message={error} onRetry={reload} /></Card>
  if (!data) return <Card padding="none"><SkeletonRows rows={5} label="Memuat beban" /></Card>
  if (!data.goLive) {
    return (
      <Card>
        <EmptyState icon={ReceiptText} title="Mulai pembukuan dulu" description="Tentukan tanggal mulai dan saldo awal di menu Keuangan. Setelah itu beban bisa dicatat dan otomatis dijurnal."
          action={<Link to={`${base}/finance`} className="ui-link-button">Buka Keuangan</Link>} />
      </Card>
    )
  }
  return <ExpensesContent cafe={cafe} goLive={data.goLive} accounts={data.accounts} />
}

function ExpensesContent({ cafe, goLive, accounts }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [period, setPeriod] = useState(() => ({ ...periodFor('this-month'), key: 'this-month' }))
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState(null)
  const accountMap = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])
  const from = period.from < goLive ? goLive : period.from

  const load = useCallback(async () => {
    const [list, unpaid] = await Promise.all([
      fetchAllRows(() => supabase.from('expenses').select(EXPENSE_COLUMNS).eq('cafe_id', cafe.id)
        .gte('expense_date', from).lte('expense_date', period.to)
        .order('expense_date', { ascending: false }).order('created_at', { ascending: false })),
      supabase.from('expenses').select('id, amount').eq('cafe_id', cafe.id).eq('status', 'posted').eq('payment_method', 'unpaid').is('paid_on', null),
    ])
    const failure = list.error || unpaid.error
    if (failure) throw new Error(friendlyError(failure))
    return { rows: list.data, unpaid: unpaid.data || [] }
  }, [cafe.id, from, period.to, supabase])
  const { data, error, reload, loading } = useLoader(load)

  const posted = useMemo(() => (data?.rows || []).filter((row) => row.status === 'posted'), [data])
  const total = posted.reduce((sum, row) => sum + Number(row.amount), 0)
  const unpaidTotal = (data?.unpaid || []).reduce((sum, row) => sum + Number(row.amount), 0)
  const byCategory = useMemo(() => {
    const map = new Map()
    for (const row of posted) map.set(row.account_id, (map.get(row.account_id) || 0) + Number(row.amount))
    return [...map.entries()].map(([accountId, amount]) => ({ account: accountMap.get(accountId), amount })).sort((a, b) => b.amount - a.amount)
  }, [accountMap, posted])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id')
    return (data?.rows || []).filter((row) => (category === 'all' || row.account_id === category)
      && (status === 'all' || (status === 'unpaid' ? row.status === 'posted' && row.payment_method === 'unpaid' && !row.paid_on : row.status === status))
      && (!needle || `${row.description} ${row.vendor || ''}`.toLocaleLowerCase('id').includes(needle)))
  }, [category, data, query, status])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const usedCategories = [...new Set((data?.rows || []).map((row) => row.account_id))].map((id) => accountMap.get(id)).filter(Boolean)

  async function openReceipt(path) {
    const popup = window.open('', '_blank')
    const { data: signed, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300)
    if (signError || !signed?.signedUrl) {
      popup?.close()
      toast({ tone: 'error', title: 'Nota tidak dapat dibuka', description: friendlyError(signError) })
      return
    }
    if (popup) popup.location.href = signed.signedUrl
    else toast({ tone: 'error', title: 'Jendela baru diblokir', description: 'Izinkan pop-up untuk situs ini.' })
  }

  async function handleExport(format) {
    try {
      await exportRows(filtered.map((row) => ({
        date: row.expense_date, description: row.description, vendor: row.vendor || '', category: accountMap.get(row.account_id)?.name || '',
        method: METHOD_LABELS[row.payment_method], status: statusLabel(row), amount: Number(row.amount),
      })), [
        { key: 'date', header: 'Tanggal', width: 12 }, { key: 'description', header: 'Keterangan', width: 36 }, { key: 'vendor', header: 'Vendor', width: 20 },
        { key: 'category', header: 'Kategori', width: 24 }, { key: 'method', header: 'Dibayar dengan', width: 20 }, { key: 'status', header: 'Status', width: 14 },
        { key: 'amount', header: 'Nominal', number: true, format: '#,##0', width: 16 },
      ], `beban-${from}_${period.to}`, format, 'Beban')
    } catch (caught) {
      toast({ tone: 'error', title: 'Ekspor gagal', description: caught.message })
    }
  }

  return (
    <div className="inv-page">
      <section className="toolbar" aria-label="Periode beban">
        <PeriodPicker value={period} onChange={(next) => { setPeriod(next); setPage(1) }} minDate={goLive} />
        <span className="toolbar-end fin-actions">
          <Menu label="Ekspor beban" trigger={({ props }) => <Button variant="secondary" icon={Download} disabled={!filtered.length} {...props}>Ekspor</Button>}
            items={[{ label: 'Excel (.xlsx)', icon: FileSpreadsheet, onSelect: () => handleExport('xlsx') }, { label: 'CSV', icon: FileText, onSelect: () => handleExport('csv') }]} />
          <Button icon={Plus} onClick={() => setDialog({ type: 'create' })}>Catat beban</Button>
        </span>
      </section>

      {error && !data ? <Card><ErrorState message={error} onRetry={reload} /></Card> : (
        <>
          <section className="dash-stats inv-stats" aria-label="Ringkasan beban">
            <StatCard label="Total beban" value={formatRupiah(total)} caption={`${formatNumber(posted.length)} transaksi`} loading={!data} />
            <StatCard tone="amber" label="Belum dibayar" value={formatRupiah(unpaidTotal)} caption={`${formatNumber(data?.unpaid.length || 0)} beban · semua periode`} loading={!data}
              onClick={unpaidTotal ? () => { setStatus('unpaid'); setPage(1) } : undefined} />
            <StatCard tone="neutral" label="Kategori terbesar" value={byCategory[0]?.account?.name || '—'} caption={byCategory[0] ? `${formatRupiah(byCategory[0].amount)} · ${percentLabel(total ? byCategory[0].amount / total : 0)}` : 'Belum ada beban'} loading={!data} />
          </section>

          <div className="fin-grid is-wide-left">
            <div className="inv-page">
              <section className="toolbar" aria-label="Filter beban">
                <SearchInput value={query} onChange={(value) => { setQuery(value); setPage(1) }} placeholder="Cari keterangan atau vendor…" label="Cari beban" className="toolbar-search" />
                <Select hideLabel label="Kategori" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }}
                  options={[{ value: 'all', label: 'Semua kategori' }, ...usedCategories.map((account) => ({ value: account.id, label: account.name }))]} />
                <Select hideLabel label="Status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}
                  options={[{ value: 'all', label: 'Semua status' }, { value: 'unpaid', label: 'Belum dibayar' }, { value: 'posted', label: 'Tercatat' }, { value: 'void', label: 'Dibatalkan' }]} />
              </section>
              <Card padding="none" className={`table-card${loading && data ? ' is-refreshing' : ''}`}>
                {!data ? <SkeletonRows rows={6} label="Memuat beban" />
                  : !data.rows.length ? (
                    <EmptyState icon={ReceiptText} title="Belum ada beban di periode ini" description="Catat sewa, listrik, gaji, gas, dan pengeluaran lain agar laba bersih akurat."
                      action={<Button icon={Plus} onClick={() => setDialog({ type: 'create' })}>Catat beban</Button>} />
                  ) : !filtered.length ? <EmptyState compact title="Tidak ada beban yang cocok" description="Ubah filter atau kata kunci." /> : (
                    <>
                      <div className="table-scroll">
                        <table className="data-table">
                          <thead><tr><th scope="col">Tanggal</th><th scope="col">Keterangan</th><th scope="col">Kategori</th><th scope="col">Pembayaran</th><th scope="col" className="num">Nominal</th><th scope="col"><span className="sr-only">Aksi</span></th></tr></thead>
                          <tbody>
                            {rows.map((row) => (
                              <tr key={row.id} className={row.status === 'void' ? 'is-muted' : ''}>
                                <td className="tabular nowrap">{dateOnly(row.expense_date)}</td>
                                <td>
                                  <span className="inv-name"><strong>{row.description}</strong>{(row.vendor || row.void_reason) && <small>{row.status === 'void' ? `Dibatalkan: ${row.void_reason}` : row.vendor}</small>}</span>
                                </td>
                                <td>{accountMap.get(row.account_id)?.name || '—'}</td>
                                <td><StatusBadge row={row} /></td>
                                <td className={`num tabular${row.status === 'void' ? ' is-struck' : ''}`}>{formatRupiah(row.amount)}</td>
                                <td className="cell-actions">
                                  <RowMenu row={row} onReceipt={() => openReceipt(row.receipt_path)} onPay={() => setDialog({ type: 'pay', row })} onVoid={() => setDialog({ type: 'void', row })} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <Pagination page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} itemLabel="beban" />
                    </>
                  )}
              </Card>
            </div>

            <Card>
              <CardHeader title="Per kategori" description="Beban tercatat pada periode ini" />
              {!data ? <SkeletonRows rows={4} label="Memuat ringkasan" />
                : !byCategory.length ? <p className="text-muted">Belum ada beban.</p> : (
                  <ul className="fin-bars">
                    {byCategory.map((item) => (
                      <li key={item.account?.id || 'unknown'}>
                        <span className="fin-bars-label"><span>{item.account?.name || 'Akun dihapus'}</span><span className="tabular">{formatRupiah(item.amount)}</span></span>
                        <span className="fin-bars-track" aria-hidden="true"><span style={{ width: `${Math.max(2, (item.amount / byCategory[0].amount) * 100)}%` }} /></span>
                        <small className="text-muted">{percentLabel(total ? item.amount / total : 0)} dari total</small>
                      </li>
                    ))}
                  </ul>
                )}
            </Card>
          </div>
        </>
      )}

      {dialog?.type === 'create' && <ExpenseDrawer cafe={cafe} goLive={goLive} accounts={accounts} onClose={() => setDialog(null)} onSaved={reload} />}
      {dialog?.type === 'pay' && <PayDialog row={dialog.row} onClose={() => setDialog(null)} onSaved={reload} />}
      {dialog?.type === 'void' && <VoidDialog row={dialog.row} onClose={() => setDialog(null)} onSaved={reload} />}
    </div>
  )
}

const isUnpaid = (row) => row.status === 'posted' && row.payment_method === 'unpaid' && !row.paid_on

function statusLabel(row) {
  if (row.status === 'void') return 'Dibatalkan'
  if (isUnpaid(row)) return 'Belum dibayar'
  if (row.payment_method === 'unpaid') return `Lunas ${dateOnly(row.paid_on)}`
  return 'Lunas'
}

function StatusBadge({ row }) {
  if (row.status === 'void') return <Badge tone="neutral" size="sm">Dibatalkan</Badge>
  if (isUnpaid(row)) return <Badge tone="amber" size="sm">Belum dibayar</Badge>
  const method = row.payment_method === 'unpaid' ? row.paid_method : row.payment_method
  return <span className="fin-method">{METHOD_LABELS[method]}{row.payment_method === 'unpaid' && <small className="text-muted">Dilunasi {dateOnly(row.paid_on)}</small>}</span>
}

function RowMenu({ row, onReceipt, onPay, onVoid }) {
  const items = [
    row.receipt_path && { label: 'Lihat nota', icon: Paperclip, onSelect: onReceipt },
    isUnpaid(row) && { label: 'Tandai lunas', icon: Banknote, onSelect: onPay },
    row.status === 'posted' && { label: 'Batalkan beban', icon: Ban, tone: 'danger', onSelect: onVoid },
  ].filter(Boolean)
  if (!items.length) return null
  return (
    <Menu label={`Aksi ${row.description}`} items={items}
      trigger={({ props }) => <IconButton icon={MoreHorizontal} label={`Aksi ${row.description}`} size="sm" {...props} />} />
  )
}

function ExpenseDrawer({ cafe, goLive, accounts, onClose, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const today = jakartaDateKey()
  const groups = categoryGroups(accounts)
  const [form, setForm] = useState({ date: today, account_id: '', description: '', amount: '', method: 'cash', vendor: '' })
  const [file, setFile] = useState(null)
  const fileInput = useRef(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (key) => (value) => { setForm((current) => ({ ...current, [key]: value?.target ? value.target.value : value })); setError('') }

  function pickFile(event) {
    const picked = event.target.files?.[0]
    event.target.value = ''
    if (!picked) return
    if (!RECEIPT_TYPES[picked.type]) return setError('Nota harus berupa foto (JPG, PNG, WebP) atau PDF')
    if (picked.size > 5 * 1024 * 1024) return setError('Ukuran nota maksimal 5 MB')
    setFile(picked)
    setError('')
    return undefined
  }

  async function submit(event) {
    event.preventDefault()
    if (!form.account_id) return setError('Pilih kategori beban')
    if (form.description.trim().length < 3) return setError('Tulis keterangan beban (min. 3 huruf)')
    if (!(Number(form.amount) > 0)) return setError('Isi nominal beban')
    setSaving(true)
    let path = null
    try {
      if (file) {
        path = `${cafe.id}/${crypto.randomUUID()}.${RECEIPT_TYPES[file.type]}`
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
        if (uploadError) {
          path = null
          throw new Error(`Nota gagal diunggah: ${friendlyError(uploadError)}`)
        }
      }
      await rpc(supabase, 'expense_create', {
        p_cafe_id: cafe.id, p_date: form.date, p_account_id: form.account_id, p_description: form.description.trim(),
        p_amount: Number(form.amount), p_method: form.method, p_vendor: form.vendor.trim() || null, p_receipt_path: path,
      })
      toast({ tone: 'success', title: 'Beban dicatat', description: `${formatRupiah(form.amount)} · masuk jurnal otomatis` })
      onSaved()
      onClose()
    } catch (caught) {
      if (path) await supabase.storage.from(BUCKET).remove([path])
      setError(caught.message)
      setSaving(false)
    }
    return undefined
  }

  return (
    <Drawer title="Catat beban" description="Server membuat jurnal: debit kategori beban, kredit kas/bank (atau utang bila belum dibayar)."
      onClose={saving ? undefined : onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button><Button type="submit" form="expense-form" loading={saving}>Simpan beban</Button></>}>
      <form id="expense-form" className="inv-form" onSubmit={submit} noValidate>
        <div className="inv-form-row">
          <TextField label="Tanggal" type="date" value={form.date} min={goLive} max={today} onChange={(event) => event.target.value && set('date')(event.target.value)} />
          <RupiahInput label="Nominal" value={form.amount} onChange={set('amount')} />
        </div>
        <span className="ui-field">
          <label htmlFor="expense-account" className="ui-field-label">Kategori</label>
          <span className="ui-select-wrap">
            <select id="expense-account" className="ui-select" value={form.account_id} onChange={set('account_id')}>
              <option value="">Pilih kategori…</option>
              {groups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </optgroup>
              ))}
            </select>
          </span>
          <span className="ui-field-hint">Kategori lain bisa ditambah di Keuangan → Akun & periode</span>
        </span>
        <TextField label="Keterangan" value={form.description} onChange={set('description')} maxLength={200} placeholder="Mis. Listrik PLN Oktober" />
        <div className="inv-form-row">
          <Select label="Dibayar dengan" value={form.method} onChange={set('method')} options={EXPENSE_METHODS} />
          <TextField label="Vendor (opsional)" value={form.vendor} onChange={set('vendor')} maxLength={80} placeholder="Mis. PLN" />
        </div>
        <div className="fin-upload">
          <span className="ui-field-label">Foto nota (opsional)</span>
          {file ? (
            <span className="fin-upload-file">
              <Paperclip size={15} aria-hidden="true" /><span>{file.name}</span>
              <Button size="sm" variant="ghost" onClick={() => setFile(null)}>Hapus</Button>
            </span>
          ) : (
            <span>
              <Button size="sm" variant="secondary" icon={Paperclip} onClick={() => fileInput.current?.click()}>Pilih file</Button>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" tabIndex={-1} onChange={pickFile} />
            </span>
          )}
          <small className="text-muted">JPG, PNG, WebP, atau PDF · maks. 5 MB · hanya bisa dilihat owner</small>
        </div>
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Drawer>
  )
}

function PayDialog({ row, onClose, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const today = jakartaDateKey()
  const [method, setMethod] = useState('cash')
  const [date, setDate] = useState(today)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    setSaving(true)
    try {
      await rpc(supabase, 'expense_pay', { p_expense_id: row.id, p_method: method, p_date: date })
      toast({ tone: 'success', title: 'Beban dilunasi', description: formatRupiah(row.amount) })
      onSaved()
      onClose()
    } catch (caught) {
      setError(caught.message)
      setSaving(false)
    }
  }

  return (
    <Dialog size="sm" title="Tandai lunas" description={`${row.description} · ${formatRupiah(row.amount)}`} onClose={saving ? undefined : onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button><Button onClick={submit} loading={saving}>Simpan pelunasan</Button></>}>
      <div className="inv-form">
        <Select label="Dibayar dengan" value={method} onChange={(event) => { setMethod(event.target.value); setError('') }} options={PAID_METHODS} />
        <TextField label="Tanggal bayar" type="date" value={date} min={row.expense_date} max={today} onChange={(event) => event.target.value && setDate(event.target.value)} />
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}

function VoidDialog({ row, onClose, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  return (
    <ConfirmDialog tone="danger" title="Batalkan beban?" confirmLabel="Batalkan beban" onClose={onClose}
      description={`${row.description} · ${formatRupiah(row.amount)}. Jurnalnya dibalik (tidak dihapus), jadi riwayat tetap utuh.`}
      onConfirm={async () => {
        if (reason.trim().length < 3) {
          setError('Tulis alasan')
          return false
        }
        await rpc(supabase, 'expense_void', { p_expense_id: row.id, p_reason: reason.trim() })
        toast({ tone: 'success', title: 'Beban dibatalkan' })
        onSaved()
        onClose()
        return true
      }}>
      <TextField label="Alasan" value={reason} maxLength={300} error={error} onChange={(event) => { setReason(event.target.value); setError('') }} placeholder="Mis. Salah input nominal" />
    </ConfirmDialog>
  )
}
