import { useContext } from 'react'
import { BrandContext } from './BrandContext.js'

/** { cafe, brand: { name, businessName, logoUrl, tagline, colors }, loading, error, reload } */
export function useBrand() {
  const value = useContext(BrandContext)
  if (!value) throw new Error('useBrand harus dipakai di dalam BrandProvider')
  return value
}
