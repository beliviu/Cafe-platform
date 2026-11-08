/*
 * Cetak label cup / struk sederhana lewat jendela cetak browser (printer thermal 58–80 mm).
 * Hanya membaca data pesanan — tidak menulis apa pun.
 */
import { customerLabel } from './db.js'
import { formatQueueNumber, formatRupiah, formatTime } from './format.js'
import { paymentStatusMeta } from './status.js'

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))

export function printOrderLabel(order, cafeName) {
  const win = window.open('', 'dailybrew-label', 'width=380,height=600')
  if (!win) return false
  const items = (order.items || []).map((item) => `
    <li><b>${escapeHtml(item.quantity)}×</b> ${escapeHtml(item.product_name)}${item.notes ? `<em>${escapeHtml(item.notes)}</em>` : ''}</li>`).join('')
  win.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Label ${escapeHtml(formatQueueNumber(order))}</title>
<style>
  @page { size: 72mm auto; margin: 4mm; }
  body { margin: 0; font: 13px/1.35 system-ui, sans-serif; color: #000; }
  .cafe { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
  .queue { margin: 4px 0; font-size: 34px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .who { font-size: 15px; font-weight: 700; }
  ul { margin: 8px 0; padding: 8px 0 0; list-style: none; border-top: 1px dashed #000; }
  li { margin-bottom: 6px; }
  em { display: block; padding-left: 18px; font-style: normal; font-weight: 700; }
  .notes { padding: 6px 0; border-top: 1px dashed #000; font-weight: 700; }
  .foot { display: flex; justify-content: space-between; padding-top: 6px; border-top: 1px dashed #000; font-size: 12px; }
</style></head><body>
  <div class="cafe">${escapeHtml(cafeName)} · ${escapeHtml(formatTime(order.created_at))}</div>
  <div class="queue">${escapeHtml(formatQueueNumber(order))}</div>
  <div class="who">${escapeHtml(customerLabel(order))}</div>
  <ul>${items}</ul>
  ${order.notes ? `<div class="notes">Catatan: ${escapeHtml(order.notes)}</div>` : ''}
  <div class="foot"><span>${escapeHtml(paymentStatusMeta(order.payment_status).label)}</span><b>${escapeHtml(formatRupiah(order.total_amount))}</b></div>
  <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 300) }</${'script'}>
</body></html>`)
  win.document.close()
  return true
}
