/*
 * Kasir (POS): pesanan walk-in memakai jalur yang sama dengan app (place_order).
 * Keranjang tersimpan di perangkat ini; pesanan yang ditahan tersimpan di server.
 */
import { useCallback, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { canDo } from '../../lib/permissions.js'
import {
  CircleCheck, Coffee, Minus, PauseCircle, PercentCircle, Plus, Printer, RefreshCw, ShoppingBag, Trash2, Wallet,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import {
  Badge, Button, Card, ConfirmDialog, Dialog, Drawer, EmptyState, ErrorState, IconButton, RupiahInput, SearchInput, SegmentedControl,
  Select, SkeletonRows, TextField, useToast,
} from '../../components/ui/index.js'
import { OptionPickerDialog } from '../../components/pos/OptionPickerDialog.jsx'
import { PaymentDialog } from '../../components/pos/PaymentDialog.jsx'
import { OpenSessionDialog } from '../../components/pos/CashierDialogs.jsx'
import { brandOf } from '../../lib/branding.js'
import { friendlyError, orderColumns, POS_REQUIRED } from '../../lib/db.js'
import { formatNumber, formatQueueNumber, formatRelative, formatRupiah, formatTime } from '../../lib/format.js'
import { useLoader } from '../../lib/inventory.js'
import {
  cartTotals, emptyCart, fetchOpenSession, groupOptions, lineLabel, lineTotal, newLine, placeOrderPayload, rpc,
} from '../../lib/pos.js'
import { printKitchenTicket, printReceipt } from '../../lib/printReceipt.js'
import { ORDER_TYPE_LABEL } from '../../lib/status.js'

const cartKey = (cafeId) => `dailybrew.pos.cart.${cafeId}`
function readCart(cafeId) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(cartKey(cafeId)) || 'null')
    return stored && Array.isArray(stored.lines) ? stored : null
  } catch {
    return null
  }
}
function writeCart(cafeId, cart) {
  try {
    window.localStorage.setItem(cartKey(cafeId), JSON.stringify(cart))
  } catch {
    // mode privat
  }
}

export function PosPage() {
  const context = useOutletContext()
  if (!context.features?.pos) {
    return <div className="page"><Card><EmptyState icon={ShoppingBag} title="Kasir belum aktif" description={POS_REQUIRED} /></Card></div>
  }
  if (!canDo(context.permissions, 'pos.sell')) {
    return <div className="page"><Card><EmptyState icon={ShoppingBag} title="Kasir tidak tersedia untuk akunmu" description="Owner belum memberi izin Kasir (POS). Minta diaktifkan di menu Tim → Atur izin." /></Card></div>
  }
  return <Pos context={context} />
}

function Pos({ context }) {
  const { cafe, profile, features } = context
  const { supabase, session: authSession } = useAuth()
  const { toast } = useToast()
  const userId = authSession?.user?.id || profile?.id

  const load = useCallback(async () => {
    const [products, categories, groups, options, availability, tables, settings, held, openSession] = await Promise.all([
      supabase.from('products').select('id, name, price, image_url, is_available, category_id').eq('cafe_id', cafe.id).order('name'),
      supabase.from('categories').select('id, name, sort_order').eq('cafe_id', cafe.id).order('sort_order'),
      supabase.from('product_option_groups').select('id, product_id, name, selection_type, is_required, max_select, sort_order').eq('cafe_id', cafe.id),
      supabase.from('product_options').select('id, group_id, name, price_delta, is_available, is_default, sort_order').eq('cafe_id', cafe.id),
      supabase.rpc('product_availability', { p_cafe_id: cafe.id }),
      supabase.from('cafe_tables').select('id, label, area, is_active, sort_order').eq('cafe_id', cafe.id).eq('is_active', true).order('sort_order'),
      supabase.from('cafe_settings').select('*').eq('cafe_id', cafe.id).maybeSingle(),
      supabase.from('pos_held_orders').select('id, label, cart, created_by, updated_at').eq('cafe_id', cafe.id).order('updated_at', { ascending: false }),
      fetchOpenSession(supabase, cafe.id, userId),
    ])
    const failure = [products, categories, groups, options, availability, tables, settings, held].find((result) => result.error)?.error
    if (failure) throw new Error(friendlyError(failure))
    return {
      products: products.data || [],
      categories: categories.data || [],
      optionsByProduct: groupOptions(groups.data || [], options.data || []),
      availability: new Map((availability.data || []).map((row) => [row.product_id, row])),
      tables: tables.data || [],
      settings: settings.data || {},
      held: held.data || [],
      session: openSession,
    }
  }, [cafe.id, supabase, userId])
  const { data, error, reload, loading } = useLoader(load)

  if (error && !data) return <div className="page"><Card><ErrorState message={error} onRetry={reload} /></Card></div>
  if (!data) return <div className="page page-wide"><Card padding="none"><SkeletonRows rows={8} label="Memuat kasir" /></Card></div>
  return <PosScreen cafe={cafe} profile={profile} features={features} data={data} reload={reload} loading={loading} supabase={supabase} toast={toast} />
}

function PosScreen({ cafe, profile, features, data, reload, loading, supabase, toast }) {
  const [cart, setCartState] = useState(() => readCart(cafe.id) || emptyCart(data.settings))
  const [placedOrder, setPlaced] = useState(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [dialog, setDialog] = useState(null)
  const [mobileCart, setMobileCart] = useState(false)
  const [busy, setBusy] = useState(null)
  const settings = data.settings
  const totals = cartTotals(cart, settings)
  const isOwner = profile?.role === 'owner'
  const discountLimit = isOwner ? 100 : canDo(context.permissions, 'pos.discount') ? Number(settings.staff_max_discount_pct) || 0 : 0

  const setCart = useCallback((updater) => {
    setCartState((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      writeCart(cafe.id, next)
      return next
    })
  }, [cafe.id])

  // Pesanan yang sudah dibuat hanya berlaku untuk keranjang dengan kunci yang sama
  const placed = placedOrder && placedOrder.idempotency_key === cart.key ? placedOrder : null

  const products = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id')
    return data.products.filter((product) => (category === 'all' || product.category_id === category)
      && (!needle || product.name.toLocaleLowerCase('id').includes(needle)))
  }, [category, data.products, query])

  function addProduct(product) {
    const availability = data.availability.get(product.id)
    if (availability && !availability.available) return
    const groups = data.optionsByProduct.get(product.id) || []
    if (groups.length) {
      setDialog({ type: 'options', product, groups })
      return
    }
    setCart((current) => {
      const existing = current.lines.find((line) => line.productId === product.id && !line.options.length && !line.notes)
      if (existing) return { ...current, lines: current.lines.map((line) => (line === existing ? { ...line, quantity: Math.min(99, line.quantity + 1) } : line)) }
      return { ...current, lines: [...current.lines, newLine(product, [])] }
    })
  }

  function changeQty(lineId, delta) {
    setCart((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.id === lineId ? { ...line, quantity: Math.min(99, line.quantity + delta) } : line)).filter((line) => line.quantity > 0),
    }))
  }

  function resetCart() {
    setPlaced(null)
    setCart(emptyCart(settings))
  }

  async function fetchOrder(orderId) {
    const [orderResult, itemsResult] = await Promise.all([
      supabase.from('orders').select(orderColumns(features)).eq('id', orderId).maybeSingle(),
      supabase.from('order_items').select('id, product_name, price, quantity, subtotal, notes').eq('order_id', orderId).order('created_at', { ascending: true }),
    ])
    if (orderResult.error) throw new Error(friendlyError(orderResult.error))
    return { ...orderResult.data, idempotency_key: cart.key, items: itemsResult.data || [] }
  }

  /** Buat pesanan sekali per keranjang (kunci anti-dobel). */
  async function ensureOrder() {
    if (placed) return placed
    try {
      const orderId = await rpc(supabase, 'place_order', placeOrderPayload(cafe.id, cart))
      const order = await fetchOrder(orderId)
      setPlaced(order)
      if (cart.heldId) await supabase.from('pos_held_orders').delete().eq('id', cart.heldId)
      if (settings.print_kitchen_ticket !== false) printKitchenTicket({ order, items: order.items, settings })
      return order
    } catch (caught) {
      reload()
      throw caught
    }
  }

  async function sendWithoutPayment() {
    setBusy('send')
    try {
      const order = await ensureOrder()
      toast({ tone: 'success', title: `${formatQueueNumber(order)} dikirim ke dapur`, description: `Belum dibayar · ${formatRupiah(order.total_amount)}` })
      resetCart()
      reload()
    } catch (caught) {
      toast({ tone: 'error', title: 'Pesanan gagal dibuat', description: caught.message })
    }
    setBusy(null)
  }

  async function holdCart(label) {
    const payload = { label, cart: { ...cart, heldId: null } }
    const { error } = cart.heldId
      ? await supabase.from('pos_held_orders').update(payload).eq('id', cart.heldId)
      : await supabase.from('pos_held_orders').insert({ ...payload, cafe_id: cafe.id })
    if (error) throw new Error(friendlyError(error))
    toast({ title: `Pesanan "${label}" ditahan`, description: 'Lanjutkan dari tombol Ditahan.' })
    resetCart()
    reload()
  }

  async function resumeHeld(held) {
    setCart({ ...held.cart, key: held.cart.key || emptyCart(settings).key, heldId: held.id })
    setDialog(null)
  }

  async function deleteHeld(held) {
    const { error } = await supabase.from('pos_held_orders').delete().eq('id', held.id)
    if (error) throw new Error(friendlyError(error))
    if (cart.heldId === held.id) setCart((current) => ({ ...current, heldId: null }))
    reload()
  }

  const cartPanel = (
    <CartPanel
      cart={cart}
      setCart={setCart}
      totals={totals}
      settings={settings}
      tables={data.tables}
      placed={placed}
      busy={busy}
      onEditLine={(line) => {
        const groups = data.optionsByProduct.get(line.productId) || []
        const product = data.products.find((item) => item.id === line.productId)
        if (groups.length && product) setDialog({ type: 'options', product, groups, line })
      }}
      onQty={changeQty}
      onDiscount={() => setDialog({ type: 'discount' })}
      discountLimit={discountLimit}
      onHold={() => setDialog({ type: 'hold' })}
      onClear={() => setDialog({ type: 'clear' })}
      onSend={sendWithoutPayment}
      onPay={() => { setMobileCart(false); setDialog({ type: 'pay' }) }}
    />
  )

  return (
    <div className="page page-wide pos-page">
      <header className="pos-head">
        <div>
          <h1 className="pos-title">Kasir</h1>
          <SessionPill session={data.session} onOpen={() => setDialog({ type: 'open-session' })} />
        </div>
        <div className="pos-head-actions">
          <Button variant="secondary" icon={PauseCircle} onClick={() => setDialog({ type: 'held' })}>
            Ditahan{data.held.length ? <span className="btn-count tabular">{data.held.length}</span> : null}
          </Button>
          <IconButton icon={RefreshCw} variant="secondary" label="Muat ulang stok & menu" onClick={reload} className={loading ? 'ui-spin-icon' : ''} />
        </div>
      </header>

      <div className="pos">
        <section className="pos-catalog" aria-label="Menu">
          <div className="pos-filters">
            <SearchInput value={query} onChange={setQuery} placeholder="Cari menu…" label="Cari menu" className="pos-search" />
            <div className="pos-chips" role="tablist" aria-label="Kategori">
              {[{ id: 'all', name: 'Semua' }, ...data.categories].map((item) => (
                <button key={item.id} type="button" role="tab" aria-selected={category === item.id}
                  className={`pos-chip${category === item.id ? ' is-active' : ''}`} onClick={() => setCategory(item.id)}>{item.name}</button>
              ))}
            </div>
          </div>
          {!products.length ? <EmptyState compact icon={Coffee} title="Menu tidak ditemukan" description="Ubah kata kunci atau kategori." /> : (
            <div className="pos-grid">
              {products.map((product) => {
                const availability = data.availability.get(product.id)
                const soldOut = availability ? !availability.available : !product.is_available
                const portions = availability?.portions
                const inCart = cart.lines.filter((line) => line.productId === product.id).reduce((sum, line) => sum + line.quantity, 0)
                return (
                  <button key={product.id} type="button" className={`pos-product${soldOut ? ' is-soldout' : ''}`} disabled={soldOut}
                    onClick={() => addProduct(product)} aria-label={`${product.name}, ${formatRupiah(product.price)}${soldOut ? ', habis' : ''}`}>
                    <span className="pos-product-image">
                      {product.image_url ? <img src={product.image_url} alt="" loading="lazy" /> : <Coffee size={22} aria-hidden="true" />}
                      {inCart > 0 && <span className="pos-product-count tabular">{inCart}</span>}
                    </span>
                    <span className="pos-product-name">{product.name}</span>
                    <span className="pos-product-meta">
                      <strong className="tabular">{formatRupiah(product.price)}</strong>
                      {soldOut ? <Badge tone="red" size="sm" dot={false}>Habis</Badge>
                        : portions !== null && portions !== undefined && Number(portions) <= 5 ? <Badge tone="amber" size="sm" dot={false}>Sisa {formatNumber(portions)}</Badge> : null}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>
        <aside className="pos-cart" aria-label="Keranjang">{cartPanel}</aside>
      </div>

      <button type="button" className="pos-cart-bar" onClick={() => setMobileCart(true)} disabled={!cart.lines.length}>
        <span><ShoppingBag size={18} aria-hidden="true" /> {formatNumber(totals.itemCount)} item</span>
        <strong className="tabular">{formatRupiah(totals.total)}</strong>
      </button>
      {mobileCart && <Drawer title="Keranjang" onClose={() => setMobileCart(false)}>{cartPanel}</Drawer>}

      {dialog?.type === 'options' && (
        <OptionPickerDialog product={dialog.product} groups={dialog.groups} initialLine={dialog.line} onClose={() => setDialog(null)}
          onSubmit={(line) => {
            setCart((current) => ({
              ...current,
              lines: dialog.line ? current.lines.map((item) => (item.id === dialog.line.id ? line : item)) : [...current.lines, line],
            }))
            setDialog(null)
          }} />
      )}
      {dialog?.type === 'discount' && (
        <DiscountDialog discount={cart.discount} subtotal={totals.subtotal} limit={discountLimit} isOwner={isOwner} onClose={() => setDialog(null)}
          onSave={(discount) => { setCart((current) => ({ ...current, discount })); setDialog(null) }} />
      )}
      {dialog?.type === 'hold' && <HoldDialog cart={cart} tables={data.tables} onClose={() => setDialog(null)} onHold={holdCart} />}
      {dialog?.type === 'held' && (
        <HeldDrawer held={data.held} onClose={() => setDialog(null)} onResume={resumeHeld} onDelete={deleteHeld} hasCart={cart.lines.length > 0} />
      )}
      {dialog?.type === 'clear' && (
        <ConfirmDialog title="Kosongkan keranjang?" confirmLabel="Kosongkan" description="Semua item di keranjang dihapus." onClose={() => setDialog(null)}
          onConfirm={() => { resetCart(); setDialog(null) }} />
      )}
      {dialog?.type === 'open-session' && (
        <OpenSessionDialog cafeId={cafe.id} onClose={() => setDialog(null)} onOpened={() => { setDialog(null); reload() }} />
      )}
      {dialog?.type === 'pay' && (
        <PaymentDialog cafe={cafe} supabase={supabase} total={placed ? Number(placed.total_amount) - Number(placed.paid_amount || 0) : totals.total}
          session={data.session} ensureOrder={ensureOrder} onClose={() => setDialog(null)}
          onPaid={async (order, change) => {
            const full = await fetchOrder(order.id).catch(() => ({ ...order, items: placed?.items || [] }))
            const { data: payments } = await supabase.from('payments').select('*').eq('order_id', order.id)
            setDialog({ type: 'done', order: full, payments: payments || [], change })
            if (settings.auto_print_receipt) printReceipt({ order: full, items: full.items, payments: payments || [], cafe, settings, brand: brandOf(cafe) })
            resetCart()
            reload()
          }} />
      )}
      {dialog?.type === 'done' && (
        <Dialog size="sm" title={`${formatQueueNumber(dialog.order)} lunas`} onClose={() => setDialog(null)}
          footer={(
            <>
              <Button variant="secondary" icon={Printer} onClick={() => printReceipt({ order: dialog.order, items: dialog.order.items, payments: dialog.payments, cafe, settings, brand: brandOf(cafe) })}>Cetak struk</Button>
              <Button onClick={() => setDialog(null)} autoFocus>Pesanan baru</Button>
            </>
          )}>
          <div className="pos-done">
            <CircleCheck size={40} aria-hidden="true" />
            <strong className="tabular">{formatRupiah(dialog.order.total_amount)}</strong>
            {dialog.change > 0 && <p>Kembalian <strong className="tabular">{formatRupiah(dialog.change)}</strong></p>}
          </div>
        </Dialog>
      )}
    </div>
  )
}

function SessionPill({ session, onOpen }) {
  if (session) {
    return <p className="pos-session is-open"><span aria-hidden="true" /> Kasir dibuka {formatTime(session.opened_at)} · modal {formatRupiah(session.opening_cash)}</p>
  }
  return (
    <p className="pos-session">
      <span aria-hidden="true" /> Kasir belum dibuka — tunai belum bisa diterima
      <Button size="sm" variant="secondary" icon={Wallet} onClick={onOpen}>Buka kasir</Button>
    </p>
  )
}

function CartPanel({ cart, setCart, totals, settings, tables, placed, busy, onEditLine, onQty, onDiscount, discountLimit, onHold, onClear, onSend, onPay }) {
  const orderTypes = settings.order_types?.length ? settings.order_types : ['dine_in', 'takeaway']
  const set = (key) => (value) => setCart((current) => ({ ...current, [key]: value?.target ? value.target.value : value }))
  const empty = !cart.lines.length
  return (
    <div className="pos-cart-inner">
      {placed && (
        <p className="pos-placed">
          <CircleCheck size={15} aria-hidden="true" /> {formatQueueNumber(placed)} sudah dibuat — belum dibayar
        </p>
      )}
      {orderTypes.length > 1 && (
        <SegmentedControl label="Jenis pesanan" value={cart.orderType} onChange={set('orderType')} size="sm"
          options={orderTypes.map((value) => ({ value, label: ORDER_TYPE_LABEL[value] }))} />
      )}
      <div className="pos-cart-fields">
        {cart.orderType === 'dine_in' && tables.length > 0 && (
          <Select hideLabel label="Meja" value={cart.tableId} onChange={set('tableId')}
            options={[{ value: '', label: 'Pilih meja' }, ...tables.map((table) => ({ value: table.id, label: `Meja ${table.label}${table.area ? ` · ${table.area}` : ''}` }))]} />
        )}
        <TextField hideLabel label="Nama pembeli" placeholder="Nama pembeli (opsional)" value={cart.guestName} maxLength={60} onChange={set('guestName')} />
      </div>

      {empty ? (
        <div className="pos-empty"><ShoppingBag size={28} aria-hidden="true" /><p>Ketuk menu untuk menambah ke keranjang.</p></div>
      ) : (
        <ul className="pos-lines">
          {cart.lines.map((line) => (
            <li key={line.id}>
              <button type="button" className="pos-line-main" onClick={() => onEditLine(line)}>
                <strong>{line.name}</strong>
                {line.options.length > 0 && <small>{line.options.map((option) => option.name).join(', ')}</small>}
                {line.notes && <small className="pos-line-note">“{line.notes}”</small>}
              </button>
              <div className="pos-line-side">
                <span className="tabular">{formatRupiah(lineTotal(line))}</span>
                <div className="pos-qty is-sm" role="group" aria-label={`Jumlah ${lineLabel(line)}`}>
                  <IconButton icon={line.quantity === 1 ? Trash2 : Minus} size="sm" label={line.quantity === 1 ? 'Hapus' : 'Kurangi'} onClick={() => onQty(line.id, -1)} />
                  <strong className="tabular">{line.quantity}</strong>
                  <IconButton icon={Plus} size="sm" label="Tambah" disabled={line.quantity >= 99} onClick={() => onQty(line.id, 1)} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <TextField hideLabel label="Catatan pesanan" placeholder="Catatan untuk dapur (opsional)" value={cart.notes} maxLength={300} onChange={set('notes')} />

      <dl className="pos-totals">
        <div><dt>Subtotal</dt><dd className="tabular">{formatRupiah(totals.subtotal)}</dd></div>
        {totals.discount > 0 && <div className="is-discount"><dt>Diskon{cart.discount?.reason ? ` · ${cart.discount.reason}` : ''}</dt><dd className="tabular">−{formatRupiah(totals.discount)}</dd></div>}
        {totals.service > 0 && <div><dt>Service {totals.serviceRate}%</dt><dd className="tabular">{formatRupiah(totals.service)}</dd></div>}
        {totals.tax > 0 && <div><dt>{settings.tax_name || 'Pajak'} {totals.taxRate}%{totals.taxInclusive ? ' (termasuk)' : ''}</dt><dd className="tabular">{formatRupiah(totals.tax)}</dd></div>}
        {totals.rounding !== 0 && <div><dt>Pembulatan</dt><dd className="tabular">{formatRupiah(totals.rounding)}</dd></div>}
        <div className="is-total"><dt>Total</dt><dd className="tabular">{formatRupiah(totals.total)}</dd></div>
      </dl>

      <div className="pos-cart-tools">
        <Button size="sm" variant="ghost" icon={PercentCircle} onClick={onDiscount} disabled={empty || discountLimit <= 0}
          title={discountLimit <= 0 ? 'Diskon staff dimatikan owner (Pengaturan → Pajak & biaya)' : undefined}>
          {cart.discount ? 'Ubah diskon' : 'Diskon'}
        </Button>
        <Button size="sm" variant="ghost" icon={PauseCircle} onClick={onHold} disabled={empty || Boolean(placed)}>Tahan</Button>
        <Button size="sm" variant="ghost" icon={Trash2} onClick={onClear} disabled={empty}>Kosongkan</Button>
      </div>
      <div className="pos-cart-actions">
        <Button variant="secondary" onClick={onSend} loading={busy === 'send'} disabled={empty}>Bayar nanti</Button>
        <Button icon={Wallet} onClick={onPay} disabled={empty}>Bayar {formatRupiah(placed ? Number(placed.total_amount) - Number(placed.paid_amount || 0) : totals.total)}</Button>
      </div>
    </div>
  )
}

function DiscountDialog({ discount, subtotal, limit, isOwner, onClose, onSave }) {
  const [type, setType] = useState(discount?.type || 'percent')
  const [value, setValue] = useState(discount?.value ? String(discount.value) : '')
  const [reason, setReason] = useState(discount?.reason || '')
  const [error, setError] = useState('')
  const amount = type === 'percent' ? Math.round((subtotal * (Number(value) || 0)) / 100) : Math.round(Number(value) || 0)
  const percent = subtotal ? (Math.min(amount, subtotal) / subtotal) * 100 : 0

  function submit(event) {
    event.preventDefault()
    if (!(Number(value) > 0)) return setError('Isi nilai diskon')
    if (type === 'percent' && Number(value) > 100) return setError('Maksimal 100%')
    if (!isOwner && percent > limit + 0.001) return setError(`Batas diskon staff ${limit}% (${formatRupiah(Math.floor((subtotal * limit) / 100))})`)
    if (reason.trim().length < 3) return setError('Tulis alasan diskon')
    onSave({ type, value: Number(value), reason: reason.trim() })
    return undefined
  }

  return (
    <Dialog size="sm" title="Diskon" description={isOwner ? 'Owner bisa memberi diskon berapa pun.' : `Batas diskon staff ${limit}% dari subtotal.`} onClose={onClose}
      footer={(
        <>
          {discount && <Button variant="ghost" onClick={() => onSave(null)}>Hapus diskon</Button>}
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button type="submit" form="discount-form">Terapkan −{formatRupiah(Math.min(amount, subtotal))}</Button>
        </>
      )}>
      <form id="discount-form" className="inv-form" onSubmit={submit} noValidate>
        <SegmentedControl label="Jenis" value={type} onChange={(next) => { setType(next); setValue(''); setError('') }} options={[{ value: 'percent', label: 'Persen' }, { value: 'amount', label: 'Nominal' }]} />
        {type === 'percent'
          ? <TextField label="Diskon" suffix="%" inputMode="decimal" value={value} onChange={(event) => { setValue(event.target.value.replace(/[^\d.]/g, '')); setError('') }} autoFocus />
          : <RupiahInput label="Diskon" value={value} onChange={(next) => { setValue(next); setError('') }} autoFocus />}
        <TextField label="Alasan" value={reason} maxLength={200} onChange={(event) => { setReason(event.target.value); setError('') }} placeholder="Mis. member, kompensasi, promo" />
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}

function HoldDialog({ cart, tables, onClose, onHold }) {
  const table = tables.find((item) => item.id === cart.tableId)
  const [label, setLabel] = useState(() => cart.guestName || (table ? `Meja ${table.label}` : `Pesanan ${formatTime(new Date().toISOString())}`))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault()
    if (!label.trim()) return setError('Isi nama penanda')
    setBusy(true)
    try {
      await onHold(label.trim().slice(0, 40))
      onClose()
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
    return undefined
  }
  return (
    <Dialog size="sm" title="Tahan pesanan" description="Keranjang disimpan dan bisa dilanjutkan nanti, juga dari perangkat lain." onClose={busy ? undefined : onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="hold-form" loading={busy}>Tahan</Button></>}>
      <form id="hold-form" className="inv-form" onSubmit={submit} noValidate>
        <TextField label="Penanda" value={label} maxLength={40} onChange={(event) => { setLabel(event.target.value); setError('') }} autoFocus />
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}

function HeldDrawer({ held, hasCart, onClose, onResume, onDelete }) {
  const { toast } = useToast()
  return (
    <Drawer title="Pesanan ditahan" description={hasCart ? 'Melanjutkan pesanan akan mengganti keranjang yang sedang terbuka.' : 'Lanjutkan untuk memasukkan kembali ke keranjang.'} onClose={onClose}>
      {!held.length ? <EmptyState compact icon={PauseCircle} title="Tidak ada pesanan ditahan" description="Gunakan tombol Tahan di keranjang." /> : (
        <ul className="po-payments">
          {held.map((item) => {
            const lines = item.cart?.lines || []
            return (
              <li key={item.id}>
                <span className="inv-name">
                  <strong>{item.label}</strong>
                  <small>{lines.reduce((sum, line) => sum + line.quantity, 0)} item · {formatRupiah(lines.reduce((sum, line) => sum + lineTotal(line), 0))} · {formatRelative(item.updated_at)}</small>
                </span>
                <span className="pos-held-actions">
                  <IconButton icon={Trash2} size="sm" variant="danger" label={`Hapus ${item.label}`}
                    onClick={() => onDelete(item).catch((caught) => toast({ tone: 'error', title: 'Gagal menghapus', description: caught.message }))} />
                  <Button size="sm" onClick={() => onResume(item)}>Lanjutkan</Button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Drawer>
  )
}
