import { ClipboardList, Layers3, LayoutDashboard, Package2, Settings2 } from 'lucide-react'

/** Menu owner dikelompokkan: Ringkasan / Katalog / Operasional / Pengaturan. */
export const OWNER_NAVIGATION = [
  {
    label: 'Ringkasan',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Katalog',
    items: [
      { to: '/products', label: 'Produk', icon: Package2 },
      { to: '/categories', label: 'Kategori', icon: Layers3 },
    ],
  },
  {
    label: 'Operasional',
    items: [{ to: '/orders', label: 'Transaksi', icon: ClipboardList }],
  },
  {
    label: 'Pengaturan',
    items: [{ to: '/settings', label: 'Pengaturan', icon: Settings2 }],
  },
]
