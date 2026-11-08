import { useCallback, useEffect, useMemo, useState } from 'react'
import { Coffee, PackageX } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { EmptyState, ErrorState, SearchInput, SegmentedControl, SkeletonRows, Switch, useToast } from '../ui/index.js'
import { useCan } from '../../lib/permissions.js'
import { DB_UPDATE_REQUIRED, friendlyError } from '../../lib/db.js'
import { formatRupiah } from '../../lib/format.js'
import { setProductAvailability } from '../../lib/orderActions.js'

/**
 * Daftar menu dengan toggle Tersedia/Habis untuk staff.
 * Menulis lewat RPC staff_set_product_availability → hanya products.is_available (tanpa akses harga).
 */
export function AvailabilityPanel({ cafe, features, compact = false, onCountChange }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const allowed = useCan()('menu.availability')
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [productResult, categoryResult] = await Promise.all([
      supabase.from('products').select('id, name, price, image_url, is_available, category_id').eq('cafe_id', cafe.id).order('name', { ascending: true }),
      supabase.from('categories').select('id, name, sort_order').eq('cafe_id', cafe.id).order('sort_order', { ascending: true }).order('name', { ascending: true }),
    ])
    const failure = productResult.error || categoryResult.error
    if (failure) setError(friendlyError(failure))
    else {
      setProducts(productResult.data || [])
      setCategories(categoryResult.data || [])
    }
    setLoading(false)
  }, [cafe.id, supabase])

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => window.clearTimeout(timer)
  }, [attempt, load])

  const soldOut = products.filter((product) => !product.is_available).length
  useEffect(() => { onCountChange?.(soldOut) }, [onCountChange, soldOut])

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id')
    const visible = products.filter((product) => (
      (!needle || product.name.toLocaleLowerCase('id').includes(needle))
      && (filter === 'all' || (filter === 'soldout' ? !product.is_available : product.is_available))
    ))
    const known = new Set(categories.map((category) => category.id))
    const list = categories.map((category) => ({ ...category, items: visible.filter((product) => product.category_id === category.id) }))
    const orphans = visible.filter((product) => !known.has(product.category_id))
    if (orphans.length) list.push({ id: 'none', name: 'Tanpa kategori', items: orphans })
    return list.filter((group) => group.items.length)
  }, [categories, filter, products, query])

  async function toggle(product, next) {
    setBusyId(product.id)
    setProducts((current) => current.map((item) => (item.id === product.id ? { ...item, is_available: next } : item)))
    try {
      await setProductAvailability(supabase, product.id, next)
      toast({ title: next ? `${product.name} tersedia lagi` : `${product.name} ditandai habis`, description: next ? undefined : 'Customer tidak bisa memesan menu ini.', duration: 2600 })
    } catch (caught) {
      setProducts((current) => current.map((item) => (item.id === product.id ? { ...item, is_available: product.is_available } : item)))
      toast({ tone: 'error', title: 'Gagal mengubah ketersediaan', description: caught.message })
    }
    setBusyId('')
  }

  if (!features?.operations) {
    return <EmptyState icon={PackageX} title="Belum tersedia" description={DB_UPDATE_REQUIRED} />
  }

  return (
    <div className={`avail${compact ? ' is-compact' : ''}`}>
      <div className="avail-toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Cari menu…" label="Cari menu" />
        <SegmentedControl
          label="Filter ketersediaan"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Semua', count: products.length },
            { value: 'soldout', label: 'Habis', count: soldOut },
          ]}
        />
      </div>
      {loading ? (
        <SkeletonRows rows={6} label="Memuat menu" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} />
      ) : !groups.length ? (
        <EmptyState compact icon={Coffee} title={filter === 'soldout' ? 'Tidak ada menu yang habis' : 'Menu tidak ditemukan'} description={filter === 'soldout' ? 'Semua menu bisa dipesan customer.' : 'Coba kata kunci lain.'} />
      ) : (
        groups.map((group) => (
          <section className="avail-group" key={group.id} aria-label={group.name}>
            <h3>{group.name}</h3>
            <ul>
              {group.items.map((product) => (
                <li key={product.id} className={product.is_available ? '' : 'is-soldout'}>
                  {product.image_url
                    ? <img src={product.image_url} alt="" loading="lazy" />
                    : <span className="avail-thumb" aria-hidden="true"><Coffee size={16} /></span>}
                  <span className="avail-name">
                    <strong>{product.name}</strong>
                    <small className="tabular">{formatRupiah(product.price)}</small>
                  </span>
                  <Switch
                    checked={product.is_available}
                    disabled={busyId === product.id || !allowed}
                    onChange={(next) => toggle(product, next)}
                    label={`${product.name} tersedia`}
                    onLabel="Tersedia"
                    offLabel="Habis"
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
