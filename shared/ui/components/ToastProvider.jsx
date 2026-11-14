import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'

const ToastContext = createContext(null)
const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info }
const EXIT_MS = 220

/** const { toast } = useToast(); toast({ title: 'Tersimpan', tone: 'success' }) */
// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast harus dipakai di dalam <ToastProvider>.')
  return context
}

/** Toast di pojok kanan bawah dengan bar waktu. Arahkan kursor ke toast untuk menahannya. */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const counter = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)))
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), EXIT_MS)
  }, [])

  const toast = useCallback(({ title, description, tone = 'success', duration = 4200, action }) => {
    const id = ++counter.current
    setToasts((current) => [...current.slice(-3), { id, title, description, tone, action, duration }])
    return id
  }, [])

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="ui-toast-region" role="region" aria-label="Notifikasi">
        {toasts.map((item) => <Toast key={item.id} item={item} onDismiss={dismiss} />)}
      </div>
    </ToastContext.Provider>
  )
}

function Toast({ item, onDismiss }) {
  const { id, title, description, tone, action, duration, leaving } = item
  const Icon = ICONS[tone] || Info
  const [paused, setPaused] = useState(false)

  // Timer mengikuti bar waktu: berhenti saat kursor di atas toast, lanjut dari awal saat kursor pergi.
  useEffect(() => {
    if (!duration || paused || leaving) return undefined
    const timer = window.setTimeout(() => onDismiss(id), duration)
    return () => window.clearTimeout(timer)
  }, [duration, paused, leaving, id, onDismiss])

  return (
    <div
      className={`ui-toast ui-toast-${tone}${leaving ? ' is-leaving' : ''}`}
      role={tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <Icon size={18} aria-hidden="true" className="ui-toast-icon" />
      <div className="ui-toast-text">
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </div>
      {action && (
        <button type="button" className="ui-toast-action" onClick={() => { action.onClick(); onDismiss(id) }}>
          {action.label}
        </button>
      )}
      <button type="button" className="ui-toast-close" aria-label="Tutup notifikasi" onClick={() => onDismiss(id)}>
        <X size={15} aria-hidden="true" />
      </button>
      {duration && !paused ? <span className="ui-toast-timer" aria-hidden="true" style={{ animationDuration: `${duration}ms` }} /> : null}
    </div>
  )
}
