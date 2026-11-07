import { useEffect } from 'react'
import { AlertCircle, Inbox, LoaderCircle } from 'lucide-react'

export function PageLoading({ label = 'Memuat data...' }) {
  return (
    <div className="page-state" role="status" aria-live="polite">
      <LoaderCircle className="page-state-spinner" size={23} />
      <span>{label}</span>
    </div>
  )
}

export function PageError({ message, onRetry }) {
  return (
    <div className="page-state page-state-error" role="alert">
      <AlertCircle size={23} />
      <strong>Data tidak dapat dimuat</strong>
      <span>{message}</span>
      {onRetry && <button className="text-button" type="button" onClick={onRetry}>Coba lagi</button>}
    </div>
  )
}

export function PageEmpty({ title, description, action }) {
  return (
    <div className="page-state">
      <span className="empty-icon"><Inbox size={21} /></span>
      <strong>{title}</strong>
      <span>{description}</span>
      {action}
    </div>
  )
}

export function Modal({ title, description, onClose, children, wide = false }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className={`modal-card${wide ? ' modal-card-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header className="modal-heading">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="Tutup">
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}
