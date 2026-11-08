/*
 * Supplier: profil & kontak, katalog bahan per supplier (harga terakhir), riwayat PO & utang.
 */
import { useCallback, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { MessageCircle, Plus, Trash2, Truck, UserPlus } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import {
  Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, IconButton, PageHeader, RupiahInput, SearchInput, Select,
  SkeletonRows, Switch, TextField, useToast,
} from '../../components/ui/index.js'
import { INVENTORY_REQUIRED } from '../../lib/db.js'
import { formatNumber, formatRupiah, formatRelative } from '../../lib/format.js'
import {
  dateOnly, fetchIngredients, fetchSuppliers, inventoryError, outstandingOf, parseDecimal, PO_STATUS, UNITS, useLoader, useOwnerBase,
} from '../../lib/inventory.js'

export function SuppliersPage() {
  const context = useOutletContext()
  return (
    <div className="page">
      <PageHeader eyebrow="Inventori" title="Supplier" description="Kontak pemasok, harga bahan per supplier, dan utang yang berjalan." />
      {context.features?.inventory ? <SuppliersContent cafe={context.cafe} /> : <Card><EmptyState title="Belum tersedia" description={INVENTORY_REQUIRED} /></Card>}
    </div>
  )
}

function SuppliersContent({ cafe }) {
  const { supabase } = useAuth()
  const [query, setQuery] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [dialog, setDialog] = useState(null)

  const load = useCallback(async () => {
    const [suppliers, ingredients, orderResult] = await Promise.all([
      fetchSuppliers(supabase, cafe.id),
      fetchIngredients(supabase, cafe.id),
      supabase.from('purchase_orders').select('id, supplier_id, status, received_amount, paid_amount, created_at').eq('cafe_id', cafe.id),
    ])
    if (orderResult.error) throw new Error(inventoryError(orderResult.error))
    return { suppliers, ingredients, orders: orderResult.data || [] }
  }, [cafe.id, supabase])
  const { data, error, loading, reload } = useLoader(load)

  const stats = useMemo(() => {
    const map = new Map()
    for (const po of data?.orders || []) {
      const entry = map.get(po.supplier_id) || { count: 0, payable: 0, last: null }
      entry.count += 1
      if (po.status !== 'cancelled') entry.payable += Math.max(outstandingOf(po), 0)
      if (!entry.last || po.created_at > entry.last) entry.last = po.created_at
      map.set(po.supplier_id, entry)
    }
    return map
  }, [data])

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id')
    return (data?.suppliers || []).filter((supplier) => (showInactive || supplier.is_active)
      && (!needle || [supplier.name, supplier.contact_name, supplier.phone].filter(Boolean).join(' ').toLocaleLowerCase('id').includes(needle)))
  }, [data, query, showInactive])

  if (error) return <Card><ErrorState message={error} onRetry={reload} /></Card>
  if (!data) return <Card padding="none"><SkeletonRows rows={5} label="Memuat supplier" /></Card>

  const editing = dialog?.id ? data.suppliers.find((supplier) => supplier.id === dialog.id) : null
  return (
    <div className="inv-page">
      <section className="toolbar" aria-label="Filter supplier">
        <SearchInput value={query} onChange={setQuery} placeholder="Cari nama, kontak, nomor…" label="Cari supplier" className="toolbar-search" />
        <Switch checked={showInactive} onChange={setShowInactive} label="Tampilkan supplier nonaktif" onLabel="Termasuk nonaktif" offLabel="Hanya aktif" />
        <Button icon={UserPlus} className="toolbar-end" onClick={() => setDialog({ type: 'form' })}>Tambah supplier</Button>
      </section>

      <Card padding="none" className={`table-card${loading ? ' is-refreshing' : ''}`}>
        {!data.suppliers.length ? (
          <EmptyState icon={Truck} title="Belum ada supplier" description="Catat pemasok susu, biji kopi, kemasan, dan lainnya agar bisa membuat PO dan melacak utang."
            action={<Button icon={UserPlus} onClick={() => setDialog({ type: 'form' })}>Tambah supplier</Button>} />
        ) : !rows.length ? <EmptyState compact title="Tidak ada supplier yang cocok" description="Ubah kata kunci." /> : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr><th scope="col">Supplier</th><th scope="col">Kontak</th><th scope="col">Termin</th><th scope="col" className="num">PO</th><th scope="col" className="num">Utang</th><th scope="col">Status</th></tr>
              </thead>
              <tbody>
                {rows.map((supplier) => {
                  const stat = stats.get(supplier.id)
                  return (
                    <tr key={supplier.id} className={`is-clickable${supplier.is_active ? '' : ' is-muted'}`} onClick={() => setDialog({ type: 'form', id: supplier.id })}>
                      <td><span className="inv-name"><strong>{supplier.name}</strong><small>{stat?.last ? `PO terakhir ${formatRelative(stat.last)}` : 'Belum ada PO'}</small></span></td>
                      <td><span className="inv-name"><span>{supplier.contact_name || '—'}</span><small className="tabular">{supplier.phone || ''}</small></span></td>
                      <td>{supplier.payment_terms_days ? `${supplier.payment_terms_days} hari` : 'Tunai'}</td>
                      <td className="num tabular">{formatNumber(stat?.count || 0)}</td>
                      <td className="num tabular">{stat?.payable ? <strong>{formatRupiah(stat.payable)}</strong> : <span className="text-muted">—</span>}</td>
                      <td>{supplier.is_active ? <Badge tone="green">Aktif</Badge> : <Badge tone="neutral">Nonaktif</Badge>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dialog?.type === 'form' && (
        <SupplierDrawer key={dialog.id || 'new'} cafeId={cafe.id} supplier={editing} ingredients={data.ingredients}
          orders={data.orders.filter((po) => po.supplier_id === dialog.id)} onClose={() => setDialog(null)} onSaved={reload} />
      )}
    </div>
  )
}

function SupplierDrawer({ cafeId, supplier, ingredients, orders, onClose, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const base = useOwnerBase()
  const editing = Boolean(supplier)
  const [form, setForm] = useState(() => ({
    name: supplier?.name || '', contact_name: supplier?.contact_name || '', phone: supplier?.phone || '', email: supplier?.email || '',
    address: supplier?.address || '', payment_terms_days: String(supplier?.payment_terms_days ?? 0), notes: supplier?.notes || '', is_active: supplier?.is_active ?? true,
  }))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (key) => (event) => {
    const value = event?.target ? event.target.value : event
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }
  const whatsapp = form.phone.replace(/\D/g, '').replace(/^0/, '62')

  async function save(event) {
    event.preventDefault()
    const next = {}
    if (form.name.trim().length < 2) next.name = 'Nama minimal 2 huruf'
    const terms = Number(form.payment_terms_days)
    if (!Number.isInteger(terms) || terms < 0 || terms > 180) next.payment_terms_days = '0–180 hari'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = 'Email tidak valid'
    setErrors(next)
    if (Object.keys(next).length) return
    setSaving(true)
    const values = {
      name: form.name.trim(), contact_name: form.contact_name.trim() || null, phone: form.phone.trim() || null, email: form.email.trim() || null,
      address: form.address.trim() || null, payment_terms_days: terms, notes: form.notes.trim() || null, is_active: form.is_active,
    }
    const { error } = editing
      ? await supabase.from('suppliers').update(values).eq('id', supplier.id)
      : await supabase.from('suppliers').insert({ ...values, cafe_id: cafeId })
    if (error) {
      toast({ tone: 'error', title: 'Supplier gagal disimpan', description: inventoryError(error) })
      setSaving(false)
      return
    }
    toast({ tone: 'success', title: editing ? 'Supplier diperbarui' : `${values.name} ditambahkan` })
    onSaved()
    onClose()
  }

  async function remove() {
    const { error } = await supabase.from('suppliers').delete().eq('id', supplier.id)
    if (error) throw new Error(inventoryError(error))
    toast({ title: `${supplier.name} dihapus` })
    onSaved()
    onClose()
  }

  const payable = orders.filter((po) => po.status !== 'cancelled').reduce((sum, po) => sum + Math.max(outstandingOf(po), 0), 0)
  return (
    <Drawer
      title={editing ? supplier.name : 'Tambah supplier'}
      description={editing ? `${orders.length} PO · utang ${formatRupiah(payable)}` : 'Kontak dan termin pembayaran.'}
      size={editing ? 'lg' : 'md'}
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          {editing && !orders.length && <Button variant="ghost" icon={Trash2} className="drawer-footer-start" onClick={() => setConfirmDelete(true)}>Hapus</Button>}
          {editing && orders.length > 0 && <Button as={Link} variant="ghost" className="drawer-footer-start" to={`${base}/purchases?supplier=${supplier.id}`}>Lihat PO</Button>}
          <Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form="supplier-form" loading={saving}>{editing ? 'Simpan' : 'Tambah supplier'}</Button>
        </>
      )}
    >
      <form id="supplier-form" className="inv-form" onSubmit={save} noValidate>
        <TextField label="Nama supplier" value={form.name} onChange={set('name')} maxLength={80} error={errors.name} autoFocus={!editing} placeholder="Mis. CV Susu Segar Jaya" />
        <div className="inv-form-row">
          <TextField label="Nama kontak" value={form.contact_name} onChange={set('contact_name')} maxLength={80} />
          <TextField label="Telepon / WhatsApp" value={form.phone} onChange={set('phone')} maxLength={30} inputMode="tel"
            hint={whatsapp.length >= 9 ? <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer" className="inv-wa"><MessageCircle size={13} aria-hidden="true" /> Buka WhatsApp</a> : undefined} />
        </div>
        <div className="inv-form-row">
          <TextField label="Email" type="email" value={form.email} onChange={set('email')} maxLength={254} error={errors.email} />
          <TextField label="Termin bayar" value={form.payment_terms_days} onChange={set('payment_terms_days')} suffix="hari" inputMode="numeric" error={errors.payment_terms_days}
            hint="0 = bayar saat barang datang" />
        </div>
        <TextField label="Alamat" value={form.address} onChange={set('address')} maxLength={300} />
        <TextField label="Catatan" multiline rows={2} value={form.notes} onChange={set('notes')} maxLength={500} placeholder="Mis. kirim tiap Senin & Kamis, minimal order 5 karton" />
        {editing && (
          <div className="inv-switch-line">
            <span><strong>Supplier aktif</strong><small>Supplier nonaktif tidak muncul saat membuat PO.</small></span>
            <Switch checked={form.is_active} onChange={set('is_active')} label="Supplier aktif" onLabel="Aktif" offLabel="Nonaktif" />
          </div>
        )}
      </form>

      {editing && <SupplierCatalog supplier={supplier} ingredients={ingredients} />}
      {editing && orders.length > 0 && (
        <section className="inv-section">
          <h3>PO terakhir</h3>
          <ul className="po-payments">
            {[...orders].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 5).map((po) => (
              <li key={po.id}>
                <span className="inv-name"><strong>{dateOnly(po.created_at.slice(0, 10))}</strong><small>{formatRupiah(po.received_amount)} diterima · {formatRupiah(po.paid_amount)} dibayar</small></span>
                <Badge tone={PO_STATUS[po.status].tone} size="sm">{PO_STATUS[po.status].label}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {confirmDelete && (
        <ConfirmDialog title={`Hapus ${supplier.name}?`} confirmLabel="Hapus supplier" description="Supplier tanpa PO dan tanpa riwayat stok bisa dihapus. Katalog harganya ikut terhapus."
          onConfirm={remove} onClose={() => setConfirmDelete(false)} />
      )}
    </Drawer>
  )
}

function SupplierCatalog({ supplier, ingredients }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [draft, setDraft] = useState({ ingredient_id: '', unit_label: '', unit_size: '', last_price: '' })
  const [busy, setBusy] = useState(false)
  const byId = useMemo(() => new Map(ingredients.map((item) => [item.id, item])), [ingredients])
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('supplier_items').select('id, ingredient_id, supplier_sku, unit_label, unit_size, last_price, last_purchased_at').eq('supplier_id', supplier.id)
    if (error) throw new Error(inventoryError(error))
    return data || []
  }, [supabase, supplier.id])
  const { data, error, reload } = useLoader(load)
  const listed = new Set((data || []).map((row) => row.ingredient_id))
  const available = ingredients.filter((item) => item.is_active && !listed.has(item.id))

  function pick(ingredientId) {
    const item = byId.get(ingredientId)
    setDraft({
      ingredient_id: ingredientId,
      unit_label: item?.purchase_unit || UNITS[item?.unit]?.short || '',
      unit_size: item?.purchase_unit_size ? String(Number(item.purchase_unit_size)) : '1',
      last_price: '',
    })
  }

  async function add() {
    const size = parseDecimal(draft.unit_size)
    if (!draft.ingredient_id || !(size > 0) || !draft.unit_label.trim()) {
      toast({ tone: 'error', title: 'Lengkapi bahan, kemasan, dan isi per kemasan' })
      return
    }
    setBusy(true)
    const { error: insertError } = await supabase.from('supplier_items').insert({
      supplier_id: supplier.id, ingredient_id: draft.ingredient_id, unit_label: draft.unit_label.trim(), unit_size: size, last_price: Number(draft.last_price) || null,
    })
    setBusy(false)
    if (insertError) {
      toast({ tone: 'error', title: 'Gagal menambah', description: inventoryError(insertError) })
      return
    }
    setDraft({ ingredient_id: '', unit_label: '', unit_size: '', last_price: '' })
    reload()
  }

  async function remove(row) {
    const { error: deleteError } = await supabase.from('supplier_items').delete().eq('id', row.id)
    if (deleteError) toast({ tone: 'error', title: 'Gagal menghapus', description: inventoryError(deleteError) })
    else reload()
  }

  return (
    <section className="inv-section">
      <h3>Katalog bahan dari supplier ini</h3>
      <p className="ui-field-hint">Harga terakhir terisi otomatis saat barang PO diterima, dan dipakai sebagai harga awal PO berikutnya.</p>
      {error ? <ErrorState compact message={error} onRetry={reload} /> : !data ? <SkeletonRows rows={2} label="Memuat katalog" /> : (
        <>
          {data.length > 0 && (
            <table className="data-table">
              <thead><tr><th scope="col">Bahan</th><th scope="col">Kemasan</th><th scope="col" className="num">Harga terakhir</th><th scope="col"><span className="sr-only">Aksi</span></th></tr></thead>
              <tbody>
                {data.map((row) => {
                  const item = byId.get(row.ingredient_id)
                  return (
                    <tr key={row.id}>
                      <th scope="row">{item?.name || 'Bahan'}</th>
                      <td className="tabular">{row.unit_label} · {formatNumber(row.unit_size)} {UNITS[item?.unit]?.short || ''}</td>
                      <td className="num tabular">{row.last_price ? formatRupiah(row.last_price) : <span className="text-muted">—</span>}{row.last_purchased_at && <small className="cell-sub">{formatRelative(row.last_purchased_at)}</small>}</td>
                      <td className="cell-actions"><IconButton icon={Trash2} size="sm" variant="danger" label={`Hapus ${item?.name} dari katalog`} onClick={() => remove(row)} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {available.length > 0 && (
            <div className="catalog-add">
              <Select hideLabel label="Bahan" value={draft.ingredient_id} onChange={(event) => pick(event.target.value)}
                options={[{ value: '', label: 'Tambah bahan ke katalog…' }, ...available.map((item) => ({ value: item.id, label: item.name }))]} />
              {draft.ingredient_id && (
                <>
                  <TextField hideLabel label="Kemasan" value={draft.unit_label} maxLength={20} placeholder="karton" onChange={(event) => setDraft((current) => ({ ...current, unit_label: event.target.value }))} />
                  <TextField hideLabel label="Isi per kemasan" value={draft.unit_size} inputMode="decimal" suffix={UNITS[byId.get(draft.ingredient_id)?.unit]?.short}
                    onChange={(event) => setDraft((current) => ({ ...current, unit_size: event.target.value }))} />
                  <RupiahInput hideLabel label="Harga per kemasan" value={draft.last_price} onChange={(value) => setDraft((current) => ({ ...current, last_price: value }))} />
                  <Button size="sm" icon={Plus} loading={busy} onClick={add}>Tambah</Button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
