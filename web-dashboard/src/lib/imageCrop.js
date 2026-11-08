/* Potong foto produk di browser sebelum diunggah. */
export const PRODUCT_IMAGE_SIZE = 800

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

/** Potong area terpilih jadi persegi 800×800 (WebP, fallback JPEG). */
export async function cropToFile(src, area, baseName = 'produk') {
  const image = await loadImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = PRODUCT_IMAGE_SIZE
  canvas.height = PRODUCT_IMAGE_SIZE
  const context = canvas.getContext('2d')
  context.imageSmoothingQuality = 'high'
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, PRODUCT_IMAGE_SIZE, PRODUCT_IMAGE_SIZE)
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, PRODUCT_IMAGE_SIZE, PRODUCT_IMAGE_SIZE)
  let blob = await canvasToBlob(canvas, 'image/webp', 0.86)
  let type = 'image/webp'
  if (!blob || blob.type !== 'image/webp') {
    blob = await canvasToBlob(canvas, 'image/jpeg', 0.88)
    type = 'image/jpeg'
  }
  if (!blob) throw new Error('Gambar gagal diproses.')
  return new File([blob], `${baseName}.${type === 'image/webp' ? 'webp' : 'jpg'}`, { type })
}
