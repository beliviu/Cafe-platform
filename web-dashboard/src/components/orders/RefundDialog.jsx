/*
 * Ajukan refund (staff → menunggu owner) atau refund langsung (owner). RPC refund_request (file 06).
 * Bahan bisa dikembalikan ke stok bila pesanan sudah selesai (bahan sudah terpotong).
 */
import { useState } from 'react'
import { useAuth } from '../../auth/useAuth.js'
import { Button, Dialog, RupiahInput, Select, Switch, TextField, useToast } from '../ui/index.js'
import { formatRupiah } from '../../lib/format.js'
import { REFUND_REASONS, rpc } from '../../lib/pos.js'
import { paymentMethodLabel } from '../../lib/status.js'

const METHODS = ['cash', 'qris', 'bank_transfer', 'ewallet']

export function RefundDialog({ order, items, isOwner, onClose, onDone }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const refundable = Math.max(Number(order.paid_amount || 0) - Number(order.refunded_amount || 0), 0)
  const canRestock = order.order_status === 'completed' && items.length > 0
  const [amount, setAmount] = useState(refundable)
  const [method, setMethod] = useState(METHODS.includes(order.payment_method) ? order.payment_method : 'cash')
  const [reason, setReason] = useState('')
  const [restock, setRestock] = useState(false)
  const [quantities, setQuantities] = useState(() => Object.fromEntries(items.map((item) => [item.id, item.quantity])))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (!(Number(amount) > 0) || Number(amount) > refundable) return setError(`Nominal 1 – ${formatRupiah(refundable)}`)
    if (reason.trim().length < 3) return setError('Tulis alasan refund')
    setBusy(true)
    try {
      const refund = await rpc(supabase, 'refund_request', {
        p_order_id: order.id, p_amount: Number(amount), p_method: method, p_reason: reason.trim(), p_restock: canRestock && restock,
        p_items: canRestock && restock ? items.filter((item) => Number(quantities[item.id]) > 0).map((item) => ({ order_item_id: item.id, quantity: Number(quantities[item.id]) })) : [],
      })
      toast({
        tone: 'success',
        title: refund.status === 'approved' ? `Refund ${formatRupiah(amount)} disetujui` : 'Refund diajukan',
        description: refund.status === 'approved' ? `Kembalikan lewat ${paymentMethodLabel(method)}.` : 'Menunggu persetujuan owner. Uang dikembalikan setelah disetujui.',
      })
      onDone(refund)
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
    return undefined
  }

  return (
    <Dialog title={isOwner ? 'Refund' : 'Ajukan refund'} description={`Sudah dibayar ${formatRupiah(order.paid_amount)}${Number(order.refunded_amount) ? ` · sudah direfund ${formatRupiah(order.refunded_amount)}` : ''}.${isOwner ? '' : ' Owner menyetujui sebelum uang dikembalikan.'}`}
      onClose={busy ? undefined : onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="refund-form" variant="danger" loading={busy}>{isOwner ? `Refund ${formatRupiah(amount || 0)}` : 'Ajukan refund'}</Button></>}>
      <form id="refund-form" className="inv-form" onSubmit={submit} noValidate>
        <div className="inv-form-row">
          <RupiahInput label="Nominal" value={amount} onChange={(value) => { setAmount(value); setError('') }} />
          <Select label="Dikembalikan lewat" value={method} onChange={(event) => setMethod(event.target.value)} options={METHODS.map((value) => ({ value, label: paymentMethodLabel(value) }))} />
        </div>
        <div className="refund-reasons">
          {REFUND_REASONS.map((value) => (
            <Button key={value} size="sm" variant={reason === value ? 'primary' : 'secondary'} onClick={() => { setReason(value); setError('') }}>{value}</Button>
          ))}
        </div>
        <TextField label="Alasan" value={reason} maxLength={300} onChange={(event) => { setReason(event.target.value); setError('') }} />
        {canRestock && (
          <>
            <div className="inv-switch-line">
              <span><strong>Kembalikan bahan ke stok</strong><small>Hanya bila menu belum dibuat/belum terpakai. Bahan terbuang tidak perlu dikembalikan.</small></span>
              <Switch checked={restock} onChange={setRestock} label="Kembalikan bahan ke stok" onLabel="Ya" offLabel="Tidak" />
            </div>
            {restock && items.map((item) => (
              <div key={item.id} className="receive-line">
                <span className="inv-name"><strong>{item.product_name}</strong><small>dipesan {item.quantity}</small></span>
                <TextField hideLabel label={`Jumlah ${item.product_name} dikembalikan`} inputMode="numeric" value={String(quantities[item.id] ?? '')}
                  onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: Math.min(item.quantity, Number(event.target.value.replace(/\D/g, '')) || 0) }))} />
              </div>
            ))}
          </>
        )}
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}
