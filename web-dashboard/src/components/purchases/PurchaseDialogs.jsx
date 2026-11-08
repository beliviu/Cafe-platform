/*
 * Purchase order: form draf, detail (terima barang, bayar, batalkan), cetak PO.
 * Semua perubahan lewat RPC purchase_order_* dan supplier_payment_void (file 05).
 */
import { useCallback, useMemo, useState } from 'react'
import { Ban, Check, PackageCheck, Pencil, Plus, Printer, Send, Trash2, Wallet, XCircle } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import {
  Badge, Button, ConfirmDialog, Dialog, Drawer, ErrorState, IconButton, RupiahInput, Select, SkeletonRows, TextField, useToast,
} from '../ui/index.js'
import { formatDateTime, formatNumber, formatRupiah, jakartaDateKey } from '../../lib/format.js'
import {
  callRpc, dateOnly, daysUntil, formatQty, inventoryError, outstandingOf, parseDecimal, PO_STATUS, SUPPLIER_PAYMENT_METHODS, UNITS, useLoader,
} from '../../lib/inventory.js'


let lineSeed = 0
const newLine = (values = {}) => ({ key: `line-${(lineSeed += 1)}`, ingredient_id: '', quantity: '', unit_label: '', unit_size: '', unit_price: '', ...values })

/* ====================================================================
 * Form draf PO (baru / ubah draf)
 * ==================================================================== */
export function PurchaseOrderFormDrawer({ cafeId, po, suppliers, ingredients, catalog = [], onClose, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const byId = useMemo(() => new Map(ingredients.map((item) => [item.id, item])), [ingredients])
  const load = useCallback(async () => {
    if (!po) return []
    const { data, error } = await supabase.from('purchase_order_items').select('id, ingredient_id, quantity, unit_label, unit_size, unit_price, sort_order').eq('purchase_order_id', po.id).order('sort_order')
    if (error) throw new Error(inventoryError(error))
    return data || []
  }, [po, supabase])
  const { data: existing, error: loadError, reload } = useLoader(load)

  return (
    <Drawer title={po ? `Ubah draf ${po.po_number}` : 'Buat purchase order'} description="Harga per kemasan beli. Stok baru bertambah saat barang diterima." size="lg" onClose={onClose}>
      {loadError ? <ErrorState compact message={loadError} onRetry={reload} />
        : !existing ? <SkeletonRows rows={4} label="Memuat PO" />
          : <PurchaseOrderForm cafeId={cafeId} po={po} suppliers={suppliers} ingredients={ingredients} byId={byId} catalog={catalog} existing={existing}
            onClose={onClose} onSaved={onSaved} supabase={supabase} toast={toast} />}
    </Drawer>
  )
}

function PurchaseOrderForm({ cafeId, po, suppliers, ingredients, byId, catalog, existing, onClose, onSaved, supabase, toast }) {
  const [header, setHeader] = useState({
    supplier_id: po?.supplier_id || '',
    order_date: po?.order_date || jakartaDateKey(),
    expected_date: po?.expected_date || '',
    notes: po?.notes || '',
  })
  const [lines, setLines] = useState(() => (existing.length
    ? existing.map((line) => newLine({ ingredient_id: line.ingredient_id, quantity: String(Number(line.quantity)), unit_label: line.unit_label, unit_size: String(Number(line.unit_size)), unit_price: Number(line.unit_price) }))
    : [newLine()]))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(null)

  function defaultsFor(ingredientId, supplierId) {
    const item = byId.get(ingredientId)
    if (!item) return {}
    const entry = catalog.find((row) => row.supplier_id === supplierId && row.ingredient_id === ingredientId)
    const size = Number(entry?.unit_size || item.purchase_unit_size || 1)
    return {
      unit_label: entry?.unit_label || item.purchase_unit || UNITS[item.unit]?.short || item.unit,
      unit_size: String(size),
      unit_price: Math.round(Number(entry?.last_price) || Number(item.last_purchase_cost || item.avg_cost || 0) * size) || '',
    }
  }

  function setLine(key, patch) {
    // Supplier belum dipilih: ikuti supplier utama bahan pertama yang dipilih
    let supplierId = header.supplier_id
    if (patch.ingredient_id && !supplierId) {
      const preferred = byId.get(patch.ingredient_id)?.default_supplier_id
      if (preferred && suppliers.some((supplier) => supplier.id === preferred && supplier.is_active)) {
        supplierId = preferred
        setHeader((current) => ({ ...current, supplier_id: preferred }))
      }
    }
    setLines((current) => current.map((line) => {
      if (line.key !== key) return line
      const next = { ...line, ...patch }
      if (patch.ingredient_id) Object.assign(next, defaultsFor(patch.ingredient_id, supplierId))
      return next
    }))
    setError('')
  }

  const parsed = lines.map((line) => ({ ...line, qty: parseDecimal(line.quantity), size: parseDecimal(line.unit_size), price: Number(line.unit_price) || 0 }))
  const total = parsed.reduce((sum, line) => sum + (line.qty > 0 ? line.qty * line.price : 0), 0)
  const activeSuppliers = suppliers.filter((supplier) => supplier.is_active || supplier.id === header.supplier_id)

  async function submit(markOrdered) {
    const filled = parsed.filter((line) => line.ingredient_id || line.quantity)
    if (!header.supplier_id) return setError('Pilih supplier')
    if (!filled.length) return setError('Tambahkan minimal satu bahan')
    for (const line of filled) {
      const name = byId.get(line.ingredient_id)?.name || 'bahan'
      if (!line.ingredient_id) return setError('Pilih bahan di setiap baris')
      if (!(line.qty > 0)) return setError(`Isi jumlah ${name}`)
      if (!(line.size > 0)) return setError(`Isi isi per kemasan ${name}`)
      if (!line.unit_label.trim()) return setError(`Isi nama kemasan ${name}`)
    }
    if (new Set(filled.map((line) => line.ingredient_id)).size !== filled.length) return setError('Ada bahan yang sama dua kali. Gabungkan jumlahnya.')
    if (header.expected_date && header.expected_date < header.order_date) return setError('Tanggal kirim tidak boleh sebelum tanggal pesan')
    setSaving(markOrdered ? 'order' : 'draft')
    try {
      const id = await callRpc(supabase, 'purchase_order_save', {
        p_cafe_id: cafeId, p_po_id: po?.id || null, p_supplier_id: header.supplier_id, p_order_date: header.order_date || null,
        p_expected_date: header.expected_date || null, p_notes: header.notes || null,
        p_items: filled.map((line) => ({ ingredient_id: line.ingredient_id, quantity: line.qty, unit_label: line.unit_label.trim(), unit_size: line.size, unit_price: line.price })),
      })
      if (markOrdered) await callRpc(supabase, 'purchase_order_transition', { p_po_id: id, p_action: 'order', p_reason: null })
      toast({ tone: 'success', title: markOrdered ? 'PO ditandai dipesan' : 'Draf PO disimpan', description: formatRupiah(total) })
      onSaved?.(id)
      onClose()
    } catch (caught) {
      setError(caught.message)
      setSaving(null)
    }
    return undefined
  }

  return (
    <div className="po-form">
      <div className="inv-form-row is-3">
        <Select label="Supplier" value={header.supplier_id} onChange={(event) => setHeader((current) => ({ ...current, supplier_id: event.target.value }))}
          options={[{ value: '', label: 'Pilih supplier' }, ...activeSuppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))]} />
        <TextField label="Tanggal pesan" type="date" value={header.order_date} onChange={(event) => setHeader((current) => ({ ...current, order_date: event.target.value }))} />
        <TextField label="Perkiraan tiba" type="date" value={header.expected_date} onChange={(event) => setHeader((current) => ({ ...current, expected_date: event.target.value }))} />
      </div>

      <div className="po-lines" role="table" aria-label="Barang yang dipesan">
        <div className="po-line is-head" role="row">
          <span role="columnheader">Bahan</span><span role="columnheader">Jumlah</span><span role="columnheader">Kemasan</span>
          <span role="columnheader">Isi / kemasan</span><span role="columnheader">Harga / kemasan</span><span role="columnheader" className="num">Subtotal</span><span />
        </div>
        {parsed.map((line) => {
          const item = byId.get(line.ingredient_id)
          return (
            <div key={line.key} className="po-line" role="row">
              <Select hideLabel label="Bahan" value={line.ingredient_id} onChange={(event) => setLine(line.key, { ingredient_id: event.target.value })}
                options={[{ value: '', label: 'Pilih bahan…' }, ...ingredients.filter((row) => row.is_active || row.id === line.ingredient_id).map((row) => ({ value: row.id, label: row.name }))]} />
              <TextField hideLabel label="Jumlah" value={line.quantity} onChange={(event) => setLine(line.key, { quantity: event.target.value })} inputMode="decimal" autoComplete="off" placeholder="Jumlah" />
              <TextField hideLabel label="Nama kemasan" value={line.unit_label} onChange={(event) => setLine(line.key, { unit_label: event.target.value })} maxLength={20} placeholder="karton" />
              <TextField hideLabel label="Isi per kemasan" value={line.unit_size} onChange={(event) => setLine(line.key, { unit_size: event.target.value })}
                suffix={item ? UNITS[item.unit]?.short : ''} inputMode="decimal" autoComplete="off" placeholder="Isi" />
              <RupiahInput hideLabel label="Harga per kemasan" value={line.unit_price} onChange={(value) => setLine(line.key, { unit_price: value })} />
              <span className="num tabular po-line-total">{line.qty > 0 ? formatRupiah(line.qty * line.price) : '—'}</span>
              <IconButton icon={Trash2} size="sm" variant="danger" label="Hapus baris" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))} />
            </div>
          )
        })}
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => setLines((current) => [...current, newLine()])}>Tambah bahan</Button>
      </div>

      <TextField label="Catatan untuk supplier" multiline rows={2} maxLength={500} value={header.notes} onChange={(event) => setHeader((current) => ({ ...current, notes: event.target.value }))} />

      <footer className="po-form-footer">
        <span>Total <strong className="tabular">{formatRupiah(total)}</strong></span>
        {error && <p className="ui-field-error" role="alert">{error}</p>}
        <div className="recipe-actions">
          <Button variant="ghost" onClick={onClose} disabled={Boolean(saving)}>Batal</Button>
          <Button variant="secondary" onClick={() => submit(false)} loading={saving === 'draft'} disabled={Boolean(saving)}>Simpan draf</Button>
          <Button icon={Send} onClick={() => submit(true)} loading={saving === 'order'} disabled={Boolean(saving)}>Simpan & tandai dipesan</Button>
        </div>
      </footer>
    </div>
  )
}

/* ====================================================================
 * Detail PO
 * ==================================================================== */
export function PurchaseOrderDetailDrawer({ poId, cafe, suppliers, ingredients, onClose, onChanged, onEdit }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [dialog, setDialog] = useState(null)
  const byId = useMemo(() => new Map(ingredients.map((item) => [item.id, item])), [ingredients])
  const load = useCallback(async () => {
    const [poResult, itemResult, payResult] = await Promise.all([
      supabase.from('purchase_orders').select('*').eq('id', poId).maybeSingle(),
      supabase.from('purchase_order_items').select('id, ingredient_id, quantity, unit_label, unit_size, unit_price, received_quantity, line_total, sort_order').eq('purchase_order_id', poId).order('sort_order'),
      supabase.from('supplier_payments').select('id, amount, method, paid_on, reference, note, created_at, voided_at, void_reason').eq('purchase_order_id', poId).order('created_at'),
    ])
    const failure = poResult.error || itemResult.error || payResult.error
    if (failure) throw new Error(inventoryError(failure))
    if (!poResult.data) throw new Error('PO tidak ditemukan')
    return { po: poResult.data, items: itemResult.data || [], payments: payResult.data || [] }
  }, [poId, supabase])
  const { data, error, reload } = useLoader(load)

  function refresh() {
    reload()
    onChanged?.()
  }

  async function transition(action, reason = null) {
    await callRpc(supabase, 'purchase_order_transition', { p_po_id: poId, p_action: action, p_reason: reason })
    toast({ tone: 'success', title: { order: 'PO ditandai dipesan', cancel: 'PO dibatalkan', close: 'PO ditutup', delete: 'Draf dihapus' }[action] })
    if (action === 'delete') {
      onChanged?.()
      onClose()
    } else refresh()
  }

  if (error) return <Drawer title="Purchase order" onClose={onClose}><ErrorState compact message={error} onRetry={reload} /></Drawer>
  if (!data) return <Drawer title="Purchase order" onClose={onClose}><SkeletonRows rows={5} label="Memuat PO" /></Drawer>

  const { po, items, payments } = data
  const status = PO_STATUS[po.status]
  const supplier = suppliers.find((row) => row.id === po.supplier_id)
  const outstanding = outstandingOf(po)
  const dueDays = po.due_date ? daysUntil(po.due_date, jakartaDateKey()) : null
  const canReceive = ['draft', 'ordered', 'partial'].includes(po.status)
  const canPay = ['ordered', 'partial', 'received'].includes(po.status) && (po.status === 'ordered' ? Number(po.total_amount) - Number(po.paid_amount) > 0 : outstanding > 0)

  return (
    <Drawer
      title={po.po_number}
      description={`${supplier?.name || 'Supplier'} · dipesan ${dateOnly(po.order_date)}`}
      headerExtra={<Badge tone={status.tone} className="inv-detail-badge">{status.label}{po.closed_short ? ' (ditutup)' : ''}</Badge>}
      size="lg"
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" icon={Printer} className="drawer-footer-start" onClick={() => printPurchaseOrder({ po, items, supplier, cafe, byId })}>Cetak</Button>
          {po.status === 'draft' && <Button variant="ghost" icon={Trash2} onClick={() => setDialog('delete')}>Hapus draf</Button>}
          {po.status === 'ordered' && Number(po.received_amount) === 0 && <Button variant="ghost" icon={Ban} onClick={() => setDialog('cancel')}>Batalkan</Button>}
          {po.status === 'partial' && <Button variant="ghost" icon={XCircle} onClick={() => setDialog('close')}>Tutup PO</Button>}
          {po.status === 'draft' && <Button variant="secondary" icon={Pencil} onClick={() => onEdit(po)}>Ubah</Button>}
          {po.status === 'draft' && <Button variant="secondary" icon={Send} onClick={() => transition('order').catch((caught) => toast({ tone: 'error', title: 'Gagal', description: caught.message }))}>Tandai dipesan</Button>}
          {canPay && <Button variant="secondary" icon={Wallet} onClick={() => setDialog('pay')}>Bayar</Button>}
          {canReceive && <Button icon={PackageCheck} onClick={() => setDialog('receive')}>Terima barang</Button>}
        </>
      )}
    >
      <dl className="inv-facts is-4">
        <div><dt>Total PO</dt><dd className="tabular">{formatRupiah(po.total_amount)}</dd></div>
        <div><dt>Diterima</dt><dd className="tabular">{formatRupiah(po.received_amount)}</dd></div>
        <div><dt>Dibayar</dt><dd className="tabular">{formatRupiah(po.paid_amount)}</dd></div>
        <div>
          <dt>{outstanding < 0 ? 'Uang muka' : 'Sisa utang'}</dt>
          <dd className={`tabular${outstanding > 0 && dueDays !== null && dueDays < 0 ? ' inv-low' : ''}`}>{formatRupiah(Math.abs(outstanding))}</dd>
        </div>
        <div><dt>Perkiraan tiba</dt><dd>{dateOnly(po.expected_date)}</dd></div>
        <div><dt>Jatuh tempo</dt><dd>{po.due_date ? `${dateOnly(po.due_date)}${outstanding > 0 && dueDays < 0 ? ` · lewat ${Math.abs(dueDays)} hari` : ''}` : 'Saat barang diterima'}</dd></div>
        <div><dt>Termin supplier</dt><dd>{supplier?.payment_terms_days ? `${supplier.payment_terms_days} hari` : 'Tunai'}</dd></div>
        <div><dt>Diterima terakhir</dt><dd>{po.received_at ? formatDateTime(po.received_at) : '—'}</dd></div>
      </dl>
      {po.notes && <p className="inv-note-box">{po.notes}</p>}
      {po.cancel_reason && <p className="inv-note-box">Alasan {po.status === 'cancelled' ? 'batal' : 'ditutup'}: {po.cancel_reason}</p>}

      <section className="inv-section">
        <h3>Barang</h3>
        <table className="data-table">
          <thead><tr><th scope="col">Bahan</th><th scope="col" className="num">Dipesan</th><th scope="col" className="num">Diterima</th><th scope="col" className="num">Harga</th><th scope="col" className="num">Subtotal</th></tr></thead>
          <tbody>
            {items.map((line) => {
              const item = byId.get(line.ingredient_id)
              const done = Number(line.received_quantity) >= Number(line.quantity)
              return (
                <tr key={line.id}>
                  <th scope="row">{item?.name || 'Bahan'}<small className="cell-sub">{formatNumber(line.unit_size)} {UNITS[item?.unit]?.short || ''} / {line.unit_label}</small></th>
                  <td className="num tabular">{formatNumber(line.quantity)} {line.unit_label}</td>
                  <td className="num tabular">{done ? <Badge tone="green" size="sm" dot={false}><Check size={12} aria-hidden="true" /> {formatNumber(line.received_quantity)}</Badge> : `${formatNumber(line.received_quantity)} ${line.unit_label}`}</td>
                  <td className="num tabular">{formatRupiah(line.unit_price)}</td>
                  <td className="num tabular">{formatRupiah(line.line_total)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section className="inv-section">
        <h3>Pembayaran</h3>
        {!payments.length ? <p className="text-muted">Belum ada pembayaran.</p> : (
          <ul className="po-payments">
            {payments.map((payment) => (
              <li key={payment.id} className={payment.voided_at ? 'is-void' : ''}>
                <span className="inv-name">
                  <strong className="tabular">{formatRupiah(payment.amount)}</strong>
                  <small>{SUPPLIER_PAYMENT_METHODS.find((method) => method.value === payment.method)?.label} · {dateOnly(payment.paid_on)}{payment.reference ? ` · ${payment.reference}` : ''}</small>
                  {payment.voided_at && <small>Dibatalkan: {payment.void_reason}</small>}
                </span>
                {payment.voided_at ? <Badge tone="neutral" size="sm">Batal</Badge>
                  : <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'void', payment })}>Batalkan</Button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog === 'receive' && <ReceiveDialog po={po} items={items} byId={byId} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'pay' && <PayDialog po={po} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'delete' && <ConfirmDialog title={`Hapus draf ${po.po_number}?`} confirmLabel="Hapus draf" description="Draf dihapus permanen. Nomor PO tidak dipakai ulang." onConfirm={() => transition('delete')} onClose={() => setDialog(null)} />}
      {(dialog === 'cancel' || dialog === 'close') && (
        <ReasonDialog
          title={dialog === 'cancel' ? `Batalkan ${po.po_number}?` : `Tutup ${po.po_number}?`}
          description={dialog === 'cancel' ? 'PO dibatalkan dan tidak bisa diterima atau dibayar lagi.' : 'Sisa barang dianggap tidak dikirim. Utang dihitung dari barang yang sudah diterima saja.'}
          confirmLabel={dialog === 'cancel' ? 'Batalkan PO' : 'Tutup PO'}
          onConfirm={(reason) => transition(dialog, reason)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'void' && (
        <ReasonDialog
          title={`Batalkan pembayaran ${formatRupiah(dialog.payment.amount)}?`}
          description="Pembayaran tidak dihapus, hanya ditandai batal dengan alasan. Sisa utang kembali bertambah."
          confirmLabel="Batalkan pembayaran"
          required
          onConfirm={async (reason) => {
            await callRpc(supabase, 'supplier_payment_void', { p_payment_id: dialog.payment.id, p_reason: reason })
            toast({ title: 'Pembayaran dibatalkan' })
            refresh()
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </Drawer>
  )
}

function ReasonDialog({ title, description, confirmLabel, onConfirm, onClose, required = false }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  return (
    <ConfirmDialog title={title} description={description} confirmLabel={confirmLabel} onClose={onClose}
      onConfirm={async () => {
        if (required && reason.trim().length < 3) {
          setError('Tulis alasan (minimal 3 huruf)')
          return false
        }
        await onConfirm(reason.trim() || null)
        onClose()
        return true
      }}>
      <TextField label={required ? 'Alasan' : 'Alasan (opsional)'} value={reason} onChange={(event) => { setReason(event.target.value); setError('') }} maxLength={300} error={error} />
    </ConfirmDialog>
  )
}

function ReceiveDialog({ po, items, byId, onClose, onDone }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const open = items.filter((line) => Number(line.received_quantity) < Number(line.quantity))
  const [values, setValues] = useState(() => Object.fromEntries(open.map((line) => [line.id, { quantity: String(Number(line.quantity) - Number(line.received_quantity)), expires_at: '' }])))
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event) {
    event.preventDefault()
    const lines = []
    for (const line of open) {
      const qty = parseDecimal(values[line.id]?.quantity)
      if (qty === null || qty === 0) continue
      const remaining = Number(line.quantity) - Number(line.received_quantity)
      if (qty < 0 || qty > remaining + 0.0005) return setError(`Jumlah ${byId.get(line.ingredient_id)?.name} maksimal ${formatNumber(remaining)} ${line.unit_label}`)
      lines.push({ item_id: line.id, quantity: qty, expires_at: values[line.id]?.expires_at || null })
    }
    if (!lines.length) return setError('Isi jumlah barang yang diterima')
    setSaving(true)
    try {
      const status = await callRpc(supabase, 'purchase_order_receive', { p_po_id: po.id, p_lines: lines, p_note: note || null })
      toast({ tone: 'success', title: status === 'received' ? 'Semua barang diterima' : 'Barang diterima sebagian', description: 'Stok bahan bertambah.' })
      onDone()
      onClose()
    } catch (caught) {
      setError(caught.message)
      setSaving(false)
    }
    return undefined
  }

  return (
    <Dialog title={`Terima barang · ${po.po_number}`} description="Isi jumlah yang benar-benar datang. Kosongkan atau 0 bila belum datang." size="lg" onClose={saving ? undefined : onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button><Button type="submit" form="receive-form" icon={PackageCheck} loading={saving}>Terima & tambah stok</Button></>}>
      <form id="receive-form" className="inv-form" onSubmit={submit} noValidate>
        {open.map((line) => {
          const item = byId.get(line.ingredient_id)
          const remaining = Number(line.quantity) - Number(line.received_quantity)
          const qty = parseDecimal(values[line.id]?.quantity)
          return (
            <div key={line.id} className="receive-line">
              <span className="inv-name">
                <strong>{item?.name}</strong>
                <small className="tabular">sisa {formatNumber(remaining)} {line.unit_label}{qty > 0 && item ? ` · +${formatQty(qty * Number(line.unit_size), item.unit)}` : ''}</small>
              </span>
              <TextField hideLabel label={`Diterima ${item?.name}`} value={values[line.id]?.quantity ?? ''} suffix={line.unit_label} inputMode="decimal" autoComplete="off"
                onChange={(event) => { setValues((current) => ({ ...current, [line.id]: { ...current[line.id], quantity: event.target.value } })); setError('') }} />
              <TextField hideLabel label={`Kedaluwarsa ${item?.name}`} type="date" value={values[line.id]?.expires_at ?? ''}
                onChange={(event) => setValues((current) => ({ ...current, [line.id]: { ...current[line.id], expires_at: event.target.value } }))} />
            </div>
          )
        })}
        <p className="ui-field-hint">Tanggal kedaluwarsa opsional — isi untuk bahan yang cepat basi agar muncul peringatan.</p>
        <TextField label="Catatan penerimaan" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="Mis. no. surat jalan" />
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}

function PayDialog({ po, onClose, onDone }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const limit = po.status === 'ordered' ? Number(po.total_amount) - Number(po.paid_amount) : outstandingOf(po)
  const [form, setForm] = useState({ amount: Math.round(limit), method: 'bank_transfer', paid_on: jakartaDateKey(), reference: '', note: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (!(Number(form.amount) > 0)) return setError('Isi nominal')
    if (Number(form.amount) > limit + 0.005) return setError(`Maksimal ${formatRupiah(limit)}`)
    setSaving(true)
    try {
      await callRpc(supabase, 'purchase_order_pay', {
        p_po_id: po.id, p_amount: Number(form.amount), p_method: form.method, p_paid_on: form.paid_on || null, p_reference: form.reference || null, p_note: form.note || null,
      })
      toast({ tone: 'success', title: 'Pembayaran supplier dicatat', description: formatRupiah(form.amount) })
      onDone()
      onClose()
    } catch (caught) {
      setError(caught.message)
      setSaving(false)
    }
    return undefined
  }

  return (
    <Dialog title={`Bayar ${po.po_number}`} description={po.status === 'ordered' ? 'Barang belum diterima — pembayaran ini dicatat sebagai uang muka.' : `Sisa utang ${formatRupiah(limit)}`} onClose={saving ? undefined : onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button><Button type="submit" form="pay-form" icon={Wallet} loading={saving}>Catat pembayaran</Button></>}>
      <form id="pay-form" className="inv-form" onSubmit={submit} noValidate>
        <div className="inv-form-row">
          <RupiahInput label="Nominal" value={form.amount} onChange={(value) => { setForm((current) => ({ ...current, amount: value })); setError('') }} />
          <Select label="Metode" value={form.method} onChange={(event) => setForm((current) => ({ ...current, method: event.target.value }))} options={SUPPLIER_PAYMENT_METHODS} />
        </div>
        <div className="inv-form-row">
          <TextField label="Tanggal bayar" type="date" value={form.paid_on} max={jakartaDateKey()} onChange={(event) => setForm((current) => ({ ...current, paid_on: event.target.value }))} />
          <TextField label="No. referensi" value={form.reference} maxLength={60} placeholder="Mis. no. transfer" onChange={(event) => setForm((current) => ({ ...current, reference: event.target.value }))} />
        </div>
        <TextField label="Catatan" value={form.note} maxLength={300} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} />
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}

/* ====================================================================
 * Cetak PO (jendela cetak browser)
 * ==================================================================== */
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))

function printPurchaseOrder({ po, items, supplier, cafe, byId }) {
  const win = window.open('', 'dailybrew-po', 'width=820,height=900')
  if (!win) return
  const rows = items.map((line, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(byId.get(line.ingredient_id)?.name)}</td>
    <td class="n">${escapeHtml(formatNumber(line.quantity))} ${escapeHtml(line.unit_label)}</td><td class="n">${escapeHtml(formatRupiah(line.unit_price))}</td><td class="n">${escapeHtml(formatRupiah(line.line_total))}</td></tr>`).join('')
  win.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${escapeHtml(po.po_number)}</title>
<style>
  body { margin: 32px; font: 13px/1.5 system-ui, sans-serif; color: #1f1a17; }
  h1 { margin: 0; font-size: 22px; } .muted { color: #6b625b; }
  .head { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 16px; border-bottom: 2px solid #1f1a17; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 20px 0; }
  table { width: 100%; border-collapse: collapse; } th, td { padding: 8px 6px; border-bottom: 1px solid #ddd; text-align: left; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #6b625b; } .n { text-align: right; white-space: nowrap; }
  .total td { border: 0; font-weight: 700; font-size: 15px; }
</style></head><body>
  <div class="head"><div><h1>Purchase Order</h1><div class="muted">${escapeHtml(po.po_number)}</div></div>
  <div class="n"><strong>${escapeHtml(cafe.name)}</strong><div class="muted">${escapeHtml(cafe.address || '')}</div><div class="muted">${escapeHtml(cafe.phone || '')}</div></div></div>
  <div class="parties"><div><div class="muted">Kepada</div><strong>${escapeHtml(supplier?.name)}</strong><div>${escapeHtml(supplier?.contact_name || '')}</div><div>${escapeHtml(supplier?.phone || '')}</div><div>${escapeHtml(supplier?.address || '')}</div></div>
  <div><div class="muted">Tanggal pesan</div><strong>${escapeHtml(dateOnly(po.order_date))}</strong><div class="muted" style="margin-top:8px">Perkiraan tiba</div><strong>${escapeHtml(dateOnly(po.expected_date))}</strong></div></div>
  <table><thead><tr><th>#</th><th>Barang</th><th class="n">Jumlah</th><th class="n">Harga</th><th class="n">Subtotal</th></tr></thead><tbody>${rows}</tbody>
  <tfoot><tr class="total"><td colspan="4" class="n">Total</td><td class="n">${escapeHtml(formatRupiah(po.total_amount))}</td></tr></tfoot></table>
  ${po.notes ? `<p><span class="muted">Catatan:</span> ${escapeHtml(po.notes)}</p>` : ''}
  <p class="muted" style="margin-top:32px">Dicetak ${escapeHtml(formatDateTime(new Date().toISOString()))}</p>
  <script>window.onload = () => window.print()</${'script'}>
</body></html>`)
  win.document.close()
}

