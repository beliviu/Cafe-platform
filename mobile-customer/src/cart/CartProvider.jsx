/*
 * Keranjang: tersimpan di perangkat (tetap ada setelah app ditutup), mendukung varian & catatan per item,
 * dan konteks meja dari QR. Harga di sini hanya perkiraan — total final selalu dihitung database.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { CartContext } from './CartContext.js'

const STORAGE_KEY = 'dailybrew.cart.v2'
const TABLE_TTL_MS = 3 * 60 * 60 * 1000 // QR meja berlaku 3 jam sejak dipindai
const CART_TTL_MS = 3 * 24 * 60 * 60 * 1000

export const lineKey = (productId, optionIds = [], notes = '') => `${productId}|${[...optionIds].sort().join(',')}|${notes.trim()}`

/** Baris keranjang dari produk + pilihan varian. */
export function makeLine(product, cafe, { options = [], quantity = 1, notes = '' } = {}) {
  const optionIds = options.map((option) => option.id)
  const unitPrice = Number(product.price) + options.reduce((sum, option) => sum + Number(option.price_delta || 0), 0)
  return {
    key: lineKey(product.id, optionIds, notes),
    product_id: product.id,
    cafe_id: product.cafe_id,
    cafe_name: cafe?.name || product.cafe_name || '',
    name: product.name,
    image_url: product.image_url || null,
    base_price: Number(product.price),
    option_ids: optionIds,
    options: options.map((option) => ({ id: option.id, name: option.name, price_delta: Number(option.price_delta || 0) })),
    unit_price: unitPrice,
    quantity: Math.min(Math.max(quantity, 1), 99),
    notes: notes.trim(),
  }
}

export function CartProvider({ children }) {
  const [lines, setLines] = useState([])
  const [table, setTableState] = useState(null)
  const [restored, setRestored] = useState(false)
  const skipSave = useRef(true)
  const cafeId = lines[0]?.cafe_id || table?.cafe_id || null

  // Pulihkan dari perangkat sekali saat app dibuka
  useEffect(() => {
    let active = true
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!active || !raw) return
      const saved = JSON.parse(raw)
      if (saved?.version !== 2 || Date.now() - saved.savedAt > CART_TTL_MS) return
      setLines(Array.isArray(saved.lines) ? saved.lines : [])
      if (saved.table && Date.now() - saved.table.scannedAt < TABLE_TTL_MS) setTableState(saved.table)
    }).catch(() => {}).finally(() => { if (active) setRestored(true) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!restored) return
    if (skipSave.current) {
      skipSave.current = false
      return
    }
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, savedAt: Date.now(), lines, table })).catch(() => {})
  }, [lines, restored, table])

  const confirmSwitch = useCallback((nextCafeId) => {
    if (!cafeId || cafeId === nextCafeId) return true
    Alert.alert('Satu kafe per pesanan', 'Selesaikan atau kosongkan keranjang sebelum memesan dari kafe lain.')
    return false
  }, [cafeId])

  /** addItem(product, cafe, { options, quantity, notes }) → true bila berhasil. */
  const addItem = useCallback((product, cafe, extra = {}) => {
    if (product.sold_out || product.is_available === false) {
      Alert.alert('Menu sedang habis', 'Silakan pilih menu lain.')
      return false
    }
    if (!confirmSwitch(product.cafe_id)) return false
    const line = makeLine(product, cafe, extra)
    setLines((current) => {
      const existing = current.find((item) => item.key === line.key)
      if (existing) return current.map((item) => (item.key === line.key ? { ...item, quantity: Math.min(item.quantity + line.quantity, 99) } : item))
      return [...current, line]
    })
    return true
  }, [confirmSwitch])

  const changeQuantity = useCallback((key, delta) => {
    setLines((current) => current
      .map((item) => (item.key === key ? { ...item, quantity: Math.min(99, item.quantity + delta) } : item))
      .filter((item) => item.quantity > 0))
  }, [])

  const removeItem = useCallback((key) => setLines((current) => current.filter((item) => item.key !== key)), [])
  const clearCart = useCallback(() => setLines([]), [])
  /** Ganti seluruh isi (pesan ulang). */
  const replaceLines = useCallback((next) => setLines(next), [])

  /** Meja dari QR: { token, label, area, cafe_id, cafe_name }. null = bukan pesanan meja. */
  const setTable = useCallback((next) => {
    if (next && lines.length && lines[0].cafe_id !== next.cafe_id) setLines([])
    setTableState(next ? { ...next, scannedAt: Date.now() } : null)
  }, [lines])

  const value = useMemo(() => ({
    items: lines,
    lines,
    cafeId,
    table,
    restored,
    subtotal: lines.reduce((total, item) => total + item.unit_price * item.quantity, 0),
    itemCount: lines.reduce((total, item) => total + item.quantity, 0),
    addItem,
    changeQuantity,
    removeItem,
    clearCart,
    replaceLines,
    setTable,
  }), [addItem, cafeId, changeQuantity, clearCart, lines, removeItem, replaceLines, restored, setTable, table])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
