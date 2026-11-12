// Salinan dari web-dashboard/src/components/ui/PageHeader.jsx — sinkronkan manual bila aslinya berubah.
/**
 * Judul halaman: konteks kecil (eyebrow), judul, deskripsi, aksi di kanan.
 * Tenang dan padat — hierarki dari ukuran & warna, bukan ornamen.
 */
export function PageHeader({ eyebrow, title, description, actions, children }) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header-text">
        {eyebrow && <span className="ui-page-eyebrow">{eyebrow}</span>}
        <h1 className="ui-title ui-page-title">{title}</h1>
        {description && <p className="ui-page-description">{description}</p>}
        {children}
      </div>
      {actions && <div className="ui-page-actions">{actions}</div>}
    </header>
  )
}
