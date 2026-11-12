/* Breadcrumb bar atas: halaman detail menambahkan jejaknya sendiri (mis. "Kafe › Kopi Senja"). */
import { createContext, useContext, useEffect } from 'react'

export const CrumbContext = createContext(() => {})

/** Dipanggil halaman, mis. useCrumbs([{ label: 'Kopi Senja' }]). */
export function useCrumbs(crumbs) {
  const setCrumbs = useContext(CrumbContext)
  const key = JSON.stringify(crumbs || [])
  useEffect(() => {
    setCrumbs(JSON.parse(key))
    return () => setCrumbs([])
  }, [key, setCrumbs])
}
