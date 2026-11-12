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

/* ---------- File 15: kontak WhatsApp Dailybrew & notifikasi owner ---------- */

/** { support_whatsapp, owner_whatsapp } atau null (file 15 belum dijalankan). */
export function usePlatformContact(supabase, cafeId) {
  const [contact, setContact] = useState(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!supabase || !cafeId) return undefined
    let active = true
    supabase.rpc('platform_contact', { p_cafe_id: cafeId }).then(({ data, error }) => {
      if (active) setContact(error ? null : data)
    })
    return () => { active = false }
  }, [attempt, cafeId, supabase])
  return { contact, reload: () => setAttempt((value) => value + 1) }
}

/** Link wa.me ke Dailybrew dengan pesan berisi nama & ID kafe. */
export function dailybrewWaLink(supportWhatsapp, cafe, topic = '') {
  const text = [
    'Halo Dailybrew,',
    '',
    `${topic || 'Saya butuh bantuan.'}`,
    '',
    `Kafe: ${cafe?.name || '-'}`,
    `ID kafe: ${cafe?.id || '-'}`,
  ].join('\n')
  return `https://wa.me/${String(supportWhatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
}

export async function saveOwnerWhatsapp(supabase, cafeId, value) {
  const { data, error } = await supabase.rpc('owner_set_whatsapp', { p_cafe_id: cafeId, p_whatsapp: value })
  if (error) throw new Error(error.message)
  return data
}

/** Notifikasi owner yang masih berlaku (null bila file 15 belum dijalankan). */
export function useOwnerNotifications(supabase, cafeId, enabled) {
  const [items, setItems] = useState(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!supabase || !cafeId || !enabled) return undefined
    let active = true
    supabase.rpc('owner_notifications', { p_cafe_id: cafeId }).then(({ data, error }) => {
      if (active) setItems(error ? null : data)
    })
    return () => { active = false }
  }, [attempt, cafeId, enabled, supabase])
  async function dismiss(id) {
    setItems((current) => (current || []).filter((item) => item.id !== id))
    await supabase.rpc('owner_notification_dismiss', { p_id: id })
  }
  return { items, dismiss, reload: () => setAttempt((value) => value + 1) }
}

export function formatWa(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return ''
  const local = digits.replace(/^62/, '')
  return `+62 ${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`.replace(/-$/, '')
}
