/*
 * Bagan akun (tambah akun, ubah nama, nonaktifkan) dan periode akuntansi (tutup / buka kembali).
 */
import { useCallback, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Lock, LockOpen, Pencil, Plus } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, Dialog, ErrorState, IconButton, Select, SkeletonRows, Switch, TextField, useToast,
} from '../../components/ui/index.js'
import { friendlyError } from '../../lib/db.js'
import { formatDateTime, jakartaDateKey } from '../../lib/format.js'
import { ACCOUNT_TYPE_OPTIONS, ACCOUNT_TYPES, CASH_FLOW_LABELS, MONTHS } from '../../lib/finance.js'
import { useLoader } from '../../lib/inventory.js'
import { rpc } from '../../lib/pos.js'

export function AccountsPage() {
  const { cafe, finance } = useOutletContext()
  const [dialog, setDialog] = useState(null)
  return (
    <div className="inv-page">
      <div className="fin-grid is-wide-left">
        <Card padding="none">
          <div className="table-card-head">
            <CardHeader title="Bagan akun" description="Kode & jenis akun bawaan tetap; nama boleh diubah. Tambah akun baru untuk kategori beban sendiri."
              actions={<Button icon={Plus} onClick={() => setDialog({ type: 'account' })}>Tambah akun</Button>} />
          </div>
          {Object.entries(ACCOUNT_TYPES).map(([type, meta]) => {
            const list = finance.accounts.filter((account) => account.type === type)
            if (!list.length) return null
            return (
              <section key={type} className="fin-account-group" aria-label={meta.label}>
                <h3>{meta.label}</h3>
                <ul>
                  {list.map((account) => (
                    <li key={account.id} className={account.is_active ? '' : 'is-muted'}>
                      <span className="fin-code">{account.code}</span>
                      <span className="fin-account-name">{account.name}
                        {account.is_cash && <Badge tone="blue" size="sm" dot={false}>Kas & bank</Badge>}
                        {!account.is_active && <Badge tone="neutral" size="sm" dot={false}>Nonaktif</Badge>}
                      </span>
                      <small className="text-muted">{CASH_FLOW_LABELS[account.cash_flow]}</small>
                      <IconButton icon={Pencil} size="sm" label={`Ubah ${account.name}`} onClick={() => setDialog({ type: 'account', account })} />
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </Card>
        <PeriodsCard cafe={cafe} goLive={finance.goLive} />
      </div>
      {dialog?.type === 'account' && <AccountDialog cafe={cafe} account={dialog.account} onClose={() => setDialog(null)} onSaved={finance.reload} />}
    </div>
  )
}

function AccountDialog({ cafe, account, onClose, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const editing = Boolean(account)
  const [form, setForm] = useState({ code: account?.code || '6-', name: account?.name || '', type: account?.type || 'expense', cash_flow: account?.cash_flow || 'operating', is_active: account?.is_active ?? true })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (key) => (value) => { setForm((current) => ({ ...current, [key]: value?.target ? value.target.value : value })); setError('') }

  async function submit(event) {
    event.preventDefault()
    if (!editing && !/^[1-9]-\d{4}$/.test(form.code)) return setError('Kode berformat 6-1234 (digit pertama = golongan)')
    if (form.name.trim().length < 2) return setError('Nama minimal 2 huruf')
    setSaving(true)
    try {
      await rpc(supabase, 'acc_account_save', {
        p_cafe_id: cafe.id, p_id: account?.id || null, p_code: editing ? null : form.code, p_name: form.name.trim(),
        p_type: editing ? null : form.type, p_cash_flow: form.cash_flow, p_is_active: form.is_active,
      })
      toast({ tone: 'success', title: editing ? 'Akun diperbarui' : 'Akun ditambahkan' })
      onSaved()
      onClose()
    } catch (caught) {
      setError(caught.message)
      setSaving(false)
    }
    return undefined
  }

  return (
    <Dialog size="sm" title={editing ? `Ubah ${account.code}` : 'Tambah akun'} onClose={saving ? undefined : onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button><Button type="submit" form="account-form" loading={saving}>Simpan</Button></>}>
      <form id="account-form" className="inv-form" onSubmit={submit} noValidate>
        {!editing && (
          <div className="inv-form-row">
            <TextField label="Kode" value={form.code} onChange={set('code')} maxLength={6} placeholder="6-2100" hint="1 aset · 2 kewajiban · 3 ekuitas · 4 pendapatan · 5 HPP · 6 beban" />
            <Select label="Jenis" value={form.type} onChange={set('type')} options={ACCOUNT_TYPE_OPTIONS} />
          </div>
        )}
        <TextField label="Nama akun" value={form.name} onChange={set('name')} maxLength={80} autoFocus />
        {(!editing || !account.is_system) && (
          <Select label="Kelompok arus kas" value={form.cash_flow} onChange={set('cash_flow')}
            options={Object.entries(CASH_FLOW_LABELS).map(([value, label]) => ({ value, label }))} hint="Peralatan = investasi; modal & pinjaman = pendanaan; lainnya operasional" />
        )}
        {editing && !account.is_system && (
          <div className="inv-switch-line">
            <span><strong>Akun aktif</strong><small>Akun nonaktif tidak muncul di pilihan beban & jurnal manual.</small></span>
            <Switch checked={form.is_active} onChange={set('is_active')} label="Akun aktif" onLabel="Aktif" offLabel="Nonaktif" />
          </div>
        )}
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}

function PeriodsCard({ cafe, goLive }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [dialog, setDialog] = useState(null)
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('accounting_periods').select('period_start, status, closed_at, note').eq('cafe_id', cafe.id)
    if (error) throw new Error(friendlyError(error))
    return new Map((data || []).map((row) => [row.period_start, row]))
  }, [cafe.id, supabase])
  const { data, error, reload } = useLoader(load)
  const today = jakartaDateKey()
  const [year, month] = today.split('-').map(Number)
  const months = []
  for (let index = 0; index < 12; index += 1) {
    const date = new Date(Date.UTC(year, month - 1 - index, 1))
    const key = date.toISOString().slice(0, 10)
    if (goLive && key < `${goLive.slice(0, 7)}-01`) break
    months.push({ key, label: `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`, current: index === 0 })
  }

  async function apply(item, close, note) {
    await rpc(supabase, 'acc_set_period', { p_cafe_id: cafe.id, p_month: item.key, p_close: close, p_note: note || null })
    toast({ tone: 'success', title: close ? `${item.label} ditutup` : `${item.label} dibuka kembali` })
    setDialog(null)
    reload()
  }

  return (
    <Card>
      <CardHeader title="Periode akuntansi" description="Tutup bulan yang sudah final agar jurnalnya tidak berubah lagi." />
      {error ? <ErrorState compact message={error} onRetry={reload} /> : !data ? <SkeletonRows rows={4} label="Memuat periode" /> : (
        <ul className="fin-periods">
          {months.map((item) => {
            const row = data.get(item.key)
            const closed = row?.status === 'closed'
            return (
              <li key={item.key}>
                <span className="inv-name"><strong>{item.label}</strong><small>{item.current ? 'Bulan berjalan' : closed ? `Ditutup ${formatDateTime(row.closed_at)}` : row?.note ? `Dibuka kembali: ${row.note}` : 'Terbuka'}</small></span>
                {closed ? <Badge tone="neutral" size="sm">Ditutup</Badge> : <Badge tone="green" size="sm">Terbuka</Badge>}
                {!item.current && (closed
                  ? <Button size="sm" variant="ghost" icon={LockOpen} onClick={() => setDialog({ ...item, close: false })}>Buka</Button>
                  : <Button size="sm" variant="secondary" icon={Lock} onClick={() => setDialog({ ...item, close: true })}>Tutup</Button>)}
              </li>
            )
          })}
        </ul>
      )}
      {dialog && <PeriodDialog dialog={dialog} onClose={() => setDialog(null)} onApply={apply} />}
    </Card>
  )
}

function PeriodDialog({ dialog, onClose, onApply }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  return (
    <ConfirmDialog tone={dialog.close ? 'primary' : 'danger'} title={dialog.close ? `Tutup ${dialog.label}?` : `Buka kembali ${dialog.label}?`}
      confirmLabel={dialog.close ? 'Tutup periode' : 'Buka kembali'} onClose={onClose}
      description={dialog.close
        ? 'Setelah ditutup, tidak ada jurnal baru yang bisa bertanggal di bulan ini (termasuk jurnal otomatis). Laporan bulan ini menjadi final.'
        : 'Membuka kembali memungkinkan jurnal baru di bulan ini. Laporan yang sudah dibagikan bisa berubah.'}
      onConfirm={async () => {
        if (!dialog.close && note.trim().length < 3) {
          setError('Tulis alasan')
          return false
        }
        await onApply(dialog, dialog.close, note.trim())
        return true
      }}>
      <TextField label={dialog.close ? 'Catatan (opsional)' : 'Alasan'} value={note} maxLength={300} error={error} onChange={(event) => { setNote(event.target.value); setError('') }} />
    </ConfirmDialog>
  )
}
