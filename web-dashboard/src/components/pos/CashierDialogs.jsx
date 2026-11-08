/*
 * Sesi kasir: buka (modal awal), kas masuk/keluar, tutup (hitung laci, selisih, serah terima).
 * Semua lewat RPC cashier_* (file 06). Kas seharusnya dihitung di database.
 */
import { useState } from 'react'
import { useAuth } from '../../auth/useAuth.js'
import { Button, Dialog, RupiahInput, SegmentedControl, Select, Switch, TextField, useToast } from '../ui/index.js'
import { formatRupiah } from '../../lib/format.js'
import { rpc } from '../../lib/pos.js'

export function OpenSessionDialog({ cafeId, suggestion, onClose, onOpened }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [cash, setCash] = useState(suggestion ?? '')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (cash === '' || Number(cash) < 0) return setError('Isi modal awal di laci (boleh 0)')
    setBusy(true)
    try {
      const id = await rpc(supabase, 'cashier_open', { p_cafe_id: cafeId, p_opening_cash: Number(cash), p_note: note || null })
      toast({ tone: 'success', title: 'Kasir dibuka', description: `Modal awal ${formatRupiah(cash)}` })
      onOpened(id)
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
    return undefined
  }

  return (
    <Dialog size="sm" title="Buka kasir" description="Hitung uang di laci sebelum mulai melayani." onClose={busy ? undefined : onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="open-session" loading={busy}>Buka kasir</Button></>}>
      <form id="open-session" className="inv-form" onSubmit={submit} noValidate>
        <RupiahInput label="Modal awal (uang di laci)" value={cash} onChange={(value) => { setCash(value); setError('') }} autoFocus
          hint={suggestion !== undefined && suggestion !== null ? `Dari serah terima sebelumnya: ${formatRupiah(suggestion)}` : undefined} />
        <TextField label="Catatan" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="Opsional, mis. shift pagi" />
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}

const CASH_PURPOSES = {
  out: [
    { value: 'expense', label: 'Belanja / biaya operasional' },
    { value: 'to_bank', label: 'Setor ke rekening bank' },
    { value: 'to_owner', label: 'Diambil owner' },
    { value: 'other', label: 'Lainnya' },
  ],
  in: [
    { value: 'from_owner', label: 'Tambahan modal dari owner' },
    { value: 'from_bank', label: 'Tarik dari rekening bank' },
    { value: 'other', label: 'Lainnya' },
  ],
}

/** finance: modul akuntansi (07) aktif — tanyakan tujuan agar jurnalnya tepat. */
export function CashMoveDialog({ sessionId, finance = false, onClose, onDone }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [direction, setDirection] = useState('out')
  const [purpose, setPurpose] = useState('expense')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (!(Number(amount) > 0)) return setError('Isi nominal')
    if (reason.trim().length < 3) return setError('Tulis keterangan')
    setBusy(true)
    try {
      await rpc(supabase, 'cashier_cash_move', {
        p_session_id: sessionId, p_direction: direction, p_amount: Number(amount), p_reason: reason,
        ...(finance ? { p_purpose: purpose } : {}),
      })
      toast({ tone: 'success', title: direction === 'in' ? 'Kas masuk dicatat' : 'Kas keluar dicatat', description: formatRupiah(amount) })
      onDone()
      onClose()
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
    return undefined
  }

  return (
    <Dialog size="sm" title="Kas masuk / keluar" description="Uang yang masuk atau keluar laci di luar penjualan." onClose={busy ? undefined : onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="cash-move" loading={busy}>Simpan</Button></>}>
      <form id="cash-move" className="inv-form" onSubmit={submit} noValidate>
        <SegmentedControl label="Arah" value={direction} onChange={(value) => { setDirection(value); setPurpose(CASH_PURPOSES[value][0].value) }}
          options={[{ value: 'out', label: 'Kas keluar' }, { value: 'in', label: 'Kas masuk' }]} />
        {finance && <Select label="Tujuan" value={purpose} onChange={(event) => setPurpose(event.target.value)} options={CASH_PURPOSES[direction]} />}
        <RupiahInput label="Nominal" value={amount} onChange={(value) => { setAmount(value); setError('') }} autoFocus />
        <TextField label="Keterangan" value={reason} onChange={(event) => { setReason(event.target.value); setError('') }} maxLength={200}
          placeholder={direction === 'out' ? 'Mis. beli es batu, setor ke owner' : 'Mis. tambahan uang kecil'} />
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}

export function CloseSessionDialog({ session, summary, team, onClose, onClosed }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [handover, setHandover] = useState(false)
  const [handoverTo, setHandoverTo] = useState('')
  const [handoverNote, setHandoverNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const expected = Number(summary?.expected_cash) || 0
  const difference = counted === '' ? null : Number(counted) - expected
  const candidates = team.filter((member) => member.is_active && member.id !== session.opened_by)

  async function submit(event) {
    event.preventDefault()
    if (counted === '') return setError('Hitung dan isi uang tunai di laci')
    if (difference !== null && Math.abs(difference) >= 1 && note.trim().length < 3) return setError('Ada selisih — tulis penjelasannya')
    if (handover && !handoverTo) return setError('Pilih penerima serah terima')
    setBusy(true)
    try {
      const result = await rpc(supabase, 'cashier_close', {
        p_session_id: session.id, p_counted_cash: Number(counted), p_note: note || null,
        p_handover_to: handover ? handoverTo : null, p_handover_note: handover ? handoverNote || null : null,
      })
      toast({ tone: Math.abs(Number(result.difference)) >= 1 ? 'info' : 'success', title: 'Kasir ditutup', description: Math.abs(Number(result.difference)) >= 1 ? `Selisih ${formatRupiah(result.difference)}` : 'Kas sesuai' })
      onClosed(result)
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
    return undefined
  }

  return (
    <Dialog title="Tutup kasir" description="Hitung semua uang tunai di laci, termasuk modal awal." onClose={busy ? undefined : onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="close-session" loading={busy}>Tutup kasir</Button></>}>
      <form id="close-session" className="inv-form" onSubmit={submit} noValidate>
        <dl className="inv-facts">
          <div><dt>Kas seharusnya</dt><dd className="tabular">{formatRupiah(expected)}</dd></div>
          <div><dt>Pesanan aktif sekarang</dt><dd className="tabular">{summary?.active_orders ?? 0}</dd></div>
        </dl>
        <RupiahInput label="Uang tunai di laci (hasil hitung)" value={counted} onChange={(value) => { setCounted(value); setError('') }} autoFocus
          hint={difference === null ? undefined : Math.abs(difference) < 1 ? 'Sesuai' : `Selisih ${difference > 0 ? '+' : ''}${formatRupiah(difference)}`} />
        <TextField label={difference !== null && Math.abs(difference) >= 1 ? 'Penjelasan selisih' : 'Catatan'} value={note} maxLength={300}
          onChange={(event) => { setNote(event.target.value); setError('') }} />
        <div className="inv-switch-line">
          <span><strong>Serah terima shift</strong><small>Teruskan kas & catatan ke staff berikutnya.</small></span>
          <Switch checked={handover} onChange={setHandover} label="Serah terima shift" onLabel="Ya" offLabel="Tidak" />
        </div>
        {handover && (
          <>
            <Select label="Diserahkan ke" value={handoverTo} onChange={(event) => setHandoverTo(event.target.value)}
              options={[{ value: '', label: 'Pilih anggota tim' }, ...candidates.map((member) => ({ value: member.id, label: member.full_name || 'Tanpa nama' }))]} />
            <TextField label="Catatan serah terima" multiline rows={3} maxLength={500} value={handoverNote} onChange={(event) => setHandoverNote(event.target.value)}
              placeholder={`Mis. ${summary?.active_orders ? `${summary.active_orders} pesanan belum selesai, ` : ''}stok cup tinggal sedikit`} />
          </>
        )}
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}
