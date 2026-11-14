import { BookOpen, Boxes, Briefcase, Building2, ChefHat, ClipboardList, Gift, HeartHandshake, Home, Landmark, Layers3, LayoutDashboard, LifeBuoy, Lightbulb, Megaphone, MessagesSquare, Package2, PieChart, ReceiptText, Settings2, ShoppingBag, ShoppingCart, Star, TrendingUp, UserCheck, Users, Wallet, Warehouse } from 'lucide-react'

/** Menu owner. Hanya modul yang sudah berfungsi yang tampil. `icon` grup = ikon di rail sidebar. */
export const OWNER_NAVIGATION = [
  {
    label: 'Ringkasan',
    icon: Home,
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Penjualan',
    icon: ShoppingBag,
    items: [
      { to: '/orders', label: 'Transaksi', icon: ClipboardList },
      { to: '/cashier', label: 'Kasir & refund', icon: Wallet },
    ],
  },
  {
    label: 'Katalog',
    icon: BookOpen,
    items: [
      { to: '/products', label: 'Produk', icon: Package2 },
      { to: '/categories', label: 'Kategori', icon: Layers3 },
    ],
  },
  {
    label: 'Inventori',
    icon: Warehouse,
    items: [
      { to: '/inventory', label: 'Stok bahan', icon: Boxes },
      { to: '/recipes', label: 'Resep & HPP', icon: ChefHat },
      { to: '/purchases', label: 'Pembelian', icon: ShoppingCart },
      { to: '/suppliers', label: 'Supplier', icon: Building2 },
    ],
  },
  {
    label: 'Pelanggan',
    icon: HeartHandshake,
    items: [
      { to: '/loyalty', label: 'Loyalti & voucher', icon: Gift },
      { to: '/promotions', label: 'Banner promosi', icon: Megaphone },
      { to: '/reviews', label: 'Ulasan', icon: Star },
      { to: '/support', label: 'Bantuan', icon: LifeBuoy },
    ],
  },
  {
    label: 'Keuangan',
    icon: Landmark,
    items: [
      { to: '/finance', label: 'Keuangan', icon: Landmark },
      { to: '/expenses', label: 'Beban', icon: ReceiptText },
    ],
  },
  {
    label: 'Analitik',
    icon: PieChart,
    items: [
      { to: '/advisor', label: 'Advisor bisnis', icon: Lightbulb },
      { to: '/sales-forecast', label: 'Prediksi penjualan', icon: TrendingUp },
      { to: '/customer-analytics', label: 'Analitik pelanggan', icon: UserCheck },
    ],
  },
  {
    label: 'Bisnis',
    icon: Briefcase,
    items: [
      { to: '/team', label: 'Tim', icon: Users },
      { to: '/settings', label: 'Pengaturan', icon: Settings2 },
      { to: '/bantuan', label: 'Bantuan Dailybrew', icon: MessagesSquare },
    ],
  },
]
