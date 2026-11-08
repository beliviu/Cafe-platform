import { useState } from 'react'
import { niceScale, useElementWidth } from './useElementWidth.js'

const HEIGHT = 228
const PAD = { top: 22, right: 8, bottom: 28, left: 56 }
const MAX_BAR = 24

/** Batang dengan ujung atas membulat 4px dan dasar persegi. */
function barPath(x, y, width, height) {
  if (height <= 0) return ''
  const radius = Math.min(4, width / 2, height)
  return `M${x},${y + height}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + width - radius}Q${x + width},${y} ${x + width},${y + radius}V${y + height}Z`
}

/**
 * Grafik kolom satu seri.
 * data: [{ key, label, tooltipLabel?, value }]
 * Hover / fokus keyboard (← →) menampilkan tooltip; batang tertinggi diberi label nilai.
 */
export function ColumnChart({ data, formatValue, formatTick = formatValue, ariaLabel, valueLabel }) {
  const [ref, width] = useElementWidth()
  const [active, setActive] = useState(null)

  const plotWidth = Math.max(40, width - PAD.left - PAD.right)
  const plotHeight = HEIGHT - PAD.top - PAD.bottom
  const maxValue = Math.max(0, ...data.map((entry) => entry.value))
  const scale = niceScale(maxValue)
  const band = plotWidth / Math.max(1, data.length)
  const barWidth = Math.max(3, Math.min(MAX_BAR, band * 0.62))
  const y = (value) => PAD.top + plotHeight - (value / scale.max) * plotHeight
  const maxLabels = Math.max(2, Math.floor(plotWidth / 58))
  const labelStep = Math.ceil(data.length / maxLabels)
  const peakIndex = maxValue > 0 ? data.findIndex((entry) => entry.value === maxValue) : -1
  const activeEntry = active === null ? null : data[active]

  function handleKeyDown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    setActive((current) => {
      if (event.key === 'Home') return 0
      if (event.key === 'End') return data.length - 1
      if (current === null) return event.key === 'ArrowLeft' ? data.length - 1 : 0
      return Math.max(0, Math.min(data.length - 1, current + (event.key === 'ArrowRight' ? 1 : -1)))
    })
  }

  return (
    <div
      ref={ref}
      className="chart"
      tabIndex={0}
      role="group"
      aria-label={`${ariaLabel}. Gunakan panah kiri dan kanan untuk membaca nilai.`}
      onKeyDown={handleKeyDown}
      onBlur={() => setActive(null)}
      onPointerLeave={() => setActive(null)}
    >
      <svg width={width} height={HEIGHT} aria-hidden="true" className="chart-svg">
        {scale.ticks.map((tick) => (
          <g key={tick}>
            <line className="chart-grid" x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} />
            <text className="chart-tick" x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{formatTick(tick)}</text>
          </g>
        ))}
        {data.map((entry, index) => {
          const x = PAD.left + band * index + (band - barWidth) / 2
          const top = y(entry.value)
          return (
            <g key={entry.key}>
              <path className={`chart-bar${active === index ? ' is-active' : ''}${active !== null && active !== index ? ' is-dimmed' : ''}`} d={barPath(x, top, barWidth, PAD.top + plotHeight - top)} />
              {index === peakIndex && active === null && (
                <text className="chart-value-label" x={x + barWidth / 2} y={top - 7} textAnchor="middle">{formatTick(entry.value)}</text>
              )}
              {index % labelStep === 0 && (
                <text className="chart-tick" x={PAD.left + band * index + band / 2} y={HEIGHT - 8} textAnchor="middle">{entry.label}</text>
              )}
              <rect
                className="chart-hit"
                x={PAD.left + band * index}
                y={PAD.top}
                width={band}
                height={plotHeight}
                onPointerEnter={() => setActive(index)}
              />
            </g>
          )
        })}
        <line className="chart-baseline" x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plotHeight} y2={PAD.top + plotHeight} />
      </svg>
      {activeEntry && (
        <div
          className="chart-tooltip"
          style={{
            left: Math.min(width - 90, Math.max(90, PAD.left + band * active + band / 2)),
            top: Math.max(4, y(activeEntry.value) - 12),
          }}
          aria-hidden="true"
        >
          <strong className="tabular">{formatValue(activeEntry.value)}</strong>
          <span>{activeEntry.tooltipLabel || activeEntry.label}{valueLabel ? ` · ${valueLabel}` : ''}</span>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {activeEntry ? `${activeEntry.tooltipLabel || activeEntry.label}: ${formatValue(activeEntry.value)}` : ''}
      </p>
    </div>
  )
}
