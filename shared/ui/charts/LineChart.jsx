/*
 * Grafik garis satu seri (SVG, tanpa library). Warna dari token --chart-1.
 * - Garis tergambar dari kiri saat muncul; tooltip mengikuti kursor; crosshair menempel di titik terdekat.
 * - Keyboard: fokus lalu ← → untuk membaca nilai. Tabel tersembunyi untuk pembaca layar.
 * points: [{ label, short?, value }]
 */
import { useId, useMemo, useState } from 'react'
import { useElementWidth } from '../components/hooks.js'
import { clamp, niceScale } from './scale.js'

const PAD = { top: 20, right: 20, bottom: 28, left: 64 }

export function LineChart({ points, format = String, formatAxis = format, label, height = 240 }) {
  const id = useId()
  const [ref, width] = useElementWidth(640)
  const [hover, setHover] = useState(null) // { index, x, y }

  const geometry = useMemo(() => {
    const scale = niceScale(Math.max(0, ...points.map((point) => Number(point.value) || 0)), 3)
    const innerW = Math.max(40, width - PAD.left - PAD.right)
    const innerH = height - PAD.top - PAD.bottom
    const x = (index) => PAD.left + (points.length === 1 ? innerW / 2 : (index / (points.length - 1)) * innerW)
    const y = (value) => PAD.top + innerH - ((Number(value) || 0) / scale.max) * innerH
    const coords = points.map((point, index) => ({ ...point, cx: x(index), cy: y(point.value) }))
    const line = coords.map((point, index) => `${index ? 'L' : 'M'}${point.cx.toFixed(1)},${point.cy.toFixed(1)}`).join(' ')
    const baseline = PAD.top + innerH
    const area = coords.length ? `${line} L${coords.at(-1).cx.toFixed(1)},${baseline} L${coords[0].cx.toFixed(1)},${baseline} Z` : ''
    return { coords, line, area, ticks: scale.ticks, y, baseline }
  }, [points, width, height])

  if (!points.length) return null

  function nearest(px) {
    let best = 0
    geometry.coords.forEach((point, index) => {
      if (Math.abs(point.cx - px) < Math.abs(geometry.coords[best].cx - px)) best = index
    })
    return best
  }
  function onMove(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = event.clientX - rect.left
    setHover({ index: nearest(px), x: px, y: event.clientY - rect.top })
  }
  function onKeyDown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const last = points.length - 1
    const current = hover?.index ?? last
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? last : clamp(current + (event.key === 'ArrowRight' ? 1 : -1), 0, last)
    setHover({ index, x: geometry.coords[index].cx, y: geometry.coords[index].cy })
  }

  const active = hover ? geometry.coords[hover.index] : null
  const last = geometry.coords.at(-1)
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor((width - PAD.left) / 64))))

  return (
    <figure className="chart chart-line">
      <div
        className="chart-plot"
        ref={ref}
        tabIndex={0}
        role="group"
        aria-label={`${label}. Gunakan panah kiri dan kanan untuk membaca nilai.`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={onKeyDown}
      >
        <svg width={width} height={height} className="chart-svg" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {geometry.ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={width - PAD.right} y1={geometry.y(tick)} y2={geometry.y(tick)} className="chart-grid" />
              <text x={PAD.left - 10} y={geometry.y(tick)} className="chart-tick" textAnchor="end" dominantBaseline="middle">{formatAxis(tick)}</text>
            </g>
          ))}
          {geometry.coords.map((point, index) => (index % labelEvery === (points.length - 1) % labelEvery) && (
            <text key={`${point.label}-${index}`} x={point.cx} y={height - 8} className="chart-tick" textAnchor="middle">{point.short || point.label}</text>
          ))}
          <g className="chart-reveal" key={points.length}>
            <path d={geometry.area} fill={`url(#${id}-fill)`} />
            <path d={geometry.line} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </g>
          {active && <line x1={active.cx} x2={active.cx} y1={PAD.top} y2={geometry.baseline} className="chart-cross" />}
          <circle className={active ? '' : 'chart-dot-in'} cx={(active || last).cx} cy={(active || last).cy} r="4.5" fill="var(--chart-1)" stroke="var(--panel)" strokeWidth="2" />
          {!active && (
            <text x={Math.min(last.cx, width - PAD.right - 4)} y={last.cy - 12} className="chart-value-label chart-dot-in" textAnchor="end">{format(last.value)}</text>
          )}
        </svg>
        {active && (
          <div className="chart-tooltip is-follow" style={{ left: clamp(hover.x, 70, width - 70), top: Math.max(8, Math.min(hover.y, active.cy) - 14) }} aria-hidden="true">
            <span>{active.label}</span>
            <strong className="tabular">{format(active.value)}</strong>
          </div>
        )}
        <p className="sr-only" aria-live="polite">{active ? `${active.label}: ${format(active.value)}` : ''}</p>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead><tr><th scope="col">Periode</th><th scope="col">Nilai</th></tr></thead>
        <tbody>{points.map((point, index) => <tr key={`${point.label}-${index}`}><td>{point.label}</td><td>{format(point.value)}</td></tr>)}</tbody>
      </table>
    </figure>
  )
}
