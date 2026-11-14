/*
 * Kerangka web owner & staff = AppShell dari design system bersama.
 * Owner: banyak menu → grup bisa dibuka-tutup (grouped). Staff: lihat StaffLayout (menu bawah di HP).
 *
 * Ctrl/Cmd+K juga mencari data: mengetik kata membuka halaman Produk / Transaksi dengan pencarian terisi
 * (?q=…), memakai pencarian yang sudah ada di halaman itu — tanpa query baru ke database.
 */
import { useCallback } from 'react'
import { ClipboardList, Package2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { AppShell as SharedShell } from '@dailybrew/ui'

export { BrandMark } from '@dailybrew/ui'

const SEARCHABLE = [
  { suffix: '/products', label: 'produk', icon: Package2 },
  { suffix: '/orders', label: 'transaksi', icon: ClipboardList },
]

export function AppShell({ grouped = true, navigation, ...props }) {
  const navigate = useNavigate()
  const search = useCallback(async (query) => {
    const items = navigation.flatMap((group) => group.items)
    return SEARCHABLE.flatMap(({ suffix, label, icon }) => {
      const page = items.find((item) => item.to.endsWith(suffix))
      if (!page) return []
      return [{
        key: `find:${suffix}`,
        label: `Cari “${query}” di ${label}`,
        hint: page.label,
        group: 'Cari data',
        icon,
        run: () => navigate(`${page.to}?q=${encodeURIComponent(query)}`),
      }]
    })
  }, [navigate, navigation])
  const hasData = navigation.some((group) => group.items.some((item) => SEARCHABLE.some(({ suffix }) => item.to.endsWith(suffix))))

  return (
    <SharedShell
      grouped={grouped}
      navigation={navigation}
      search={hasData ? search : undefined}
      searchLabel={hasData ? 'Cari halaman, produk, pesanan…' : 'Cari halaman…'}
      {...props}
    />
  )
}
