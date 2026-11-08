/*
 * Pembayaran kasir: tunai (uang diterima & kembalian), QRIS/transfer/e-wallet (konfirmasi manual),
 * atau split. Pesanan dibuat dulu (place_order, anti-dobel), lalu pos_record_payments.
 * QRIS di sini = kasir memastikan dana masuk di aplikasi merchant; bukan verifikasi otomatis.
 */
import { useState } from 'react'
import { Banknote, Landmark, Plus, QrCode, Trash2, Wallet } from 'lucide-react'
import { Button, Dialog, IconButton, RupiahInput, Select, TextField } from '../ui/index.js'
import { cafePaymentMethods } from '../../lib/db.js'
import { formatRupiah } from '../../lib/format.js'
import { cashSuggestions, rpc } from '../../lib/pos.js'
import { paymentMethodLabel } from '../../lib/status.js'

const ICONS = { cash: Banknote, qris: QrCode, bank_transfer: Landmark, ewallet: Wallet }

export function PaymentDialog({ cafe, total, session, ensureOrder, onClose, onPaid, supabase }) {
  const methods = cafePaymentMethods(cafe)
  const firstMethod = methods.includes('cash') && session ? 'cash' : methods.find((method) => method !== 'cash') || 'cash'
  const [rows, setRows] = useState([{ method: firstMethod, amount: total, tendered: '', reference: '' }])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const split = rows.length > 1
  const sum = rows.reduce((value, row) => value + (Number(row.amount) || 0), 0)
  const cashRow = rows.find((row) => row.method === 'cash')
  const change = cashRow && Number(cashRow.tendered) > Number(cashRow.amount) ? Number(cashRow.tendered) - Number(cashRow.amount) : 0

  function update(index, patch) {
    setError('')
    setRows((current) => current.map((row, position) => (position === index ? { ...row, ...patch } : row)))
  }

  function addRow() {
    const used = new Set(rows.map((row) => row.method))
    const method = methods.find((value) => !used.has(value)) || methods[0]
    const remaining = Math.max(total - sum, 0)
    setRows((current) => [...current, { method, amount: remaining, tendered: '', reference: '' }])
  }

  async function submit(event) {
    event.preventDefault()
    if (Math.abs(sum - total) > 0.5) return setError(`Jumlah pembayaran ${formatRupiah(sum)} harus sama dengan total ${formatRupiah(total)}`)
    if (rows.filter((row) => row.method === 'cash').length > 1) return setError('Gabungkan tunai menjadi satu baris')
    if (cashRow && !session) return setError('Buka sesi kasir dulu untuk menerima tunai')
    if (cashRow && cashRow.tendered !== '' && Number(cashRow.tendered) < Number(cashRow.amount)) return setError('Uang diterima kurang dari nominal tunai')
    if (rows.some((row) => !(Number(row.amount) > 0))) return setError('Setiap baris harus lebih dari 0')
    setBusy(true)
    try {
      const order = await ensureOrder()
      const serverTotal = Number(order.total_amount) - Number(order.paid_amount || 0)
      if (Math.abs(serverTotal - sum) > 0.5) {
        setBusy(false)
        if (!split) {
          update(0, { amount: serverTotal })
          return setError(`Total dari server ${formatRupiah(serverTotal)} (harga baru diperbarui). Periksa lalu bayar lagi.`)
        }
        return setError(`Total dari server ${formatRupiah(serverTotal)}. Sesuaikan nominal tiap metode.`)
      }
      const updated = await rpc(supabase, 'pos_record_payments', {
        p_order_id: order.id,
        p_payments: rows.map((row) => ({
          method: row.method,
          amount: Number(row.amount),
          tendered: row.method === 'cash' && row.tendered !== '' ? Number(row.tendered) : null,
          reference: row.method !== 'cash' ? row.reference.trim() || null : null,
        })),
      })
      onPaid({ ...order, ...updated }, change)
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
    return undefined
  }

  return (
    <Dialog
      title={`Bayar ${formatRupiah(total)}`}
      description={session ? 'Pilih cara bayar. Untuk QRIS/transfer, pastikan dana sudah masuk sebelum menyimpan.' : 'Sesi kasir belum dibuka — hanya pembayaran non-tunai yang bisa diterima.'}
      onClose={busy ? undefined : onClose}
      dismissible={!busy}
      footer={(
        <>
          {change > 0 && <span className="pos-change">Kembalian <strong className="tabular">{formatRupiah(change)}</strong></span>}
          <Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button>
          <Button type="submit" form="pos-payment" loading={busy}>Simpan pembayaran</Button>
        </>
      )}
    >
      <form id="pos-payment" className="pos-payment" onSubmit={submit} noValidate>
        {!split && (
          <div className="pos-method-grid" role="radiogroup" aria-label="Metode pembayaran">
            {methods.map((method) => {
              const Icon = ICONS[method] || Wallet
              const disabled = method === 'cash' && !session
              return (
                <button key={method} type="button" role="radio" aria-checked={rows[0].method === method} disabled={disabled}
                  className={`pos-method${rows[0].method === method ? ' is-selected' : ''}`} onClick={() => update(0, { method, amount: total })}>
                  <Icon size={20} aria-hidden="true" />
                  <span>{paymentMethodLabel(method)}</span>
                  {disabled && <small>Butuh sesi kasir</small>}
                </button>
              )
            })}
          </div>
        )}

        {rows.map((row, index) => (
          <div key={index} className={`pos-pay-row${split ? ' is-split' : ''}`}>
            {split && (
              <Select hideLabel label="Metode" value={row.method} onChange={(event) => update(index, { method: event.target.value, tendered: '', reference: '' })}
                options={methods.map((method) => ({ value: method, label: paymentMethodLabel(method) }))} />
            )}
            {split && <RupiahInput hideLabel label="Nominal" value={row.amount} onChange={(value) => update(index, { amount: value })} />}
            {row.method === 'cash' ? (
              <div className="pos-cash">
                <RupiahInput label="Uang diterima" value={row.tendered} onChange={(value) => update(index, { tendered: value })} placeholder={String(row.amount)} />
                <div className="pos-cash-quick">
                  {cashSuggestions(Number(row.amount) || 0).map((value) => (
                    <Button key={value} size="sm" variant={Number(row.tendered) === value ? 'primary' : 'secondary'} onClick={() => update(index, { tendered: value })}>
                      {value === Number(row.amount) ? 'Uang pas' : formatRupiah(value)}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <TextField label="No. referensi (opsional)" hideLabel={split} value={row.reference} maxLength={60}
                placeholder="4 digit terakhir / ID transaksi" onChange={(event) => update(index, { reference: event.target.value })} />
            )}
            {split && rows.length > 1 && <IconButton icon={Trash2} size="sm" variant="danger" label="Hapus baris" onClick={() => setRows((current) => current.filter((_, position) => position !== index))} />}
          </div>
        ))}

        <div className="pos-pay-footer">
          {rows.length < 4 && methods.length > 1 && (
            <Button size="sm" variant="ghost" icon={Plus} onClick={addRow}>{split ? 'Tambah metode' : 'Bayar dengan beberapa metode'}</Button>
          )}
          {split && <span className={`tabular${Math.abs(sum - total) > 0.5 ? ' inv-low' : ''}`}>Terisi {formatRupiah(sum)} dari {formatRupiah(total)}</span>}
        </div>
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}
