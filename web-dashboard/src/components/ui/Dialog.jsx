import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './Button.jsx'

/**
 * Dialog berbasis <dialog> native: focus trap, Esc, dan top-layer gratis dari browser.
 * variant: modal (tengah) | drawer (panel kanan; di layar kecil jadi bottom sheet)
 * Bisa dipakai terkontrol (`open`) atau dirender kondisional (default open = true).
 */
export function Dialog({
  open = true,
  onClose,
  title,
  description,
  children,
  footer,
  variant = 'modal',
  size = 'md',
  dismissible = true,
  headerExtra,
  className = '',
}) {
  const ref = useRef(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return undefined
    const previouslyFocused = document.activeElement
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
    return () => {
      if (dialog.open) dialog.close()
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) previouslyFocused.focus()
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      className={`ui-dialog ui-dialog-${variant} ui-dialog-${size} ${className}`.trim()}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault()
        if (dismissible) onClose?.()
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible) onClose?.()
      }}
    >
      <div className="ui-dialog-panel">
        <header className="ui-dialog-header">
          <div className="ui-dialog-heading">
            <h2 id={titleId} className="ui-dialog-title">{title}</h2>
            {description && <p id={descriptionId} className="ui-dialog-description">{description}</p>}
            {headerExtra}
          </div>
          {dismissible && <IconButton icon={X} label="Tutup" onClick={onClose} tooltip={false} />}
        </header>
        <div className="ui-dialog-body">{children}</div>
        {footer && <footer className="ui-dialog-footer">{footer}</footer>}
      </div>
    </dialog>
  )
}

export function Drawer(props) {
  return <Dialog variant="drawer" {...props} />
}
