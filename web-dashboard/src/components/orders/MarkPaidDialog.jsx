import { useState } from 'react'
import { Banknote, Landmark, QrCode, Wallet } from 'lucide-react'
import { Button, Dialog } from '../ui/index.js'
import { useAuth } from '../../auth/useAuth.js'
import { cafePaymentMethods } from '../../lib/db.js'
import { formatQueueNumber, formatRupiah } from '../../lib/format.js'
import { markOrderPaid } from '../../lib/orderActions.js'
import { paymentMethodLabel } from '../../lib/status.js'

const METHOD_ICONS = { cash: Banknote, qris: QrCode, bank_transfer: Landmark, ewallet: Wallet }

/**
 * Pilih metode lalu tandai lunas.
 * Menulis lewat RPC staff_mark_order_paid → payments (baris baru, status paid, paid_at)
 * dan orders.payment_status = 'paid', payment_method, paid_at.
 */
export function MarkPaidDialog({ order, cafe, onClose, onPaid, confirmLabel }) {
  const { supabase } = useAuth()
  const methods = cafePaymentMethods(cafe)
  const [method, setMethod] = useState(methods.includes(order.payment_method) ? order.payment_method : methods[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleConfirm() {
    setSaving(true)
    setError('')
    try {
      const updated = await markOrderPaid(supabase, order.id, method)
      await onPaid?.({ ...order, ...updated })
    } catch (caught) {
      setError(caught.message)
      setSaving(false)
    }
  }

  return (
    <Dialog
      size="sm"
      title={`Tandai lunas · ${formatQueueNumber(order)}`}
      description="Pilih cara customer membayar."
      onClose={saving ? undefined : onClose}
      dismissible={!saving}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={handleConfirm} loading={saving}>{confirmLabel || `Lunas ${formatRupiah(order.total_amount)}`}</Button>
        </>
      )}
    >
      <div className="paid-total">
        <span>Total dibayar</span>
        <strong className="tabular">{formatRupiah(order.total_amount)}</strong>
      </div>
      <fieldset className="ui-choice-group">
        <legend className="ui-field-label">Metode pembayaran</legend>
        <div className="ui-choice-grid">
          {methods.map((value) => {
            const Icon = METHOD_ICONS[value] || Wallet
            return (
              <label key={value} className={`ui-choice${method === value ? ' is-selected' : ''}`}>
                <input type="radio" name="payment-method" value={value} checked={method === value} onChange={() => setMethod(value)} />
                <Icon size={20} aria-hidden="true" />
                <span>{paymentMethodLabel(value)}</span>
              </label>
            )
          })}
        </div>
      </fieldset>
      {error && <p className="ui-field-error" role="alert">{error}</p>}
    </Dialog>
  )
}
