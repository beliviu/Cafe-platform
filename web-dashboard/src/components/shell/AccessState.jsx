import { Coffee } from 'lucide-react'
import { Button } from '../ui/index.js'

/** Layar penuh untuk akses ditolak / data belum siap. */
export function AccessState({ title, message, onRetry, action }) {
  return (
    <main className="access-v2">
      <div className="access-v2-card">
        <span className="shell-brand-mark access-v2-mark"><Coffee size={24} aria-hidden="true" /></span>
        <h1 className="ui-title">{title}<span className="ui-title-period">.</span></h1>
        <p>{message}</p>
        {onRetry && <Button onClick={onRetry}>Coba lagi</Button>}
        {action}
      </div>
    </main>
  )
}
