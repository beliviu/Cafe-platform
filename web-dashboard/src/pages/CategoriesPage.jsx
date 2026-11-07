import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { FolderPlus, Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import { Modal, PageEmpty, PageError, PageLoading } from '../components/PageState.jsx'
import { PageHeader } from '../components/PageHeader.jsx'

const CATEGORY_NAME_MIN = 2
const CATEGORY_NAME_MAX = 40

/** Rapikan nama: buang spasi di awal/akhir dan spasi ganda. */
function normalizeCategoryName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function validateCategoryName(name, categories, currentId) {
  if (!name) return 'Nama kategori wajib diisi.'
  if (name.length < CATEGORY_NAME_MIN) return `Nama kategori minimal ${CATEGORY_NAME_MIN} karakter.`
  if (name.length > CATEGORY_NAME_MAX) return `Nama kategori maksimal ${CATEGORY_NAME_MAX} karakter.`
  const duplicate = categories.find((item) => item.id !== currentId && item.name.trim().toLocaleLowerCase('id') === name.toLocaleLowerCase('id'))
  if (duplicate) return `Kategori "${duplicate.name}" sudah ada.`
  return ''
}

function CategoryForm({ category, categories, cafeId, supabase, onCancel, onSaved }) {
  const [name, setName] = useState(category?.name || '')
  const [errorMessage, setErrorMessage] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    const trimmedName = normalizeCategoryName(name)
    setName(trimmedName)
    const validationError = validateCategoryName(trimmedName, categories, category?.id)
    setErrorMessage(validationError)
    if (validationError) return

    setSaving(true)
    const nextSortOrder = categories.reduce((max, item) => Math.max(max, Number(item.sort_order) || 0), 0) + 1
    const result = category
      ? await supabase.from('categories')
        .update({ name: trimmedName })
        .eq('id', category.id)
        .eq('cafe_id', cafeId)
        .select('id')
        .maybeSingle()
      : await supabase.from('categories')
        .insert({ cafe_id: cafeId, name: trimmedName, sort_order: nextSortOrder })
        .select('id')
        .maybeSingle()

    if (result.error || !result.data) {
      if (result.error) {
        setErrorMessage(result.error.code === '23505'
          ? 'Nama kategori ini sudah dipakai.'
          : `Kategori gagal disimpan: ${result.error.message}`)
      } else if (category) {
        const { data: existingCategory, error: lookupError } = await supabase
          .from('categories')
          .select('id')
          .eq('id', category.id)
          .eq('cafe_id', cafeId)
          .maybeSingle()

        setErrorMessage(lookupError
          ? `Kategori tidak berubah dan pemeriksaan gagal: ${lookupError.message}`
          : existingCategory
            ? 'Kategori ditemukan, tetapi Supabase menolak update melalui Row Level Security. Terapkan migrasi repair owner catalog.'
            : 'Kategori tidak ditemukan di cafe ini. Muat ulang daftar sebelum mencoba lagi.')
      } else {
        setErrorMessage('Kategori tidak dibuat. Periksa hak INSERT dan kebijakan Row Level Security kategori di Supabase.')
      }
      setSaving(false)
      return
    }
    setSaving(false)
    onSaved()
  }

  return (
    <form className="entity-form" onSubmit={handleSubmit} noValidate>
      <label className="form-field">
        <span>Nama kategori <b>*</b></span>
        <input
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            if (errorMessage) setErrorMessage('')
          }}
          onBlur={() => setName((current) => normalizeCategoryName(current))}
          maxLength={CATEGORY_NAME_MAX + 10}
          placeholder="Contoh: Kopi Susu"
          aria-invalid={errorMessage ? true : undefined}
          autoFocus
        />
        <small className="form-hint">{normalizeCategoryName(name).length}/{CATEGORY_NAME_MAX} karakter · nama tampil di menu customer</small>
      </label>
      {errorMessage && <div className="form-alert" role="alert">{errorMessage}</div>}
      <footer className="form-actions">
        <button type="button" className="button button-secondary" onClick={onCancel} disabled={saving}>Batal</button>
        <button type="submit" className="button button-primary" disabled={saving}>
          {saving ? 'Menyimpan...' : category ? 'Simpan perubahan' : 'Tambah kategori'}
        </button>
      </footer>
    </form>
  )
}

export function CategoriesPage() {
  const { cafe } = useOutletContext()
  const { supabase } = useAuth()
  const [categories, setCategories] = useState([])
  const [productCounts, setProductCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [editingCategory, setEditingCategory] = useState(undefined)
  const [notice, setNotice] = useState('')
  const [deletingId, setDeletingId] = useState('')

  const loadCategories = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    const [categoryResult, productResult] = await Promise.all([
      supabase.from('categories')
        .select('id, cafe_id, name, sort_order, created_at')
        .eq('cafe_id', cafe.id)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      supabase.from('products')
        .select('category_id')
        .eq('cafe_id', cafe.id),
    ])

    if (categoryResult.error || productResult.error) {
      const error = categoryResult.error || productResult.error
      setLoadError(`Kategori gagal dimuat: ${error.message}`)
      setLoading(false)
      return
    }

    const counts = (productResult.data || []).reduce((result, product) => {
      result[product.category_id] = (result[product.category_id] || 0) + 1
      return result
    }, {})
    setCategories(categoryResult.data || [])
    setProductCounts(counts)
    setLoading(false)
  }, [cafe.id, supabase])

  useEffect(() => {
    const timer = window.setTimeout(loadCategories, 0)
    return () => window.clearTimeout(timer)
  }, [attempt, loadCategories])

  async function deleteCategory(category) {
    const linkedProducts = productCounts[category.id] || 0
    if (linkedProducts) {
      setNotice(`"${category.name}" belum bisa dihapus karena masih memiliki ${linkedProducts} produk. Pindahkan produk ke kategori lain terlebih dahulu.`)
      return
    }
    if (!window.confirm(`Hapus kategori "${category.name}"?`)) return

    setNotice('')
    setDeletingId(category.id)
    const { data, error } = await supabase.from('categories')
      .delete()
      .eq('id', category.id)
      .eq('cafe_id', cafe.id)
      .select('id')
      .maybeSingle()

    if (error || !data) {
      setNotice(error
        ? `Kategori gagal dihapus: ${error.message}`
        : 'Kategori tidak terhapus. Periksa kembali hak DELETE dan kebijakan akses di Supabase.')
    } else {
      setCategories((current) => current.filter((item) => item.id !== category.id))
    }
    setDeletingId('')
  }

  function handleSaved() {
    setEditingCategory(undefined)
    setAttempt((value) => value + 1)
  }

  return (
    <div className="dashboard-content entity-page">
      <PageHeader
        eyebrow="KATALOG"
        title="Kategori"
        description="Kelompokkan produk agar menu cafe lebih mudah dijelajahi."
        actions={(
          <button type="button" className="button button-primary" onClick={() => setEditingCategory(null)}>
            <Plus size={16} /> Tambah kategori
          </button>
        )}
      />

      {notice && <div className="inline-alert entity-alert" role="alert"><span>{notice}</span><button type="button" onClick={() => setNotice('')}>Tutup</button></div>}

      {loading ? (
        <PageLoading label="Memuat kategori..." />
      ) : loadError ? (
        <PageError message={loadError} onRetry={() => setAttempt((value) => value + 1)} />
      ) : !categories.length ? (
        <PageEmpty
          title="Belum ada kategori"
          description="Buat kategori pertama, misalnya Kopi, Non-kopi, atau Pastry."
          action={<button className="button button-primary" type="button" onClick={() => setEditingCategory(null)}><FolderPlus size={15} /> Buat kategori</button>}
        />
      ) : (
        <section className="category-grid" aria-label="Daftar kategori">
          {categories.map((category) => (
            <article className="category-card" key={category.id}>
              <span className="category-icon"><Tag size={18} /></span>
              <div className="category-info">
                <h2>{category.name}</h2>
                <p>{productCounts[category.id] || 0} produk</p>
              </div>
              <div className="category-actions">
                <button className="icon-button" type="button" aria-label={`Edit ${category.name}`} onClick={() => setEditingCategory(category)}>
                  <Pencil size={15} />
                </button>
                <button className="icon-button product-delete-button" type="button" aria-label={`Hapus ${category.name}`} disabled={deletingId === category.id} onClick={() => deleteCategory(category)}>
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {editingCategory !== undefined && (
        <Modal
          title={editingCategory ? 'Edit kategori' : 'Tambah kategori'}
          description="Kategori hanya berlaku untuk cafe ini."
          onClose={() => setEditingCategory(undefined)}
        >
          <CategoryForm
            key={editingCategory?.id || 'new-category'}
            category={editingCategory}
            categories={categories}
            cafeId={cafe.id}
            supabase={supabase}
            onCancel={() => setEditingCategory(undefined)}
            onSaved={handleSaved}
          />
        </Modal>
      )}
    </div>
  )
}
