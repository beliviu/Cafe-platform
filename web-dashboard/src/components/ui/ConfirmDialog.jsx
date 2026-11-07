import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from './Button.jsx'
import { Dialog } from './Dialog.jsx'

/**
 * Konfirmasi untuk aksi berisiko (hapus, batalkan).
 * - onConfirm boleh async; tombol menampilkan loading sampai selesai.
 * - alternative: { label, onClick } — mis. "Nonaktifkan saja" sebagai opsi lebih aman.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Ya, lanjutkan',
  cancelLabel = 'Batal',
  tone = 'danger',
  onConfirm,
  onClose,
  alternative,
  children,
}) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  async function run(action, key) {
    setBusy(key)
    setError('')
    try {
      const result = await action()
      if (result === false) setBusy(null)
    } catch (caught) {
      setError(caught?.message || 'Aksi gagal. Coba lagi.')
      setBusy(null)
    }
  }

  return (
    <Dialog
      title={title}
      size="sm"
      onClose={busy ? undefined : onClose}
      dismissible={!busy}
      className="ui-confirm"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={Boolean(busy)}>{cancelLabel}</Button>
          {alternative && (
            <Button variant="secondary" loading={busy === 'alt'} disabled={Boolean(busy)} onClick={() => run(alternative.onClick, 'alt')}>
              {alternative.label}
            </Button>
          )}
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy === 'confirm'}
            disabled={Boolean(busy)}
            onClick={() => run(onConfirm, 'confirm')}
          >
            {confirmLabel}
          </Button>
        </>
      )}
    >
      <div className="ui-confirm-body">
        {tone === 'danger' && <span className="ui-confirm-icon"><AlertTriangle size={20} aria-hidden="true" /></span>}
        <div>
          {description && <p className="ui-confirm-description">{description}</p>}
          {children}
          {error && <p className="ui-field-error" role="alert">{error}</p>}
        </div>
      </div>
    </Dialog>
  )
}
