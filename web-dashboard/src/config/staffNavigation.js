import { ClipboardList, History, PackageX, ShoppingCart, Wallet } from 'lucide-react'

export function staffNavigation(pendingCount = 0) {
  return [
    {
      label: 'Operasional',
      items: [
        { to: '/staff', label: 'Pesanan', icon: ClipboardList, end: true, badge: pendingCount || null },
        { to: '/staff/pos', label: 'Kasir', icon: ShoppingCart },
        { to: '/staff/cashier', label: 'Sesi kasir', icon: Wallet },
        { to: '/staff/history', label: 'Riwayat', icon: History },
      ],
    },
    {
      label: 'Menu',
      items: [{ to: '/staff/menu', label: 'Menu habis', icon: PackageX }],
    },
  ]
}
