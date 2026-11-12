// Salinan dari web-dashboard/src/components/ui/Card.jsx — sinkronkan manual bila aslinya berubah.
export function Card({ as: Component = 'section', padding = 'md', interactive = false, className = '', children, ...props }) {
  return (
    <Component className={`ui-card ui-card-pad-${padding}${interactive ? ' ui-card-interactive' : ''} ${className}`.trim()} {...props}>
      {children}
    </Component>
  )
}

/** Judul kartu cukup teks. Prop `icon` lama diabaikan agar pemanggil lama tetap jalan. */
export function CardHeader({ title, description, actions, as: Heading = 'h2' }) {
  return (
    <header className="ui-card-header">
      <div className="ui-card-header-text">
        <Heading className="ui-card-title">{title}</Heading>
        {description && <p className="ui-card-description">{description}</p>}
      </div>
      {actions && <div className="ui-card-actions">{actions}</div>}
    </header>
  )
}
