import { useState } from 'react'
import { niceScale, useElementWidth } from './useElementWidth.js'

const HEIGHT = 248
const PAD = { top: 26, right: 8, bottom: 28, left: 56 }
const MAX_BAR = 20

function barPath(x, y, width, height) {
  if (height <= 0) return ''
  const radius = Math.min(4, width / 2, height)
  return `M${x},${y + height}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + width - radius}Q${x + width},${y} ${x + width},${y + radius}V${y + height}Z`
}

/**
 * Aktual (batang penuh) + perkiraan (batang garis putus, isi terang) + rentang perkiraan (garis vertikal).
 * data: [{ key, label, tooltipLabel, actual: number|null, forecast: number|null, low, high }]
 * Perkiraan dibedakan dengan bentuk (garis putus & rentang), bukan hanya warna.
 */
export function ForecastChart({ data, formatValue, formatTick = formatValue, ariaLabel, rangeLabel = 'Rentang 80%' }) {
  const [ref, width] = useElementWidth()
  const [active, setActive] = useState(null)

  const plotWidth = Math.max(40, width - PAD.left - PAD.right)
  const plotHeight = HEIGHT - PAD.top - PAD.bottom
  const maxValue = Math.max(0, ...data.map((entry) => Math.max(entry.actual ?? 0, entry.forecast ?? 0, entry.high ?? 0)))
  const scale = niceScale(maxValue)
  const band = plotWidth / Math.max(1, data.length)
  const barWidth = Math.max(3, Math.min(MAX_BAR, band * 0.62))
  const y = (value) => PAD.top + plotHeight - (Math.max(0, value) / scale.max) * plotHeight
  const base = PAD.top + plotHeight
  const maxLabels = Math.max(2, Math.floor(plotWidth / 58))
  const labelStep = Math.ceil(data.length / maxLabels)
  const firstForecast = data.findIndex((entry) => entry.forecast !== null && entry.forecast !== undefined)
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

  function describe(entry) {
    const parts = []
    if (entry.actual !== null && entry.actual !== undefined) parts.push(`Aktual ${formatValue(entry.actual)}`)
    if (entry.forecast !== null && entry.forecast !== undefined) parts.push(`Perkiraan ${formatValue(entry.forecast)} (${formatValue(entry.low)}–${formatValue(entry.high)})`)
    return parts.join(' · ')
  }

  return (
    <div className="forecast-chart">
      <ul className="forecast-legend" aria-hidden="true">
        <li><i className="is-actual" />Aktual</li>
        <li><i className="is-forecast" />Perkiraan</li>
        <li><i className="is-range" />{rangeLabel}</li>
      </ul>
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
          {firstForecast > 0 && (
            <g>
              <line className="forecast-divider" x1={PAD.left + band * firstForecast} x2={PAD.left + band * firstForecast} y1={PAD.top - 14} y2={base} />
              <text className="chart-tick" x={PAD.left + band * firstForecast + 6} y={PAD.top - 8}>Hari ini</text>
            </g>
          )}
          {data.map((entry, index) => {
            const x = PAD.left + band * index + (band - barWidth) / 2
            const center = x + barWidth / 2
            const dim = active !== null && active !== index ? ' is-dimmed' : ''
            const hasForecast = entry.forecast !== null && entry.forecast !== undefined
            return (
              <g key={entry.key}>
                {hasForecast && (
                  <path className={`forecast-bar${dim}${active === index ? ' is-active' : ''}`} d={barPath(x + 1, y(entry.forecast) + 1, barWidth - 2, base - y(entry.forecast) - 1)} />
                )}
                {entry.actual !== null && entry.actual !== undefined && (
                  <path className={`chart-bar${dim}${active === index ? ' is-active' : ''}`} d={barPath(hasForecast ? x + barWidth * 0.25 : x, y(entry.actual), hasForecast ? barWidth * 0.5 : barWidth, base - y(entry.actual))} />
                )}
                {hasForecast && Number(entry.high) > Number(entry.low) && (
                  <g className={`forecast-range${dim}`}>
                    <line x1={center} x2={center} y1={y(entry.high)} y2={y(entry.low)} />
                    <line x1={center - 3} x2={center + 3} y1={y(entry.high)} y2={y(entry.high)} />
                    <line x1={center - 3} x2={center + 3} y1={y(entry.low)} y2={y(entry.low)} />
                  </g>
                )}
                {index % labelStep === 0 && (
                  <text className="chart-tick" x={PAD.left + band * index + band / 2} y={HEIGHT - 8} textAnchor="middle">{entry.label}</text>
                )}
                <rect className="chart-hit" x={PAD.left + band * index} y={PAD.top} width={band} height={plotHeight} onPointerEnter={() => setActive(index)} />
              </g>
            )
          })}
          <line className="chart-baseline" x1={PAD.left} x2={width - PAD.right} y1={base} y2={base} />
        </svg>
        {activeEntry && (
          <div
            className="chart-tooltip"
            style={{
              left: Math.min(width - 110, Math.max(110, PAD.left + band * active + band / 2)),
              top: Math.max(4, y(Math.max(activeEntry.actual ?? 0, activeEntry.high ?? activeEntry.forecast ?? 0)) - 12),
            }}
            aria-hidden="true"
          >
            <strong className="tabular">{formatValue(activeEntry.actual ?? activeEntry.forecast ?? 0)}</strong>
            <span>{activeEntry.tooltipLabel || activeEntry.label}</span>
            {activeEntry.forecast !== null && activeEntry.forecast !== undefined && (
              <span>{activeEntry.actual !== null && activeEntry.actual !== undefined ? `Aktual sejauh ini · perkiraan ${formatValue(activeEntry.forecast)}` : 'Perkiraan'} · {formatValue(activeEntry.low)}–{formatValue(activeEntry.high)}</span>
            )}
          </div>
        )}
        <p className="sr-only" aria-live="polite">{activeEntry ? `${activeEntry.tooltipLabel || activeEntry.label}: ${describe(activeEntry)}` : ''}</p>
      </div>
    </div>
  )
}
