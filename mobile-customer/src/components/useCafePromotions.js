import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth.js'

export function useCafePromotions(cafeId) {
  const { supabase } = useAuth()
  const [banners, setBanners] = useState([])
  const [loading, setLoading] = useState(Boolean(cafeId))
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    if (!supabase) {
      setError('Konfigurasi Supabase belum tersedia.')
      setLoading(false)
      return
    }
    if (!cafeId) {
      setBanners([])
      setLoading(false)
      return
    }
    setBanners([])
    setLoading(true)
    setError('')
    const { data, error: queryError } = await supabase.from('promotional_banners')
      .select('id, cafe_id, title, subtitle, image_path, cta_label, destination_type, destination_id, destination_path')
      .eq('cafe_id', cafeId)
      .eq('is_active', true)
      .order('sort_order')
      .order('created_at', { ascending: false })
    if (queryError) {
      setError(`Promosi gagal dimuat: ${queryError.message}`)
      setLoading(false)
      return
    }
    setBanners((data || []).map((banner) => ({
      ...banner,
      image_url: supabase.storage.from('cafe-banners').getPublicUrl(banner.image_path).data.publicUrl,
    })))
    setLoading(false)
  }, [cafeId, supabase])

  useEffect(() => {
    const timer = setTimeout(reload, 0)
    return () => clearTimeout(timer)
  }, [reload])

  return { banners, loading, error, reload }
}
