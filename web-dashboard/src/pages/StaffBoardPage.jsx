import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { brandOf } from '../lib/branding.js'
import {
  Bell, Check, CircleDollarSign, Inbox, Keyboard, PackageX, RefreshCw, SlidersHorizontal, Volume2, VolumeX, Wallet,
} from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import { CancelOrderDialog } from '../components/orders/CancelOrderDialog.jsx'
import { MarkPaidDialog } from '../components/orders/MarkPaidDialog.jsx'
import { OrderDetailDrawer } from '../components/orders/OrderDetailDrawer.jsx'
import { AvailabilityPanel } from '../components/staff/AvailabilityPanel.jsx'
import { BoardSettingsDialog, ShortcutsDialog } from '../components/staff/BoardDialogs.jsx'
import { OrderTicket } from '../components/staff/OrderTicket.jsx'
import { useNow } from '../components/staff/useNow.js'
import {
  Button, ConfirmDialog, Drawer, EmptyState, ErrorState, IconButton, PageHeader, SegmentedControl, Skeleton, useToast,
} from '../components/ui/index.js'
import { playNewOrderSound, unlockAlertSound } from '../lib/alertSound.js'
import { customerLabel, fetchCustomerNames, fetchOrderItems, friendlyError, orderColumns } from '../lib/db.js'
import { formatNumber, formatQueueNumber, formatRupiah, jakartaDateKey, startOfJakartaDay } from '../lib/format.js'
import { advanceOrderTo } from '../lib/orderActions.js'
import { printOrderLabel } from '../lib/printLabel.js'
import { BOARD_COLUMNS, boardColumnOf, primaryAction } from '../lib/staffBoard.js'
import { loadStaffPrefs, saveStaffPrefs } from '../lib/staffPrefs.js'
import { ACTIVE_ORDER_STATUSES, orderStatusMeta, paymentMethodLabel } from '../lib/status.js'

const POLL_MS = 20000
const NEW_HIGHLIGHT_MS = 12000

function notificationPermission() {
  return typeof window.Notification === 'undefined' ? 'unsupported' : window.Notification.permission
}

function isTypingTarget(target) {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

function LiveIndicator({ state, onReload }) {
  if (state === 'connected') {
    return <span className="live-pill is-live" role="status"><span className="live-dot" /> LIVE</span>
  }
  return (
    <span className="live-pill is-off" role="status">
      <span className="live-dot" />
      {state === 'connecting' ? 'Menghubungkan…' : 'Terputus · cek tiap 20 dtk'}
      {state !== 'connecting' && <button type="button" onClick={onReload}><RefreshCw size={13} aria-hidden="true" /> Muat ulang</button>}
    </span>
  )
}

export function StaffBoardPage() {
  const { cafe, features, setPendingCount } = useOutletContext()
  const brandName = brandOf(cafe).name
  const { supabase } = useAuth()
  const { toast } = useToast()
  const now = useNow(15000)
  const [prefs, setPrefs] = useState(loadStaffPrefs)
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [realtime, setRealtime] = useState('connecting')
  const [newIds, setNewIds] = useState(() => new Set())
  const [selectedId, setSelectedId] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [panel, setPanel] = useState(null)
  const [mobileColumn, setMobileColumn] = useState('incoming')
  const [permission, setPermission] = useState(notificationPermission)
  const [soldOutCount, setSoldOutCount] = useState(null)
  const knownIds = useRef(null)
  const prefsRef = useRef(prefs)
  const ticketRefs = useRef(new Map())
  const reloadTimer = useRef(0)

  useEffect(() => { prefsRef.current = prefs }, [prefs])

  const announce = useCallback((fresh) => {
    setNewIds((current) => new Set([...current, ...fresh.map((order) => order.id)]))
    window.setTimeout(() => {
      setNewIds((current) => {
        const next = new Set(current)
        fresh.forEach((order) => next.delete(order.id))
        return next
      })
    }, NEW_HIGHLIGHT_MS)
    if (prefsRef.current.sound) playNewOrderSound()
    const title = fresh.length === 1 ? `Pesanan baru ${formatQueueNumber(fresh[0])}` : `${fresh.length} pesanan baru`
    const body = fresh.map((order) => `${formatQueueNumber(order)} · ${customerLabel(order)}`).join('\n')
    toast({ tone: 'info', title, description: body, duration: 6000 })
    if (notificationPermission() === 'granted' && document.visibilityState !== 'visible') {
      try {
        new window.Notification(title, { body, tag: 'cafe-order' })
      } catch {
        // beberapa browser (mis. Android) hanya mengizinkan notifikasi lewat service worker
      }
    }
  }, [toast])

  const loadOrders = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const todayStart = startOfJakartaDay(jakartaDateKey()).toISOString()
    const { data, error } = await supabase
      .from('orders')
      .select(orderColumns(features))
      .eq('cafe_id', cafe.id)
      .or(`order_status.in.(${ACTIVE_ORDER_STATUSES.join(',')}),created_at.gte.${todayStart}`)
      .order('created_at', { ascending: true })
      .limit(400)
    if (error) {
      if (!silent) setLoadError(friendlyError(error))
      setLoading(false)
      return
    }
    const ids = data.map((order) => order.id)
    const activeIds = data.filter((order) => ACTIVE_ORDER_STATUSES.includes(order.order_status)).map((order) => order.id)
    const [{ names }, { byOrder }] = await Promise.all([fetchCustomerNames(supabase, ids), fetchOrderItems(supabase, activeIds)])
    const next = data.map((order) => ({ ...order, customer_name: names.get(order.id) || '', items: byOrder.get(order.id) || [] }))

    if (knownIds.current) {
      const fresh = next.filter((order) => order.order_status === 'pending' && !knownIds.current.has(order.id))
      if (fresh.length) announce(fresh)
    }
    knownIds.current = new Set(ids)
    setOrders(next)
    setLoadError('')
    setLoading(false)
  }, [announce, cafe.id, features, supabase])

  const scheduleReload = useCallback(() => {
    window.clearTimeout(reloadTimer.current)
    reloadTimer.current = window.setTimeout(() => loadOrders(true), 250)
  }, [loadOrders])

  useEffect(() => {
    const timer = window.setTimeout(() => loadOrders(), 0)
    return () => window.clearTimeout(timer)
  }, [attempt, loadOrders])

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel(`staff-board-${cafe.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `cafe_id=eq.${cafe.id}` }, scheduleReload)
      .subscribe((status) => {
        setRealtime(status === 'SUBSCRIBED' ? 'connected' : ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status) ? 'error' : 'connecting')
      })
    return () => {
      window.clearTimeout(reloadTimer.current)
      supabase.removeChannel(channel)
    }
  }, [cafe.id, scheduleReload, supabase])

  // Cadangan: polling saat realtime tidak tersambung, dan muat ulang saat tab kembali aktif / internet kembali.
  useEffect(() => {
    const poll = realtime === 'connected' ? null : window.setInterval(() => loadOrders(true), POLL_MS)
    function refresh() { if (document.visibilityState === 'visible') loadOrders(true) }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    return () => {
      if (poll) window.clearInterval(poll)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [loadOrders, realtime])

  // Jumlah menu habis untuk tombol di header (diperbarui lagi saat panel menu ditutup)
  useEffect(() => {
    if (panel) return undefined
    let active = true
    supabase.from('products').select('id').eq('cafe_id', cafe.id).eq('is_available', false).then(({ data, error }) => {
      if (active && !error) setSoldOutCount((data || []).length)
    })
    return () => { active = false }
  }, [cafe.id, panel, supabase])

  // Suara hanya boleh setelah interaksi pertama
  useEffect(() => {
    document.addEventListener('pointerdown', unlockAlertSound)
    document.addEventListener('keydown', unlockAlertSound)
    return () => {
      document.removeEventListener('pointerdown', unlockAlertSound)
      document.removeEventListener('keydown', unlockAlertSound)
    }
  }, [])

  const columns = useMemo(() => BOARD_COLUMNS.map((column) => ({
    ...column,
    orders: orders.filter((order) => boardColumnOf(order) === column.key),
  })), [orders])
  const boardOrder = useMemo(() => columns.flatMap((column) => column.orders), [columns])
  const shortcutOf = useMemo(() => new Map(boardOrder.slice(0, 9).map((order, index) => [order.id, String(index + 1)])), [boardOrder])
  const pendingCount = columns[0].orders.length

  // Judul tab + badge menu
  useEffect(() => {
    const baseTitle = `Pesanan — ${brandName}`
    document.title = pendingCount ? `(${pendingCount}) ${baseTitle}` : baseTitle
    setPendingCount?.(pendingCount)
  }, [brandName, pendingCount, setPendingCount])
  useEffect(() => () => {
    document.title = `${brandName} · Staff`
    setPendingCount?.(0)
  }, [brandName, setPendingCount])

  const stats = useMemo(() => {
    const todayKey = jakartaDateKey()
    const today = orders.filter((order) => jakartaDateKey(order.created_at) === todayKey)
    return {
      completed: today.filter((order) => order.order_status === 'completed').length,
      paid: today.filter((order) => order.payment_status === 'paid' && order.order_status !== 'cancelled')
        .reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0),
      unpaidActive: orders.filter((order) => ACTIVE_ORDER_STATUSES.includes(order.order_status) && order.payment_status !== 'paid').length,
    }
  }, [orders])

  function patchOrder(id, changes) {
    setOrders((current) => current.map((order) => (order.id === id ? { ...order, ...changes } : order)))
  }

  async function runPrimary(order, { skipPayCheck = false } = {}) {
    const action = primaryAction(order)
    if (!action) return
    if (action.target === 'completed' && order.payment_status !== 'paid' && !skipPayCheck) {
      setDialog({ type: 'complete-unpaid', order })
      return
    }
    setBusyId(order.id)
    try {
      const updated = await advanceOrderTo(supabase, order, action.target)
      patchOrder(order.id, { order_status: updated.order_status })
      toast({
        title: `${formatQueueNumber(order)} · ${orderStatusMeta(updated.order_status).label}`,
        description: updated.order_status === 'completed' ? 'Pindah ke Riwayat.' : undefined,
        duration: 2600,
      })
      if (updated.order_status === 'completed') {
        setSelectedId((current) => (current === order.id ? null : current))
        setDetailId((current) => (current === order.id ? null : current))
      }
    } catch (caught) {
      toast({ tone: 'error', title: 'Status gagal diperbarui', description: caught.message })
      loadOrders(true)
    } finally {
      setBusyId(null)
    }
  }

  async function requestPermission() {
    if (typeof window.Notification === 'undefined') return
    const result = await window.Notification.requestPermission()
    setPermission(result)
    if (result === 'granted') toast({ title: 'Notifikasi aktif', description: 'Pesanan baru akan muncul walau tab ini tidak dibuka.' })
  }

  function updatePrefs(next) {
    setPrefs(next)
    saveStaffPrefs(next)
  }

  // Tombol pintas
  useEffect(() => {
    function handleKey(event) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return
      if (document.querySelector('dialog[open]')) return
      const selected = orders.find((order) => order.id === selectedId)
      if (/^[1-9]$/.test(event.key)) {
        const target = boardOrder[Number(event.key) - 1]
        if (target) {
          event.preventDefault()
          setSelectedId(target.id)
          setMobileColumn(boardColumnOf(target))
          ticketRefs.current.get(target.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
      } else if (event.key === 'Enter' && selected && (document.activeElement === document.body || document.activeElement?.classList.contains('ticket'))) {
        event.preventDefault()
        runPrimary(selected)
      } else if ((event.key === 'l' || event.key === 'L') && selected && features?.operations && selected.payment_status !== 'paid') {
        setDialog({ type: 'pay', order: selected })
      } else if ((event.key === 'd' || event.key === 'D') && selected) {
        setDetailId(selected.id)
      } else if (event.key === 'm' || event.key === 'M') {
        setPanel('menu')
      } else if (event.key === '?') {
        setDialog({ type: 'shortcuts' })
      } else if (event.key === 'Escape') {
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

  const detailOrder = orders.find((order) => order.id === detailId)
  const detailAction = detailOrder && primaryAction(detailOrder)

  return (
    <div className="page page-wide">
      <div className="staff-intro">
        <PageHeader
          eyebrow={cafe.name}
          title="Pesanan"
          description="Pesanan aktif dari lama ke baru. Pesanan selesai pindah ke Riwayat."
          actions={(
            <>
              <LiveIndicator state={realtime} onReload={() => setAttempt((value) => value + 1)} />
              <IconButton
                icon={prefs.sound ? Volume2 : VolumeX}
                variant="secondary"
                label={prefs.sound ? 'Matikan suara pesanan baru' : 'Nyalakan suara pesanan baru'}
                aria-pressed={prefs.sound}
                onClick={() => { unlockAlertSound(); updatePrefs({ ...prefs, sound: !prefs.sound }) }}
              />
              {permission === 'default' && <IconButton icon={Bell} variant="secondary" label="Izinkan notifikasi browser" onClick={requestPermission} />}
              <IconButton icon={SlidersHorizontal} variant="secondary" label="Pengaturan papan" onClick={() => setDialog({ type: 'settings' })} />
              <IconButton icon={Keyboard} variant="secondary" label="Tombol pintas (?)" onClick={() => setDialog({ type: 'shortcuts' })} className="hide-on-touch" />
              <Button variant="secondary" icon={PackageX} onClick={() => setPanel('menu')}>
                Menu habis{soldOutCount ? <span className="btn-count tabular"><span className="sr-only">: </span>{soldOutCount}</span> : null}
              </Button>
            </>
          )}
        />
      </div>

      <section className="board-strip" aria-label="Ringkasan hari ini">
        <span><Check size={15} aria-hidden="true" /> Selesai hari ini <strong className="tabular">{formatNumber(stats.completed)}</strong></span>
        <span><CircleDollarSign size={15} aria-hidden="true" /> Lunas hari ini <strong className="tabular">{formatRupiah(stats.paid)}</strong></span>
        <span className={stats.unpaidActive ? 'is-warn' : ''}><Wallet size={15} aria-hidden="true" /> Aktif belum lunas <strong className="tabular">{formatNumber(stats.unpaidActive)}</strong></span>
      </section>

      {loadError ? (
        <ErrorState message={loadError} onRetry={() => setAttempt((value) => value + 1)} />
      ) : (
        <>
          <SegmentedControl
            className="board-switch"
            label="Pilih kolom"
            value={mobileColumn}
            onChange={setMobileColumn}
            options={columns.map((column) => ({ value: column.key, label: column.label, count: column.orders.length }))}
          />
          <div className="board">
            {columns.map((column) => (
              <section
                key={column.key}
                className={`board-col board-col-${column.tone}${mobileColumn === column.key ? ' is-current' : ''}`}
                aria-label={`${column.label}, ${column.orders.length} pesanan`}
              >
                <header className="board-col-head">
                  <span className="board-col-dot" aria-hidden="true" />
                  <h2>{column.label}</h2>
                  <span className="board-col-count tabular">{column.orders.length}</span>
                </header>
                <div className="board-col-body">
                  {loading ? (
                    [0, 1].map((key) => <Skeleton key={key} height={220} radius={16} />)
                  ) : column.orders.length ? (
                    column.orders.map((order) => (
                      <OrderTicket
                        key={order.id}
                        ref={(node) => { if (node) ticketRefs.current.set(order.id, node); else ticketRefs.current.delete(order.id) }}
                        order={order}
                        shortcut={shortcutOf.get(order.id)}
                        now={now}
                        prefs={prefs}
                        features={features}
                        selected={selectedId === order.id}
                        isNew={newIds.has(order.id)}
                        busy={busyId === order.id}
                        onSelect={setSelectedId}
                        onPrimary={(target) => runPrimary(target)}
                        onPay={(target) => setDialog({ type: 'pay', order: target })}
                        onCancel={(target) => setDialog({ type: 'cancel', order: target })}
                        onOpen={(target) => setDetailId(target.id)}
                      />
                    ))
                  ) : (
                    <EmptyState compact icon={Inbox} title={column.empty} description={column.key === 'incoming' ? 'Pesanan baru muncul otomatis dengan bunyi.' : undefined} />
                  )}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {detailOrder && (
        <OrderDetailDrawer
          key={detailOrder.id}
          order={detailOrder}
          cafe={cafe}
          features={features}
          onClose={() => setDetailId(null)}
          onPrint={(order) => {
            if (!printOrderLabel(order, cafe.name)) toast({ tone: 'error', title: 'Jendela cetak diblokir', description: 'Izinkan pop-up untuk situs ini.' })
          }}
          onChanged={(updated, kind) => {
            patchOrder(updated.id, updated)
            if (kind === 'cancelled') setDetailId(null)
            toast({ title: kind === 'paid' ? `${formatQueueNumber(updated)} lunas` : `${formatQueueNumber(updated)} dibatalkan`, tone: kind === 'paid' ? 'success' : 'info' })
          }}
          actions={detailAction && (
            <Button icon={Check} loading={busyId === detailOrder.id} onClick={() => runPrimary(detailOrder)}>{detailAction.label}</Button>
          )}
        />
      )}

      {panel === 'menu' && (
        <Drawer title="Menu habis" description="Tandai menu yang habis agar customer tidak bisa memesannya." onClose={() => setPanel(null)}>
          <AvailabilityPanel cafe={cafe} features={features} compact onCountChange={setSoldOutCount} />
        </Drawer>
      )}

      {dialog?.type === 'pay' && (
        <MarkPaidDialog
          order={dialog.order}
          cafe={cafe}
          confirmLabel={dialog.then === 'complete' ? 'Lunas & selesaikan' : undefined}
          onClose={() => setDialog(null)}
          onPaid={async (updated) => {
            const then = dialog.then
            patchOrder(updated.id, updated)
            setDialog(null)
            toast({ title: `${formatQueueNumber(updated)} lunas`, description: `${formatRupiah(updated.total_amount)} · ${paymentMethodLabel(updated.payment_method)}` })
            if (then === 'complete') await runPrimary({ ...updated, items: dialog.order.items }, { skipPayCheck: true })
          }}
        />
      )}
      {dialog?.type === 'cancel' && (
        <CancelOrderDialog
          order={dialog.order}
          onClose={() => setDialog(null)}
          onCancelled={(updated) => {
            patchOrder(updated.id, updated)
            setDialog(null)
            toast({ title: `${formatQueueNumber(updated)} dibatalkan`, tone: 'info' })
          }}
        />
      )}
      {dialog?.type === 'complete-unpaid' && (
        <ConfirmDialog
          title={`${formatQueueNumber(dialog.order)} belum lunas`}
          description={`Total ${formatRupiah(dialog.order.total_amount)} belum tercatat dibayar. Pesanan yang belum lunas tidak dihitung sebagai pendapatan.`}
          confirmLabel="Tetap selesaikan"
          tone="primary"
          alternative={features?.operations ? { label: 'Tandai lunas dulu', onClick: () => setDialog({ type: 'pay', order: dialog.order, then: 'complete' }) } : undefined}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            const target = dialog.order
            setDialog(null)
            await runPrimary(target, { skipPayCheck: true })
          }}
        />
      )}
      {dialog?.type === 'settings' && (
        <BoardSettingsDialog
          prefs={prefs}
          permission={permission}
          onRequestPermission={requestPermission}
          onClose={() => setDialog(null)}
          onSave={(next) => { updatePrefs(next); setDialog(null); toast({ title: 'Pengaturan papan disimpan', duration: 2000 }) }}
        />
      )}
      {dialog?.type === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
    </div>
  )
}
