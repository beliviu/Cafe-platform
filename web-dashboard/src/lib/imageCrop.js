/* Potong gambar (foto produk, logo) di browser sebelum diunggah. */
export const PRODUCT_IMAGE_SIZE = 800
export const LOGO_IMAGE_SIZE = 512

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Gambar tidak dapat dibaca.'))
    image.src = src
  })
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Potong area terpilih jadi persegi `size`×`size` (WebP, fallback JPEG/PNG).
 * transparent = true mempertahankan latar transparan (logo); fallback-nya PNG, bukan JPEG.
 */
export async function cropToFile(src, area, { size = PRODUCT_IMAGE_SIZE, baseName = 'produk', transparent = false } = {}) {
  const image = await loadImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  context.imageSmoothingQuality = 'high'
  if (!transparent) {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, size, size)
  }
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, size, size)
  let blob = await canvasToBlob(canvas, 'image/webp', 0.88)
  let type = 'image/webp'
  if (!blob || blob.type !== 'image/webp') {
    type = transparent ? 'image/png' : 'image/jpeg'
    blob = await canvasToBlob(canvas, type, 0.88)
  }
  if (!blob) throw new Error('Gambar gagal diproses.')
  const extension = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }[type]
  return new File([blob], `${baseName}.${extension}`, { type })
}
