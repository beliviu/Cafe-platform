import { orderStatusMeta, paymentMethodLabel, paymentStatusMeta } from '../../lib/status.js'

/** tone: amber | blue | green | neutral | red | brand */
export function Badge({ tone = 'neutral', dot = true, size = 'md', className = '', children, ...props }) {
  return (
    <span className={`ui-badge ui-badge-${tone} ui-badge-${size} ${className}`.trim()} {...props}>
      {dot && <span className="ui-badge-dot" aria-hidden="true" />}
      {children}
    </span>
  )
}

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
