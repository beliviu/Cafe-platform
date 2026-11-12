import { Link } from 'react-router-dom'
import { ACTION_LABELS } from '../lib/api.js'
import { formatDateTime } from '../lib/format.js'

const HIDDEN_KEYS = new Set(['updated_at', 'created_at', 'cafe_id', 'id', 'created_by'])

function show(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Daftar kolom yang berubah (sebelum → sesudah), termasuk satu tingkat objek bersarang. */
function diffEntries(before, after, prefix = '') {
  const entries = []
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  for (const key of keys) {
    if (HIDDEN_KEYS.has(key)) continue
    const a = before?.[key]
    const b = after?.[key]
    if (!prefix && a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) {
      entries.push(...diffEntries(a, b, `${key}.`))
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      entries.push({ key: `${prefix}${key}`, before: a, after: b })
    }
  }
  return entries
}

function Changes({ before, after }) {
  if (!before && after) {
    return (
      <details className="pa-details">
        <summary>Lihat data</summary>
        <pre className="pa-json">{JSON.stringify(after, null, 2)}</pre>
      </details>
    )
  }
  const entries = diffEntries(before, after)
  if (!entries.length) return <span className="pa-muted">—</span>
  return (
    <ul className="pa-diff">
      {entries.slice(0, 6).map((entry) => (
        <li key={entry.key}><b>{entry.key}</b><del>{show(entry.before)}</del>→<ins>{show(entry.after)}</ins></li>
      ))}
      {entries.length > 6 && <li className="pa-muted">+{entries.length - 6} perubahan lain</li>}
    </ul>
  )
}

export function AuditTable({ rows, showCafe = true }) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Waktu</th>
            <th scope="col">Oleh</th>
            <th scope="col">Aksi</th>
            {showCafe && <th scope="col">Kafe</th>}
            <th scope="col">Perubahan</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="tabular">{formatDateTime(row.created_at)}</td>
              <td>{row.actor_label || <span className="pa-muted">—</span>}</td>
              <td><span className="pa-cell-main"><strong>{ACTION_LABELS[row.action] || row.action}</strong>{row.note && <small title={row.note}>{row.note}</small>}</span></td>
              {showCafe && <td>{row.cafe_id ? <Link to={`/kafe/${row.cafe_id}`} className="link-button">{row.cafe_name || 'Kafe'}</Link> : <span className="pa-muted">—</span>}</td>}
              <td><Changes before={row.before} after={row.after} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
