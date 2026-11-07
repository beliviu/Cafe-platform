export function Card({ as: Component = 'section', padding = 'md', interactive = false, className = '', children, ...props }) {
  return (
    <Component className={`ui-card ui-card-pad-${padding}${interactive ? ' ui-card-interactive' : ''} ${className}`.trim()} {...props}>
      {children}
    </Component>
  )
}

export function CardHeader({ title, description, actions, icon: Icon, as: Heading = 'h2' }) {
  return (
    <header className="ui-card-header">
      {Icon && <span className="ui-card-header-icon"><Icon size={17} aria-hidden="true" /></span>}
      <div className="ui-card-header-text">
        <Heading className="ui-card-title">{title}</Heading>
        {description && <p className="ui-card-description">{description}</p>}
      </div>
      {actions && <div className="ui-card-actions">{actions}</div>}
    </header>
  )
}
