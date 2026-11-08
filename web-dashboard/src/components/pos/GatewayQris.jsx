/*
 * QRIS dinamis di kasir: QR dari gateway ditampilkan untuk di-scan pelanggan.
 * Lunas hanya ketika gateway mengonfirmasi (realtime + cek berkala ke payment_intents).
 */
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, RefreshCw } from 'lucide-react'
import { Badge, Button } from '../ui/index.js'
import { formatRupiah } from '../../lib/format.js'
import { callPayments, INTENT_STATUS } from '../../lib/payments.js'
import { qrMatrix } from '../../lib/qr.js'

let channelSequence = 0

function countdown(expiresAt, now) {
  const seconds = Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function GatewayQris({ supabase, orderId, onPaid, onBack }) {
  const [intent, setIntent] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [now, setNow] = useState(() => Date.now())

  const read = useCallback(async () => {
    const { data } = await supabase.from('payment_intents').select('id, amount, status, qr_string, qr_url, expires_at, paid_at')
      .eq('order_id', orderId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (data) setIntent(data)
  }, [orderId, supabase])

  const create = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const result = await callPayments(supabase, { action: 'create', order_id: orderId, source: 'pos' })
      setIntent(result.intent)
    } catch (caught) {
      setError(caught.message)
    }
    setBusy(false)
  }, [orderId, supabase])

  useEffect(() => {
    const timer = setTimeout(create, 0)
    return () => clearTimeout(timer)
  }, [create])

  useEffect(() => {
    if (intent?.status === 'paid') return undefined
    const channel = supabase.channel(`pos-pay-${orderId}-${++channelSequence}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_intents', filter: `order_id=eq.${orderId}` }, read)
      .subscribe()
    const poll = setInterval(read, 4000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { supabase.removeChannel(channel); clearInterval(poll); clearInterval(tick) }
  }, [intent?.status, orderId, read, supabase])

  useEffect(() => {
    if (intent?.status === 'paid') onPaid()
  }, [intent?.status, onPaid])

  async function check() {
    setBusy(true)
    try {
      await callPayments(supabase, { action: 'status', order_id: orderId })
      await read()
    } catch (caught) {
      setError(caught.message)
    }
    setBusy(false)
  }

  const expired = intent && (intent.status === 'expired' || (intent.status === 'pending' && new Date(intent.expires_at).getTime() <= now))
  const status = expired ? INTENT_STATUS.expired : INTENT_STATUS[intent?.status] || INTENT_STATUS.creating
  const matrix = intent?.qr_string && !expired && intent.status === 'pending' ? qrMatrix(intent.qr_string) : null

  return (
    <div className="pos-gateway">
      <div className="pos-gateway-head">
        <Badge tone={status.tone}>{status.label}{intent?.status === 'pending' && !expired ? ` · ${countdown(intent.expires_at, now)}` : ''}</Badge>
        <strong className="tabular">{formatRupiah(intent?.amount ?? 0)}</strong>
      </div>
      <div className="pos-gateway-qr">
        {intent?.status === 'paid' ? <CheckCircle2 size={96} aria-label="Lunas" className="pos-gateway-done" />
          : matrix ? (
            <svg viewBox={`-4 -4 ${matrix.size + 8} ${matrix.size + 8}`} role="img" aria-label="QRIS untuk dibayar pelanggan" shapeRendering="crispEdges">
              <rect x="-4" y="-4" width={matrix.size + 8} height={matrix.size + 8} fill="#fff" />
              <path d={matrix.path} fill="#000" />
            </svg>
          ) : intent?.qr_url && !expired ? <img src={intent.qr_url} alt="QRIS untuk dibayar pelanggan" />
            : <span className="text-muted">{busy ? 'Menyiapkan QR…' : expired ? 'QR kedaluwarsa' : 'QR belum tersedia'}</span>}
      </div>
      <p className="text-muted pos-gateway-hint">Arahkan layar ke pelanggan. Pesanan otomatis lunas setelah bank mengonfirmasi — tidak perlu ditandai manual.</p>
      {error && <p className="ui-field-error" role="alert">{error}</p>}
      <div className="pos-gateway-actions">
        <Button variant="ghost" onClick={onBack} disabled={intent?.status === 'paid'}>Ganti metode</Button>
        {expired || intent?.status === 'failed' || error
          ? <Button icon={RefreshCw} onClick={create} loading={busy}>Buat QR baru</Button>
          : <Button variant="secondary" onClick={check} loading={busy && Boolean(intent)} disabled={!intent || intent.status === 'paid'}>Cek status</Button>}
      </div>
    </div>
  )
}
