/*
 * Pengaturan bisnis per kafe (tabel cafe_settings, file usulan 04).
 * Satu baris per kafe, dibuat otomatis oleh database. Hanya owner yang boleh mengubah.
 */
import { useCallback, useEffect, useState } from 'react'
import { friendlyError } from './db.js'

export const SETTINGS_COLUMNS = [
  'cafe_id', 'timezone', 'currency', 'tax_enabled', 'tax_name', 'tax_rate', 'tax_inclusive',
  'service_charge_enabled', 'service_charge_rate', 'service_charge_taxable', 'rounding_unit', 'order_types',
  'receipt_header', 'receipt_footer', 'receipt_show_logo', 'receipt_show_address', 'receipt_paper_mm', 'updated_at',
].join(', ')

export const ORDER_TYPE_LABELS = { dine_in: 'Makan di tempat', takeaway: 'Bawa pulang' }

export function useCafeSettings(supabase, cafeId, enabled) {
  const [state, setState] = useState({ loading: Boolean(enabled), settings: null, error: '' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    supabase.from('cafe_settings').select(SETTINGS_COLUMNS).eq('cafe_id', cafeId).maybeSingle().then(({ data, error }) => {
      if (!active) return
      if (error) setState({ loading: false, settings: null, error: friendlyError(error) })
      else if (!data) setState({ loading: false, settings: null, error: 'Baris pengaturan kafe belum ada. Jalankan ulang file 04.' })
      else setState({ loading: false, settings: data, error: '' })
    })
    return () => { active = false }
  }, [attempt, cafeId, enabled, supabase])

  const reload = useCallback(() => {
    setState((current) => ({ ...current, loading: true }))
    setAttempt((value) => value + 1)
  }, [])
  const replace = useCallback((settings) => setState({ loading: false, settings, error: '' }), [])

  return { ...state, reload, replace }
}

export async function saveCafeSettings(supabase, cafeId, values) {
  const { data, error } = await supabase
    .from('cafe_settings')
    .update(values)
    .eq('cafe_id', cafeId)
    .select(SETTINGS_COLUMNS)
    .maybeSingle()
  if (error) throw new Error(friendlyError(error))
  if (!data) throw new Error('Perubahan ditolak database. Hanya owner yang bisa mengubah pengaturan.')
  return data
}
