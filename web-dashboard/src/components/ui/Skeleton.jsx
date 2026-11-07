export function Skeleton({ width = '100%', height = 14, radius = 6, className = '', style }) {
  return <span className={`ui-skeleton ${className}`.trim()} style={{ width, height, borderRadius: radius, ...style }} aria-hidden="true" />
}

export function SkeletonText({ lines = 3 }) {
  return (
    <span className="ui-skeleton-text" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} width={index === lines - 1 ? '60%' : '100%'} />
      ))}
    </span>
  )
}

/** Baris-baris placeholder untuk tabel/list. */
export function SkeletonRows({ rows = 5, label = 'Memuat data' }) {
  return (
    <div className="ui-skeleton-rows" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div className="ui-skeleton-row" key={index}>
          <Skeleton width={36} height={36} radius={10} />
          <span className="ui-skeleton-row-text"><Skeleton width="42%" /><Skeleton width="26%" height={11} /></span>
          <Skeleton width={72} height={22} radius={999} />
        </div>
      ))}
    </div>
  )
}
