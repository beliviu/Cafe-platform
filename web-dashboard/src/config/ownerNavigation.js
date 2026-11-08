import { ClipboardList, Layers3, LayoutDashboard, Package2, Settings2, Users } from 'lucide-react'

/**
 * Menu owner. Hanya modul yang sudah berfungsi yang tampil —
 * Inventori, POS, dan Keuangan ditambahkan saat fasenya selesai.
 */
export const OWNER_NAVIGATION = [
  {
    label: 'Ringkasan',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Penjualan',
    items: [{ to: '/orders', label: 'Transaksi', icon: ClipboardList }],
  },
  {
    label: 'Katalog',
    items: [
      { to: '/products', label: 'Produk', icon: Package2 },
      { to: '/categories', label: 'Kategori', icon: Layers3 },
    ],
  },
  {
    label: 'Bisnis',
    items: [
      { to: '/team', label: 'Tim', icon: Users },
      { to: '/settings', label: 'Pengaturan', icon: Settings2 },
    ],
  },
]
