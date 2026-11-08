import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatNumber } from '../../lib/format.js'
import { IconButton } from './Button.jsx'

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
