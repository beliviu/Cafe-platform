import { useState } from 'react'
import { CircleDollarSign, Coffee, LayoutGrid, Pencil, Plus, ReceiptText, ShoppingBag, Table2, Trash2, XCircle } from 'lucide-react'
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, Drawer, EmptyState, ErrorState, IconButton, OrderStatusBadge,
  PaymentBadge, SearchInput, SegmentedControl, Select, Skeleton, SkeletonRows, StatCard, Switch, TextField, useToast,
} from '../components/ui/index.js'
import { CancelOrderDialog } from '../components/orders/CancelOrderDialog.jsx'
import { MarkPaidDialog } from '../components/orders/MarkPaidDialog.jsx'
import { formatDateTime, formatQueueNumber, formatRupiah, summarizeItems } from '../lib/format.js'
import { ORDER_STATUS, PAYMENT_STATUS } from '../lib/status.js'

const SWATCHES = [
  ['--sage-50', 'sage 50'], ['--sage-100', '100'], ['--sage-200', '200'], ['--sage-300', '300'], ['--sage-400', '400'],
  ['--sage-500', '500'], ['--sage-600', '600 · primary'], ['--sage-700', '700'], ['--sage-800', '800'], ['--sage-900', '900'],
]
const SURFACES = [['--surface-canvas', 'canvas'], ['--surface-card', 'card'], ['--surface-sunken', 'sunken'], ['--border-default', 'border']]
const TEXTS = [['--text-primary', 'Teks utama · 14.2:1'], ['--text-secondary', 'Teks sekunder · 7.4:1'], ['--text-muted', 'Teks muted · 5.2:1']]

function Section({ title, children }) {
  return (
    <section className="ds-section">
      <h2 className="ds-section-title">{title}</h2>
      {children}
    </section>
  )
}

/** Halaman pratinjau design system — hanya tersedia saat `npm run dev`, di /design. */
export function DesignSystemPage() {
  const { toast } = useToast()
  const [range, setRange] = useState('7d')
  const [view, setView] = useState('grid')
  const [tab, setTab] = useState('active')
  const [search, setSearch] = useState('')
  const [available, setAvailable] = useState(true)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [now] = useState(() => new Date())
  const [orderDialog, setOrderDialog] = useState(null)
  const demoOrder = { id: 'demo', queue_number: 12, order_number: '95449854819529334', total_amount: 22000, payment_status: 'unpaid', payment_method: 'cash', order_status: 'ready' }
  const sampleOrders = [
    { id: 'a', queue_number: 12, order_number: '95449854819529334' },
    { id: 'b', order_number: '95449854819529334' },
    { id: '6d4b3d51-1c2e-4f7a-9b1d-2a3c4d5e6f70', order_number: '6d4b3d51-1c2e-4f7a-9b1d-2a3c4d5e6f70' },
  ]

  return (
    <main className="ds-page">
      <header className="ds-header">
        <span className="ds-eyebrow">DAILYBREW · DESIGN SYSTEM</span>
        <h1 className="ui-title ds-h1">Komponen dasar<span className="ui-title-period">.</span></h1>
        <p>Token dan komponen yang dipakai owner, staff, dan (padanannya) customer app.</p>
      </header>

      <Section title="Warna">
        <div className="ds-swatches">
          {SWATCHES.map(([token, name]) => (
            <div key={token} className="ds-swatch"><span style={{ background: `var(${token})` }} /><small>{name}</small></div>
          ))}
        </div>
        <div className="ds-swatches">
          {SURFACES.map(([token, name]) => (
            <div key={token} className="ds-swatch"><span style={{ background: `var(${token})` }} /><small>{name}</small></div>
          ))}
        </div>
        <div className="ds-row">
          {TEXTS.map(([token, name]) => <p key={token} style={{ margin: 0, color: `var(${token})`, fontWeight: 600 }}>{name}</p>)}
        </div>
      </Section>

      <Section title="Tipografi & angka">
        <h2 className="ui-title" style={{ fontSize: 'var(--text-4xl)' }}>Produk<span className="ui-title-period">.</span></h2>
        <h3 className="ui-title" style={{ fontSize: 'var(--text-2xl)' }}>Heading serif · Fraunces</h3>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Body sans · Plus Jakarta Sans. Teks ramah tapi rapi.</p>
        <div className="ds-numbers tabular">
          <span>{formatRupiah(12000)}</span><span>{formatRupiah(1)}</span><span>{formatRupiah(1250000)}</span><span>{formatRupiah(-5000)}</span>
        </div>
        <div className="ds-row">
          {sampleOrders.map((order) => (
            <span key={order.id} className="ds-queue"><strong className="tabular">{formatQueueNumber(order)}</strong><small>{order.queue_number ? 'queue_number ada' : 'fallback'}</small></span>
          ))}
        </div>
        <p className="ds-muted">{summarizeItems([{ product_name: 'Vanilla Latte', quantity: 1 }, { product_name: 'Croissant', quantity: 2 }])} · {formatDateTime(now)} WIB</p>
      </Section>

      <Section title="Tombol">
        <div className="ds-row">
          <Button icon={Plus}>Tambah produk</Button>
          <Button variant="secondary">Sekunder</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger" icon={Trash2}>Hapus</Button>
          <Button variant="danger-soft" icon={XCircle}>Batalkan</Button>
          <Button loading>Menyimpan</Button>
          <Button disabled>Nonaktif</Button>
        </div>
        <div className="ds-row">
          <Button size="sm" variant="secondary">Kecil (36px)</Button>
          <Button size="lg">Besar (52px)</Button>
          <IconButton icon={Pencil} label="Edit produk" variant="secondary" />
          <IconButton icon={Trash2} label="Hapus produk" variant="danger" />
        </div>
      </Section>

      <Section title="Status (identik di 3 aplikasi)">
        <div className="ds-row">{Object.keys(ORDER_STATUS).map((status) => <OrderStatusBadge key={status} status={status} />)}</div>
        <div className="ds-row">
          {Object.keys(PAYMENT_STATUS).map((status) => <PaymentBadge key={status} status={status} />)}
          <PaymentBadge status="paid" method="qris" showMethod />
          <Badge tone="sage" dot={false}>Terlaris</Badge>
        </div>
      </Section>

      <Section title="StatCard">
        <div className="ds-grid-4">
          <StatCard icon={CircleDollarSign} label="Pendapatan" value={formatRupiah(1840000)} delta={12.4} trend={[3, 5, 4, 7, 6, 9, 11]} />
          <StatCard icon={ShoppingBag} label="Jumlah pesanan" value="128" delta={-6} tone="blue" trend={[9, 8, 9, 7, 6, 7, 6]} />
          <StatCard icon={ReceiptText} label="Rata-rata per pesanan" value={formatRupiah(14375)} delta={0} tone="neutral" />
          <StatCard icon={XCircle} label="Dibatalkan" value="3" delta={50} deltaInverse tone="red" />
        </div>
        <div className="ds-grid-4">
          <StatCard compact icon={Coffee} label="Masuk" value="4" tone="amber" />
          <StatCard compact icon={Coffee} label="Diproses" value="2" tone="blue" />
          <StatCard compact icon={Coffee} label="Siap" value="1" tone="green" />
          <StatCard loading label="Memuat…" />
        </div>
      </Section>

      <Section title="Kontrol">
        <div className="ds-row">
          <SegmentedControl label="Rentang tanggal" value={range} onChange={setRange} options={[
            { value: 'today', label: 'Hari ini' }, { value: '7d', label: '7 hari' }, { value: '30d', label: '30 hari' },
            { value: 'month', label: 'Bulan ini' }, { value: 'custom', label: 'Custom' },
          ]} />
          <SegmentedControl label="Tampilan" value={view} onChange={setView} options={[
            { value: 'grid', icon: LayoutGrid, ariaLabel: 'Grid' }, { value: 'table', icon: Table2, ariaLabel: 'Tabel' },
          ]} />
        </div>
        <SegmentedControl variant="tabs" label="Pesanan" value={tab} onChange={setTab} options={[
          { value: 'active', label: 'Aktif', count: 3 }, { value: 'history', label: 'Riwayat', count: 41 },
        ]} />
        <div className="ds-grid-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Cari nomor pesanan atau nama" />
          <Select label="Status pesanan" hideLabel options={[['all', 'Semua status'], ...Object.entries(ORDER_STATUS).map(([key, meta]) => [key, meta.label])]} />
          <Switch checked={available} onChange={setAvailable} label="Ketersediaan produk" onLabel="Tersedia" offLabel="Habis" />
        </div>
        <div className="ds-grid-3">
          <TextField label="Nama produk" placeholder="mis. Vanilla Latte" hint="Maksimal 60 karakter." />
          <TextField label="Harga" prefix="Rp" inputMode="numeric" defaultValue="18.000" />
          <TextField label="Nama kategori" defaultValue="  " error="Nama kategori wajib diisi." />
        </div>
      </Section>

      <Section title="Overlay & umpan balik">
        <div className="ds-row">
          <Button variant="secondary" onClick={() => toast({ title: 'Produk tersimpan', description: 'Perubahan langsung terlihat di menu customer.' })}>Toast sukses</Button>
          <Button variant="secondary" onClick={() => toast({ title: 'Gagal menyimpan', description: 'Periksa koneksi lalu coba lagi.', tone: 'error' })}>Toast error</Button>
          <Button variant="danger-soft" onClick={() => setConfirmOpen(true)}>ConfirmDialog</Button>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>Drawer</Button>
          <Button variant="secondary" onClick={() => setOrderDialog('pay')}>Dialog tandai lunas</Button>
          <Button variant="secondary" onClick={() => setOrderDialog('cancel')}>Dialog batalkan</Button>
        </div>
      </Section>

      <Section title="State: kosong, error, loading">
        <div className="ds-grid-3">
          <Card padding="none"><EmptyState icon={ShoppingBag} title="Belum ada pesanan" description="Pesanan customer akan muncul otomatis di sini." action={<Button size="sm" variant="secondary">Lihat riwayat</Button>} /></Card>
          <Card padding="none"><ErrorState message="Koneksi ke server terputus." onRetry={() => {}} /></Card>
          <Card padding="none"><SkeletonRows rows={3} /></Card>
        </div>
        <Card>
          <CardHeader icon={ReceiptText} title="Card dengan header" description="Deskripsi singkat di bawah judul." actions={<Button size="sm" variant="ghost">Lihat semua</Button>} />
          <Skeleton height={80} radius={12} />
        </Card>
      </Section>

      {confirmOpen && (
        <ConfirmDialog
          title="Hapus produk ini?"
          description="Vanilla Latte akan hilang dari menu. Riwayat pesanan tetap aman. Kalau hanya sementara, nonaktifkan saja."
          confirmLabel="Hapus produk"
          alternative={{ label: 'Nonaktifkan saja', onClick: () => { setConfirmOpen(false); toast({ title: 'Produk dinonaktifkan' }) } }}
          onConfirm={() => new Promise((resolve) => setTimeout(() => { setConfirmOpen(false); toast({ title: 'Produk dihapus' }); resolve() }, 700))}
          onClose={() => setConfirmOpen(false)}
        />
      )}
      {orderDialog === 'pay' && (
        <MarkPaidDialog order={demoOrder} cafe={{ accepted_payment_methods: ['cash', 'qris', 'bank_transfer', 'ewallet'] }} onClose={() => setOrderDialog(null)} />
      )}
      {orderDialog === 'cancel' && <CancelOrderDialog order={demoOrder} onClose={() => setOrderDialog(null)} />}
      {drawerOpen && (
        <Drawer
          title="Pesanan #9334"
          description="Detail pesanan tampil sebagai drawer samping; jadi bottom sheet di layar kecil."
          onClose={() => setDrawerOpen(false)}
          footer={<><Button variant="ghost" onClick={() => setDrawerOpen(false)}>Tutup</Button><Button>Tandai lunas</Button></>}
        >
          <div className="ds-row"><OrderStatusBadge status="preparing" /><PaymentBadge status="unpaid" /></div>
          <SkeletonRows rows={4} />
        </Drawer>
      )}
    </main>
  )
}
