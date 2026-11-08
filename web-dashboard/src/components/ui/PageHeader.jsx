/**
 * Judul halaman brand: eyebrow kecil, judul serif + titik aksen, deskripsi, aksi di kanan.
 * Memberi jarak bawah tetap (28px) agar subjudul tidak menempel ke konten.
 */
export function PageHeader({ eyebrow, title, description, actions, children }) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header-text">
        {eyebrow && <span className="ui-page-eyebrow"><span className="ui-page-eyebrow-dot" aria-hidden="true" />{eyebrow}</span>}
        <h1 className="ui-title ui-page-title">{title}<span className="ui-title-period">.</span></h1>
        {description && <p className="ui-page-description">{description}</p>}
        {children}
      </div>
      {actions && <div className="ui-page-actions">{actions}</div>}
    </header>
  )
}
