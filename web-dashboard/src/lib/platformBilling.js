/*
 * Status platform & tagihan langganan Dailybrew (file SQL 14 + Edge Function "subscription-billing").
 * Semua fungsi aman dipanggil sebelum file 14 dijalankan: status → null, tagihan → null.
 */
import { useEffect, useState } from 'react'

const MISSING = /could not find the function|schema cache|does not exist/i

/** { suspended, suspended_reason, in_grace, grace_until, pending_invoices, ... } atau null. */
export function usePlatformStatus(supabase, cafeId) {
  const [status, setStatus] = useState(null)
  useEffect(() => {
    if (!supabase || !cafeId) return undefined
    let active = true
    supabase.rpc('cafe_platform_status', { p_cafe_id: cafeId }).then(({ data, error }) => {
      if (active) setStatus(error ? null : data)
    })
    return () => { active = false }
  }, [cafeId, supabase])
  return status
}

/** Daftar tagihan owner (null bila file 14 belum ada). */
export async function fetchOwnerInvoices(supabase, cafeId) {
  const { data, error } = await supabase.rpc('owner_invoices', { p_cafe_id: cafeId })
  if (error) {
    if (MISSING.test(error.message)) return null
    throw new Error(error.message)
  }
  return data
}

export async function requestInvoice(supabase, cafeId, plan, months) {
  const { data, error } = await supabase.rpc('owner_invoice_request', { p_cafe_id: cafeId, p_plan: plan, p_months: months })
  if (error) throw new Error(error.message)
  return data
}

export async function callBilling(supabase, body) {
  const { data, error } = await supabase.functions.invoke('subscription-billing', { body })
  if (error) {
    let message = error.message
    try {
      const detail = await error.context?.json?.()
      if (detail?.error) message = detail.error
    } catch {
      // badan respons bukan JSON
    }
    throw new Error(/Failed to send|fetch/i.test(message || '') ? 'Pembayaran online belum tersedia. Hubungi Dailybrew untuk transfer manual.' : message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export const INVOICE_STATE = {
  pending: { label: 'Menunggu bayar', tone: 'blue' },
  overdue: { label: 'Lewat jatuh tempo', tone: 'amber' },
  paid: { label: 'Lunas', tone: 'green' },
}
