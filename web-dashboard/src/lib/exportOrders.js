/*
 * Ekspor transaksi ke CSV / Excel (.xlsx). Hanya membaca data — tidak menulis ke database.
 */
import { customerLabel } from './db.js'
import { formatDate, formatQueueNumber, formatTime, summarizeItems } from './format.js'
import { orderStatusMeta, paymentMethodLabel, paymentStatusMeta } from './status.js'

const COLUMNS = [
  { key: 'queue', header: 'No. antrean', width: 12 },
  { key: 'reference', header: 'Referensi', width: 22 },
  { key: 'date', header: 'Tanggal (WIB)', width: 14 },
  { key: 'time', header: 'Jam', width: 8 },
  { key: 'customer', header: 'Customer', width: 22 },
  { key: 'items', header: 'Item', width: 40 },
  { key: 'quantity', header: 'Jumlah item', width: 12, number: true },
  { key: 'status', header: 'Status', width: 14 },
  { key: 'payment', header: 'Pembayaran', width: 16 },
  { key: 'method', header: 'Metode', width: 14 },
  { key: 'total', header: 'Total (Rp)', width: 14, number: true },
  { key: 'paidAt', header: 'Lunas pada', width: 20 },
  { key: 'cancelReason', header: 'Alasan batal', width: 24 },
  { key: 'notes', header: 'Catatan', width: 30 },
]

export function buildExportRows(orders, itemsByOrder) {
  return orders.map((order) => {
    const items = itemsByOrder.get(order.id) || []
    return {
      queue: formatQueueNumber(order),
      reference: String(order.order_number ?? order.id ?? ''),
      date: formatDate(order.created_at),
      time: formatTime(order.created_at),
      customer: customerLabel(order),
      items: items.length ? summarizeItems(items, items.length) : '',
      quantity: items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
      status: orderStatusMeta(order.order_status).label,
      payment: paymentStatusMeta(order.payment_status).label,
      method: order.payment_method ? paymentMethodLabel(order.payment_method) : '',
      total: Math.round(Number(order.total_amount) || 0),
      paidAt: order.paid_at ? `${formatDate(order.paid_at)} ${formatTime(order.paid_at)}` : '',
      cancelReason: order.cancel_reason || '',
      notes: order.notes || '',
    }
  })
}

function download(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function exportCsv(rows, fileName) {
  const lines = [COLUMNS.map((column) => csvCell(column.header)).join(',')]
  for (const row of rows) lines.push(COLUMNS.map((column) => csvCell(row[column.key])).join(','))
  // BOM agar Excel membaca UTF-8 dengan benar
  download(new Blob(['﻿', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${fileName}.csv`)
}

export async function exportXlsx(rows, fileName) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  const header = COLUMNS.map((column) => ({ value: column.header, fontWeight: 'bold' }))
  const body = rows.map((row) => COLUMNS.map((column) => (column.number
    ? { value: row[column.key], type: Number, format: column.key === 'total' ? '#,##0' : '0' }
    : { value: String(row[column.key] ?? ''), type: String })))
  const blob = await writeXlsxFile([header, ...body], {
    columns: COLUMNS.map((column) => ({ width: column.width })),
    stickyRowsCount: 1,
    sheet: 'Transaksi',
  }).toBlob()
  download(blob, `${fileName}.xlsx`)
}
