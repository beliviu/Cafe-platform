import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { ArrowDown, ArrowUp, Coffee, FolderPlus, GripVertical, Layers3, Pencil, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import {
  Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, IconButton, PageHeader, Select, SkeletonRows, TextField, useToast,
} from '../components/ui/index.js'
import { friendlyError } from '../lib/db.js'
import { formatNumber } from '../lib/format.js'

const NAME_MIN = 2
const NAME_MAX = 40

/** Rapikan nama: buang spasi di awal/akhir dan spasi ganda. */
function normalizeName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function validateName(name, categories, currentId) {
  if (!name) return 'Nama kategori wajib diisi.'
  if (name.length < NAME_MIN) return `Nama kategori minimal ${NAME_MIN} karakter.`
  if (name.length > NAME_MAX) return `Nama kategori maksimal ${NAME_MAX} karakter.`
  const duplicate = categories.find((item) => item.id !== currentId && normalizeName(item.name).toLocaleLowerCase('id') === name.toLocaleLowerCase('id'))
  return duplicate ? `Kategori "${duplicate.name}" sudah ada.` : ''
}

function CategoryDialog({ category, categories, cafeId, onClose, onSaved }) {
  const { supabase } = useAuth()
  const [name, setName] = useState(category?.name || '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    const clean = normalizeName(name)
    setName(clean)
    const validation = validateName(clean, categories, category?.id)
    setError(validation)
    if (validation) return
    setSaving(true)
    const nextSort = categories.reduce((max, item) => Math.max(max, Number(item.sort_order) || 0), 0) + 1
    const result = category
      ? await supabase.from('categories').update({ name: clean }).eq('id', category.id).eq('cafe_id', cafeId).select('id, name, sort_order').maybeSingle()
      : await supabase.from('categories').insert({ cafe_id: cafeId, name: clean, sort_order: nextSort }).select('id, name, sort_order').maybeSingle()
    if (result.error || !result.data) {
      setError(result.error?.code === '23505' ? 'Nama kategori ini sudah dipakai.' : result.error ? friendlyError(result.error) : 'Perubahan ditolak database.')
      setSaving(false)
      return
    }
    onSaved(result.data, category ? 'updated' : 'created')
  }

  return (
    <Dialog
      size="sm"
      title={category ? 'Ubah nama kategori' : 'Tambah kategori'}
      description="Nama kategori tampil sebagai pilihan di menu customer."
      onClose={saving ? undefined : onClose}
      dismissible={!saving}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form="category-form" loading={saving}>{category ? 'Simpan' : 'Tambah kategori'}</Button>
        </>
      )}
    >
      <form id="category-form" onSubmit={handleSubmit} noValidate>
        <TextField
          label="Nama kategori"
          value={name}
          onChange={(event) => { setName(event.target.value); setError('') }}
          onBlur={() => setName((current) => normalizeName(current))}
          maxLength={NAME_MAX + 10}
          placeholder="mis. Kopi Susu"
          error={error}
          hint={`${normalizeName(name).length}/${NAME_MAX} karakter`}
          autoFocus
        />
      </form>
    </Dialog>
  )
}

/** Kategori yang masih berisi produk: pindahkan produknya dulu, baru hapus. */
function MoveProductsDialog({ category, count, categories, onClose, onConfirm }) {
  const others = categories.filter((item) => item.id !== category.id)
  const [target, setTarget] = useState(others[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleConfirm() {
    setBusy(true)
    setError('')
    try {
      await onConfirm(target)
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
  }

  return (
    <Dialog
      size="sm"
      title={`"${category.name}" masih punya ${formatNumber(count)} produk`}
      description="Pindahkan produknya ke kategori lain dulu agar tidak hilang dari menu customer."
      onClose={busy ? undefined : onClose}
      dismissible={!busy}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button>
          {others.length > 0 && <Button variant="danger" onClick={handleConfirm} loading={busy} disabled={!target}>Pindahkan &amp; hapus</Button>}
        </>
      )}
    >
      {others.length ? (
        <Select
          label="Pindahkan produk ke"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          options={others.map((item) => ({ value: item.id, label: item.name }))}
        />
      ) : (
        <p className="settings-note">Belum ada kategori lain. Buat kategori baru dulu, atau ubah nama kategori ini.</p>
      )}
      <p className="settings-note">
        Atau <Link to={`/products?category=${category.id}`}>lihat produknya</Link> dan pindahkan satu per satu.
      </p>
      {error && <p className="ui-field-error" role="alert">{error}</p>}
    </Dialog>
  )
}

export function CategoriesPage() {
  const { cafe } = useOutletContext()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [categories, setCategories] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState(undefined)
  const [deleting, setDeleting] = useState(null)
  const [dragId, setDragId] = useState(null)
  const [savingOrder, setSavingOrder] = useState(false)
  const listRef = useRef(null)
  const savedOrder = useRef([])
  const saveTimer = useRef(0)

  const loadCategories = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    const [categoryResult, productResult] = await Promise.all([
      supabase.from('categories').select('id, name, sort_order, created_at').eq('cafe_id', cafe.id)
        .order('sort_order', { ascending: true }).order('name', { ascending: true }),
      supabase.from('products').select('id, category_id, image_url, is_available, name').eq('cafe_id', cafe.id)
        .order('created_at', { ascending: false }),
    ])
    const error = categoryResult.error || productResult.error
    if (error) {
      setLoadError(friendlyError(error))
    } else {
      setCategories(categoryResult.data || [])
      setProducts(productResult.data || [])
      savedOrder.current = (categoryResult.data || []).map((item) => item.id)
    }
    setLoading(false)
  }, [cafe.id, supabase])

  useEffect(() => {
    const timer = window.setTimeout(loadCategories, 0)
    return () => window.clearTimeout(timer)
  }, [attempt, loadCategories])

  useEffect(() => () => window.clearTimeout(saveTimer.current), [])

  /**
   * Simpan urutan: hanya kolom categories.sort_order (1, 2, 3, …) untuk baris yang posisinya berubah.
   */
  async function persistOrder(ordered) {
    const ids = ordered.map((item) => item.id)
    if (ids.join() === savedOrder.current.join()) return
    const changed = ordered
      .map((item, index) => ({ item, sort: index + 1 }))
      .filter(({ item, sort }) => Number(item.sort_order) !== sort)
    if (!changed.length) {
      savedOrder.current = ids
      return
    }
    setSavingOrder(true)
    const results = await Promise.all(changed.map(({ item, sort }) => supabase
      .from('categories').update({ sort_order: sort }).eq('id', item.id).eq('cafe_id', cafe.id).select('id').maybeSingle()))
    const failed = results.find((result) => result.error || !result.data)
    setSavingOrder(false)
    if (failed) {
      toast({ tone: 'error', title: 'Urutan gagal disimpan', description: failed.error ? friendlyError(failed.error) : 'Perubahan ditolak database.' })
      setAttempt((value) => value + 1)
      return
    }
    savedOrder.current = ids
    setCategories(ordered.map((item, index) => ({ ...item, sort_order: index + 1 })))
    toast({ title: 'Urutan disimpan', description: 'Menu customer mengikuti urutan ini.', duration: 2400 })
  }

  function schedulePersist(ordered, delay = 700) {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => persistOrder(ordered), delay)
  }

  function move(id, delta) {
    const index = categories.findIndex((item) => item.id === id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= categories.length) return
    const next = [...categories]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    setCategories(next)
    schedulePersist(next)
  }

  function handlePointerDown(event, id) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    window.clearTimeout(saveTimer.current)
    setDragId(id)
  }

  function handlePointerMove(event) {
    if (!dragId || !listRef.current) return
    const rows = [...listRef.current.querySelectorAll('[data-row-id]')]
    let target = rows.length - 1
    for (let index = 0; index < rows.length; index += 1) {
      const rect = rows[index].getBoundingClientRect()
      if (event.clientY < rect.top + rect.height / 2) {
        target = index
        break
      }
    }
    setCategories((current) => {
      const index = current.findIndex((item) => item.id === dragId)
      if (index === target || index < 0) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  function handlePointerUp() {
    if (!dragId) return
    setDragId(null)
    schedulePersist(categories, 0)
  }

  async function moveProductsAndDelete(category, targetId) {
    const { error: moveError } = await supabase.from('products').update({ category_id: targetId })
      .eq('cafe_id', cafe.id).eq('category_id', category.id)
    if (moveError) throw new Error(friendlyError(moveError))
    await removeCategory(category)
    setProducts((current) => current.map((product) => (product.category_id === category.id ? { ...product, category_id: targetId } : product)))
  }

  async function removeCategory(category) {
    const { data, error } = await supabase.from('categories').delete().eq('id', category.id).eq('cafe_id', cafe.id).select('id').maybeSingle()
    if (error) throw new Error(error.code === '23503' ? 'Kategori masih dipakai produk. Muat ulang halaman lalu coba lagi.' : friendlyError(error))
    if (!data) throw new Error('Kategori tidak terhapus. Akses hapus ditolak database.')
    setCategories((current) => current.filter((item) => item.id !== category.id))
    savedOrder.current = savedOrder.current.filter((id) => id !== category.id)
    setDeleting(null)
    toast({ title: `Kategori "${category.name}" dihapus` })
  }

  const productsByCategory = new Map()
  for (const product of products) {
    const list = productsByCategory.get(product.category_id) || []
    list.push(product)
    productsByCategory.set(product.category_id, list)
  }
  const deletingCount = deleting ? (productsByCategory.get(deleting.id) || []).length : 0

  return (
    <div className="page">
      <PageHeader
        eyebrow="Katalog"
        title="Kategori"
        description="Kelompokkan produk dan atur urutannya. Urutan di sini dipakai di menu customer."
        actions={<Button icon={Plus} onClick={() => setEditing(null)}>Tambah kategori</Button>}
      />

      {loading ? (
        <Card padding="none"><SkeletonRows rows={4} label="Memuat kategori" /></Card>
      ) : loadError ? (
        <Card><ErrorState message={loadError} onRetry={() => setAttempt((value) => value + 1)} /></Card>
      ) : !categories.length ? (
        <Card>
          <EmptyState
            icon={FolderPlus}
            title="Belum ada kategori"
            description="Buat kategori pertama, misalnya Kopi, Non-kopi, atau Pastry."
            action={<Button icon={Plus} onClick={() => setEditing(null)}>Buat kategori</Button>}
          />
        </Card>
      ) : (
        <Card padding="none" className="table-card">
          <div className="cat-list-head">
            <span>Seret <GripVertical size={14} aria-hidden="true" /> atau pakai tombol panah untuk mengubah urutan.</span>
            <span className="cat-saving" aria-live="polite">{savingOrder ? 'Menyimpan urutan…' : ''}</span>
          </div>
          <ol
            className={`cat-list${dragId ? ' is-dragging' : ''}`}
            ref={listRef}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            aria-label="Urutan kategori"
          >
            {categories.map((category, index) => {
              const items = productsByCategory.get(category.id) || []
              const available = items.filter((product) => product.is_available).length
              const thumbs = items.filter((product) => product.image_url).slice(0, 4)
              return (
                <li key={category.id} data-row-id={category.id} className={`cat-row${dragId === category.id ? ' is-dragged' : ''}`}>
                  <button
                    type="button"
                    className="cat-handle"
                    aria-label={`Seret untuk memindahkan ${category.name}`}
                    onPointerDown={(event) => handlePointerDown(event, category.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                        event.preventDefault()
                        const handle = event.currentTarget
                        move(category.id, event.key === 'ArrowUp' ? -1 : 1)
                        window.requestAnimationFrame(() => handle.focus())
                      }
                    }}
                  >
                    <GripVertical size={18} aria-hidden="true" />
                  </button>
                  <span className="cat-position tabular" aria-hidden="true">{index + 1}</span>
                  <span className="cat-thumbs" aria-hidden="true">
                    {thumbs.length ? thumbs.map((product) => <img key={product.id} src={product.image_url} alt="" loading="lazy" />)
                      : <span className="cat-thumb-empty">{items.length ? <Coffee size={16} /> : <Layers3 size={16} />}</span>}
                  </span>
                  <span className="cat-info">
                    <strong>{category.name}</strong>
                    <small>
                      {items.length
                        ? <><Link to={`/products?category=${category.id}`}>{formatNumber(items.length)} produk</Link> · {formatNumber(available)} tersedia</>
                        : 'Belum ada produk'}
                    </small>
                  </span>
                  <span className="cat-actions">
                    <IconButton icon={ArrowUp} size="sm" label={`Naikkan ${category.name}`} disabled={index === 0} onClick={() => move(category.id, -1)} />
                    <IconButton icon={ArrowDown} size="sm" label={`Turunkan ${category.name}`} disabled={index === categories.length - 1} onClick={() => move(category.id, 1)} />
                    <IconButton icon={Pencil} size="sm" label={`Ubah nama ${category.name}`} onClick={() => setEditing(category)} />
                    <IconButton icon={Trash2} size="sm" variant="danger" label={`Hapus ${category.name}`} onClick={() => setDeleting(category)} />
                  </span>
                </li>
              )
            })}
          </ol>
        </Card>
      )}

      {editing !== undefined && (
        <CategoryDialog
          key={editing?.id || 'new'}
          category={editing}
          categories={categories}
          cafeId={cafe.id}
          onClose={() => setEditing(undefined)}
          onSaved={(saved, mode) => {
            setEditing(undefined)
            if (mode === 'created') {
              setCategories((current) => [...current, saved])
              savedOrder.current = [...savedOrder.current, saved.id]
            } else {
              setCategories((current) => current.map((item) => (item.id === saved.id ? { ...item, ...saved } : item)))
            }
            toast({ title: mode === 'created' ? `Kategori "${saved.name}" ditambahkan` : 'Nama kategori disimpan' })
          }}
        />
      )}

      {deleting && deletingCount > 0 && (
        <MoveProductsDialog
          category={deleting}
          count={deletingCount}
          categories={categories}
          onClose={() => setDeleting(null)}
          onConfirm={(targetId) => moveProductsAndDelete(deleting, targetId)}
        />
      )}
      {deleting && deletingCount === 0 && (
        <ConfirmDialog
          title={`Hapus kategori "${deleting.name}"?`}
          description="Kategori ini kosong. Menghapusnya tidak memengaruhi produk atau transaksi."
          confirmLabel="Hapus kategori"
          onClose={() => setDeleting(null)}
          onConfirm={() => removeCategory(deleting)}
        />
      )}
    </div>
  )
}
