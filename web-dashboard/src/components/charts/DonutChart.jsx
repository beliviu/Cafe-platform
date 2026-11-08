import { useState } from 'react'

const SIZE = 148
const STROKE = 20
const GAP_DEG = 2.4

function polar(cx, cy, radius, angle) {
  const radians = ((angle - 90) * Math.PI) / 180
  return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)]
}

function arc(startAngle, endAngle) {
  const radius = (SIZE - STROKE) / 2
  const center = SIZE / 2
  const [x1, y1] = polar(center, center, radius, startAngle)
  const [x2, y2] = polar(center, center, radius, endAngle)
  const large = endAngle - startAngle > 180 ? 1 : 0
  return `M${x1},${y1}A${radius},${radius} 0 ${large} 1 ${x2},${y2}`
}

/**
 * Donut kecil bagian-dari-keseluruhan. Identitas tidak hanya dari warna:
 * legenda di sampingnya selalu menampilkan nama, nilai, dan persentase.
 * segments: [{ key, label, value, color, detail }] — urutan tetap (bukan diurutkan per nilai).
 */
export function DonutChart({ segments, centerValue, centerLabel, formatValue, ariaLabel }) {
  const [active, setActive] = useState(null)
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  const visible = segments.filter((segment) => segment.value > 0)
  const gap = visible.length > 1 ? GAP_DEG : 0
  const arcs = visible.map((segment, index) => {
    const before = visible.slice(0, index).reduce((sum, item) => sum + item.value, 0)
    const offset = (before / total) * 360
    const sweep = (segment.value / total) * 360
    const start = offset + gap / 2
    const end = offset + sweep - gap / 2
    return { ...segment, path: sweep >= 359.9 ? null : arc(start, Math.max(start + 0.5, end)) }
  })
  const activeSegment = arcs.find((segment) => segment.key === active)
  const share = (value) => (total ? Math.round((value / total) * 100) : 0)

  return (
    <div className="donut" role="group" aria-label={ariaLabel}>
      <div className="donut-layout">
      <div className="donut-figure">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          {arcs.map((segment) => (segment.path ? (
            <path
              key={segment.key}
              d={segment.path}
              className={`donut-arc${active && active !== segment.key ? ' is-dimmed' : ''}`}
              stroke={segment.color}
              strokeWidth={STROKE}
              fill="none"
              onPointerEnter={() => setActive(segment.key)}
              onPointerLeave={() => setActive(null)}
            />
          ) : (
            <circle key={segment.key} cx={SIZE / 2} cy={SIZE / 2} r={(SIZE - STROKE) / 2} stroke={segment.color} strokeWidth={STROKE} fill="none" />
          )))}
        </svg>
        <div className="donut-center">
          <strong className="tabular">{activeSegment ? `${share(activeSegment.value)}%` : centerValue}</strong>
          <span>{activeSegment ? activeSegment.label : centerLabel}</span>
        </div>
      </div>
      <ul className="donut-legend">
        {segments.map((segment) => (
          <li
            key={segment.key}
            className={active === segment.key ? 'is-active' : ''}
            onPointerEnter={() => segment.value > 0 && setActive(segment.key)}
            onPointerLeave={() => setActive(null)}
          >
            <i style={{ background: segment.color }} aria-hidden="true" />
            <span className="donut-legend-name">{segment.label}<small>{segment.detail}</small></span>
            <span className="donut-legend-value tabular">
              {formatValue(segment.value)}
              <small>{share(segment.value)}%</small>
            </span>
          </li>
        ))}
      </ul>
      </div>
    </div>
  )
}
