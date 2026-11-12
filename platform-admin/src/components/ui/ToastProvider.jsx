// Salinan dari web-dashboard/src/components/ui/ToastProvider.jsx — sinkronkan manual bila aslinya berubah.
import { useCallback, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { ToastContext } from './ToastContext.js'

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info }

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const counter = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const toast = useCallback(({ title, description, tone = 'success', duration = 4200, action }) => {
    const id = ++counter.current
    setToasts((current) => [...current.slice(-3), { id, title, description, tone, action }])
    if (duration) window.setTimeout(() => dismiss(id), duration)
    return id
  }, [dismiss])

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="ui-toast-region" role="region" aria-label="Notifikasi">
        {toasts.map(({ id, title, description, tone, action }) => {
          const Icon = ICONS[tone] || Info
          return (
            <div className={`ui-toast ui-toast-${tone}`} key={id} role={tone === 'error' ? 'alert' : 'status'}>
              <Icon size={18} aria-hidden="true" className="ui-toast-icon" />
              <div className="ui-toast-text">
                <strong>{title}</strong>
                {description && <span>{description}</span>}
              </div>
              {action && (
                <button type="button" className="ui-toast-action" onClick={() => { action.onClick(); dismiss(id) }}>
                  {action.label}
                </button>
              )}
              <button type="button" className="ui-toast-close" aria-label="Tutup notifikasi" onClick={() => dismiss(id)}>
                <X size={15} aria-hidden="true" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
