import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { formatPercent } from '../../lib/format.js'
import { Skeleton } from './Skeleton.jsx'
import { Sparkline } from './Sparkline.jsx'

/**
 * Kartu metrik.
 * - delta: persentase perubahan vs periode sebelumnya (null = tidak ditampilkan)
 * - deltaInverse: true bila kenaikan itu buruk (mis. pesanan dibatalkan)
 * - compact: strip kecil (dipakai di staff)
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  caption,
  delta = null,
  deltaLabel = 'vs periode sebelumnya',
  deltaInverse = false,
  trend,
  tone = 'sage',
  loading = false,
  compact = false,
  onClick,
}) {
  const Component = onClick ? 'button' : 'article'
  const hasDelta = delta !== null && delta !== undefined && Number.isFinite(delta)
  const direction = !hasDelta || Math.abs(delta) < 0.5 ? 'flat' : delta > 0 ? 'up' : 'down'
  const good = direction === 'flat' ? null : (direction === 'up') !== deltaInverse
  const DeltaIcon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus

  return (
    <Component
      className={`ui-stat ui-stat-${tone}${compact ? ' ui-stat-compact' : ''}${onClick ? ' ui-stat-clickable' : ''}`}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
    >
      <div className="ui-stat-top">
        {Icon && <span className="ui-stat-icon"><Icon size={compact ? 15 : 17} aria-hidden="true" /></span>}
        <span className="ui-stat-label">{label}</span>
      </div>
      {loading ? (
        <Skeleton width="60%" height={compact ? 22 : 30} />
      ) : (
        <strong className="ui-stat-value tabular">{value}</strong>
      )}
      {!compact && (hasDelta || caption) && !loading && (
        <div className="ui-stat-foot">
          {hasDelta && (
            <span
              className={`ui-delta ui-delta-${good === null ? 'flat' : good ? 'good' : 'bad'}`}
              aria-label={`${direction === 'up' ? 'Naik' : direction === 'down' ? 'Turun' : 'Tetap'} ${formatPercent(Math.abs(delta))} ${deltaLabel}`}
            >
              <DeltaIcon size={13} aria-hidden="true" />
              <span className="tabular">{formatPercent(Math.abs(delta))}</span>
            </span>
          )}
          <span className="ui-stat-caption">{hasDelta ? deltaLabel : caption}</span>
        </div>
      )}
      {trend && !compact && !loading && (
        <div className="ui-stat-trend"><Sparkline values={trend} tone={tone} width={200} height={30} fluid /></div>
      )}
    </Component>
  )
}
