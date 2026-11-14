/*
 * Pendaftaran mandiri (file SQL 18): kafe yang daftar sendiri lewat /daftar di web owner.
 * Mode persetujuan (Pengaturan → Platform): kafe baru menunggu di sini sampai disetujui Super admin.
 */
import { useCallback, useState } from 'react'
import { Check, UserPlus, X } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { WhatsAppButton } from '../components/WhatsAppButton.jsx'
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, PageHeader, SegmentedControl, SkeletonRows, TextField, useToast,
} from '../components/ui/index.js'
import { optional, rpc, STATE_META, useLoader } from '../lib/api.js'
import { formatDate, formatDateTime } from '../lib/format.js'
import { can } from '../lib/roles.js'

const STATUS = {
  pending: { label: 'Menunggu', tone: 'amber' },
  approved: { label: 'Disetujui', tone: 'green' },
  rejected: { label: 'Ditolak', tone: 'red' },
}

export function SignupsPage() {
  const { admin } = useAuth()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const status = ['pending', 'approved', 'rejected'].includes(params.get('status')) ? params.get('status') : ''
  const load = useCallback(() => optional(rpc('pa_signups_list', { p_status: status || null, p_limit: 100 })), [status])
  const { data, error, loading, reload } = useLoader(load)
  const [deciding, setDeciding] = useState(null)
  const [note, setNote] = useState('')
  const canDecide = can(admin, 'pa_signup_decide')

  if (error) return <div className="page"><PageHeader title="Pendaftaran" /><ErrorState message={error} onRetry={reload} /></div>
  const counts = data?.counts || {}
  const options = [
    { value: '', label: 'Semua' },
    { value: 'pending', label: 'Menunggu', count: counts.pending },
    { value: 'approved', label: 'Disetujui', count: counts.approved },
    { value: 'rejected', label: 'Ditolak', count: counts.rejected },
  ]

  return (
    <div className="page page-wide pa-stack">
      <PageHeader eyebrow="Kafe" title="Pendaftaran" description="Kafe yang mendaftar sendiri lewat halaman /daftar. Nyalakan mode persetujuan di Pengaturan bila ingin meninjau dulu." />
      <SegmentedControl label="Status pendaftaran" options={options} value={status} onChange={(value) => setParams(value ? { status: value } : {}, { replace: true })} />
      <Card padding="none">
        {loading && !data ? <div className="ov-card-body"><SkeletonRows rows={5} /></div>
          : data === null ? <EmptyState icon={UserPlus} title="Belum aktif" description="Halaman ini aktif setelah file SQL 18 dijalankan." />
            : data.rows.length === 0 ? <EmptyState icon={UserPlus} title={status === 'pending' ? 'Tidak ada yang menunggu' : 'Belum ada pendaftaran'} description="Kafe yang mendaftar sendiri akan tampil di sini." />
              : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead><tr><th scope="col">Kafe</th><th scope="col">Owner</th><th scope="col">Daftar</th><th scope="col">Email</th><th scope="col">Status</th><th scope="col" className="cell-actions"><span className="sr-only">Aksi</span></th></tr></thead>
                    <tbody>
                      {data.rows.map((row) => {
                        const meta = STATUS[row.signup_status] || STATUS.pending
                        const state = STATE_META[row.state]
                        return (
                          <tr key={row.cafe_id}>
                            <td><span className="pa-cell-main"><Link to={`/kafe/${row.cafe_id}`} className="link-button">{row.name}</Link><small>{row.city || '—'} · {row.plan_name || '—'}{row.trial_ends_at ? ` · coba sampai ${formatDate(row.trial_ends_at)}` : ''}</small></span></td>
                            <td><span className="pa-cell-main"><strong>{row.owner_name || '—'}</strong><small>{row.owner_email}</small></span></td>
                            <td>{formatDateTime(row.signup_at)}</td>
                            <td>{row.email_confirmed ? <Badge tone="green">Terverifikasi</Badge> : <Badge tone="amber">Belum verifikasi</Badge>}</td>
                            <td><span className="pa-cell-main"><Badge tone={meta.tone}>{meta.label}</Badge>{state && row.signup_status === 'approved' && <small>{state.label}</small>}</span></td>
                            <td className="cell-actions">
                              <span className="pa-actions">
                                <WhatsAppButton size="sm" ctx={{ cafeId: row.cafe_id, cafeName: row.name, ownerName: row.owner_name, phone: row.owner_whatsapp }} defaultTemplate="bebas" />
                                {row.signup_status === 'pending' && canDecide && (
                                  <>
                                    <Button size="sm" icon={Check} onClick={() => { setNote(''); setDeciding({ row, approve: true }) }}>Setujui</Button>
                                    <Button size="sm" variant="danger-soft" icon={X} onClick={() => { setNote(''); setDeciding({ row, approve: false }) }}>Tolak</Button>
                                  </>
                                )}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
      </Card>

      {deciding && (
        <ConfirmDialog
          title={deciding.approve ? `Setujui ${deciding.row.name}?` : `Tolak ${deciding.row.name}?`}
          description={deciding.approve
            ? 'Kafe langsung aktif dan masa coba dihitung mulai hari ini. Owner mendapat email & notifikasi.'
            : 'Kafe tetap nonaktif. Alasan tampil di dashboard owner.'}
          confirmLabel={deciding.approve ? 'Setujui' : 'Tolak pendaftaran'}
          tone={deciding.approve ? 'primary' : 'danger'}
          onClose={() => setDeciding(null)}
          onConfirm={async () => {
            await rpc('pa_signup_decide', { p_cafe: deciding.row.cafe_id, p_approve: deciding.approve, p_note: note || null })
            toast({ title: deciding.approve ? 'Pendaftaran disetujui' : 'Pendaftaran ditolak', description: deciding.row.name })
            setDeciding(null)
            reload()
          }}
        >
          <TextField label={deciding.approve ? 'Catatan (opsional)' : 'Alasan penolakan'} value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} />
        </ConfirmDialog>
      )}
    </div>
  )
}
