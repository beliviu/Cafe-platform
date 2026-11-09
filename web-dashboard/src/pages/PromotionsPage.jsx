import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ImagePlus, Megaphone, Pencil, Plus, Trash2 } from 'lucide-react'
import { useOutletContext } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, PageHeader, useToast } from '../components/ui/index.js'

const BUCKET = 'cafe-banners'
const MAX_FILE_SIZE = 8 * 1024 * 1024
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const DEFAULT_FORM = {
  title: '',
  subtitle: '',
  cta_label: '',
  destination_type: 'menu',
  destination_id: '',
  destination_path: '',
  starts_at: '',
  ends_at: '',
  is_active: false,
  sort_order: 0,
  image_path: '',
}

function jakartaInput(value) {
  if (!value) return ''
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value)).map(({ type, value: part }) => [type, part]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

function jakartaTimestamp(value) {
  return value ? new Date(`${value}:00+07:00`).toISOString() : null
}

function bannerDestination(banner) {
  if (banner.destination_type === 'product') return `/product/${banner.destination_id}?cafeId=${banner.cafe_id}`
  if (banner.destination_type === 'category') return `/menu?categoryId=${banner.destination_id}`
  if (banner.destination_type === 'vouchers') return '/vouchers'
  if (banner.destination_type === 'custom') return banner.destination_path
  return '/menu'
}

function bannerImageUrl(supabase, path) {
  return path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : ''
}

function formatSchedule(banner) {
  const format = (value) => value
    ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value))
    : null
  if (!banner.starts_at && !banner.ends_at) return 'Tanpa jadwal'
  if (banner.starts_at && banner.ends_at) return `${format(banner.starts_at)} – ${format(banner.ends_at)} WIB`
  return banner.starts_at ? `Mulai ${format(banner.starts_at)} WIB` : `Berakhir ${format(banner.ends_at)} WIB`
}

export function PromotionsPage() {
  const { cafe } = useOutletContext()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [banners, setBanners] = useState([])
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [form, setForm] = useState(DEFAULT_FORM)
  const [editingId, setEditingId] = useState(null)
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState('')
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const fileInput = useRef(null)
  const objectUrl = useRef('')

  const releasePreview = useCallback(() => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = ''
  }, [])

  useEffect(() => releasePreview, [releasePreview])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [bannerResult, productResult, categoryResult] = await Promise.all([
      supabase.from('promotional_banners').select('*').eq('cafe_id', cafe.id).order('sort_order').order('created_at', { ascending: false }),
      supabase.from('products').select('id, name').eq('cafe_id', cafe.id).order('name'),
      supabase.from('categories').select('id, name').eq('cafe_id', cafe.id).order('name'),
    ])
    const failure = bannerResult.error || productResult.error || categoryResult.error
    if (failure) {
      setError(failure.message)
      setLoading(false)
      return
    }
    setBanners(bannerResult.data || [])
    setProducts(productResult.data || [])
    setCategories(categoryResult.data || [])
    setLoading(false)
  }, [cafe.id, supabase])

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  function resetForm() {
    releasePreview()
    setForm(DEFAULT_FORM)
    setEditingId(null)
    setImageFile(null)
    setImagePreview('')
    setFormError('')
  }

  function editBanner(banner) {
    releasePreview()
    setEditingId(banner.id)
    setImageFile(null)
    setImagePreview('')
    setForm({
      ...DEFAULT_FORM,
      ...banner,
      destination_id: banner.destination_id || '',
      destination_path: banner.destination_path || '',
      starts_at: jakartaInput(banner.starts_at),
      ends_at: jakartaInput(banner.ends_at),
    })
    setFormError('')
    document.getElementById('promotion-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function chooseImage(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setFormError('Pilih gambar JPG, PNG, atau WebP.')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setFormError('Ukuran gambar maksimal 8 MB.')
      return
    }
    releasePreview()
    objectUrl.current = URL.createObjectURL(file)
    setImagePreview(objectUrl.current)
    setImageFile(file)
    setFormError('')
  }

  function setDestinationType(destination_type) {
    const destination_id = destination_type === 'product'
      ? products[0]?.id || ''
      : destination_type === 'category'
        ? categories[0]?.id || ''
        : ''
    setForm((current) => ({ ...current, destination_type, destination_id }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError('')
    if (!form.title.trim()) return setFormError('Judul banner wajib diisi.')
    if (!imageFile && !form.image_path) return setFormError('Tambahkan gambar banner terlebih dahulu.')
    if (form.destination_type === 'product' && !form.destination_id) return setFormError('Pilih produk tujuan.')
    if (form.destination_type === 'category' && !form.destination_id) return setFormError('Pilih kategori tujuan.')
    if (form.destination_type === 'custom' && (!form.destination_path.startsWith('/') || form.destination_path.startsWith('//'))) {
      return setFormError('Tujuan kustom harus berupa path internal yang dimulai dengan satu garis miring.')
    }
    if (form.starts_at && form.ends_at && new Date(`${form.ends_at}:00+07:00`) <= new Date(`${form.starts_at}:00+07:00`)) {
      return setFormError('Waktu berakhir harus setelah waktu mulai.')
    }

    setSaving(true)
    let uploadedPath = ''
    try {
      let image_path = form.image_path
      if (imageFile) {
        const extension = imageFile.type === 'image/png' ? 'png' : imageFile.type === 'image/webp' ? 'webp' : 'jpg'
        uploadedPath = `${cafe.id}/${crypto.randomUUID()}.${extension}`
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(uploadedPath, imageFile, {
          cacheControl: '31536000',
          contentType: imageFile.type,
          upsert: false,
        })
        if (uploadError) throw new Error(`Gambar gagal diunggah: ${uploadError.message}`)
        image_path = uploadedPath
      }

      const payload = {
        cafe_id: cafe.id,
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || null,
        image_path,
        cta_label: form.cta_label.trim() || null,
        destination_type: form.destination_type,
        destination_id: ['product', 'category'].includes(form.destination_type) ? form.destination_id : null,
        destination_path: form.destination_type === 'custom' ? form.destination_path.trim() : null,
        starts_at: jakartaTimestamp(form.starts_at),
        ends_at: jakartaTimestamp(form.ends_at),
        is_active: form.is_active,
        sort_order: Number(form.sort_order) || 0,
      }
      const result = editingId
        ? await supabase.from('promotional_banners').update(payload).eq('id', editingId).eq('cafe_id', cafe.id).select().single()
        : await supabase.from('promotional_banners').insert(payload).select().single()
      if (result.error) throw new Error(`Banner gagal disimpan: ${result.error.message}`)

      if (uploadedPath && form.image_path) {
        const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([form.image_path])
        if (cleanupError) toast({ tone: 'error', title: 'Banner tersimpan, gambar lama belum terhapus', description: cleanupError.message })
      }
      toast({ tone: 'success', title: editingId ? 'Banner diperbarui' : 'Banner dibuat' })
      resetForm()
      await load()
    } catch (caught) {
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([uploadedPath])
        if (cleanupError) toast({ tone: 'error', title: 'Gambar sementara belum terhapus', description: cleanupError.message })
      }
      setFormError(caught.message)
    } finally {
      setSaving(false)
    }
    return undefined
  }

  async function toggleActive(banner) {
    const { error: updateError } = await supabase.from('promotional_banners')
      .update({ is_active: !banner.is_active })
      .eq('id', banner.id)
      .eq('cafe_id', cafe.id)
    if (updateError) {
      toast({ tone: 'error', title: 'Status banner gagal diubah', description: updateError.message })
      return
    }
    await load()
    toast({ tone: 'success', title: banner.is_active ? 'Banner dinonaktifkan' : 'Banner diaktifkan' })
  }

  async function moveBanner(index, direction) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= banners.length) return
    const current = banners[index]
    const sibling = banners[nextIndex]
    const [first, second] = await Promise.all([
      supabase.from('promotional_banners').update({ sort_order: sibling.sort_order }).eq('id', current.id).eq('cafe_id', cafe.id),
      supabase.from('promotional_banners').update({ sort_order: current.sort_order }).eq('id', sibling.id).eq('cafe_id', cafe.id),
    ])
    const failure = first.error || second.error
    if (failure) {
      toast({ tone: 'error', title: 'Urutan banner gagal disimpan', description: failure.message })
      await load()
      return
    }
    await load()
  }

  async function deleteBanner() {
    const target = banners.find((banner) => banner.id === deleting)
    if (!target) return
    const { error: deleteError } = await supabase.from('promotional_banners').delete().eq('id', target.id).eq('cafe_id', cafe.id)
    if (deleteError) throw new Error(`Banner gagal dihapus: ${deleteError.message}`)
    const { error: imageError } = await supabase.storage.from(BUCKET).remove([target.image_path])
    if (imageError) toast({ tone: 'error', title: 'Banner terhapus, gambar belum dibersihkan', description: imageError.message })
    setDeleting(null)
    if (editingId === target.id) resetForm()
    await load()
    toast({ tone: 'success', title: 'Banner dihapus' })
  }

  const selectedProduct = products.find((product) => product.id === form.destination_id)
  const selectedCategory = categories.find((category) => category.id === form.destination_id)
  const previewImage = imagePreview || bannerImageUrl(supabase, form.image_path)

  return (
    <div className="page promotions-page">
      <PageHeader
        eyebrow={cafe.name}
        title="Promosi untuk pelanggan"
        description="Atur cerita dan menu unggulan yang tampil di beranda aplikasi customer."
        actions={<Button icon={Plus} onClick={resetForm}>Banner baru</Button>}
      />

      {error ? <Card><ErrorState message={error} onRetry={load} /></Card> : null}

      <div className="promotion-layout">
        <Card as="form" id="promotion-editor" className="promotion-editor" onSubmit={handleSubmit}>
          <CardHeader
            title={editingId ? 'Edit banner' : 'Buat banner'}
            description="Pakai foto menu atau suasana cafe milikmu. Gambar tampil dengan crop cover."
            actions={editingId ? <Button variant="ghost" size="sm" onClick={resetForm}>Batal edit</Button> : null}
          />

          <button type="button" className={`promotion-upload${previewImage ? ' has-image' : ''}`} onClick={() => fileInput.current?.click()}>
            {previewImage
              ? <img src={previewImage} alt="Pratinjau gambar banner" />
              : <span className="promotion-upload-empty"><ImagePlus size={25} /><strong>Pilih foto banner</strong><small>JPG, PNG, atau WebP · maks. 8 MB</small></span>}
            <span className="promotion-upload-edit">{previewImage ? 'Ganti gambar' : 'Pilih gambar'}</span>
          </button>
          <input ref={fileInput} className="sr-only" type="file" accept={ACCEPTED_TYPES.join(',')} onChange={chooseImage} />

          <label className="promotion-field">
            <span>Judul promosi</span>
            <input value={form.title} maxLength={80} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Contoh: Es kopi favorit, lebih dekat" />
          </label>
          <label className="promotion-field">
            <span>Subjudul <small>Opsional</small></span>
            <textarea value={form.subtitle} maxLength={180} rows={2} onChange={(event) => setForm((current) => ({ ...current, subtitle: event.target.value }))} placeholder="Ceritakan singkat kenapa menu ini istimewa." />
          </label>

          <div className="promotion-form-grid">
            <label className="promotion-field">
              <span>Teks tombol <small>Opsional</small></span>
              <input value={form.cta_label} maxLength={32} onChange={(event) => setForm((current) => ({ ...current, cta_label: event.target.value }))} placeholder="Lihat menu" />
            </label>
            <label className="promotion-field">
              <span>Tujuan</span>
              <select value={form.destination_type} onChange={(event) => setDestinationType(event.target.value)}>
                <option value="menu">Buka menu</option>
                <option value="product">Produk tertentu</option>
                <option value="category">Kategori menu</option>
                <option value="vouchers">Voucher & promosi</option>
                <option value="custom">Path internal</option>
              </select>
            </label>
          </div>
          {form.destination_type === 'product' ? (
            <label className="promotion-field">
              <span>Produk tujuan</span>
              <select value={form.destination_id} onChange={(event) => setForm((current) => ({ ...current, destination_id: event.target.value }))}>
                {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </label>
          ) : null}
          {form.destination_type === 'category' ? (
            <label className="promotion-field">
              <span>Kategori tujuan</span>
              <select value={form.destination_id} onChange={(event) => setForm((current) => ({ ...current, destination_id: event.target.value }))}>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
          ) : null}
          {form.destination_type === 'custom' ? (
            <label className="promotion-field">
              <span>Path internal</span>
              <input value={form.destination_path} onChange={(event) => setForm((current) => ({ ...current, destination_path: event.target.value }))} placeholder="/vouchers" />
            </label>
          ) : null}

          <div className="promotion-form-grid">
            <label className="promotion-field">
              <span>Tayang mulai <small>WIB</small></span>
              <input type="datetime-local" value={form.starts_at} onChange={(event) => setForm((current) => ({ ...current, starts_at: event.target.value }))} />
            </label>
            <label className="promotion-field">
              <span>Tayang sampai <small>WIB</small></span>
              <input type="datetime-local" value={form.ends_at} onChange={(event) => setForm((current) => ({ ...current, ends_at: event.target.value }))} />
            </label>
          </div>
          <label className="promotion-field promotion-order">
            <span>Urutan tampil</span>
            <input type="number" step="1" value={form.sort_order} onChange={(event) => setForm((current) => ({ ...current, sort_order: event.target.value }))} />
          </label>
          <label className="promotion-toggle">
            <input type="checkbox" checked={form.is_active} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} />
            <span><strong>Aktifkan banner</strong><small>Banner hanya tampil saat jadwalnya berlaku.</small></span>
          </label>

          {formError ? <p className="ui-field-error" role="alert">{formError}</p> : null}
          <Button type="submit" loading={saving} disabled={loading}>{editingId ? 'Simpan perubahan' : 'Simpan banner'}</Button>
        </Card>

        <div className="promotion-aside">
          <Card className="promotion-preview-card">
            <CardHeader title="Pratinjau" description="Tampilan banner di beranda customer." />
            {previewImage ? (
              <div className="promotion-preview">
                <img src={previewImage} alt="" />
                <span className="promotion-preview-shade" />
                <span className="promotion-preview-copy">
                  <small>{cafe.app_name || cafe.name}</small>
                  <strong>{form.title || 'Judul promosi'}</strong>
                  {form.subtitle ? <span>{form.subtitle}</span> : null}
                  {form.cta_label ? <i>{form.cta_label}</i> : null}
                </span>
              </div>
            ) : <EmptyState compact icon={Megaphone} title="Pratinjau banner" description="Pilih foto dan isi judul untuk melihat komposisi." />}
            <p className="promotion-destination">
              Tujuan: {selectedProduct?.name || selectedCategory?.name || (form.destination_type === 'custom' ? form.destination_path || 'Path internal' : form.destination_type === 'vouchers' ? 'Voucher & promosi' : 'Menu')}
            </p>
          </Card>

          <Card className="promotion-list-card">
            <CardHeader title="Banner tersimpan" description={`${banners.length} banner · urutan paling kecil tampil lebih dulu`} />
            {loading ? <div className="promotion-list-loading">Memuat banner…</div> : banners.length ? (
              <ol className="promotion-list">
                {banners.map((banner, index) => (
                  <li key={banner.id} className="promotion-list-item">
                    <img src={bannerImageUrl(supabase, banner.image_path)} alt="" />
                    <span className="promotion-list-copy">
                      <strong>{banner.title}</strong>
                      <small>{formatSchedule(banner)}</small>
                      <small>{banner.is_active ? 'Aktif' : 'Draft'} · {bannerDestination(banner)}</small>
                    </span>
                    <span className="promotion-list-actions">
                      <button type="button" aria-label="Naikkan urutan" disabled={index === 0} onClick={() => moveBanner(index, -1)}><ArrowUp size={15} /></button>
                      <button type="button" aria-label="Turunkan urutan" disabled={index === banners.length - 1} onClick={() => moveBanner(index, 1)}><ArrowDown size={15} /></button>
                      <button type="button" aria-label={`Edit ${banner.title}`} onClick={() => editBanner(banner)}><Pencil size={15} /></button>
                      <button type="button" aria-label={`Hapus ${banner.title}`} onClick={() => setDeleting(banner.id)}><Trash2 size={15} /></button>
                    </span>
                    <button type="button" className={`promotion-status${banner.is_active ? ' is-active' : ''}`} onClick={() => toggleActive(banner)}>
                      {banner.is_active ? 'Aktif' : 'Draft'}
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState compact icon={Megaphone} title="Belum ada banner" description="Buat banner pertama untuk menampilkan promo dan menu pilihan di aplikasi customer." />
            )}
          </Card>
        </div>
      </div>

      {deleting ? (
        <ConfirmDialog
          title="Hapus banner?"
          description="Banner dan gambar promosinya akan dihapus permanen. Pesanan dan data menu tidak terpengaruh."
          confirmLabel="Hapus banner"
          onConfirm={deleteBanner}
          onClose={() => setDeleting(null)}
          alternative={{
            label: 'Nonaktifkan saja',
            onClick: async () => {
              const target = banners.find((banner) => banner.id === deleting)
              if (!target) return
              const { error: updateError } = await supabase.from('promotional_banners').update({ is_active: false }).eq('id', target.id).eq('cafe_id', cafe.id)
              if (updateError) throw new Error(updateError.message)
              setDeleting(null)
              await load()
            },
          }}
        />
      ) : null}
    </div>
  )
}
