/*
 * Aksi tulis katalog produk (owner). Kolom yang ditulis — semuanya kolom yang SUDAH ADA:
 *   products: name, description, price, category_id, image_url, is_available (insert/update), baris (delete)
 *   storage bucket product-images: unggah foto baru, hapus foto lama
 */
import { friendlyError } from './db.js'

export const PRODUCT_COLUMNS = 'id, cafe_id, category_id, name, description, price, image_url, is_available, created_at'
const BUCKET = 'product-images'

export function productImagePath(imageUrl) {
  if (!imageUrl) return null
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const index = imageUrl.indexOf(marker)
  return index < 0 ? null : decodeURIComponent(imageUrl.slice(index + marker.length))
}

function productError(error, fallback) {
  if (error?.code === '23503') return 'Produk ini sudah pernah dipesan sehingga tidak bisa dihapus. Nonaktifkan saja agar tidak tampil di menu.'
  if (error?.code === '23505') return 'Nama produk ini sudah dipakai.'
  return friendlyError(error, fallback)
}

async function removeImage(supabase, imageUrl) {
  const path = productImagePath(imageUrl)
  if (!path) return null
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  return error
}

/**
 * Simpan produk (baru atau edit). imageFile opsional (sudah di-crop).
 * Mengembalikan { product, warning }.
 */
export async function saveProduct(supabase, { cafeId, product, values, imageFile, removeExistingImage = false }) {
  let imageUrl = removeExistingImage ? null : product?.image_url || null
  let uploadedPath = null

  if (imageFile) {
    const extension = imageFile.type === 'image/webp' ? 'webp' : imageFile.type === 'image/png' ? 'png' : 'jpg'
    uploadedPath = `${cafeId}/${crypto.randomUUID()}.${extension}`
    const { error } = await supabase.storage.from(BUCKET).upload(uploadedPath, imageFile, {
      cacheControl: '3600',
      contentType: imageFile.type,
      upsert: false,
    })
    if (error) throw new Error(`Foto gagal diunggah: ${friendlyError(error)}`)
    imageUrl = supabase.storage.from(BUCKET).getPublicUrl(uploadedPath).data.publicUrl
  }

  const row = { ...values, cafe_id: cafeId, image_url: imageUrl }
  const result = product
    ? await supabase.from('products').update(row).eq('id', product.id).eq('cafe_id', cafeId).select(PRODUCT_COLUMNS).maybeSingle()
    : await supabase.from('products').insert(row).select(PRODUCT_COLUMNS).maybeSingle()

  if (result.error || !result.data) {
    if (uploadedPath) await supabase.storage.from(BUCKET).remove([uploadedPath])
    throw new Error(result.error
      ? productError(result.error, 'Produk gagal disimpan.')
      : 'Perubahan ditolak database. Muat ulang halaman lalu coba lagi.')
  }

  let warning = ''
  const replacedImage = product?.image_url && product.image_url !== result.data.image_url
  if (replacedImage) {
    const removeError = await removeImage(supabase, product.image_url)
    if (removeError) warning = 'Produk tersimpan, tetapi foto lama gagal dibersihkan dari penyimpanan.'
  }
  return { product: result.data, warning }
}

/** Ubah satu/lebih kolom sederhana (harga, ketersediaan). */
export async function patchProduct(supabase, cafeId, productId, patch) {
  const { data, error } = await supabase
    .from('products')
    .update(patch)
    .eq('id', productId)
    .eq('cafe_id', cafeId)
    .select(PRODUCT_COLUMNS)
    .maybeSingle()
  if (error) throw new Error(productError(error, 'Produk gagal diperbarui.'))
  if (!data) throw new Error('Perubahan ditolak database. Muat ulang halaman lalu coba lagi.')
  return data
}

export async function deleteProduct(supabase, cafeId, product) {
  const { data, error } = await supabase
    .from('products')
    .delete()
    .eq('id', product.id)
    .eq('cafe_id', cafeId)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(productError(error, 'Produk gagal dihapus.'))
  if (!data) throw new Error('Produk tidak terhapus. Akses hapus ditolak database.')
  const removeError = await removeImage(supabase, product.image_url)
  return removeError ? 'Produk terhapus, tetapi fotonya gagal dibersihkan dari penyimpanan.' : ''
}
