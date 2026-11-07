import { LoaderCircle } from 'lucide-react'

/**
 * Tombol dasar.
 * variant: primary | secondary | ghost | danger | danger-soft
 * size: sm (36px, khusus area padat) | md (44px) | lg (52px)
 */
export function Button({
  as: Component = 'button',
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  loading = false,
  block = false,
  disabled,
  className = '',
  children,
  type,
  ...props
}) {
  const isButton = Component === 'button'
  return (
    <Component
      className={`ui-btn ui-btn-${variant} ui-btn-${size}${block ? ' ui-btn-block' : ''}${loading ? ' is-loading' : ''} ${className}`.trim()}
      type={isButton ? type || 'button' : undefined}
      disabled={isButton ? disabled || loading : undefined}
      aria-disabled={!isButton && disabled ? true : undefined}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <LoaderCircle className="ui-spin" size={16} aria-hidden="true" /> : Icon && <Icon size={16} aria-hidden="true" />}
      {children && <span>{children}</span>}
      {IconRight && !loading && <IconRight size={16} aria-hidden="true" />}
    </Component>
  )
}

/** Tombol ikon — `label` wajib (dipakai sebagai aria-label dan tooltip). */
export function IconButton({ icon: Icon, label, variant = 'ghost', size = 'md', tooltip = true, className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={`ui-icon-btn ui-icon-btn-${variant} ui-icon-btn-${size} ${className}`.trim()}
      aria-label={label}
      data-tooltip={tooltip ? label : undefined}
      {...props}
    >
      <Icon size={size === 'sm' ? 16 : 18} aria-hidden="true" />
    </button>
  )
}
