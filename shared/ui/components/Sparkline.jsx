import { useId } from 'react'

/**
 * Garis tren kecil tanpa sumbu. `values` = array angka. Warna mengikuti `color` CSS induknya.
 * fluid: melebar mengikuti wadah (garis tetap tipis berkat non-scaling-stroke).
 */
export function Sparkline({ values = [], width = 96, height = 28, label, fluid = false, className = '' }) {
  const gradientId = useId()
  const clean = values.map((value) => Number(value) || 0)
  if (clean.length < 2) return null
  const max = Math.max(...clean)
  const min = Math.min(...clean)
  const span = max - min || 1
  const step = width / (clean.length - 1)
  const points = clean.map((value, index) => [index * step, height - 3 - ((value - min) / span) * (height - 6)])
  const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const area = `${line} L${width} ${height} L0 ${height} Z`

  return (
    <svg
      className={`ui-sparkline chart-reveal ${className}`.trim()}
      width={fluid ? '100%' : width}
      height={height}
      preserveAspectRatio={fluid ? 'none' : undefined}
      viewBox={`0 0 ${width} ${height}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity=".22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
