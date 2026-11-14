import { AlertCircle, Inbox } from 'lucide-react'
import { Button } from './Button.jsx'

/** Keadaan kosong: ikon + kalimat + tombol aksi (action = elemen tombol). */
export function EmptyState({ icon: Icon = Inbox, title, description, action, compact = false, tone = 'brand' }) {
  return (
    <div className={`ui-empty${compact ? ' ui-empty-compact' : ''}`}>
      <span className={`ui-empty-icon ui-empty-icon-${tone}`}><Icon size={compact ? 18 : 22} aria-hidden="true" /></span>
      <strong className="ui-empty-title">{title}</strong>
      {description && <p className="ui-empty-description">{description}</p>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  )
}

/** Keadaan gagal: pesan jelas + "Coba lagi". */
export function ErrorState({ title = 'Data tidak dapat dimuat', message, onRetry, compact = false }) {
  return (
    <div role="alert">
      <EmptyState
        icon={AlertCircle}
        tone="red"
        compact={compact}
        title={title}
        description={message}
        action={onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Coba lagi</Button>}
      />
    </div>
  )
}
