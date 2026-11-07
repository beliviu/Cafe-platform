import { useState } from 'react'
import { Button, Dialog, TextField } from '../ui/index.js'
import { useAuth } from '../../auth/useAuth.js'
import { formatQueueNumber } from '../../lib/format.js'
import { cancelOrder } from '../../lib/orderActions.js'

const REASONS = ['Customer membatalkan', 'Menu habis', 'Pesanan ganda', 'Tidak jadi dibayar']

/**
 * Batalkan pesanan dengan alasan.
 * Menulis lewat RPC staff_cancel_order → orders.order_status = 'cancelled', cancel_reason, cancelled_at.
 */
export function CancelOrderDialog({ order, onClose, onCancelled }) {
  const { supabase } = useAuth()
  const [preset, setPreset] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const reason = [preset, note.trim()].filter(Boolean).join(' — ')

  async function handleConfirm() {
    if (!reason) {
      setError('Pilih atau tulis alasan pembatalan.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const updated = await cancelOrder(supabase, order.id, reason)
      await onCancelled?.({ ...order, ...updated })
    } catch (caught) {
      setError(caught.message)
      setSaving(false)
    }
  }

  return (
    <Dialog
      size="sm"
      title={`Batalkan pesanan ${formatQueueNumber(order)}?`}
      description={order.payment_status === 'paid'
        ? 'Pesanan ini sudah lunas. Setelah dibatalkan, kembalikan uang customer secara manual.'
        : 'Customer akan melihat status Dibatalkan beserta alasannya.'}
      onClose={saving ? undefined : onClose}
      dismissible={!saving}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Kembali</Button>
          <Button variant="danger" onClick={handleConfirm} loading={saving}>Batalkan pesanan</Button>
        </>
      )}
    >
      <fieldset className="ui-choice-group">
        <legend className="ui-field-label">Alasan</legend>
        <div className="ui-chip-row">
          {REASONS.map((value) => (
            <button
              key={value}
              type="button"
              className={`ui-chip${preset === value ? ' is-selected' : ''}`}
              aria-pressed={preset === value}
              onClick={() => {
                setPreset(preset === value ? '' : value)
                setError('')
              }}
            >
              {value}
            </button>
          ))}
        </div>
      </fieldset>
      <TextField label="Catatan (opsional)" multiline rows={2} maxLength={200} value={note} onChange={(event) => {
        setNote(event.target.value)
        setError('')
      }} placeholder="mis. stok susu oat habis" />
      {error && <p className="ui-field-error" role="alert">{error}</p>}
    </Dialog>
  )
}
