import { ClipboardList, Coffee, History, LifeBuoy, PackageX, ShoppingCart, Store, Wallet } from 'lucide-react'

export function staffNavigation(pendingCount = 0) {
  return [
    {
      label: 'Operasional',
      icon: Store,
      items: [
        { to: '/staff', label: 'Pesanan', icon: ClipboardList, end: true, badge: pendingCount || null },
        { to: '/staff/pos', label: 'Kasir', icon: ShoppingCart },
        { to: '/staff/cashier', label: 'Sesi kasir', icon: Wallet },
        { to: '/staff/history', label: 'Riwayat', icon: History },
      ],
    },
    {
      label: 'Menu & pelanggan',
      icon: Coffee,
      items: [
        { to: '/staff/menu', label: 'Menu habis', icon: PackageX },
        { to: '/staff/support', label: 'Bantuan pelanggan', icon: LifeBuoy },
      ],
    },
  ]
}
