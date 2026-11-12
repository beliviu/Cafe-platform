import { AlertTriangle, CalendarClock, CircleDollarSign, Moon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { WhatsAppButton } from './WhatsAppButton.jsx'

const KIND = {
  invoice_overdue: { icon: CircleDollarSign, tone: 'red', label: 'Telat bayar', template: 'tagihan' },
  payment_failed: { icon: AlertTriangle, tone: 'red', label: 'Pembayaran gagal', template: 'bebas' },
  trial_ending: { icon: CalendarClock, tone: 'amber', label: 'Masa coba', template: 'upgrade' },
  idle_cafe: { icon: Moon, tone: 'blue', label: 'Kafe sepi', template: 'setup' },
}

/** Daftar "Perlu tindakan" (pa_action_items), sudah urut dari yang paling mendesak. */
export function ActionList({ items, limit }) {
  const shown = limit ? items.slice(0, limit) : items
  return (
    <ul className="pa-actions-list">
      {shown.map((item) => {
        const meta = KIND[item.kind] || KIND.idle_cafe
        const Icon = meta.icon
        return (
          <li key={`${item.kind}-${item.ref_id}`} className={`pa-action is-${meta.tone}`}>
            <span className="pa-action-icon" aria-hidden="true"><Icon size={16} /></span>
            <span className="pa-action-text">
              <Link to={`/kafe/${item.cafe_id}`}><strong>{item.cafe_name}</strong></Link>
              <span><span className="pa-action-kind">{meta.label}</span> · {item.reason}</span>
            </span>
            <span className="pa-action-buttons">
              <WhatsAppButton size="sm" variant="ghost" defaultTemplate={meta.template}
                ctx={{ cafeId: item.cafe_id, cafeName: item.cafe_name, ownerName: item.owner_name, phone: item.owner_whatsapp, amount: item.amount, dueAt: item.due_at }} />
              <Link to={`/kafe/${item.cafe_id}`} className="ui-btn ui-btn-secondary ui-btn-sm"><span>Buka kafe</span></Link>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
