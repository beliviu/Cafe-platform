/*
 * Grafik garis satu seri (SVG, tanpa library). Warna: --chart-1 dari mesin tema (ikut warna & mode).
 * Divalidasi (dataviz validate_palette.js, 6 warna tema × gelap/terang): kontras garis ≥ 3:1 terhadap kartu.
 * Satu seri → tanpa legenda (judul kartu menamainya). Satu sumbu. Garis 2px, crosshair + tooltip saat hover,
 * titik terakhir diberi label nilai. Tabel tersembunyi untuk pembaca layar.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'

const H = 240
const PAD = { top: 18, right: 18, bottom: 28, left: 64 }

function niceMax(value) {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((unit) => unit * power >= value / 1) * power
  return step < value ? step * 2 : step
}

export function LineChart({ points, format = String, formatAxis = format, label }) {
  const id = useId()
  const svgRef = useRef(null)
  const plotRef = useRef(null)
  const [hover, setHover] = useState(null)
  // Lebar SVG = lebar kartu (1 unit = 1px) agar teks sumbu tetap 11px di layar mana pun
  const [W, setW] = useState(640)
  useEffect(() => {
    const node = plotRef.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const geometry = useMemo(() => {
    const max = niceMax(Math.max(...points.map((point) => Number(point.value) || 0)))
    const innerW = W - PAD.left - PAD.right
    const innerH = H - PAD.top - PAD.bottom
    const x = (index) => PAD.left + (points.length === 1 ? innerW / 2 : (index / (points.length - 1)) * innerW)
    const y = (value) => PAD.top + innerH - ((Number(value) || 0) / max) * innerH
    const coords = points.map((point, index) => ({ ...point, cx: x(index), cy: y(point.value) }))
    const line = coords.map((point, index) => `${index ? 'L' : 'M'}${point.cx.toFixed(1)},${point.cy.toFixed(1)}`).join(' ')
    const area = `${line} L${coords.at(-1).cx.toFixed(1)},${PAD.top + innerH} L${coords[0].cx.toFixed(1)},${PAD.top + innerH} Z`
    const ticks = [0, max / 2, max]
    return { coords, line, area, ticks, y, baseline: PAD.top + innerH }
  }, [points, W])

  function onMove(event) {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * W
    let nearest = 0
    geometry.coords.forEach((point, index) => {
      if (Math.abs(point.cx - px) < Math.abs(geometry.coords[nearest].cx - px)) nearest = index
    })
    setHover(nearest)
  }

  const active = hover === null ? null : geometry.coords[hover]
  const last = geometry.coords.at(-1)
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor((W - PAD.left) / 64))))

  return (
    <figure className="pa-chart">
      <div className="pa-chart-plot" ref={plotRef}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-title`}
          onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <title id={`${id}-title`}>{label}</title>
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {geometry.ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={W - PAD.right} y1={geometry.y(tick)} y2={geometry.y(tick)} className="pa-chart-grid" />
              <text x={PAD.left - 10} y={geometry.y(tick)} className="pa-chart-axis" textAnchor="end" dominantBaseline="middle">{formatAxis(tick)}</text>
            </g>
          ))}
          {geometry.coords.map((point, index) => (index % labelEvery === (points.length - 1) % labelEvery) && (
            <text key={point.label} x={point.cx} y={H - 8} className="pa-chart-axis" textAnchor="middle">{point.short || point.label}</text>
          ))}
          <path d={geometry.area} fill={`url(#${id}-fill)`} />
          <path d={geometry.line} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {active && <line x1={active.cx} x2={active.cx} y1={PAD.top} y2={geometry.baseline} className="pa-chart-cross" />}
          {(active ? [active] : [last]).map((point) => (
            <circle key={point.label} cx={point.cx} cy={point.cy} r="4.5" fill="var(--chart-1)" stroke="var(--surface-card)" strokeWidth="2" />
          ))}
          {!active && (
            <text x={Math.min(last.cx, W - PAD.right - 4)} y={last.cy - 12} className="pa-chart-value" textAnchor="end">{format(last.value)}</text>
          )}
        </svg>
        {active && (
          <div className="pa-chart-tip" style={{ left: `${(active.cx / W) * 100}%`, top: `${(active.cy / H) * 100}%` }} role="status">
            <span>{active.label}</span>
            <strong className="tabular">{format(active.value)}</strong>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead><tr><th scope="col">Bulan</th><th scope="col">Nilai</th></tr></thead>
        <tbody>{points.map((point) => <tr key={point.label}><td>{point.label}</td><td>{format(point.value)}</td></tr>)}</tbody>
      </table>
    </figure>
  )
}
