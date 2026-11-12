// Salinan dari web-dashboard/src/components/ui/Badge.jsx (tanpa badge pesanan) — sinkronkan manual bila aslinya berubah.

/** tone: amber | blue | green | neutral | red | brand */
export function Badge({ tone = 'neutral', dot = true, size = 'md', className = '', children, ...props }) {
  return (
    <span className={`ui-badge ui-badge-${tone} ui-badge-${size} ${className}`.trim()} {...props}>
      {dot && <span className="ui-badge-dot" aria-hidden="true" />}
      {children}
    </span>
  )
}
