import { Boxes, ScanLine, Building2, ChefHat, ClipboardList, Gift, Landmark, Layers3, LayoutDashboard, LifeBuoy, Package2, ReceiptText, Settings2, ShoppingCart, Star, Users, Wallet } from 'lucide-react'

/** Menu owner. Hanya modul yang sudah berfungsi yang tampil. */
export const OWNER_NAVIGATION = [
  {
    label: 'Ringkasan',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Penjualan',
    items: [
      { to: '/orders', label: 'Transaksi', icon: ClipboardList },
      { to: '/cashier', label: 'Kasir & refund', icon: Wallet },
      { to: '/payments', label: 'Pembayaran online', icon: ScanLine },
    ],
  },
  {
    label: 'Katalog',
    items: [
      { to: '/products', label: 'Produk', icon: Package2 },
      { to: '/categories', label: 'Kategori', icon: Layers3 },
    ],
  },
  {
    label: 'Inventori',
    items: [
      { to: '/inventory', label: 'Stok bahan', icon: Boxes },
      { to: '/recipes', label: 'Resep & HPP', icon: ChefHat },
      { to: '/purchases', label: 'Pembelian', icon: ShoppingCart },
      { to: '/suppliers', label: 'Supplier', icon: Building2 },
    ],
  },
  {
    label: 'Pelanggan',
    items: [
      { to: '/loyalty', label: 'Loyalti & voucher', icon: Gift },
      { to: '/reviews', label: 'Ulasan', icon: Star },
      { to: '/support', label: 'Bantuan', icon: LifeBuoy },
    ],
  },
  {
    label: 'Keuangan',
    items: [
      { to: '/finance', label: 'Keuangan', icon: Landmark },
      { to: '/expenses', label: 'Beban', icon: ReceiptText },
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
