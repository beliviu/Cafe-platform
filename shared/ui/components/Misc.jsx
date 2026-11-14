import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from './Button.jsx'

const formatNumber = (value) => new Intl.NumberFormat('id-ID').format(value)

/**
 * Judul halaman: konteks kecil (eyebrow), judul Fraunces, deskripsi, aksi di kanan.
 * hero: judul besar (44px di layar lebar) — untuk sapaan dashboard.
 */
export function PageHeader({ eyebrow, title, description, actions, hero = false, children }) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header-text">
        {eyebrow && <span className="ui-page-eyebrow">{eyebrow}</span>}
        <h1 className={`ui-title ui-page-title${hero ? ' is-hero' : ''}`}>{title}</h1>
        {description && <p className="ui-page-description">{description}</p>}
        {children}
      </div>
      {actions && <div className="ui-page-actions">{actions}</div>}
    </header>
  )
}

/** Tooltip untuk elemen apa pun. Untuk tombol ikon cukup pakai IconButton (label = tooltip). side: top | right | bottom */
export function Tooltip({ label, side = 'top', children, className = '' }) {
  return <span className={`ui-tip ${className}`.trim()} data-tooltip={label} data-tooltip-side={side}>{children}</span>
}

/**
 * Tabel data. Selalu dibungkus agar bisa digeser horizontal di layar kecil.
 * columns: [{ key, header, numeric?, width?, render?: (row) => node }]
 * rows: array objek; rowKey: (row) => id; onRowClick opsional (baris jadi bisa ditekan & fokus keyboard).
 */
export function Table({ columns, rows, rowKey = (row) => row.id, onRowClick, caption, compact = false, className = '', minWidth }) {
  return (
    <div className="ui-table-wrap" tabIndex={0} role="region" aria-label={caption || 'Tabel data'}>
      <table className={`ui-table${compact ? ' ui-table-compact' : ''} ${className}`.trim()} style={minWidth ? { minWidth } : undefined}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.numeric ? 'is-num' : undefined} style={column.width ? { width: column.width } : undefined}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? 'is-clickable' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (event) => { if (event.key === 'Enter') onRowClick(row) } : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} className={column.numeric ? 'is-num' : undefined}>{column.render ? column.render(row) : row[column.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Centang yang tergambar (feedback sukses, mis. setelah "Tandai lunas"). */
export function CheckMark({ size = 22, label = 'Berhasil' }) {
  return (
    <span className="ui-check" role="img" aria-label={label}>
      <svg width={size} height={size} viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="13" cy="13" r="12" />
        <path d="M7.5 13.5l3.6 3.6 7.4-8" />
      </svg>
    </span>
  )
}

/** Bar progres 0–100. tone: accent | good | warn | bad. `label` wajib untuk pembaca layar. */
export function Progress({ value = 0, tone = 'accent', label, className = '' }) {
  const clamped = Math.min(100, Math.max(0, Number(value) || 0))
  return (
    <span className={`ui-progress ui-progress-${tone} ${className}`.trim()} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped)} aria-label={label} style={{ '--value': `${clamped}%` }}>
      <span />
    </span>
  )
}

function pageWindow(page, pageCount) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1)
  const pages = new Set([1, pageCount, page - 1, page, page + 1])
  if (page <= 3) [2, 3, 4].forEach((value) => pages.add(value))
  if (page >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((value) => pages.add(value))
  const sorted = [...pages].filter((value) => value >= 1 && value <= pageCount).sort((a, b) => a - b)
  const result = []
  sorted.forEach((value, index) => {
    if (index && value - sorted[index - 1] > 1) result.push(`gap-${value}`)
    result.push(value)
  })
  return result
}

/** Navigasi halaman: "1–25 dari 120" + tombol halaman. page dimulai dari 1. */
export function Pagination({ page, pageSize, total, onChange, itemLabel = 'baris' }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) {
    return <div className="ui-pagination"><span className="ui-pagination-info tabular">{formatNumber(total)} {itemLabel}</span></div>
  }
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <nav className="ui-pagination" aria-label="Halaman">
      <span className="ui-pagination-info tabular">{formatNumber(from)}–{formatNumber(to)} dari {formatNumber(total)} {itemLabel}</span>
      <div className="ui-pagination-pages">
        <IconButton icon={ChevronLeft} label="Halaman sebelumnya" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)} />
        {pageWindow(page, pageCount).map((value) => (typeof value === 'string' ? (
          <span key={value} className="ui-pagination-gap" aria-hidden="true">…</span>
        ) : (
          <button
            key={value}
            type="button"
            className={`ui-pagination-page tabular${value === page ? ' is-current' : ''}`}
            aria-current={value === page ? 'page' : undefined}
            aria-label={`Halaman ${value}`}
            onClick={() => onChange(value)}
          >
            {value}
          </button>
        )))}
        <IconButton icon={ChevronRight} label="Halaman berikutnya" size="sm" disabled={page >= pageCount} onClick={() => onChange(page + 1)} />
      </div>
    </nav>
  )
}
