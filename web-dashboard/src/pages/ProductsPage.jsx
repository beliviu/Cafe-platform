import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import { Check, Coffee, FolderPlus, LayoutGrid, Package2, Pencil, Plus, Rows3, SlidersHorizontal, Trash2, TrendingUp } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import { ProductFormDrawer } from '../components/products/ProductFormDrawer.jsx'
import { ProductOptionsDrawer } from '../components/products/ProductOptionsDrawer.jsx'
import { fetchOptionCounts } from '../lib/productOptions.js'
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, IconButton, PageHeader, SearchInput,
  SegmentedControl, Select, Skeleton, Switch, useToast,
} from '../components/ui/index.js'
import { addDaysToKey, formatNumber, formatRupiah, jakartaDateKey, parseRupiah, startOfJakartaDay } from '../lib/format.js'
import { fetchAllRows, friendlyError } from '../lib/db.js'
import { deleteProduct, patchProduct, PRODUCT_COLUMNS } from '../lib/products.js'

const VIEW_KEY = 'dailybrew.products.view'
const BEST_SELLER_COUNT = 3
const SORTS = [
  { value: 'newest', label: 'Terbaru' },
  { value: 'name', label: 'Nama A–Z' },
  { value: 'best', label: 'Terlaris' },
  { value: 'price-asc', label: 'Harga terendah' },
  { value: 'price-desc', label: 'Harga tertinggi' },
]

function readView() {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'grid'
  } catch {
    return 'grid'
  }
}

/** Input harga di tabel: simpan saat Enter atau keluar dari kolom. */
function InlinePrice({ product, onSave }) {
  const original = Math.round(Number(product.price) || 0)
  const [text, setText] = useState(formatNumber(original))
  const [state, setState] = useState('idle')

  async function commit() {
    const value = parseRupiah(text)
    if (value === '') {
      setText(formatNumber(original))
      return
    }
    setText(formatNumber(value))
    if (value === original) return
    setState('saving')
    const ok = await onSave(value)
    setState(ok ? 'saved' : 'idle')
    if (!ok) setText(formatNumber(original))
    if (ok) window.setTimeout(() => setState('idle'), 1600)
  }

  return (
    <span className={`inline-price is-${state}`}>
      <span className="inline-price-prefix" aria-hidden="true">Rp</span>
      <input
        className="tabular"
        inputMode="numeric"
        aria-label={`Harga ${product.name}`}
        value={text}
        disabled={state === 'saving'}
        onChange={(event) => {
          const value = parseRupiah(event.target.value)
          setText(value === '' ? '' : formatNumber(value))
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setText(formatNumber(original))
            event.currentTarget.blur()
          }
        }}
      />
      {state === 'saved' && <Check size={15} className="inline-price-ok" aria-label="Tersimpan" />}
    </span>
  )
}

function ProductThumb({ product, size = 'md' }) {
  return product.image_url ? (
    <img className={`product-thumb product-thumb-${size}`} src={product.image_url} alt="" loading="lazy" />
  ) : (
    <span className={`product-thumb product-thumb-${size} is-empty`} aria-hidden="true"><Coffee size={size === 'lg' ? 28 : 16} /></span>
  )
}

function ProductCard({ product, categoryName, sold, bestSeller, busy, optionCount, onEdit, onToggle, onOptions }) {
  return (
    <article className={`pcard${product.is_available ? '' : ' is-unavailable'}`}>
      <button type="button" className="pcard-image" onClick={onEdit} aria-label={`Edit ${product.name}`} tabIndex={-1}>
        <ProductThumb product={product} size="lg" />
        {bestSeller && <span className="pcard-best"><TrendingUp size={13} aria-hidden="true" /> Terlaris</span>}
        {!product.is_available && <span className="pcard-soldout">Habis</span>}
      </button>
      <div className="pcard-body">
        <span className="pcard-category">{categoryName || 'Tanpa kategori'}</span>
        <h2 className="pcard-name">{product.name}</h2>
        <p className="pcard-desc">{product.description || 'Belum ada deskripsi.'}</p>
        <div className="pcard-meta">
          <strong className="tabular">{formatRupiah(product.price)}</strong>
          <span className="tabular">{sold ? `${formatNumber(sold)} terjual · 30 hari` : 'Belum terjual · 30 hari'}</span>
          {optionCount > 0 && <span className="pcard-options">{optionCount} grup varian</span>}
        </div>
      </div>
      <footer className="pcard-footer">
        <Switch
          checked={product.is_available}
          disabled={busy}
          onChange={onToggle}
          label={`${product.name} tersedia`}
          onLabel="Tersedia"
          offLabel="Habis"
        />
        <span className="pcard-actions">
          {onOptions && <IconButton icon={SlidersHorizontal} label={`Varian ${product.name}`} variant="secondary" onClick={onOptions} />}
          <IconButton icon={Pencil} label={`Edit ${product.name}`} variant="secondary" onClick={onEdit} />
        </span>
      </footer>
    </article>
  )
}

function ProductsSkeleton({ view }) {
  if (view === 'table') {
    return <Card padding="none"><div className="ui-skeleton-rows" role="status" aria-label="Memuat produk">{[0, 1, 2, 3, 4].map((key) => <div className="ui-skeleton-row" key={key}><Skeleton width={44} height={44} radius={10} /><span className="ui-skeleton-row-text"><Skeleton width="40%" /><Skeleton width="20%" height={11} /></span><Skeleton width={110} height={36} radius={10} /></div>)}</div></Card>
  }
  return (
    <div className="pgrid" role="status" aria-label="Memuat produk">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((key) => (
        <div className="pcard" key={key}>
          <Skeleton height={0} style={{ aspectRatio: '1 / 1', height: 'auto' }} radius={0} />
          <div className="pcard-body"><Skeleton width="40%" height={11} /><Skeleton width="80%" height={18} /><Skeleton width="55%" /></div>
        </div>
      ))}
    </div>
  )
}

export function ProductsPage() {
  const { cafe, features } = useOutletContext()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [searchParams] = useSearchParams()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [soldById, setSoldById] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  // ?q=… dari palet perintah (Ctrl/Cmd+K) mengisi kotak cari; berubah lagi bila palet dipakai saat halaman ini terbuka
  const urlQuery = searchParams.get('q') || ''
  const [query, setQuery] = useState(urlQuery)
  const [seenUrlQuery, setSeenUrlQuery] = useState(urlQuery)
  if (urlQuery !== seenUrlQuery) {
    setSeenUrlQuery(urlQuery)
    setQuery(urlQuery)
  }
  const [categoryFilter, setCategoryFilter] = useState(() => searchParams.get('category') || 'all')
  const [statusFilter, setStatusFilter] = useState(() => (['available', 'unavailable'].includes(searchParams.get('status')) ? searchParams.get('status') : 'all'))
  const [sort, setSort] = useState('newest')
  const [view, setView] = useState(readView)
  const [editing, setEditing] = useState(undefined)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [busyId, setBusyId] = useState('')
  const [optionsFor, setOptionsFor] = useState(null)
  const [optionCounts, setOptionCounts] = useState(new Map())

  useEffect(() => {
    if (!features?.phase3) return undefined
    let active = true
    fetchOptionCounts(supabase, cafe.id).then((counts) => { if (active) setOptionCounts(counts) })
    return () => { active = false }
  }, [cafe.id, features?.phase3, supabase])

  const loadProducts = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    const since = startOfJakartaDay(addDaysToKey(jakartaDateKey(), -29)).toISOString()
    const [productResult, categoryResult, soldResult] = await Promise.all([
      supabase.from('products').select(PRODUCT_COLUMNS).eq('cafe_id', cafe.id).order('created_at', { ascending: false }),
      supabase.from('categories').select('id, name, sort_order').eq('cafe_id', cafe.id)
        .order('sort_order', { ascending: true }).order('name', { ascending: true }),
      fetchAllRows(() => supabase.from('order_items').select('product_id, quantity, orders!inner(order_status)')
        .eq('cafe_id', cafe.id).gte('created_at', since).neq('orders.order_status', 'cancelled')),
    ])
    const error = productResult.error || categoryResult.error
    if (error) {
      setLoadError(friendlyError(error))
      setLoading(false)
      return
    }
    const sold = new Map()
    // Data terjual hanya pelengkap (badge Terlaris) — kalau gagal, halaman tetap jalan.
    for (const item of soldResult.error ? [] : soldResult.data) {
      if (item.product_id) sold.set(item.product_id, (sold.get(item.product_id) || 0) + (Number(item.quantity) || 0))
    }
    setProducts(productResult.data || [])
    setCategories(categoryResult.data || [])
    setSoldById(sold)
    setLoading(false)
  }, [cafe.id, supabase])

  useEffect(() => {
    const timer = window.setTimeout(loadProducts, 0)
    return () => window.clearTimeout(timer)
  }, [attempt, loadProducts])

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_KEY, view)
    } catch {
      // abaikan
    }
  }, [view])

  const categoryNames = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories])
  const bestSellers = useMemo(() => new Set(
    [...soldById.entries()].filter(([, quantity]) => quantity > 0).sort((a, b) => b[1] - a[1]).slice(0, BEST_SELLER_COUNT).map(([id]) => id),
  ), [soldById])

  const counts = useMemo(() => ({
    all: products.length,
    available: products.filter((product) => product.is_available).length,
    unavailable: products.filter((product) => !product.is_available).length,
  }), [products])

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id')
    const list = products.filter((product) => (
      (!needle || product.name.toLocaleLowerCase('id').includes(needle) || (product.description || '').toLocaleLowerCase('id').includes(needle))
      && (categoryFilter === 'all' || product.category_id === categoryFilter)
      && (statusFilter === 'all' || (statusFilter === 'available' ? product.is_available : !product.is_available))
    ))
    const sorters = {
      newest: (a, b) => new Date(b.created_at) - new Date(a.created_at),
      name: (a, b) => a.name.localeCompare(b.name, 'id'),
      best: (a, b) => (soldById.get(b.id) || 0) - (soldById.get(a.id) || 0) || a.name.localeCompare(b.name, 'id'),
      'price-asc': (a, b) => Number(a.price) - Number(b.price),
      'price-desc': (a, b) => Number(b.price) - Number(a.price),
    }
    return [...list].sort(sorters[sort])
  }, [categoryFilter, products, query, soldById, sort, statusFilter])

  function replaceProduct(updated) {
    setProducts((current) => current.map((item) => (item.id === updated.id ? updated : item)))
  }

  async function toggleAvailability(product, nextValue = !product.is_available) {
    setBusyId(product.id)
    replaceProduct({ ...product, is_available: nextValue })
    try {
      replaceProduct(await patchProduct(supabase, cafe.id, product.id, { is_available: nextValue }))
      toast({ title: `${product.name} ${nextValue ? 'tersedia lagi' : 'ditandai habis'}`, tone: 'success', duration: 2600 })
    } catch (caught) {
      replaceProduct(product)
      toast({ tone: 'error', title: 'Status produk gagal diubah', description: caught.message })
    }
    setBusyId('')
  }

  async function savePrice(product, price) {
    try {
      replaceProduct(await patchProduct(supabase, cafe.id, product.id, { price }))
      return true
    } catch (caught) {
      toast({ tone: 'error', title: 'Harga gagal disimpan', description: caught.message })
      return false
    }
  }

  function handleSaved({ product, warning }, mode) {
    setEditing(undefined)
    setProducts((current) => (mode === 'created' ? [product, ...current] : current.map((item) => (item.id === product.id ? product : item))))
    toast({ title: mode === 'created' ? `${product.name} ditambahkan` : 'Perubahan disimpan', description: warning || undefined, tone: warning ? 'info' : 'success' })
  }

  const filtersActive = query || categoryFilter !== 'all' || statusFilter !== 'all'
  const canAdd = categories.length > 0

  return (
    <div className="page">
      <PageHeader
        eyebrow="Katalog"
        title="Produk"
        description="Atur menu, harga, dan ketersediaan. Perubahan langsung tampil di aplikasi customer."
        actions={canAdd && <Button icon={Plus} onClick={() => setEditing(null)}>Tambah produk</Button>}
      />

      <section className="toolbar" aria-label="Filter produk">
        <SearchInput value={query} onChange={setQuery} placeholder="Cari nama atau deskripsi…" label="Cari produk" className="toolbar-search" />
        <Select hideLabel label="Kategori" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}
          options={[{ value: 'all', label: 'Semua kategori' }, ...categories.map((category) => ({ value: category.id, label: category.name }))]} />
        <Select hideLabel label="Urutkan" value={sort} onChange={(event) => setSort(event.target.value)} options={SORTS} />
        <SegmentedControl
          label="Filter ketersediaan"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'all', label: 'Semua', count: counts.all },
            { value: 'available', label: 'Tersedia', count: counts.available },
            { value: 'unavailable', label: 'Habis', count: counts.unavailable },
          ]}
        />
        <SegmentedControl
          className="toolbar-end"
          label="Tampilan"
          value={view}
          onChange={setView}
          options={[
            { value: 'grid', icon: LayoutGrid, ariaLabel: 'Tampilan grid' },
            { value: 'table', icon: Rows3, ariaLabel: 'Tampilan tabel' },
          ]}
        />
      </section>

      {loading ? (
        <ProductsSkeleton view={view} />
      ) : loadError ? (
        <Card><ErrorState message={loadError} onRetry={() => setAttempt((value) => value + 1)} /></Card>
      ) : !categories.length ? (
        <Card>
          <EmptyState
            icon={FolderPlus}
            title="Buat kategori dulu"
            description="Setiap produk perlu kategori (mis. Kopi, Non-kopi, Pastry) agar menu customer rapi."
            action={<Button as={Link} to="/categories" icon={Plus}>Buat kategori</Button>}
          />
        </Card>
      ) : !visible.length ? (
        <Card>
          <EmptyState
            icon={Package2}
            title={products.length ? 'Tidak ada produk yang cocok' : 'Belum ada produk'}
            description={products.length ? 'Coba kata kunci lain atau hapus filter.' : 'Tambahkan produk pertama untuk mengisi menu customer.'}
            action={products.length
              ? filtersActive && <Button variant="secondary" onClick={() => { setQuery(''); setCategoryFilter('all'); setStatusFilter('all') }}>Hapus filter</Button>
              : <Button icon={Plus} onClick={() => setEditing(null)}>Tambah produk</Button>}
          />
        </Card>
      ) : view === 'grid' ? (
        <section className="pgrid" aria-label="Daftar produk">
          {visible.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              categoryName={categoryNames.get(product.category_id)}
              sold={soldById.get(product.id) || 0}
              bestSeller={bestSellers.has(product.id)}
              busy={busyId === product.id}
              optionCount={optionCounts.get(product.id) || 0}
              onOptions={features?.phase3 ? () => setOptionsFor(product) : undefined}
              onEdit={() => setEditing(product)}
              onToggle={(value) => toggleAvailability(product, value)}
            />
          ))}
        </section>
      ) : (
        <Card padding="none" className="table-card">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Produk</th>
                  <th scope="col">Kategori</th>
                  <th scope="col" className="num-col">Harga</th>
                  <th scope="col" className="num-col">Terjual 30 hari</th>
                  <th scope="col">Ketersediaan</th>
                  <th scope="col"><span className="sr-only">Aksi</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((product) => (
                  <tr key={product.id} className={product.is_available ? '' : 'is-muted'}>
                    <td>
                      <span className="table-product">
                        <ProductThumb product={product} />
                        <span>
                          <strong>{product.name}</strong>
                          {bestSellers.has(product.id) && <Badge tone="amber" size="sm" dot={false}><TrendingUp size={12} aria-hidden="true" /> Terlaris</Badge>}
                        </span>
                      </span>
                    </td>
                    <td className="cell-muted">{categoryNames.get(product.category_id) || 'Tanpa kategori'}</td>
                    <td className="num-col"><InlinePrice key={product.price} product={product} onSave={(price) => savePrice(product, price)} /></td>
                    <td className="num-col tabular">{formatNumber(soldById.get(product.id) || 0)}</td>
                    <td>
                      <Switch size="sm" checked={product.is_available} disabled={busyId === product.id}
                        onChange={(value) => toggleAvailability(product, value)} label={`${product.name} tersedia`} onLabel="Tersedia" offLabel="Habis" />
                    </td>
                    <td className="actions-col">
                      {features?.phase3 && <IconButton icon={SlidersHorizontal} label={`Varian ${product.name}`} size="sm" onClick={() => setOptionsFor(product)} />}
                      <IconButton icon={Pencil} label={`Edit ${product.name}`} size="sm" onClick={() => setEditing(product)} />
                      <IconButton icon={Trash2} size="sm" variant="danger" label={`Hapus ${product.name}`} onClick={() => setConfirmDelete(product)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="table-footnote">Klik harga untuk mengubah langsung · Enter untuk simpan, Esc untuk batal.</p>
        </Card>
      )}

      {editing !== undefined && (
        <ProductFormDrawer
          key={editing?.id || 'new'}
          product={editing}
          categories={categories}
          cafeId={cafe.id}
          bestSeller={Boolean(editing && bestSellers.has(editing.id))}
          onClose={() => setEditing(undefined)}
          onSaved={handleSaved}
          onDelete={(product) => setConfirmDelete(product)}
        />
      )}

      {optionsFor && (
        <ProductOptionsDrawer
          key={optionsFor.id}
          product={optionsFor}
          onClose={() => setOptionsFor(null)}
          onSaved={(productId, count) => setOptionCounts((current) => new Map(current).set(productId, count))}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Hapus "${confirmDelete.name}"?`}
          description={`Produk akan hilang dari katalog dan menu customer. Riwayat transaksi lama tetap tersimpan.${confirmDelete.is_available ? ' Kalau hanya sedang tidak dijual, lebih aman dinonaktifkan.' : ''}`}
          confirmLabel="Hapus permanen"
          onClose={() => setConfirmDelete(null)}
          alternative={confirmDelete.is_available ? {
            label: 'Nonaktifkan saja',
            onClick: async () => {
              const updated = await patchProduct(supabase, cafe.id, confirmDelete.id, { is_available: false })
              replaceProduct(updated)
              setConfirmDelete(null)
              setEditing(undefined)
              toast({ title: `${confirmDelete.name} dinonaktifkan`, description: 'Produk tampil sebagai "Habis" di menu customer.' })
            },
          } : undefined}
          onConfirm={async () => {
            const warning = await deleteProduct(supabase, cafe.id, confirmDelete)
            setProducts((current) => current.filter((item) => item.id !== confirmDelete.id))
            setConfirmDelete(null)
            setEditing(undefined)
            toast({ title: `${confirmDelete.name} dihapus`, description: warning || undefined, tone: warning ? 'info' : 'success' })
          }}
        />
      )}
    </div>
  )
}
