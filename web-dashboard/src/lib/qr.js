/*
 * QR meja: isi QR = <VITE_CUSTOMER_APP_URL>/meja/<token>. Token rahasia per meja (file 08),
 * bisa diganti owner kapan saja (QR lama otomatis tidak berlaku).
 */
import qrcode from 'qrcode-generator'
import { CUSTOMER_APP_URL } from '../config/platform.js'

export function tableQrUrl(token) {
  return `${CUSTOMER_APP_URL || 'https://ATUR-VITE_CUSTOMER_APP_URL'}/meja/${token}`
}

/** Matriks QR (koreksi galat M) → path SVG 1 unit per modul. */
export function qrMatrix(text) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const size = qr.getModuleCount()
  let path = ''
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`
    }
  }
  return { size, path }
}

/** SVG lengkap (string) untuk dicetak / diunduh. */
export function qrSvgString(text, { margin = 4, color = '#000000' } = {}) {
  const { size, path } = qrMatrix(text)
  const total = size + margin * 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><path transform="translate(${margin} ${margin})" fill="${color}" d="${path}"/></svg>`
}

/** PNG (data URL) beresolusi tinggi untuk diunduh & dicetak. */
export function qrPngDataUrl(text, pixels = 1024) {
  const { size, path } = qrMatrix(text)
  const margin = 4
  const total = size + margin * 2
  const canvas = document.createElement('canvas')
  canvas.width = pixels
  canvas.height = pixels
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, pixels, pixels)
  context.scale(pixels / total, pixels / total)
  context.translate(margin, margin)
  context.fillStyle = '#000000'
  context.fill(new Path2D(path))
  return canvas.toDataURL('image/png')
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))

/** Lembar cetak: satu kartu per meja (QR + nama kafe + nomor meja + petunjuk). */
export function printTableQrSheet(tables, cafeName) {
  const win = window.open('', 'dailybrew-qr', 'width=900,height=1000')
  if (!win) return false
  const cards = tables.map((table) => `
    <section class="card">
      <div class="cafe">${escapeHtml(cafeName)}</div>
      <div class="qr">${qrSvgString(tableQrUrl(table.qr_token))}</div>
      <div class="table">Meja ${escapeHtml(table.label)}</div>
      <div class="hint">Scan untuk lihat menu &amp; pesan dari meja</div>
    </section>`).join('')
  win.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>QR meja — ${escapeHtml(cafeName)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { margin: 0; font: 13px/1.4 system-ui, sans-serif; color: #1f1a17; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10mm; }
  .card { display: grid; justify-items: center; gap: 4mm; padding: 8mm 6mm; border: 1px dashed #999; border-radius: 4mm; break-inside: avoid; }
  .cafe { font-size: 15px; font-weight: 700; letter-spacing: .02em; }
  .qr svg { width: 58mm; height: 58mm; display: block; }
  .table { font-size: 26px; font-weight: 800; }
  .hint { color: #555; font-size: 12px; }
</style></head><body><div class="grid">${cards}</div>
<script>window.onload = () => window.print()</${'script'}></body></html>`)
  win.document.close()
  return true
}
