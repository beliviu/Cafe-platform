import { useContext } from 'react'
import { ToastContext } from './ToastContext.js'

/** const { toast } = useToast(); toast({ title: 'Tersimpan', tone: 'success' }) */
export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast harus dipakai di dalam <ToastProvider>.')
  return context
}
