/*
 * Grafik batang (SVG, tanpa library). Batang tumbuh berurutan saat muncul; tooltip mengikuti kursor.
 *
 * BarChart        — satu seri. data: [{ key, label, tooltipLabel?, value }]
 * StackedBarChart — bertumpuk. data: [{ key, label, values: { [seriesKey]: number } }],
 *                   series: [{ key, label, color }] (urutan tetap, bawah → atas). Nilai negatif digambar ke bawah sumbu.
 * Keyboard: fokus lalu ← → untuk membaca nilai.
 */
import { useState } from 'react'
import { useElementWidth } from '../components/hooks.js'
import { barPath, clamp, niceScale } from './scale.js'

const PAD = { top: 24, right: 8, bottom: 28, left: 56 }
const MAX_BAR = 28

function useBarNav(count) {
  const [hover, setHover] = useState(null) // { index, x, y }
  function onKeyDown(event, xOf) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const last = count - 1
    const current = hover?.index ?? (event.key === 'ArrowLeft' ? count : -1)
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? last : clamp(current + (event.key === 'ArrowRight' ? 1 : -1), 0, last)
    setHover({ index, x: xOf(index), y: PAD.top + 8 })
  }
  return [hover, setHover, onKeyDown]
}

export function BarChart({ data, formatValue = String, formatTick = formatValue, ariaLabel, valueLabel, height = 228 }) {
  const [ref, width] = useElementWidth()
  const [hover, setHover, onKeyDown] = useBarNav(data.length)

  const plotWidth = Math.max(40, width - PAD.left - PAD.right)
  const plotHeight = height - PAD.top - PAD.bottom
  const maxValue = Math.max(0, ...data.map((entry) => entry.value))
  const scale = niceScale(maxValue)
  const band = plotWidth / Math.max(1, data.length)
  const barWidth = Math.max(3, Math.min(MAX_BAR, band * 0.62))
  const y = (value) => PAD.top + plotHeight - (value / scale.max) * plotHeight
  const center = (index) => PAD.left + band * index + band / 2
  const labelStep = Math.ceil(data.length / Math.max(2, Math.floor(plotWidth / 58)))
  const peakIndex = maxValue > 0 ? data.findIndex((entry) => entry.value === maxValue) : -1
  const active = hover ? data[hover.index] : null

  function onMove(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = event.clientX - rect.left
    const index = Math.floor((px - PAD.left) / band)
    if (index < 0 || index >= data.length) setHover(null)
    else setHover({ index, x: px, y: event.clientY - rect.top })
  }

  return (
    <div
      ref={ref}
      className="chart chart-bars"
      tabIndex={0}
      role="group"
      aria-label={`${ariaLabel}. Gunakan panah kiri dan kanan untuk membaca nilai.`}
      onKeyDown={(event) => onKeyDown(event, center)}
      onBlur={() => setHover(null)}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
    >
      <svg width={width} height={height} aria-hidden="true" className="chart-svg">
        {scale.ticks.map((tick) => (
          <g key={tick}>
            <line className="chart-grid" x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} />
            <text className="chart-tick" x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{formatTick(tick)}</text>
          </g>
        ))}
        {data.map((entry, index) => {
          const x = center(index) - barWidth / 2
          const top = y(entry.value)
          const state = hover ? (hover.index === index ? ' is-active' : ' is-dimmed') : ''
          return (
            <g key={entry.key}>
              <path className={`chart-bar chart-grow${state}`} style={{ '--i': index }} d={barPath(x, top, barWidth, PAD.top + plotHeight - top)} />
              {index === peakIndex && !hover && (
                <text className="chart-value-label chart-dot-in" x={center(index)} y={top - 8} textAnchor="middle">{formatTick(entry.value)}</text>
              )}
              {index % labelStep === 0 && <text className="chart-tick" x={center(index)} y={height - 8} textAnchor="middle">{entry.label}</text>}
            </g>
          )
        })}
        <line className="chart-baseline" x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plotHeight} y2={PAD.top + plotHeight} />
      </svg>
      {active && (
        <div className="chart-tooltip is-follow" style={{ left: clamp(hover.x, 70, width - 70), top: Math.max(8, Math.min(hover.y, y(active.value)) - 14) }} aria-hidden="true">
          <span>{active.tooltipLabel || active.label}{valueLabel ? ` · ${valueLabel}` : ''}</span>
          <strong className="tabular">{formatValue(active.value)}</strong>
        </div>
      )}
      <p className="sr-only" aria-live="polite">{active ? `${active.tooltipLabel || active.label}: ${formatValue(active.value)}` : ''}</p>
    </div>
  )
}
/** Nama lama. */
export const ColumnChart = BarChart

export function StackedBarChart({ data, series, formatValue = String, formatTick = formatValue, ariaLabel, height = 260 }) {
  const [ref, width] = useElementWidth()
  const [hover, setHover, onKeyDown] = useBarNav(data.length)

  const totals = data.map((entry) => series.reduce((acc, item) => {
    const value = Number(entry.values[item.key]) || 0
    return value >= 0 ? { ...acc, pos: acc.pos + value } : { ...acc, neg: acc.neg + value }
  }, { pos: 0, neg: 0 }))
  const up = niceScale(Math.max(0, ...totals.map((total) => total.pos)), 3)
  const downRaw = Math.max(0, ...totals.map((total) => -total.neg))
  const step = up.ticks[1] - up.ticks[0] || 1
  const downMax = downRaw > 0 ? Math.ceil(downRaw / step) * step : 0
  const ticks = [...up.ticks]
  for (let value = -step; value >= -downMax - step / 2; value -= step) ticks.unshift(value)

  const plotWidth = Math.max(40, width - PAD.left - PAD.right)
  const plotHeight = height - PAD.top - PAD.bottom
  const y = (value) => PAD.top + ((up.max - value) / (up.max + downMax)) * plotHeight
  const band = plotWidth / Math.max(1, data.length)
  const barWidth = Math.max(4, Math.min(36, band * 0.6))
  const center = (index) => PAD.left + band * index + band / 2
  const labelStep = Math.ceil(data.length / Math.max(2, Math.floor(plotWidth / 58)))
  const active = hover ? data[hover.index] : null

  function onMove(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = event.clientX - rect.left
    const index = Math.floor((px - PAD.left) / band)
    if (index < 0 || index >= data.length) setHover(null)
    else setHover({ index, x: px, y: event.clientY - rect.top })
  }

  return (
    <div className="chart chart-stacked">
      <ul className="chart-legend" aria-hidden="true">
        {series.map((item) => <li key={item.key}><i style={{ background: item.color }} />{item.label}</li>)}
      </ul>
      <div
        ref={ref}
        className="chart-plot"
        tabIndex={0}
        role="group"
        aria-label={`${ariaLabel}. Gunakan panah kiri dan kanan untuk membaca nilai.`}
        onKeyDown={(event) => onKeyDown(event, center)}
        onBlur={() => setHover(null)}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <svg width={width} height={height} aria-hidden="true" className="chart-svg">
          {ticks.map((tick) => (
            <g key={tick}>
              <line className={tick === 0 ? 'chart-baseline' : 'chart-grid'} x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} />
              <text className="chart-tick" x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{formatTick(tick)}</text>
            </g>
          ))}
          {data.map((entry, index) => {
            let pos = 0
            let neg = 0
            const x = center(index) - barWidth / 2
            const state = hover ? (hover.index === index ? ' is-active' : ' is-dimmed') : ''
            return (
              <g key={entry.key} className={`chart-stack chart-grow${state}`} style={{ '--i': index, transformOrigin: `0 ${y(0)}px` }}>
                {series.map((item) => {
                  const value = Number(entry.values[item.key]) || 0
                  if (!value) return null
                  const from = value > 0 ? pos : neg
                  const to = from + value
                  if (value > 0) pos = to
                  else neg = to
                  const top = Math.min(y(from), y(to))
                  const size = Math.abs(y(from) - y(to))
                  // Celah 2px antar-segmen: identitas tidak hanya dari warna
                  return <rect key={item.key} x={x} y={top + (value > 0 ? 1 : 0)} width={barWidth} height={Math.max(0, size - 1)} rx="2" style={{ fill: item.color }} />
                })}
              </g>
            )
          })}
          {data.map((entry, index) => index % labelStep === 0 && (
            <text key={entry.key} className="chart-tick" x={center(index)} y={height - 8} textAnchor="middle">{entry.label}</text>
          ))}
        </svg>
        {active && (
          <div className="chart-tooltip is-follow" style={{ left: clamp(hover.x, 96, width - 96), top: Math.max(8, hover.y - 14) }} aria-hidden="true">
            <span>{active.tooltipLabel || active.label}</span>
            {series.filter((item) => Number(active.values[item.key])).map((item) => (
              <span key={item.key} className="chart-tooltip-row"><i style={{ background: item.color }} />{item.label}<strong className="tabular">{formatValue(active.values[item.key])}</strong></span>
            ))}
          </div>
        )}
        <p className="sr-only" aria-live="polite">
          {active ? `${active.tooltipLabel || active.label}: ${series.map((item) => `${item.label} ${formatValue(Number(active.values[item.key]) || 0)}`).join(', ')}` : ''}
        </p>
      </div>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead><tr><th scope="col">Periode</th>{series.map((item) => <th key={item.key} scope="col">{item.label}</th>)}</tr></thead>
        <tbody>
          {data.map((entry) => (
            <tr key={entry.key}><td>{entry.tooltipLabel || entry.label}</td>{series.map((item) => <td key={item.key}>{formatValue(Number(entry.values[item.key]) || 0)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
