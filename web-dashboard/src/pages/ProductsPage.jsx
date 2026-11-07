import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { ImagePlus, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import { Modal, PageEmpty, PageError, PageLoading } from '../components/PageState.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { formatRupiah } from '../lib/format.js'

const EMPTY_FORM = {
  name: '',
  description: '',
  price: '',
  category_id: '',
  is_available: true,
  image_url: '',
}
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_IMAGE_SIZE = 5 * 1024 * 1024

function productImagePath(imageUrl) {
  if (!imageUrl) return null
  const marker = '/storage/v1/object/public/product-images/'
  const markerIndex = imageUrl.indexOf(marker)
  if (markerIndex < 0) return null
  return decodeURIComponent(imageUrl.slice(markerIndex + marker.length))
}

function ProductForm({ product, categories, cafeId, supabase, onCancel, onSaved }) {
  const [form, setForm] = useState(() => product ? {
    name: product.name,
    description: product.description || '',
    price: String(product.price),
    category_id: product.category_id,
    is_available: product.is_available,
    image_url: product.image_url || '',
  } : EMPTY_FORM)
  const [imageFile, setImageFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(product?.image_url || '')
  const [validationError, setValidationError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const fileInput = useRef(null)
  const previewObjectUrl = useRef(null)

  useEffect(() => {
    return () => {
      if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current)
    }
  }, [])

  function updateField(event) {
    const { name, value, checked, type } = event.target
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }))
  }

  function chooseImage(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setValidationError('Format gambar harus JPG, PNG, atau WebP.')
      return
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setValidationError('Ukuran gambar maksimal 5 MB.')
      return
    }
    setValidationError('')
    if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current)
    previewObjectUrl.current = URL.createObjectURL(file)
    setPreviewUrl(previewObjectUrl.current)
    setImageFile(file)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setValidationError('')
    setSaveError('')

    const normalizedName = form.name.trim()
    const parsedPrice = Number(form.price)
    if (!normalizedName) {
      setValidationError('Nama produk wajib diisi.')
      return
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0 || parsedPrice > 9999999999.99) {
      setValidationError('Masukkan harga yang valid dan tidak negatif.')
      return
    }
    if (Math.round(parsedPrice * 100) !== parsedPrice * 100) {
      setValidationError('Harga maksimal memiliki dua angka di belakang koma.')
      return
    }
    if (!form.category_id) {
      setValidationError('Pilih kategori produk.')
      return
    }

    setSaving(true)
    let imageUrl = form.image_url || null
    let uploadedImagePath = null

    if (imageFile) {
      const extension = imageFile.type === 'image/jpeg' ? 'jpg' : imageFile.type.split('/')[1]
      const imagePath = `${cafeId}/${crypto.randomUUID()}.${extension}`
      const { error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(imagePath, imageFile, {
          cacheControl: '3600',
          contentType: imageFile.type,
          upsert: false,
        })

      if (uploadError) {
        setSaveError(`Gambar gagal diunggah: ${uploadError.message}. Pastikan migrasi storage sudah diterapkan.`)
        setSaving(false)
        return
      }

      uploadedImagePath = imagePath
      const { data: publicUrl } = supabase.storage.from('product-images').getPublicUrl(imagePath)
      imageUrl = publicUrl.publicUrl
    }

    const values = {
      cafe_id: cafeId,
      category_id: form.category_id,
      name: normalizedName,
      description: form.description.trim() || null,
      price: parsedPrice,
      image_url: imageUrl,
      is_available: form.is_available,
    }

    const result = product
      ? await supabase.from('products')
        .update(values)
        .eq('id', product.id)
        .eq('cafe_id', cafeId)
        .select('id, price')
        .maybeSingle()
      : await supabase.from('products')
        .insert(values)
        .select('id')
        .maybeSingle()

    if (result.error || !result.data) {
      let cleanupMessage = ''
      if (uploadedImagePath) {
        const { error: cleanupError } = await supabase.storage
          .from('product-images')
          .remove([uploadedImagePath])
        if (cleanupError) cleanupMessage = ` Foto juga gagal dibersihkan: ${cleanupError.message}`
      }

      let message
      if (result.error) {
        const errorDetails = [
          result.error.code && `kode ${result.error.code}`,
          result.error.details,
          result.error.hint && `petunjuk: ${result.error.hint}`,
        ].filter(Boolean).join(' ')
        message = `Produk gagal disimpan: ${result.error.message}${errorDetails ? ` (${errorDetails})` : ''}.`
      } else if (product) {
        const { data: existingProduct, error: lookupError } = await supabase
          .from('products')
          .select('id')
          .eq('id', product.id)
          .eq('cafe_id', cafeId)
          .maybeSingle()

        if (lookupError) {
          message = `Update tidak mengembalikan produk dan pemeriksaan produk gagal: ${lookupError.message}.`
        } else if (existingProduct) {
          message = 'Produk ditemukan, tetapi Supabase menolak update melalui Row Level Security. Terapkan migrasi 20261107210600_fix_owner_product_update_policy.sql, lalu coba lagi.'
        } else {
          message = 'Produk dengan ID tersebut tidak ditemukan di cafe ini. Muat ulang daftar produk sebelum mencoba lagi.'
        }
      } else {
        message = 'Supabase tidak mengembalikan baris produk setelah insert. Periksa policy SELECT untuk owner serta policy INSERT di tabel products.'
      }

      setSaveError(`${message}${cleanupMessage}`)
      setSaving(false)
      return
    }

    if (product && Number(result.data.price) !== parsedPrice) {
      setSaveError(`Harga yang tersimpan (${formatRupiah(result.data.price)}) berbeda dari harga yang dimasukkan (${formatRupiah(parsedPrice)}).`)
      setSaving(false)
      return
    }

    if (product && imageFile && product.image_url) {
      const previousPath = productImagePath(product.image_url)
      if (previousPath) {
        const { error: removeError } = await supabase.storage.from('product-images').remove([previousPath])
        if (removeError) {
          const warning = `Produk tersimpan, tetapi gambar lama gagal dihapus: ${removeError.message}`
          setSaving(false)
          onSaved(warning)
          return
        }
      }
    }

    setSaving(false)
    onSaved()
  }

  return (
    <form className="entity-form" onSubmit={handleSubmit} noValidate>
      <div className="form-grid">
        <label className="form-field form-field-full">
          <span>Nama produk <b>*</b></span>
          <input
            name="name"
            value={form.name}
            onChange={updateField}
            maxLength={120}
            placeholder="Contoh: Es Kopi Susu"
            autoFocus
          />
        </label>

        <label className="form-field">
          <span>Harga (Rupiah) <b>*</b></span>
          <input
            name="price"
            type="number"
            min="0"
            max="9999999999.99"
            step="0.01"
            value={form.price}
            onChange={updateField}
            placeholder="28000"
          />
          <small className="field-hint">Masukkan nominal penuh, contoh Rp10.000 = 10000.</small>
        </label>

        <label className="form-field">
          <span>Kategori <b>*</b></span>
          <select name="category_id" value={form.category_id} onChange={updateField}>
            <option value="">Pilih kategori</option>
            {categories.map((category) => (
              <option value={category.id} key={category.id}>{category.name}</option>
            ))}
          </select>
        </label>

        <label className="form-field form-field-full">
          <span>Deskripsi</span>
          <textarea
            name="description"
            value={form.description}
            onChange={updateField}
            maxLength={1000}
            rows={3}
            placeholder="Jelaskan bahan atau karakter produk..."
          />
        </label>

        <div className="form-field form-field-full">
          <span>Foto produk</span>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={chooseImage}
          />
          {previewUrl ? (
            <div className="image-preview-row">
              <img src={previewUrl} alt="Pratinjau produk" />
              <div><strong>Foto produk</strong><span>JPG, PNG, atau WebP · maksimal 5 MB</span></div>
              <button type="button" className="button button-secondary" onClick={() => fileInput.current?.click()}>
                Ganti foto
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  setImageFile(null)
                  if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current)
                  previewObjectUrl.current = null
                  setPreviewUrl('')
                  setForm((current) => ({ ...current, image_url: '' }))
                }}
                aria-label="Hapus foto"
              >
                ×
              </button>
            </div>
          ) : (
            <button type="button" className="image-upload-button" onClick={() => fileInput.current?.click()}>
              <ImagePlus size={19} />
              <span><strong>Unggah foto</strong><small>JPG, PNG, WebP · maks. 5 MB</small></span>
            </button>
          )}
        </div>

        <label className="availability-toggle form-field-full">
          <span><strong>Tersedia untuk dipesan</strong><small>Produk tersedia di menu pelanggan.</small></span>
          <input
            name="is_available"
            type="checkbox"
            checked={form.is_available}
            onChange={updateField}
          />
        </label>
      </div>

      {(validationError || saveError) && (
        <div className="form-alert" role="alert">{validationError || saveError}</div>
      )}

      <footer className="form-actions">
        <button type="button" className="button button-secondary" onClick={onCancel} disabled={saving}>Batal</button>
        <button type="submit" className="button button-primary" disabled={saving}>
          {saving ? 'Menyimpan...' : product ? 'Simpan perubahan' : 'Tambah produk'}
        </button>
      </footer>
    </form>
  )
}

export function ProductsPage() {
  const { cafe } = useOutletContext()
  const { supabase } = useAuth()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [availabilityFilter, setAvailabilityFilter] = useState('all')
  const [editingProduct, setEditingProduct] = useState(undefined)
  const [notice, setNotice] = useState('')
  const [deletingId, setDeletingId] = useState('')
  const [updatingAvailability, setUpdatingAvailability] = useState('')

  const loadProducts = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    const [productResult, categoryResult] = await Promise.all([
      supabase.from('products')
        .select('id, cafe_id, category_id, name, description, price, image_url, is_available, created_at')
        .eq('cafe_id', cafe.id)
        .order('created_at', { ascending: false }),
      supabase.from('categories')
        .select('id, name')
        .eq('cafe_id', cafe.id)
        .order('name', { ascending: true }),
    ])

    if (productResult.error || categoryResult.error) {
      const error = productResult.error || categoryResult.error
      setLoadError(`Produk atau kategori gagal dimuat: ${error.message}`)
      setLoading(false)
      return
    }

    setProducts(productResult.data || [])
    setCategories(categoryResult.data || [])
    setLoading(false)
  }, [cafe.id, supabase])

  useEffect(() => {
    const timer = window.setTimeout(loadProducts, 0)
    return () => window.clearTimeout(timer)
  }, [attempt, loadProducts])

  const categoriesById = useMemo(
    () => Object.fromEntries(categories.map((category) => [category.id, category.name])),
    [categories],
  )
  const filteredProducts = useMemo(() => products.filter((product) => {
    const matchesQuery = product.name.toLowerCase().includes(query.trim().toLowerCase())
    const matchesCategory = categoryFilter === 'all' || product.category_id === categoryFilter
    const matchesAvailability = availabilityFilter === 'all'
      || (availabilityFilter === 'available' ? product.is_available : !product.is_available)
    return matchesQuery && matchesCategory && matchesAvailability
  }), [availabilityFilter, categoryFilter, products, query])

  async function toggleAvailability(product) {
    setNotice('')
    setUpdatingAvailability(product.id)
    const { data, error: updateError } = await supabase.from('products')
      .update({ is_available: !product.is_available })
      .eq('id', product.id)
      .eq('cafe_id', cafe.id)
      .select('id, is_available')
      .maybeSingle()

    if (updateError || !data) {
      setNotice(updateError
        ? `Status produk gagal diperbarui: ${updateError.message}`
        : 'Produk ditemukan, tetapi statusnya tidak berubah. Periksa kebijakan UPDATE produk di Supabase.')
    } else {
      setProducts((current) => current.map((item) => item.id === product.id
        ? { ...item, is_available: data.is_available }
        : item))
    }
    setUpdatingAvailability('')
  }

  async function deleteProduct(product) {
    const confirmed = window.confirm(
      `Hapus "${product.name}" dari katalog? Item dalam transaksi lama tetap tersimpan sebagai riwayat.`,
    )
    if (!confirmed) return

    setNotice('')
    setDeletingId(product.id)
    const { data, error } = await supabase.from('products')
      .delete()
      .eq('id', product.id)
      .eq('cafe_id', cafe.id)
      .select('id')
      .maybeSingle()

    if (error || !data) {
      setNotice(error
        ? `Produk gagal dihapus: ${error.message}`
        : 'Produk tidak terhapus. Periksa kembali hak DELETE dan kebijakan akses di Supabase.')
      setDeletingId('')
      return
    }

    const imagePath = productImagePath(product.image_url)
    if (imagePath) {
      const { error: imageError } = await supabase.storage.from('product-images').remove([imagePath])
      if (imageError) {
        setNotice(`Produk terhapus, tetapi foto gagal dihapus dari storage: ${imageError.message}`)
      }
    }
    setProducts((current) => current.filter((item) => item.id !== product.id))
    setDeletingId('')
  }

  function handleSaved(warning = '') {
    setEditingProduct(undefined)
    setNotice(warning)
    setAttempt((value) => value + 1)
  }

  return (
    <div className="dashboard-content entity-page">
      <PageHeader
        eyebrow="KATALOG"
        title="Produk"
        description="Atur menu, harga, dan ketersediaan produk cafe Anda."
        actions={(
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              if (!categories.length) {
                window.location.assign('/categories')
              } else {
                setEditingProduct(null)
              }
            }}
          >
            <Plus size={16} /> Tambah produk
          </button>
        )}
      />

      {notice && <div className="inline-alert entity-alert" role="alert"><span>{notice}</span><button type="button" onClick={() => setNotice('')}>Tutup</button></div>}

      <section className="entity-toolbar">
        <label className="search-field">
          <Search size={16} />
          <input
            type="search"
            placeholder="Cari produk..."
            aria-label="Cari produk"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select aria-label="Filter kategori" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          <option value="all">Semua kategori</option>
          {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
        </select>
        <select aria-label="Filter ketersediaan" value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value)}>
          <option value="all">Semua status</option>
          <option value="available">Tersedia</option>
          <option value="unavailable">Tidak tersedia</option>
        </select>
        <span className="entity-count">{filteredProducts.length} produk</span>
      </section>

      {loading ? (
        <PageLoading label="Memuat produk cafe..." />
      ) : loadError ? (
        <PageError message={loadError} onRetry={() => setAttempt((value) => value + 1)} />
      ) : !categories.length ? (
        <PageEmpty
          title="Buat kategori terlebih dahulu"
          description="Produk perlu ditempatkan dalam kategori. Tambahkan kategori pertama untuk mulai membuat katalog."
          action={<a className="button button-primary" href="/categories"><Plus size={15} /> Tambah kategori</a>}
        />
      ) : !filteredProducts.length ? (
        <PageEmpty
          title={products.length ? 'Produk tidak ditemukan' : 'Belum ada produk'}
          description={products.length ? 'Coba ubah kata pencarian atau filter.' : 'Tambahkan produk pertama untuk mengisi menu cafe Anda.'}
          action={!products.length && <button className="button button-primary" type="button" onClick={() => setEditingProduct(null)}><Plus size={15} /> Tambah produk</button>}
        />
      ) : (
        <section className="product-grid" aria-label="Daftar produk">
          {filteredProducts.map((product) => (
            <article className="product-card" key={product.id}>
              <div className="product-image-wrap">
                {product.image_url ? (
                  <img className="product-image" src={product.image_url} alt={product.name} loading="lazy" />
                ) : (
                  <div className="product-image-placeholder"><ImagePlus size={24} /></div>
                )}
                <span className={`availability-badge${product.is_available ? '' : ' unavailable'}`}>
                  <i /> {product.is_available ? 'Tersedia' : 'Disembunyikan'}
                </span>
                <button className="product-menu-button" type="button" aria-label={`Edit ${product.name}`} onClick={() => setEditingProduct(product)}>
                  <Pencil size={14} />
                </button>
              </div>
              <div className="product-card-body">
                <span className="product-category">{categoriesById[product.category_id] || 'Tanpa kategori'}</span>
                <h2>{product.name}</h2>
                <p>{product.description || 'Belum ada deskripsi produk.'}</p>
                <div className="product-card-footer">
                  <strong>{formatRupiah(product.price)}</strong>
                  <div className="product-actions">
                    <button
                      type="button"
                      className={`availability-switch${product.is_available ? ' checked' : ''}`}
                      role="switch"
                      aria-checked={product.is_available}
                      aria-label={`${product.is_available ? 'Sembunyikan' : 'Tampilkan'} ${product.name}`}
                      disabled={updatingAvailability === product.id || deletingId === product.id}
                      onClick={() => toggleAvailability(product)}
                    >
                      <span />
                    </button>
                    <button type="button" className="icon-button product-edit-button" aria-label={`Edit ${product.name}`} onClick={() => setEditingProduct(product)}>
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-button product-delete-button"
                      aria-label={`Hapus ${product.name}`}
                      disabled={deletingId === product.id}
                      onClick={() => deleteProduct(product)}
                    >
                      {deletingId === product.id ? <MoreHorizontal size={16} /> : <Trash2 size={15} />}
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {editingProduct !== undefined && (
        <Modal
          title={editingProduct ? 'Edit produk' : 'Tambah produk'}
          description="Informasi produk tersimpan untuk cafe ini."
          onClose={() => setEditingProduct(undefined)}
        >
          <ProductForm
            key={editingProduct?.id || 'new-product'}
            product={editingProduct}
            categories={categories}
            cafeId={cafe.id}
            supabase={supabase}
            onCancel={() => setEditingProduct(undefined)}
            onSaved={handleSaved}
          />
        </Modal>
      )}
    </div>
  )
}
