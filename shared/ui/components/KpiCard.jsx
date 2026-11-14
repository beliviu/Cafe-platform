import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { useCountUp } from './hooks.js'
import { Skeleton } from './Skeleton.jsx'
import { Sparkline } from './Sparkline.jsx'

const percent = (value) => `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value)}%`

/** Angka yang menghitung naik saat muncul / berubah. `format` mengubah angka menjadi teks (mis. formatRupiah). */
export function CountUp({ value, format = (number) => new Intl.NumberFormat('id-ID').format(Math.round(number)), duration }) {
  const shown = useCountUp(Number(value) || 0, { duration })
  return <span className="tabular">{format(shown)}</span>
}

export function Delta({ value, label = 'vs periode sebelumnya', inverse = false }) {
  const has = value !== null && value !== undefined && Number.isFinite(value)
  if (!has) return null
  const direction = Math.abs(value) < 0.5 ? 'flat' : value > 0 ? 'up' : 'down'
  const good = direction === 'flat' ? null : (direction === 'up') !== inverse
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus
  const word = direction === 'up' ? 'Naik' : direction === 'down' ? 'Turun' : 'Tetap'
  return (
    <span className={`ui-delta ui-delta-${good === null ? 'flat' : good ? 'good' : 'bad'}`} aria-label={`${word} ${percent(Math.abs(value))} ${label}`}>
      <Icon size={13} aria-hidden="true" />
      <span className="tabular">{percent(Math.abs(value))}</span>
    </span>
  )
}

/**
 * Kartu KPI.
 * - value: angka (menghitung naik, diformat lewat `format`) atau teks jadi.
 * - hero: kartu utama bergradien aksen dengan kilau pelan — SATU per halaman.
 * - delta: persen perubahan vs periode sebelumnya; deltaInverse bila kenaikan itu buruk.
 * - trend: array angka untuk sparkline.
 */
export function KpiCard({
  label,
  value,
  format,
  caption,
  delta = null,
  deltaLabel = 'vs periode sebelumnya',
  deltaInverse = false,
  trend,
  hero = false,
  loading = false,
  onClick,
  className = '',
}) {
  const Component = onClick ? 'button' : 'article'
  const hasDelta = delta !== null && delta !== undefined && Number.isFinite(delta)
  return (
    <Component className={`ui-kpi${hero ? ' ui-kpi-hero' : ''} ${className}`.trim()} type={onClick ? 'button' : undefined} onClick={onClick}>
      <span className="ui-kpi-label"><span>{label}</span></span>
      {loading ? <Skeleton width="62%" height={30} /> : (
        <strong className="ui-kpi-value">
          {typeof value === 'number' ? <CountUp value={value} format={format} /> : value}
        </strong>
      )}
      {!loading && (hasDelta || caption) && (
        <span className="ui-kpi-foot">
          {hasDelta && <Delta value={delta} label={deltaLabel} inverse={deltaInverse} />}
          <span className="ui-kpi-caption">{hasDelta ? deltaLabel : caption}</span>
        </span>
      )}
      {loading && <Skeleton width="44%" height={12} />}
      {trend && !loading && <span className="ui-kpi-trend"><Sparkline values={trend} width={200} height={32} fluid /></span>}
    </Component>
  )
}

/**
 * Kartu metrik versi lama (API dipertahankan untuk halaman yang belum dimigrasi).
 * compact: strip kecil (dipakai di staff). Untuk halaman baru pakai KpiCard.
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
  tone = 'brand',
  loading = false,
  compact = false,
  onClick,
}) {
  const Component = onClick ? 'button' : 'article'
  const hasDelta = delta !== null && delta !== undefined && Number.isFinite(delta)
  return (
    <Component
      className={`ui-stat ui-stat-${tone}${compact ? ' ui-stat-compact' : ''}${onClick ? ' ui-stat-clickable' : ''}`}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
    >
      <div className="ui-stat-top">
        {Icon && compact && <span className="ui-stat-icon"><Icon size={15} aria-hidden="true" /></span>}
        <span className="ui-stat-label">{label}</span>
      </div>
      {loading ? <Skeleton width="60%" height={compact ? 22 : 30} /> : <strong className="ui-stat-value tabular">{value}</strong>}
      {!compact && (hasDelta || caption) && !loading && (
        <div className="ui-stat-foot">
          {hasDelta && <Delta value={delta} label={deltaLabel} inverse={deltaInverse} />}
          <span className="ui-stat-caption">{hasDelta ? deltaLabel : caption}</span>
        </div>
      )}
      {trend && !compact && !loading && (
        <div className="ui-stat-trend"><Sparkline values={trend} width={200} height={30} fluid /></div>
      )}
    </Component>
  )
}
