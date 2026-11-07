export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <header className="page-heading">
      <div>
        <span className="page-eyebrow"><span className="eyebrow-dot" /> {eyebrow}</span>
        <h1>{title}<span className="heading-period">.</span></h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-heading-actions">{actions}</div>}
    </header>
  )
}
