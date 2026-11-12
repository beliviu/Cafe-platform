import { Badge } from './ui/index.js'
import { formatDateTime } from '../lib/format.js'

const STATUS = {
  pending: { label: 'Antre', tone: 'blue' },
  sending: { label: 'Mengirim', tone: 'blue' },
  sent: { label: 'Terkirim', tone: 'green' },
  failed: { label: 'Gagal', tone: 'red' },
  skipped: { label: 'Dilewati', tone: 'neutral' },
}

/** Status kirim email notifikasi (notification_outbox) untuk satu kafe. */
export function OutboxTable({ rows }) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Waktu</th>
            <th scope="col">Ke</th>
            <th scope="col">Subjek</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const meta = STATUS[row.status] || STATUS.pending
            return (
              <tr key={row.id}>
                <td className="tabular">{formatDateTime(row.created_at)}</td>
                <td><span className="pa-cell-main"><strong>{row.recipient}</strong><small>{row.audience === 'admin' ? 'Admin' : 'Owner'} · {row.channel === 'email' ? 'Email' : 'WhatsApp'}</small></span></td>
                <td>{row.subject}</td>
                <td>
                  <span className="pa-cell-main">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {row.status === 'failed' && row.error && <small title={row.error}>{row.error}</small>}
                    {row.status === 'sent' && row.sent_at && <small>{formatDateTime(row.sent_at)}</small>}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
