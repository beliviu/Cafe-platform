/*
 * Pengaturan → Meja (tabel cafe_tables, file usulan 04).
 * Dipakai POS untuk pesanan makan di tempat (fase 5) dan QR meja di aplikasi customer (fase 7).
 */
import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, Printer, QrCode, Trash2 } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, IconButton, SkeletonRows, Switch, TextField, useToast,
} from '../../components/ui/index.js'
import { CUSTOMER_REQUIRED, friendlyError, PHASE3_REQUIRED } from '../../lib/db.js'
import { formatTime } from '../../lib/format.js'
import { brandOf } from '../../lib/branding.js'
import { TableQrDialog } from '../../components/settings/TableQrDialog.jsx'
import { printTableQrSheet } from '../../lib/qr.js'

const COLUMNS = 'id, label, area, capacity, is_active, sort_order'

function tableError(error) {
  if (error?.code === '23505') return 'Nama meja ini sudah dipakai.'
  return friendlyError(error)
}

export function TablesSettings() {
  const { cafe, features } = useOutletContext()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [state, setState] = useState({ loading: true, tables: [], error: '' })
  const [attempt, setAttempt] = useState(0)
  const [draft, setDraft] = useState({ label: '', area: '', capacity: '' })
  const [bulk, setBulk] = useState({ from: '1', to: '10', area: '' })
  const [draftError, setDraftError] = useState('')
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(null)
  const [qr, setQr] = useState({ map: new Map(), error: '' })
  const [qrTable, setQrTable] = useState(null)
  const cafeName = brandOf(cafe).name

  // QR & keterisian meja (file 08): token hanya bisa dibaca owner lewat fungsi
  const loadQr = useCallback(async () => {
    if (!features?.customer) return
    const { data, error } = await supabase.rpc('cafe_tables_qr', { p_cafe_id: cafe.id })
    setQr({ map: new Map((data || []).map((row) => [row.table_id, row])), error: error ? friendlyError(error) : '' })
  }, [cafe.id, features?.customer, supabase])

  useEffect(() => {
    const timer = setTimeout(loadQr, 0)
    const interval = setInterval(loadQr, 60000)
    return () => { clearTimeout(timer); clearInterval(interval) }
  }, [loadQr, state.tables.length])

  useEffect(() => {
    if (!features?.phase3) return undefined
    let active = true
    supabase.from('cafe_tables').select(COLUMNS).eq('cafe_id', cafe.id).order('sort_order').order('label').then(({ data, error }) => {
      if (active) setState({ loading: false, tables: data || [], error: error ? friendlyError(error) : '' })
    })
    return () => { active = false }
  }, [attempt, cafe.id, features?.phase3, supabase])

  if (!features?.phase3) {
    return <Card className="settings-card"><CardHeader title="Meja" /><EmptyState compact title="Belum tersedia" description={PHASE3_REQUIRED} /></Card>
  }

  const nextSort = state.tables.reduce((max, table) => Math.max(max, table.sort_order), -1) + 1
  const areas = [...new Set(state.tables.map((table) => table.area).filter(Boolean))]

  async function insertRows(rows) {
    setBusy(true)
    const { data, error } = await supabase.from('cafe_tables').insert(rows).select(COLUMNS)
    setBusy(false)
    if (error) throw new Error(tableError(error))
    setState((current) => ({ ...current, tables: [...current.tables, ...data] }))
    return data
  }

  async function addOne(event) {
    event.preventDefault()
    const label = draft.label.replace(/\s+/g, ' ').trim()
    const capacity = draft.capacity === '' ? null : Number(draft.capacity)
    if (!label) return setDraftError('Isi nama meja, mis. "4" atau "Teras 2".')
    if (capacity !== null && !(Number.isInteger(capacity) && capacity >= 1 && capacity <= 50)) return setDraftError('Kapasitas 1–50 orang.')
    try {
      await insertRows([{ cafe_id: cafe.id, label, area: draft.area.trim() || null, capacity, sort_order: nextSort }])
      setDraft((current) => ({ label: '', area: current.area, capacity: current.capacity }))
      setDraftError('')
    } catch (caught) {
      setDraftError(caught.message)
    }
  }

  async function addBulk() {
    const from = Number(bulk.from)
    const to = Number(bulk.to)
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to - from > 49) {
      return toast({ tone: 'error', title: 'Rentang tidak valid', description: 'Gunakan angka, maksimal 50 meja sekaligus.' })
    }
    const existing = new Set(state.tables.map((table) => table.label))
    const rows = []
    for (let number = from; number <= to; number += 1) {
      const label = String(number)
      if (!existing.has(label)) rows.push({ cafe_id: cafe.id, label, area: bulk.area.trim() || null, sort_order: nextSort + rows.length })
    }
    if (!rows.length) return toast({ tone: 'info', title: 'Semua meja di rentang itu sudah ada' })
    try {
      await insertRows(rows)
      toast({ tone: 'success', title: `${rows.length} meja ditambahkan` })
    } catch (caught) {
      toast({ tone: 'error', title: 'Meja gagal ditambahkan', description: caught.message })
    }
  }

  async function patch(table, values) {
    const { data, error } = await supabase.from('cafe_tables').update(values).eq('id', table.id).select(COLUMNS).maybeSingle()
    if (error || !data) {
      toast({ tone: 'error', title: 'Meja gagal diperbarui', description: error ? tableError(error) : 'Ditolak database.' })
      return
    }
    setState((current) => ({ ...current, tables: current.tables.map((row) => (row.id === data.id ? data : row)) }))
  }

  async function remove() {
    const { error } = await supabase.from('cafe_tables').delete().eq('id', removing.id)
    if (error) throw new Error(tableError(error))
    setState((current) => ({ ...current, tables: current.tables.filter((row) => row.id !== removing.id) }))
    toast({ tone: 'success', title: `Meja ${removing.label} dihapus` })
    setRemoving(null)
  }

  return (
    <div className="settings-grid">
      <Card className="settings-card" padding="none">
        <div className="table-card-head">
          <CardHeader
            title="Daftar meja"
            description={`${state.tables.filter((table) => table.is_active).length} aktif dari ${state.tables.length} meja`}
            actions={features?.customer && qr.map.size > 0 ? (
              <Button variant="secondary" size="sm" icon={Printer}
                onClick={() => printTableQrSheet(state.tables.filter((table) => table.is_active).map((table) => ({ ...table, qr_token: qr.map.get(table.id)?.qr_token })).filter((table) => table.qr_token), cafeName)
                  || toast({ tone: 'error', title: 'Jendela cetak diblokir', description: 'Izinkan pop-up untuk situs ini.' })}>
                Cetak semua QR
              </Button>
            ) : null}
          />
        </div>
        {state.loading ? <div className="table-card-body"><SkeletonRows rows={4} label="Memuat meja" /></div>
          : state.error ? <div className="table-card-body"><ErrorState compact message={state.error} onRetry={() => setAttempt((value) => value + 1)} /></div>
            : !state.tables.length ? (
              <div className="table-card-body"><EmptyState compact title="Belum ada meja" description="Tambahkan meja satu per satu atau sekaligus dengan rentang nomor." /></div>
            ) : (
              <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr><th scope="col">Meja</th><th scope="col">Area</th><th scope="col" className="num">Kursi</th>{features?.customer && <th scope="col">Saat ini</th>}<th scope="col">Status</th><th scope="col"><span className="sr-only">Aksi</span></th></tr>
                </thead>
                <tbody>
                  {state.tables.map((table) => (
                    <tr key={table.id} className={table.is_active ? '' : 'is-muted'}>
                      <td><strong>{table.label}</strong></td>
                      <td>{table.area || <span className="text-muted">—</span>}</td>
                      <td className="num tabular">{table.capacity ?? '—'}</td>
                      {features?.customer && <td><Occupancy info={qr.map.get(table.id)} /></td>}
                      <td>
                        <Switch size="sm" checked={table.is_active} onChange={(value) => patch(table, { is_active: value })}
                          label={`Meja ${table.label} aktif`} onLabel="Aktif" offLabel="Nonaktif" />
                      </td>
                      <td className="cell-actions">
                        {features?.customer && qr.map.get(table.id)?.qr_token && (
                          <IconButton icon={QrCode} label={`QR meja ${table.label}`} size="sm" onClick={() => setQrTable({ ...table, qr_token: qr.map.get(table.id).qr_token })} />
                        )}
                        <IconButton icon={Trash2} label={`Hapus meja ${table.label}`} size="sm" variant="danger" onClick={() => setRemoving(table)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
      </Card>

      <div className="settings-column">
        <Card as="form" onSubmit={addOne} noValidate className="settings-card">
          <CardHeader title="Tambah meja" />
          <div className="settings-fields">
            <TextField label="Nama / nomor" value={draft.label} maxLength={20} placeholder="Mis. 4 atau Teras 2"
              onChange={(event) => { setDraft((current) => ({ ...current, label: event.target.value })); setDraftError('') }} />
            <TextField label="Kursi" value={draft.capacity} inputMode="numeric" placeholder="Opsional"
              onChange={(event) => setDraft((current) => ({ ...current, capacity: event.target.value.replace(/\D/g, '') }))} />
            <TextField className="settings-span" label="Area" value={draft.area} maxLength={40} placeholder="Mis. Indoor, Teras, Lantai 2"
              list="table-areas" onChange={(event) => setDraft((current) => ({ ...current, area: event.target.value }))} />
            <datalist id="table-areas">{areas.map((area) => <option key={area} value={area} />)}</datalist>
          </div>
          {draftError && <p className="ui-field-error" role="alert">{draftError}</p>}
          <div className="settings-actions"><Button type="submit" icon={Plus} loading={busy}>Tambah meja</Button></div>
        </Card>

        <Card className="settings-card">
          <CardHeader title="Tambah sekaligus" description="Buat meja bernomor berurutan. Nomor yang sudah ada dilewati." />
          <div className="settings-fields settings-fields-3">
            <TextField label="Dari" value={bulk.from} inputMode="numeric" onChange={(event) => setBulk((current) => ({ ...current, from: event.target.value.replace(/\D/g, '') }))} />
            <TextField label="Sampai" value={bulk.to} inputMode="numeric" onChange={(event) => setBulk((current) => ({ ...current, to: event.target.value.replace(/\D/g, '') }))} />
            <TextField label="Area" value={bulk.area} maxLength={40} placeholder="Opsional" list="table-areas" onChange={(event) => setBulk((current) => ({ ...current, area: event.target.value }))} />
          </div>
          <div className="settings-actions"><Button variant="secondary" onClick={addBulk} loading={busy}>Buat meja {bulk.from || '?'}–{bulk.to || '?'}</Button></div>
        </Card>

        <p className="settings-note">
          {features?.customer
            ? <>Setiap meja punya QR sendiri. Pelanggan scan → menu terbuka dengan meja terpilih, pesanan masuk ke papan staff dengan nomor meja. Meja nonaktif tidak bisa dipesan lewat QR.{qr.error ? ` (${qr.error})` : ''}</>
            : <><Badge tone="neutral" dot={false}>QR meja</Badge> {CUSTOMER_REQUIRED}</>}
        </p>
      </div>

      {qrTable && (
        <TableQrDialog table={qrTable} cafeName={cafeName} onClose={() => setQrTable(null)}
          onRotated={(token) => { setQrTable((current) => ({ ...current, qr_token: token })); loadQr() }} />
      )}
      {removing && (
        <ConfirmDialog
          title={`Hapus meja ${removing.label}?`}
          description="Meja dihapus dari daftar. Untuk sementara tidak dipakai, cukup nonaktifkan."
          confirmLabel="Hapus meja"
          tone="danger"
          onConfirm={remove}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  )
}

function Occupancy({ info }) {
  if (!info) return <span className="text-muted">—</span>
  return info.active_orders > 0
    ? <Badge tone="amber" size="sm">Terisi · {info.active_orders} pesanan sejak {formatTime(info.occupied_since)}</Badge>
    : <Badge tone="green" size="sm">Kosong</Badge>
}
