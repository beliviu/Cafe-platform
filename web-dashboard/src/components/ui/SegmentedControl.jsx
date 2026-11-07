import { useRef } from 'react'

/**
 * Pilihan tunggal (rentang tanggal, tab Aktif/Riwayat, grid/tabel).
 * options: [{ value, label, count?, icon? }]
 * variant: segmented (pil) | tabs (garis bawah)
 */
export function SegmentedControl({ options, value, onChange, label, variant = 'segmented', size = 'md', className = '' }) {
  const refs = useRef([])

  function handleKeyDown(event, index) {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    event.preventDefault()
    const next = (index + delta + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div className={`ui-segmented ui-segmented-${variant} ui-segmented-${size} ${className}`.trim()} role="radiogroup" aria-label={label}>
      {options.map((option, index) => {
        const selected = option.value === value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            ref={(node) => { refs.current[index] = node }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.ariaLabel}
            tabIndex={selected ? 0 : -1}
            className={`ui-segment${selected ? ' is-selected' : ''}`}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {Icon && <Icon size={15} aria-hidden="true" />}
            {option.label && <span>{option.label}</span>}
            {option.count !== undefined && <span className="ui-segment-count tabular">{option.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
