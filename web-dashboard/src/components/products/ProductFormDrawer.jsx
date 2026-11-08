import { useEffect, useRef, useState } from 'react'
import { Coffee, ImagePlus, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Badge, Button, Drawer, RupiahInput, Select, Switch, TextField } from '../ui/index.js'
import { formatRupiah } from '../../lib/format.js'
import { saveProduct } from '../../lib/products.js'
import { ImageCropDialog } from './ImageCropDialog.jsx'

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SOURCE_SIZE = 10 * 1024 * 1024
const NAME_MAX = 80
const DESCRIPTION_MAX = 280

/** Pratinjau kartu seperti di menu aplikasi customer. */
function CustomerPreview({ name, price, imageUrl, categoryName, description, available, bestSeller }) {
  return (
    <figure className="preview">
      <figcaption>Pratinjau di aplikasi customer</figcaption>
      <div className={`preview-card${available ? '' : ' is-unavailable'}`}>
        <div className="preview-image">
          {imageUrl ? <img src={imageUrl} alt="" /> : <span className="preview-image-empty"><Coffee size={30} aria-hidden="true" /></span>}
          {!available && <span className="preview-soldout">Habis</span>}
          {bestSeller && available && <span className="preview-best">Terlaris</span>}
        </div>
        <div className="preview-body">
          <small>{categoryName || 'Kategori'}</small>
          <strong className="preview-name">{name || 'Nama produk'}</strong>
          {description && <p>{description}</p>}
          <span className="preview-footer">
            <span className="tabular">{price === '' ? 'Rp —' : formatRupiah(price)}</span>
            <span className="preview-add" aria-hidden="true"><Plus size={16} /></span>
          </span>
        </div>
      </div>
    </figure>
  )
}

export function ProductFormDrawer({ product, categories, cafeId, bestSeller, onClose, onSaved, onDelete }) {
  const { supabase } = useAuth()
  const [form, setForm] = useState(() => ({
    name: product?.name || '',
    description: product?.description || '',
    price: product ? Math.round(Number(product.price) || 0) : '',
    category_id: product?.category_id || (categories.length === 1 ? categories[0].id : ''),
    is_available: product ? product.is_available : true,
  }))
  const [imageFile, setImageFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(product?.image_url || '')
  const [removeImage, setRemoveImage] = useState(false)
  const [cropSource, setCropSource] = useState(null)
  const [errors, setErrors] = useState({})
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const fileInput = useRef(null)
  const objectUrls = useRef([])

  useEffect(() => () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url)), [])

  function trackUrl(file) {
    const url = URL.createObjectURL(file)
    objectUrls.current.push(url)
    return url
  }

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: '' }))
    setSaveError('')
  }

  function chooseImage(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setErrors((current) => ({ ...current, image: 'Format foto harus JPG, PNG, atau WebP.' }))
      return
    }
    if (file.size > MAX_SOURCE_SIZE) {
      setErrors((current) => ({ ...current, image: 'Ukuran foto maksimal 10 MB.' }))
      return
    }
    setErrors((current) => ({ ...current, image: '' }))
    setCropSource(trackUrl(file))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const name = form.name.replace(/\s+/g, ' ').trim()
    const nextErrors = {}
    if (name.length < 2) nextErrors.name = 'Nama produk minimal 2 karakter.'
    if (form.price === '') nextErrors.price = 'Harga wajib diisi.'
    if (!form.category_id) nextErrors.category_id = 'Pilih kategori.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    setSaving(true)
    setSaveError('')
    try {
      const result = await saveProduct(supabase, {
        cafeId,
        product,
        imageFile,
        removeExistingImage: removeImage && !imageFile,
        values: {
          name,
          description: form.description.trim() || null,
          price: form.price,
          category_id: form.category_id,
          is_available: form.is_available,
        },
      })
      onSaved(result, product ? 'updated' : 'created')
    } catch (caught) {
      setSaveError(caught.message)
      setSaving(false)
    }
  }

  const categoryName = categories.find((category) => category.id === form.category_id)?.name

  return (
    <>
      <Drawer
        size="lg"
        title={product ? 'Edit produk' : 'Tambah produk'}
        description={product ? 'Perubahan langsung tampil di menu customer setelah disimpan.' : 'Produk baru langsung muncul di menu customer bila tersedia.'}
        onClose={saving ? undefined : onClose}
        dismissible={!saving}
        className="product-drawer"
        footer={(
          <>
            {product && onDelete && (
              <Button variant="danger-soft" icon={Trash2} onClick={() => onDelete(product)} disabled={saving} className="product-drawer-delete">Hapus</Button>
            )}
            <Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button>
            <Button type="submit" form="product-form" loading={saving}>{product ? 'Simpan perubahan' : 'Tambah produk'}</Button>
          </>
        )}
      >
        <div className="product-form-layout">
          <form id="product-form" className="product-form" onSubmit={handleSubmit} noValidate>
            <div className="product-photo">
              <span className="ui-field-label">Foto produk</span>
              <input ref={fileInput} className="sr-only" type="file" accept={ACCEPTED_TYPES.join(',')} onChange={chooseImage} tabIndex={-1} />
              {previewUrl ? (
                <div className="product-photo-row">
                  <img src={previewUrl} alt="Foto produk saat ini" />
                  <div className="product-photo-actions">
                    <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => fileInput.current?.click()}>Ganti foto</Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={X}
                      onClick={() => {
                        setImageFile(null)
                        setPreviewUrl('')
                        setRemoveImage(true)
                      }}
                    >
                      Hapus foto
                    </Button>
                    <small>Persegi 1:1 · otomatis dikompres</small>
                  </div>
                </div>
              ) : (
                <button type="button" className="product-photo-empty" onClick={() => fileInput.current?.click()}>
                  <ImagePlus size={22} aria-hidden="true" />
                  <span><strong>Unggah foto</strong><small>JPG, PNG, atau WebP · maks. 10 MB · dipotong persegi</small></span>
                </button>
              )}
              {errors.image && <p className="ui-field-error" role="alert">{errors.image}</p>}
            </div>

            <TextField
              label="Nama produk"
              value={form.name}
              onChange={(event) => setField('name', event.target.value)}
              onBlur={() => setField('name', form.name.replace(/\s+/g, ' ').trim())}
              maxLength={NAME_MAX}
              placeholder="mis. Es Kopi Susu Gula Aren"
              error={errors.name}
              autoFocus={!product}
            />
            <div className="product-form-row">
              <RupiahInput label="Harga" value={form.price} onChange={(value) => setField('price', value)} placeholder="25.000" error={errors.price} />
              <Select
                label="Kategori"
                value={form.category_id}
                onChange={(event) => setField('category_id', event.target.value)}
                error={errors.category_id}
                options={[{ value: '', label: 'Pilih kategori' }, ...categories.map((category) => ({ value: category.id, label: category.name }))]}
              />
            </div>
            <TextField
              label="Deskripsi (opsional)"
              multiline
              rows={3}
              value={form.description}
              onChange={(event) => setField('description', event.target.value)}
              maxLength={DESCRIPTION_MAX}
              placeholder="Bahan, rasa, atau ukuran. mis. Espresso, susu segar, gula aren."
              hint={`${form.description.length}/${DESCRIPTION_MAX} karakter`}
            />
            <div className="product-availability">
              <span>
                <strong>Ketersediaan</strong>
                <small>{form.is_available ? 'Bisa dipesan customer.' : 'Tampil abu-abu dengan label "Habis", tidak bisa dipesan.'}</small>
              </span>
              <Switch checked={form.is_available} onChange={(value) => setField('is_available', value)} label="Produk tersedia" onLabel="Tersedia" offLabel="Habis" />
            </div>
            {saveError && <p className="form-error-box" role="alert">{saveError}</p>}
          </form>

          <aside className="product-form-preview">
            <CustomerPreview
              name={form.name.trim()}
              price={form.price}
              imageUrl={previewUrl}
              categoryName={categoryName}
              description={form.description.trim()}
              available={form.is_available}
              bestSeller={bestSeller}
            />
            {bestSeller && <Badge tone="amber" dot={false}>Terlaris otomatis · 3 teratas 30 hari terakhir</Badge>}
          </aside>
        </div>
      </Drawer>

      {cropSource && (
        <ImageCropDialog
          src={cropSource}
          onCancel={() => setCropSource(null)}
          onDone={(file) => {
            setImageFile(file)
            setPreviewUrl(trackUrl(file))
            setRemoveImage(false)
            setCropSource(null)
          }}
        />
      )}
    </>
  )
}
