/*
 * Dialog bahan baku: tambah/ubah bahan, stok masuk/keluar/penyesuaian, dan detail bahan.
 * Saldo stok hanya berubah lewat RPC (inventory_stock_in / _out / _adjust).
 */
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpFromLine, Pencil, SlidersHorizontal } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import {
  Badge, Button, Dialog, Drawer, ErrorState, RupiahInput, SegmentedControl, Select, SkeletonRows, Switch, TextField, useToast,
} from '../ui/index.js'
import { formatDateShort, formatDateTime, formatRupiah, jakartaDateKey } from '../../lib/format.js'
import {
  callRpc, daysUntil, formatQty, formatUnitCost, INGREDIENT_COLUMNS, inventoryError, MOVEMENT_TYPES, parseDecimal,
  STOCK_OUT_REASONS, STOCK_STATUS, stockStatus, stockValue, UNIT_OPTIONS, UNITS, useLoader,
} from '../../lib/inventory.js'

const decimalProps = { inputMode: 'decimal', autoComplete: 'off' }

/* ====================================================================
 * Tambah / ubah bahan
 * ==================================================================== */
export function IngredientFormDrawer({ ingredient, cafeId, suppliers, categories, onClose, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const editing = Boolean(ingredient)
  const [form, setForm] = useState(() => ({
    name: ingredient?.name || '',
    sku: ingredient?.sku || '',
    category: ingredient?.category || '',
    unit: ingredient?.unit || 'g',
    min_stock: ingredient ? String(Number(ingredient.min_stock)) : '',
    purchase_unit: ingredient?.purchase_unit || '',
    purchase_unit_size: ingredient?.purchase_unit_size ? String(Number(ingredient.purchase_unit_size)) : '',
    default_supplier_id: ingredient?.default_supplier_id || '',
    lead_time_days: String(ingredient?.lead_time_days ?? 2),
    is_active: ingredient?.is_active ?? true,
    opening_qty: '',
    opening_value: '',
  }))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const unit = UNITS[form.unit]?.short || form.unit
  const set = (key) => (event) => {
    const value = event?.target ? event.target.value : event
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }
  const openingQty = parseDecimal(form.opening_qty)
  const openingValue = Number(form.opening_value) || 0

  function validate() {
    const next = {}
    if (form.name.trim().length < 2) next.name = 'Nama minimal 2 huruf'
    const min = parseDecimal(form.min_stock || '0')
    if (min === null || min < 0) next.min_stock = 'Isi angka 0 atau lebih'
    if (form.purchase_unit.trim() || form.purchase_unit_size) {
      if (!form.purchase_unit.trim()) next.purchase_unit = 'Isi nama kemasan, mis. karton'
      const size = parseDecimal(form.purchase_unit_size)
      if (!size || size <= 0) next.purchase_unit_size = `Isi jumlah ${unit} per kemasan`
    }
    const lead = Number(form.lead_time_days)
    if (!Number.isInteger(lead) || lead < 0 || lead > 60) next.lead_time_days = '0–60 hari'
    if (!editing && form.opening_qty) {
      if (openingQty === null || openingQty <= 0) next.opening_qty = 'Isi jumlah lebih dari 0'
      else if (!openingValue) next.opening_value = 'Isi nilai stok awal agar HPP bisa dihitung'
    }
    setErrors(next)
    return !Object.keys(next).length
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!validate()) return
    setSaving(true)
    const values = {
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      category: form.category.trim() || null,
      unit: form.unit,
      min_stock: parseDecimal(form.min_stock || '0'),
      purchase_unit: form.purchase_unit.trim() || null,
      purchase_unit_size: form.purchase_unit.trim() ? parseDecimal(form.purchase_unit_size) : null,
      default_supplier_id: form.default_supplier_id || null,
      lead_time_days: Number(form.lead_time_days),
      is_active: form.is_active,
    }
    try {
      let saved
      if (editing) {
        const { data, error } = await supabase.from('ingredients').update(values).eq('id', ingredient.id).select(INGREDIENT_COLUMNS).maybeSingle()
        if (error) throw new Error(inventoryError(error))
        saved = data
      } else {
        const { data, error } = await supabase.from('ingredients').insert({ ...values, cafe_id: cafeId }).select(INGREDIENT_COLUMNS).maybeSingle()
        if (error) throw new Error(inventoryError(error))
        saved = data
        if (openingQty > 0) {
          await callRpc(supabase, 'inventory_stock_in', {
            p_ingredient_id: saved.id, p_quantity: openingQty, p_unit_cost: Number((openingValue / openingQty).toFixed(4)),
            p_expires_at: null, p_supplier_id: null, p_note: 'Stok awal', p_is_opening: true,
          })
        }
      }
      toast({ tone: 'success', title: editing ? 'Bahan diperbarui' : `${values.name} ditambahkan` })
      onSaved?.(saved)
      onClose()
    } catch (caught) {
      toast({ tone: 'error', title: 'Bahan gagal disimpan', description: caught.message })
      setSaving(false)
    }
  }

  return (
    <Drawer
      title={editing ? `Ubah ${ingredient.name}` : 'Tambah bahan'}
      description="Semua stok dicatat dalam satuan dasar. Kemasan beli dipakai saat belanja dan PO."
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form="ingredient-form" loading={saving}>{editing ? 'Simpan' : 'Tambah bahan'}</Button>
        </>
      )}
    >
      <form id="ingredient-form" className="inv-form" onSubmit={handleSubmit} noValidate>
        <TextField label="Nama bahan" value={form.name} onChange={set('name')} maxLength={80} error={errors.name} placeholder="Mis. Susu UHT full cream" autoFocus />
        <div className="inv-form-row">
          <TextField label="Kategori" value={form.category} onChange={set('category')} maxLength={40} list="ingredient-categories" placeholder="Mis. Susu, Kopi, Kemasan" />
          <TextField label="Kode / SKU" hint="Opsional" value={form.sku} onChange={set('sku')} maxLength={40} />
        </div>
        <datalist id="ingredient-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist>
        <div className="inv-form-row">
          <Select label="Satuan dasar" value={form.unit} onChange={set('unit')} options={UNIT_OPTIONS}
            hint={editing ? 'Tidak bisa diubah setelah ada riwayat stok atau dipakai di resep' : 'Takaran resep memakai satuan ini'} />
          <TextField label="Stok minimum" value={form.min_stock} onChange={set('min_stock')} suffix={unit} error={errors.min_stock}
            hint="Di bawah ini muncul peringatan stok rendah" {...decimalProps} />
        </div>

        <fieldset className="inv-fieldset">
          <legend>Kemasan beli</legend>
          <div className="inv-form-row">
            <TextField label="Nama kemasan" value={form.purchase_unit} onChange={set('purchase_unit')} maxLength={20} error={errors.purchase_unit} placeholder="Mis. karton, pak, botol" />
            <TextField label="Isi per kemasan" value={form.purchase_unit_size} onChange={set('purchase_unit_size')} suffix={unit}
              error={errors.purchase_unit_size} placeholder="Mis. 12000" {...decimalProps} />
          </div>
          <div className="inv-form-row">
            <Select label="Supplier utama" value={form.default_supplier_id} onChange={set('default_supplier_id')}
              options={[{ value: '', label: 'Belum ditentukan' }, ...suppliers.filter((supplier) => supplier.is_active || supplier.id === form.default_supplier_id)
                .map((supplier) => ({ value: supplier.id, label: supplier.name }))]} />
            <TextField label="Waktu kirim" value={form.lead_time_days} onChange={set('lead_time_days')} suffix="hari" error={errors.lead_time_days}
              inputMode="numeric" hint="Dipakai untuk saran waktu beli" />
          </div>
        </fieldset>

        {!editing ? (
          <fieldset className="inv-fieldset">
            <legend>Stok awal <span className="text-muted">(opsional)</span></legend>
            <div className="inv-form-row">
              <TextField label="Jumlah sekarang" value={form.opening_qty} onChange={set('opening_qty')} suffix={unit} error={errors.opening_qty} {...decimalProps} />
              <RupiahInput label="Nilai stok itu" value={form.opening_value} onChange={set('opening_value')} error={errors.opening_value} />
            </div>
            {openingQty > 0 && openingValue > 0 && (
              <p className="ui-field-hint">Harga rata-rata awal {formatUnitCost(openingValue / openingQty, form.unit)}</p>
            )}
          </fieldset>
        ) : (
          <div className="inv-switch-line">
            <span><strong>Bahan aktif</strong><small>Bahan nonaktif disembunyikan dari opname, PO, dan perkiraan.</small></span>
            <Switch checked={form.is_active} onChange={set('is_active')} label="Bahan aktif" onLabel="Aktif" offLabel="Nonaktif" />
          </div>
        )}
      </form>
    </Drawer>
  )
}

/* ====================================================================
 * Stok masuk / keluar / penyesuaian
 * ==================================================================== */
const MODE_COPY = {
  in: { title: 'Stok masuk', description: 'Belanja langsung (tanpa PO) atau stok awal. Untuk belanja ke supplier dengan tagihan, pakai Pembelian.', confirm: 'Catat stok masuk' },
  out: { title: 'Stok keluar', description: 'Bahan terbuang, rusak, kedaluwarsa, atau dipakai di luar penjualan.', confirm: 'Catat stok keluar' },
  adjust: { title: 'Sesuaikan stok', description: 'Ubah saldo ke angka sebenarnya. Untuk menghitung banyak bahan sekaligus, pakai Stok opname.', confirm: 'Simpan penyesuaian' },
}

export function StockMoveDialog({ mode, ingredient, suppliers = [], batches = [], onClose, onDone }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const copy = MODE_COPY[mode]
  const hasPack = Boolean(ingredient.purchase_unit && Number(ingredient.purchase_unit_size) > 0)
  const unit = UNITS[ingredient.unit]?.short || ingredient.unit
  const [form, setForm] = useState({
    quantity: mode === 'adjust' ? String(Number(ingredient.on_hand)) : '',
    inPacks: hasPack && mode === 'in',
    value: '',
    supplier_id: ingredient.default_supplier_id || '',
    expires_at: '',
    reason: 'waste',
    batch_id: '',
    note: '',
    opening: Number(ingredient.on_hand) === 0 && Number(ingredient.avg_cost) === 0,
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (key) => (event) => {
    const value = event?.target ? (event.target.type === 'checkbox' ? event.target.checked : event.target.value) : event
    setForm((current) => ({ ...current, [key]: value }))
    setError('')
  }

  const entered = parseDecimal(form.quantity)
  const baseQty = entered === null ? null : form.inPacks ? entered * Number(ingredient.purchase_unit_size) : entered
  const onHand = Number(ingredient.on_hand) || 0
  const unitCost = mode === 'in' && baseQty > 0 && Number(form.value) > 0 ? Number(form.value) / baseQty : null
  const delta = mode === 'adjust' && baseQty !== null ? baseQty - onHand : null
  const openBatches = batches.filter((batch) => Number(batch.remaining) > 0)

  async function handleSubmit(event) {
    event.preventDefault()
    if (baseQty === null || (mode !== 'adjust' && baseQty <= 0) || baseQty < 0) return setError('Isi jumlah yang valid')
    if (mode === 'in' && !(Number(form.value) > 0)) return setError('Isi total harga agar harga rata-rata tetap benar')
    if (mode === 'out' && baseQty > onHand) return setError(`Stok tersedia hanya ${formatQty(onHand, ingredient.unit)}`)
    if (mode === 'adjust' && Math.abs(delta) < 0.0005) return setError('Angka sama dengan stok sekarang')
    if (mode === 'adjust' && form.note.trim().length < 3) return setError('Tulis alasan penyesuaian')
    setSaving(true)
    try {
      if (mode === 'in') {
        await callRpc(supabase, 'inventory_stock_in', {
          p_ingredient_id: ingredient.id, p_quantity: Number(baseQty.toFixed(3)), p_unit_cost: Number(unitCost.toFixed(4)),
          p_expires_at: form.expires_at || null, p_supplier_id: form.supplier_id || null, p_note: form.note || null, p_is_opening: form.opening,
        })
      } else if (mode === 'out') {
        await callRpc(supabase, 'inventory_stock_out', {
          p_ingredient_id: ingredient.id, p_quantity: Number(baseQty.toFixed(3)), p_reason: form.reason, p_note: form.note || null, p_batch_id: form.batch_id || null,
        })
      } else {
        await callRpc(supabase, 'inventory_adjust', { p_ingredient_id: ingredient.id, p_new_quantity: Number(baseQty.toFixed(3)), p_note: form.note, p_unit_cost: null })
      }
      toast({ tone: 'success', title: `${copy.title} · ${ingredient.name}`, description: mode === 'adjust' ? `Stok jadi ${formatQty(baseQty, ingredient.unit)}` : formatQty(baseQty, ingredient.unit) })
      onDone?.()
      onClose()
    } catch (caught) {
      setError(caught.message)
      setSaving(false)
    }
    return undefined
  }

  return (
    <Dialog
      title={`${copy.title} · ${ingredient.name}`}
      description={copy.description}
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form="stock-move-form" loading={saving} variant={mode === 'out' ? 'danger' : 'primary'}>{copy.confirm}</Button>
        </>
      )}
    >
      <form id="stock-move-form" className="inv-form" onSubmit={handleSubmit} noValidate>
        <p className="inv-current">Stok sekarang <strong className="tabular">{formatQty(onHand, ingredient.unit)}</strong>
          {Number(ingredient.avg_cost) > 0 && <> · rata-rata {formatUnitCost(ingredient.avg_cost, ingredient.unit)}</>}
        </p>
        {hasPack && mode !== 'adjust' && (
          <SegmentedControl size="sm" label="Satuan jumlah" value={form.inPacks ? 'pack' : 'base'} onChange={(value) => set('inPacks')(value === 'pack')}
            options={[{ value: 'pack', label: `Per ${ingredient.purchase_unit}` }, { value: 'base', label: unit }]} />
        )}
        <div className="inv-form-row">
          <TextField
            label={mode === 'adjust' ? 'Stok sebenarnya' : 'Jumlah'}
            value={form.quantity}
            onChange={set('quantity')}
            suffix={form.inPacks ? ingredient.purchase_unit : unit}
            hint={form.inPacks && baseQty > 0 ? `= ${formatQty(baseQty, ingredient.unit)}` : delta !== null && Math.abs(delta) >= 0.0005 ? `Selisih ${formatQty(delta, ingredient.unit, { signed: true })}` : undefined}
            autoFocus
            {...decimalProps}
          />
          {mode === 'in' && (
            <RupiahInput label="Total harga" value={form.value} onChange={set('value')} hint={unitCost ? `= ${formatUnitCost(unitCost, ingredient.unit)}` : 'Harga yang dibayar untuk jumlah ini'} />
          )}
          {mode === 'out' && <Select label="Alasan" value={form.reason} onChange={set('reason')} options={STOCK_OUT_REASONS} />}
        </div>
        {mode === 'in' && (
          <div className="inv-form-row">
            <Select label="Dari supplier" value={form.supplier_id} onChange={set('supplier_id')}
              options={[{ value: '', label: 'Tanpa supplier (pasar, toko)' }, ...suppliers.filter((supplier) => supplier.is_active).map((supplier) => ({ value: supplier.id, label: supplier.name }))]} />
            <TextField label="Kedaluwarsa" type="date" value={form.expires_at} onChange={set('expires_at')} hint="Opsional, untuk peringatan" />
          </div>
        )}
        {mode === 'out' && openBatches.length > 0 && (
          <Select label="Ambil dari batch" value={form.batch_id} onChange={set('batch_id')} hint="Kosongkan: otomatis dari yang paling cepat kedaluwarsa"
            options={[{ value: '', label: 'Otomatis' }, ...openBatches.map((batch) => ({ value: batch.id, label: `Exp ${formatDateShort(`${batch.expires_at}T00:00:00+07:00`)} · sisa ${formatQty(batch.remaining, ingredient.unit)}` }))]} />
        )}
        <TextField label={mode === 'adjust' ? 'Alasan' : 'Catatan'} value={form.note} onChange={set('note')} maxLength={300}
          placeholder={mode === 'adjust' ? 'Mis. salah hitung saat input awal' : 'Opsional'} />
        {mode === 'in' && (
          <label className="inv-check">
            <input type="checkbox" checked={form.opening} onChange={set('opening')} />
            <span>Catat sebagai <strong>stok awal</strong> (stok yang sudah ada sebelum memakai sistem, bukan belanja baru)</span>
          </label>
        )}
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}

/* ====================================================================
 * Detail bahan: info, batch kedaluwarsa, mutasi terakhir
 * ==================================================================== */
export function IngredientDetailDrawer({ ingredient, supplierName, expiryAlertDays = 3, onClose, onAction, basePath = '' }) {
  const { supabase } = useAuth()
  const today = jakartaDateKey()
  const load = useCallback(async () => {
    const [batchResult, movementResult] = await Promise.all([
      supabase.from('ingredient_batches').select('id, expires_at, quantity, remaining, received_at').eq('ingredient_id', ingredient.id).order('expires_at'),
      supabase.from('stock_movements').select('id, movement_type, quantity, unit_cost, total_cost, balance_after, note, occurred_at')
        .eq('ingredient_id', ingredient.id).order('occurred_at', { ascending: false }).limit(15),
    ])
    const failure = batchResult.error || movementResult.error
    if (failure) throw new Error(inventoryError(failure))
    return { batches: (batchResult.data || []).filter((batch) => Number(batch.remaining) > 0), movements: movementResult.data || [] }
  }, [ingredient.id, supabase])
  const { data, loading, error, reload } = useLoader(load)
  const status = STOCK_STATUS[stockStatus(ingredient)]
  const facts = useMemo(() => [
    ['Stok', formatQty(ingredient.on_hand, ingredient.unit)],
    ['Minimum', formatQty(ingredient.min_stock, ingredient.unit)],
    ['Harga rata-rata', Number(ingredient.avg_cost) ? formatUnitCost(ingredient.avg_cost, ingredient.unit) : 'Belum ada'],
    ['Nilai persediaan', formatRupiah(stockValue(ingredient))],
    ['Beli terakhir', ingredient.last_purchase_cost ? formatUnitCost(ingredient.last_purchase_cost, ingredient.unit) : '—'],
    ['Supplier utama', supplierName || '—'],
    ['Kemasan beli', ingredient.purchase_unit ? `1 ${ingredient.purchase_unit} = ${formatQty(ingredient.purchase_unit_size, ingredient.unit, { scale: false })}` : '—'],
    ['Waktu kirim', `${ingredient.lead_time_days} hari`],
  ], [ingredient, supplierName])

  return (
    <Drawer
      title={ingredient.name}
      description={[ingredient.category, ingredient.sku].filter(Boolean).join(' · ') || 'Bahan baku'}
      headerExtra={<Badge tone={status.tone} className="inv-detail-badge">{status.label}</Badge>}
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" icon={Pencil} onClick={() => onAction('edit')} className="drawer-footer-start">Ubah</Button>
          <Button variant="secondary" icon={SlidersHorizontal} onClick={() => onAction('adjust', data?.batches)}>Sesuaikan</Button>
          <Button variant="secondary" icon={ArrowUpFromLine} onClick={() => onAction('out', data?.batches)} disabled={Number(ingredient.on_hand) <= 0}>Keluar</Button>
          <Button icon={ArrowDownToLine} onClick={() => onAction('in', data?.batches)}>Masuk</Button>
        </>
      )}
    >
      <dl className="inv-facts">
        {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="tabular">{value}</dd></div>)}
      </dl>
      {loading && !data ? <SkeletonRows rows={4} label="Memuat riwayat" />
        : error ? <ErrorState compact message={error} onRetry={reload} />
          : (
            <>
              {data.batches.length > 0 && (
                <section className="inv-section">
                  <h3>Batch dengan tanggal kedaluwarsa</h3>
                  <ul className="inv-batches">
                    {data.batches.map((batch) => {
                      const days = daysUntil(batch.expires_at, today)
                      return (
                        <li key={batch.id}>
                          <span className="tabular">{formatDateShort(`${batch.expires_at}T00:00:00+07:00`)}</span>
                          <span className="tabular">{formatQty(batch.remaining, ingredient.unit)}</span>
                          {days < 0 ? <Badge tone="red" size="sm">Lewat {Math.abs(days)} hari</Badge>
                            : days <= expiryAlertDays ? <Badge tone="amber" size="sm">{days === 0 ? 'Hari ini' : `${days} hari lagi`}</Badge>
                              : <span className="text-muted">{days} hari lagi</span>}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}
              <section className="inv-section">
                <div className="inv-section-head">
                  <h3>Mutasi terakhir</h3>
                  <Link to={`${basePath}/inventory/movements?ingredient=${ingredient.id}`} onClick={onClose}>Semua mutasi</Link>
                </div>
                {data.movements.length ? (
                  <ol className="inv-moves">
                    {data.movements.map((move) => {
                      const meta = MOVEMENT_TYPES[move.movement_type] || { label: move.movement_type, tone: 'neutral' }
                      return (
                        <li key={move.id}>
                          <span className="inv-moves-main">
                            <Badge tone={meta.tone} size="sm" dot={false}>{meta.label}</Badge>
                            <small>{formatDateTime(move.occurred_at)}{move.note ? ` · ${move.note}` : ''}</small>
                          </span>
                          <span className={`inv-moves-qty tabular${Number(move.quantity) < 0 ? ' is-out' : ''}`}>{formatQty(move.quantity, ingredient.unit, { signed: true })}</span>
                          <span className="inv-moves-balance tabular">{formatQty(move.balance_after, ingredient.unit)}</span>
                        </li>
                      )
                    })}
                  </ol>
                ) : <p className="text-muted">Belum ada mutasi. Catat stok awal lewat tombol Masuk.</p>}
              </section>
            </>
          )}
    </Drawer>
  )
}
