import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth.js'
import { fetchRatings } from '../lib/customer.js'

/**
 * Status HABIS per produk: dimatikan staff/owner, atau bahan habis (file 06, product_availability).
 * Sebelum file 06 dijalankan, RPC tidak ada → hanya memakai is_available.
 */
export async function fetchAvailability(supabase, cafeId) {
  const { data, error } = await supabase.rpc('product_availability', { p_cafe_id: cafeId })
  if (error) return null
  return new Map((data || []).map((row) => [row.product_id, row.available]))
}

export function withAvailability(product, availability) {
  const available = availability?.has(product.id) ? availability.get(product.id) : product.is_available
  return { ...product, sold_out: !available }
}

export function useCafeProducts(cafeId) {
  const { supabase } = useAuth()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(Boolean(cafeId))
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    if (!supabase) {
      setError('Konfigurasi Supabase belum tersedia.')
      setLoading(false)
      return
    }
    if (!cafeId) {
      setProducts([])
      setCategories([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    const [productsResult, categoriesResult, availability, ratings] = await Promise.all([
      supabase.from('products')
        .select('id, cafe_id, category_id, name, description, price, image_url, is_available')
        .eq('cafe_id', cafeId)
        .order('name'),
      supabase.from('categories')
        .select('id, cafe_id, name')
        .eq('cafe_id', cafeId)
        .order('name'),
      fetchAvailability(supabase, cafeId),
      fetchRatings(supabase, cafeId),
    ])
    if (productsResult.error || categoriesResult.error) {
      setError(`Menu gagal dimuat: ${(productsResult.error || categoriesResult.error).message}`)
    } else {
      // Menu habis tetap tampil (abu-abu, tidak bisa dipesan), diletakkan setelah yang tersedia
      const list = (productsResult.data || []).map((product) => ({ ...withAvailability(product, availability), ...ratings.get(product.id) }))
      setProducts([...list.filter((product) => !product.sold_out), ...list.filter((product) => product.sold_out)])
      setCategories(categoriesResult.data || [])
    }
    setLoading(false)
  }, [cafeId, supabase])

  useEffect(() => {
    const timer = setTimeout(reload, 0)
    return () => clearTimeout(timer)
  }, [reload])

  return { products, categories, loading, error, reload }
}
