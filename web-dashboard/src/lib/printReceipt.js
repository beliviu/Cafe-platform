/*
 * Cetak struk pelanggan & tiket dapur lewat jendela cetak browser (printer thermal 58/80 mm).
 * Isi struk mengikuti Pengaturan → Struk (teks atas/bawah, logo, alamat, lebar kertas).
 * Hanya membaca data — tidak menulis apa pun.
 */
import { customerLabel } from './db.js'
import { formatDateTime, formatQueueNumber, formatRupiah } from './format.js'
import { ORDER_TYPE_LABEL, paymentMethodLabel } from './status.js'

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))

function openPrint(name, title, paperMm, body, extraCss = '') {
  const win = window.open('', name, 'width=380,height=640')
  if (!win) return false
  const width = paperMm === 80 ? 72 : 48
  win.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: ${paperMm || 58}mm auto; margin: 3mm; }
  body { width: ${width}mm; margin: 0 auto; font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace; color: #000; }
  .c { text-align: center; } .r { text-align: right; } .b { font-weight: 700; }
  .row { display: flex; justify-content: space-between; gap: 6px; }
  .sep { margin: 6px 0; border-top: 1px dashed #000; }
  .muted { font-size: 11px; }
  img { max-width: 60%; max-height: 64px; display: block; margin: 0 auto 4px; }
  ${extraCss}
</style></head><body>${body}
<script>window.onload = () => { window.print(); setTimeout(() => window.close(), 400) }</${'script'}>
</body></html>`)
  win.document.close()
  return true
}

const itemsHtml = (items, withPrice) => items.map((item) => `
  <div class="row"><span>${escapeHtml(item.quantity)}× ${escapeHtml(item.product_name)}</span>${withPrice ? `<span>${escapeHtml(formatRupiah(item.subtotal))}</span>` : ''}</div>
  ${item.notes ? `<div class="muted">  · ${escapeHtml(item.notes)}</div>` : ''}`).join('')

/** Struk pelanggan. order memakai kolom v2 bila ada; payments = baris pembayaran (opsional). */
export function printReceipt({ order, items, payments = [], cafe, settings, brand }) {
  const s = settings || {}
  const lines = []
  const money = (label, value, strong = false) => `<div class="row${strong ? ' b' : ''}"><span>${escapeHtml(label)}</span><span>${escapeHtml(formatRupiah(value))}</span></div>`
  if (order.subtotal_amount !== null && order.subtotal_amount !== undefined) {
    lines.push(money('Subtotal', order.subtotal_amount))
    if (Number(order.discount_amount)) lines.push(money(`Diskon${order.discount_reason ? ` (${order.discount_reason})` : ''}`, -Number(order.discount_amount)))
    if (Number(order.service_charge_amount)) lines.push(money('Service', order.service_charge_amount))
    if (Number(order.tax_amount)) lines.push(money(`${s.tax_name || 'Pajak'}${order.tax_inclusive ? ' (termasuk)' : ''}`, order.tax_amount))
    if (Number(order.rounding_amount)) lines.push(money('Pembulatan', order.rounding_amount))
  }
  lines.push(money('TOTAL', order.total_amount, true))
  const paid = payments.filter((payment) => (payment.status || payment.payment_status) === 'paid')
  for (const payment of paid) {
    lines.push(money(paymentMethodLabel(payment.method || payment.payment_method), Number(payment.tendered_amount) || payment.amount))
    if (Number(payment.change_amount)) lines.push(money('Kembalian', payment.change_amount))
  }
  const body = `
  ${s.receipt_show_logo !== false && brand?.logoUrl ? `<img src="${escapeHtml(brand.logoUrl)}" alt="">` : ''}
  <div class="c b">${escapeHtml(brand?.businessName || cafe.name)}</div>
  ${s.receipt_show_address !== false && (cafe.address || cafe.phone) ? `<div class="c muted">${escapeHtml([cafe.address, cafe.phone].filter(Boolean).join(' · '))}</div>` : ''}
  ${s.receipt_header ? `<div class="c muted">${escapeHtml(s.receipt_header)}</div>` : ''}
  <div class="sep"></div>
  <div class="row"><span>${escapeHtml(formatQueueNumber(order))}</span><span>${escapeHtml(formatDateTime(order.created_at))}</span></div>
  <div class="muted">${escapeHtml([customerLabel(order), ORDER_TYPE_LABEL[order.order_type], order.table_label ? `Meja ${order.table_label}` : ''].filter(Boolean).join(' · '))}</div>
  <div class="sep"></div>
  ${itemsHtml(items, true)}
  <div class="sep"></div>
  ${lines.join('')}
  <div class="sep"></div>
  <div class="c">${escapeHtml(order.payment_status === 'paid' ? 'LUNAS' : 'BELUM LUNAS')}</div>
  ${s.receipt_footer ? `<div class="c muted" style="margin-top:6px">${escapeHtml(s.receipt_footer)}</div>` : ''}`
  return openPrint('dailybrew-receipt', `Struk ${formatQueueNumber(order)}`, Number(s.receipt_paper_mm) || 58, body)
}

/** Tiket dapur/bar: nomor besar, item & catatan, tanpa harga. */
export function printKitchenTicket({ order, items, settings }) {
  const body = `
  <div class="c b" style="font-size:28px">${escapeHtml(formatQueueNumber(order))}</div>
  <div class="c">${escapeHtml([ORDER_TYPE_LABEL[order.order_type], order.table_label ? `Meja ${order.table_label}` : '', customerLabel(order)].filter(Boolean).join(' · '))}</div>
  <div class="c muted">${escapeHtml(formatDateTime(order.created_at))}</div>
  <div class="sep"></div>
  <div style="font-size:14px">${itemsHtml(items, false)}</div>
  ${order.notes ? `<div class="sep"></div><div class="b">Catatan: ${escapeHtml(order.notes)}</div>` : ''}`
  return openPrint('dailybrew-kitchen', `Dapur ${formatQueueNumber(order)}`, Number(settings?.receipt_paper_mm) || 58, body)
}
