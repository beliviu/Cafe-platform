/**
 * Label status. Warna SELALU disertai kata (jangan mengandalkan warna saja).
 * tone: amber | blue | green | neutral | red | brand
 */
export function Badge({ tone = 'neutral', dot = true, size = 'md', className = '', children, ...props }) {
  return (
    <span className={`ui-badge ui-badge-${tone} ui-badge-${size} ${className}`.trim()} {...props}>
      {dot && <span className="ui-badge-dot" aria-hidden="true" />}
      {children}
    </span>
  )
}

/** Tag netral bergaris (kategori, filter aktif). */
export function Tag({ className = '', children, ...props }) {
  return <span className={`ui-tag ${className}`.trim()} {...props}>{children}</span>
}
