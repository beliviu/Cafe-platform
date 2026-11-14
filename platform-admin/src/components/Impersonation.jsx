/*
 * Lihat sebagai owner (file SQL 18): dialog alasan → sesi baca-saja 30 menit di jendela baru, + riwayat per kafe.
 * Database menegakkan baca-saja & batas waktu; alasan tercatat di log audit.
 */
import { useCallback, useState } from 'react'
import { Eye } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, SkeletonRows, TextField, useToast } from './ui/index.js'
import { optional, rpc, useLoader } from '../lib/api.js'
import { formatDateTime } from '../lib/format.js'
import { startImpersonation } from '../lib/impersonation.js'

export function ImpersonateDialog({ cafe, onClose }) {
  const { toast } = useToast()
  const { refresh } = useAuth()
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (reason.trim().length < 10) { setError('Tulis alasan minimal 10 karakter (tercatat di log audit)'); return }
    setBusy(true)
    try {
      const session = await startImpersonation(cafe.id, reason.trim())
      toast({ title: `Melihat sebagai owner ${cafe.name}`, description: `Baca-saja sampai ${new Date(session.expires_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}.` })
      refresh()
      onClose()
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
  }

  return (
    <Dialog title={`Lihat sebagai owner ${cafe.name}`} description="Membuka dashboard owner kafe ini di jendela baru, BACA-SAJA, selama 30 menit." size="sm"
      onClose={busy ? undefined : onClose} dismissible={!busy}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="impersonate-form" icon={Eye} loading={busy}>Buka tampilan owner</Button></>}>
      <form id="impersonate-form" className="dialog-form" onSubmit={submit} noValidate>
        <TextField label="Alasan" multiline rows={2} value={reason} maxLength={300} error={error}
          placeholder="mis. Owner lapor laporan penjualan kosong (tiket TKT-00012)" onChange={(event) => { setReason(event.target.value); setError('') }} />
        <ul className="pa-checklist">
          <li>Semua perubahan ditolak database — aman untuk melihat-lihat.</li>
          <li>Tercatat di log audit beserta alasan; owner bisa ditanya bila perlu.</li>
          <li>Berakhir otomatis 30 menit, atau tekan Akhiri di banner.</li>
        </ul>
      </form>
    </Dialog>
  )
}

export function ImpersonationHistory({ cafeId }) {
  const load = useCallback(() => optional(rpc('pa_impersonations_list', { p_cafe: cafeId, p_limit: 10 })), [cafeId])
  const { data, loading } = useLoader(load)
  if (data === null) return null
  return (
    <Card>
      <CardHeader title="Riwayat lihat-sebagai" description="Siapa yang membuka tampilan owner kafe ini, kapan, dan kenapa" />
      {loading && !data ? <SkeletonRows rows={3} /> : data.length === 0 ? <EmptyState compact icon={Eye} title="Belum pernah" description="Sesi lihat-sebagai untuk kafe ini akan tercatat di sini." /> : (
        <ul className="imp-list">
          {data.map((row) => (
            <li key={row.id}>
              <span className="pa-cell-main"><strong>{row.admin_name || 'Admin'}</strong><small>{row.reason}</small></span>
              <span className="pa-cell-main is-num">
                {row.active ? <Badge tone="blue">Aktif</Badge> : <small>{formatDateTime(row.started_at)}</small>}
                {!row.active && <small>{row.end_reason === 'ended' ? 'diakhiri' : row.end_reason === 'replaced' ? 'diganti sesi baru' : 'habis waktu'}</small>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
