/*
 * Inventori: label, format jumlah, status stok, dan pemanggil RPC (file 05).
 * Semua perubahan stok, PO, pembayaran supplier, opname, dan resep lewat fungsi
 * database (SECURITY DEFINER) — klien tidak pernah menulis saldo stok langsung.
 */
import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { fetchAllRows, friendlyError } from './db.js'
import { formatDate } from './format.js'

export const UNITS = {
  g: { label: 'gram', short: 'g', big: 'kg' },
  ml: { label: 'mililiter', short: 'ml', big: 'L' },
  pcs: { label: 'pcs', short: 'pcs', big: null },
}
export const UNIT_OPTIONS = Object.entries(UNITS).map(([value, unit]) => ({ value, label: `${unit.label} (${unit.short})` }))

export const MOVEMENT_TYPES = {
  opening: { label: 'Stok awal', tone: 'neutral' },
  purchase: { label: 'Pembelian', tone: 'green' },
  sale: { label: 'Terjual', tone: 'blue' },
  adjustment: { label: 'Penyesuaian', tone: 'amber' },
  opname: { label: 'Opname', tone: 'amber' },
  waste: { label: 'Terbuang', tone: 'red' },
  damaged: { label: 'Rusak', tone: 'red' },
  expired: { label: 'Kedaluwarsa', tone: 'red' },
  usage: { label: 'Pemakaian lain', tone: 'neutral' },
  return: { label: 'Retur supplier', tone: 'neutral' },
}

export const STOCK_OUT_REASONS = [
  { value: 'waste', label: 'Terbuang (tumpah, gagal buat)' },
  { value: 'damaged', label: 'Rusak' },
  { value: 'expired', label: 'Kedaluwarsa' },
  { value: 'usage', label: 'Pemakaian lain (tester, staff)' },
  { value: 'return', label: 'Retur ke supplier' },
]

export const PO_STATUS = {
  draft: { label: 'Draf', tone: 'neutral' },
  ordered: { label: 'Dipesan', tone: 'blue' },
  partial: { label: 'Diterima sebagian', tone: 'amber' },
  received: { label: 'Diterima', tone: 'green' },
  cancelled: { label: 'Dibatalkan', tone: 'neutral' },
}

export const SUPPLIER_PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Transfer bank' },
  { value: 'cash', label: 'Tunai' },
  { value: 'qris', label: 'QRIS' },
  { value: 'ewallet', label: 'E-wallet' },
  { value: 'other', label: 'Lainnya' },
]

const quantityFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 })
const costFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })

/** 1500 g → "1,5 kg"; 250 ml → "250 ml". scale=false selalu memakai satuan dasar. */
export function formatQty(value, unit, { scale = true, signed = false } = {}) {
  const number = Number(value) || 0
  const meta = UNITS[unit] || { short: unit || '', big: null }
  const sign = signed && number > 0 ? '+' : ''
  if (scale && meta.big && Math.abs(number) >= 1000) {
    return `${sign}${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(number / 1000)} ${meta.big}`
  }
  return `${sign}${quantityFormat.format(number)} ${meta.short}`.trim()
}

/** Harga per satuan dasar, mis. "Rp 21,43/ml". */
export function formatUnitCost(value, unit) {
  return `Rp ${costFormat.format(Number(value) || 0)}/${UNITS[unit]?.short || unit}`
}

/** Angka dari input bebas ("1.250,5" / "1250.5") → number | null. */
export function parseDecimal(text) {
  if (text === '' || text === null || text === undefined) return null
  let clean = String(text).trim().replace(/\s/g, '')
  if (clean.includes(',')) clean = clean.replace(/\./g, '').replace(',', '.')
  const value = Number(clean)
  return Number.isFinite(value) ? value : null
}

/** minus | empty | low | ok | inactive */
export function stockStatus(ingredient) {
  if (!ingredient.is_active) return 'inactive'
  const onHand = Number(ingredient.on_hand) || 0
  if (onHand < 0) return 'minus'
  if (onHand === 0) return 'empty'
  if (onHand <= (Number(ingredient.min_stock) || 0)) return 'low'
  return 'ok'
}

export const STOCK_STATUS = {
  minus: { label: 'Minus', tone: 'red' },
  empty: { label: 'Habis', tone: 'red' },
  low: { label: 'Stok rendah', tone: 'amber' },
  ok: { label: 'Aman', tone: 'green' },
  inactive: { label: 'Nonaktif', tone: 'neutral' },
}

export function stockValue(ingredient) {
  return Math.max(Number(ingredient.on_hand) || 0, 0) * (Number(ingredient.avg_cost) || 0)
}

/** "YYYY-MM-DD" → "8 Nov 2026" */
export const dateOnly = (key) => (key ? formatDate(`${key}T00:00:00+07:00`) : '—')

/** Utang PO: nilai barang diterima − dibayar (minus = uang muka). */
export const outstandingOf = (po) => Math.round((Number(po.received_amount) - Number(po.paid_amount)) * 100) / 100

/** Selisih hari kalender (WIB) dari hari ini ke tanggal "YYYY-MM-DD". */
export function daysUntil(dateKey, todayKey) {
  if (!dateKey) return null
  return Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86400000)
}

/** Pemanggil RPC: lempar Error berbahasa Indonesia. */
export async function callRpc(supabase, name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(inventoryError(error))
  return data
}

export function inventoryError(error) {
  const message = String(error?.message || '')
  if (error?.code === '23503' && /delete|update/i.test(message)) {
    return 'Data ini sudah dipakai (riwayat stok, resep, atau PO) sehingga tidak bisa dihapus. Nonaktifkan saja.'
  }
  if (error?.code === '23505' || /duplicate key/i.test(message)) return 'Nama atau kode ini sudah dipakai. Gunakan yang lain.'
  return friendlyError(error)
}

export const INGREDIENT_COLUMNS =
  'id, cafe_id, name, sku, category, unit, min_stock, on_hand, avg_cost, last_purchase_cost, default_supplier_id, purchase_unit, purchase_unit_size, lead_time_days, is_active, updated_at'

export async function fetchIngredients(supabase, cafeId) {
  const { data, error } = await fetchAllRows(() => supabase.from('ingredients').select(INGREDIENT_COLUMNS).eq('cafe_id', cafeId).order('name'))
  if (error) throw new Error(inventoryError(error))
  return data
}

export async function fetchSuppliers(supabase, cafeId) {
  const { data, error } = await supabase
    .from('suppliers')
    .select('id, name, contact_name, phone, email, address, payment_terms_days, notes, is_active, created_at')
    .eq('cafe_id', cafeId)
    .order('name')
  if (error) throw new Error(inventoryError(error))
  return data || []
}

/**
 * Muat data async dengan status loading/error dan reload().
 * `load` wajib stabil (useCallback) — perubahan `load` memicu muat ulang.
 */
export function useLoader(load) {
  const [state, setState] = useState({ data: undefined, error: '', loading: true })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    Promise.resolve()
      .then(load)
      .then(
        (data) => { if (active) setState({ data, error: '', loading: false }) },
        (error) => { if (active) setState((current) => ({ ...current, error: error?.message || 'Data tidak dapat dimuat', loading: false })) },
      )
    return () => { active = false }
  }, [attempt, load])
  const reload = useCallback(() => {
    setState((current) => ({ ...current, loading: true }))
    setAttempt((value) => value + 1)
  }, [])
  return { ...state, reload }
}

/** Awalan rute owner ('' atau '/preview/owner' di pratinjau dev) untuk tautan antar halaman. */
export function useOwnerBase() {
  const { pathname } = useLocation()
  return pathname.startsWith('/preview/owner') ? '/preview/owner' : ''
}

/** Kelompokkan bahan per kategori untuk <select> berkelompok. */
export function ingredientOptionGroups(ingredients) {
  const groups = new Map()
  for (const ingredient of ingredients) {
    const key = ingredient.category || 'Tanpa kategori'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(ingredient)
  }
  return [...groups.entries()].sort(([a], [b]) => (a === 'Tanpa kategori' ? 1 : b === 'Tanpa kategori' ? -1 : a.localeCompare(b, 'id')))
}

/** Unduh baris sebagai CSV/XLSX. columns = [{ key, header, width?, number? }] */
export async function exportRows(rows, columns, fileName, format, sheet = 'Data') {
  if (format === 'csv') {
    const cell = (value) => {
      const text = String(value ?? '')
      return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const lines = [columns.map((column) => cell(column.header)).join(',')]
    for (const row of rows) lines.push(columns.map((column) => cell(row[column.key])).join(','))
    download(new Blob(['﻿', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${fileName}.csv`)
    return
  }
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  const header = columns.map((column) => ({ value: column.header, fontWeight: 'bold' }))
  const body = rows.map((row) => columns.map((column) => {
    const value = row[column.key]
    if (value === null || value === undefined || value === '') return null
    return column.number
      ? { value: Number(value), type: Number, format: column.format || '#,##0.###' }
      : { value: String(value), type: String }
  }))
  const blob = await writeXlsxFile([header, ...body], {
    columns: columns.map((column) => ({ width: column.width || 16 })),
    stickyRowsCount: 1,
    sheet,
  }).toBlob()
  download(blob, `${fileName}.xlsx`)
}

function download(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
