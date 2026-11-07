import { ClipboardList, Layers3, LayoutDashboard, Package2 } from 'lucide-react'

export const OWNER_NAVIGATION = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/products', label: 'Produk', icon: Package2 },
  { to: '/categories', label: 'Kategori', icon: Layers3 },
  { to: '/orders', label: 'Transaksi', icon: ClipboardList },
]
