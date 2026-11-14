import { Badge } from '@dailybrew/ui'
import { orderStatusMeta, paymentMethodLabel, paymentStatusMeta } from '../../lib/status.js'

export function OrderStatusBadge({ status, audience = 'staff', ...props }) {
  const meta = orderStatusMeta(status)
  return <Badge tone={meta.tone} {...props}>{audience === 'customer' ? meta.customerLabel : meta.label}</Badge>
}

export function PaymentBadge({ status, method, showMethod = false, ...props }) {
  const meta = paymentStatusMeta(status)
  return (
    <Badge tone={meta.tone} dot={false} {...props}>
      {meta.label}
      {showMethod && method && <span className="ui-badge-extra">· {paymentMethodLabel(method)}</span>}
    </Badge>
  )
}
