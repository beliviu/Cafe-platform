import { forwardRef } from 'react'
import { Ban, CalendarClock, Check, MessageSquareText, Timer, Wallet } from 'lucide-react'
import { Button, IconButton, OrderStatusBadge, PaymentBadge } from '../ui/index.js'
import { customerLabel } from '../../lib/db.js'
import { formatDateShort, formatQueueNumber, formatRupiah, formatTime, jakartaDateKey, minutesSince } from '../../lib/format.js'
import { primaryAction } from '../../lib/staffBoard.js'
import { waitTone } from '../../lib/staffPrefs.js'
import { ACTIVE_ORDER_STATUSES } from '../../lib/status.js'

const MAX_ITEMS = 5

function waitLabel(minutes) {
  if (minutes < 1) return 'Baru saja'
  if (minutes < 60) return `Menunggu ${minutes} mnt`
  const hours = Math.floor(minutes / 60)
  return `Menunggu ${hours} j ${minutes % 60} mnt`
}

/** Kartu pesanan di papan staff — dibaca dari jauh, satu aksi utama. */
export const OrderTicket = forwardRef(function OrderTicket({
  order, shortcut, now, prefs, features, selected, isNew, busy, onSelect, onPrimary, onPay, onCancel, onOpen,
}, ref) {
  const minutes = minutesSince(order.created_at, now)
  const tone = waitTone(minutes, prefs)
  const action = primaryAction(order)
  const items = order.items || []
  const canPay = features?.operations && order.payment_status !== 'paid'
  const canCancel = features?.operations && ACTIVE_ORDER_STATUSES.includes(order.order_status)
  const queue = formatQueueNumber(order)

  return (
    <article
      ref={ref}
      className={`ticket ticket-wait-${tone}${selected ? ' is-selected' : ''}${isNew ? ' is-new' : ''}`}
      aria-label={`Pesanan ${queue}, ${customerLabel(order)}`}
      onPointerDown={() => onSelect(order.id)}
      onClick={(event) => {
        // Klik area kartu (bukan tombol) membuka detail
        if (!event.target.closest('button, a, input')) onOpen(order)
      }}
    >
      <header className="ticket-head">
        <div className="ticket-id">
          <button type="button" className="ticket-queue tabular" onClick={() => onOpen(order)} aria-label={`Detail pesanan ${queue}`}>{queue}</button>
          <span className="ticket-customer">{customerLabel(order)}</span>
          {(order.order_type || order.table_label || order.source === 'pos') && (
            <span className="ticket-type">
              {[order.source === 'pos' ? 'Kasir' : null, order.order_type ? (order.order_type === 'takeaway' ? 'Bawa pulang' : 'Makan di tempat') : null,
                order.table_label ? `Meja ${order.table_label}` : null].filter(Boolean).join(' · ')}
            </span>
          )}
          {order.scheduled_for && (
            <span className="ticket-scheduled"><CalendarClock size={13} aria-hidden="true" /> Ambil {formatTime(order.scheduled_for)}{jakartaDateKey(order.scheduled_for) !== jakartaDateKey() ? ` · ${formatDateShort(order.scheduled_for)}` : ''}</span>
          )}
        </div>
        <div className="ticket-meta">
          {shortcut && <kbd className="ticket-key" aria-label={`Tombol pintas ${shortcut}`}>{shortcut}</kbd>}
          <span className={`ticket-timer is-${tone}`} title={`Dipesan ${formatTime(order.created_at)} WIB`}>
            <Timer size={14} aria-hidden="true" /> <span className="tabular">{waitLabel(minutes)}</span>
          </span>
        </div>
      </header>

      {order.order_status === 'confirmed' && <OrderStatusBadge status="confirmed" size="sm" className="ticket-substatus" />}

      <ul className="ticket-items">
        {items.slice(0, MAX_ITEMS).map((item) => (
          <li key={item.id}>
            <b className="tabular">{item.quantity}×</b>
            <span>
              {item.product_name}
              {item.notes && <em className="ticket-note"><MessageSquareText size={13} aria-hidden="true" /> {item.notes}</em>}
            </span>
          </li>
        ))}
        {items.length > MAX_ITEMS && <li className="ticket-more">+{items.length - MAX_ITEMS} item lain · lihat detail</li>}
        {!items.length && <li className="ticket-more">Item belum termuat</li>}
      </ul>
      {order.notes && <p className="ticket-order-note"><MessageSquareText size={14} aria-hidden="true" /> {order.notes}</p>}

      <div className="ticket-pay">
        <PaymentBadge status={order.payment_status} method={order.payment_method} showMethod={order.payment_status === 'paid'} />
        <strong className="tabular">{formatRupiah(order.total_amount)}</strong>
      </div>

      <footer className="ticket-actions">
        {action && (
          <Button icon={Check} loading={busy} onClick={() => onPrimary(order)} className="ticket-primary">
            {action.label}
          </Button>
        )}
        {canPay && <Button variant="secondary" icon={Wallet} onClick={() => onPay(order)} disabled={busy} className="ticket-paybtn">Lunas</Button>}
        {canCancel && <IconButton icon={Ban} variant="danger" label={`Batalkan ${queue}`} onClick={() => onCancel(order)} disabled={busy} />}
      </footer>
    </article>
  )
})
