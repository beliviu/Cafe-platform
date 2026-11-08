import { useState } from 'react'
import { visibleHours } from '../../lib/analytics.js'
import { formatNumber } from '../../lib/format.js'

const WEEKDAY_SHORT = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const WEEKDAY_LONG = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']
const LEVELS = 5

const hourLabel = (hour) => `${String(hour).padStart(2, '0')}.00`

function level(count, max) {
  if (!count || !max) return 0
  return Math.max(1, Math.ceil((count / max) * LEVELS))
}

/**
 * Heatmap hari × jam (jumlah pesanan). Satu warna sage, terang → gelap.
 * Keyboard: fokus ke grid lalu panah untuk berpindah sel.
 */
export function HourHeatmap({ matrix }) {
  const hours = visibleHours(matrix)
  const max = Math.max(0, ...matrix.flat())
  const [active, setActive] = useState(null)

  function handleKeyDown(event) {
    const moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    setActive((current) => {
      const start = current || { day: 0, hourIndex: 0 }
      if (!current) return start
      return {
        day: Math.max(0, Math.min(6, start.day + move[0])),
        hourIndex: Math.max(0, Math.min(hours.length - 1, start.hourIndex + move[1])),
      }
    })
  }

  const activeCount = active ? matrix[active.day][hours[active.hourIndex]] : 0
  const activeText = active
    ? `${WEEKDAY_LONG[active.day]}, ${hourLabel(hours[active.hourIndex])}–${hourLabel(hours[active.hourIndex] + 1)}: ${formatNumber(activeCount)} pesanan`
    : ''

  return (
    <div className="heatmap-wrap">
      <div
        className="heatmap"
        style={{ '--heatmap-cols': hours.length }}
        tabIndex={0}
        role="group"
        aria-label="Heatmap jam ramai per hari. Gunakan tombol panah untuk membaca jumlah pesanan."
        onKeyDown={handleKeyDown}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
      >
        <span aria-hidden="true" />
        {hours.map((hour) => (
          <span key={hour} className="heatmap-hour tabular" aria-hidden="true">{hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}</span>
        ))}
        {matrix.map((row, day) => (
          <div className="heatmap-row" key={WEEKDAY_SHORT[day]} style={{ display: 'contents' }}>
            <span className="heatmap-day" aria-hidden="true">{WEEKDAY_SHORT[day]}</span>
            {hours.map((hour, hourIndex) => {
              const isActive = active?.day === day && active?.hourIndex === hourIndex
              return (
                <span
                  key={hour}
                  className={`heatmap-cell heatmap-l${level(row[hour], max)}${isActive ? ' is-active' : ''}`}
                  onPointerEnter={() => setActive({ day, hourIndex })}
                  aria-hidden="true"
                />
              )
            })}
          </div>
        ))}
      </div>
      <div className="heatmap-footer">
        <span className="heatmap-readout" aria-live="polite">{activeText || 'Arahkan ke kotak untuk melihat jumlah pesanan.'}</span>
        <span className="heatmap-legend" aria-hidden="true">
          Sedikit
          {Array.from({ length: LEVELS }, (_, index) => <i key={index} className={`heatmap-cell heatmap-l${index + 1}`} />)}
          Banyak
        </span>
      </div>
    </div>
  )
}
