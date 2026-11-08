/*
 * Pengaturan → Pembayaran (file 09): QRIS dinamis lewat Midtrans.
 * Kunci Midtrans TIDAK diisi di sini — hanya di Secrets Edge Function "payments" (server).
 */
import { useCallback, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { CheckCircle2, Copy, PlugZap } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Select, SkeletonRows, Switch, useToast } from '../../components/ui/index.js'
import { friendlyError } from '../../lib/db.js'
import { formatRelative } from '../../lib/format.js'
import { useLoader } from '../../lib/inventory.js'
import { callPayments, PAYMENTS_REQUIRED } from '../../lib/payments.js'

const WEBHOOK_URL = `${(import.meta.env.VITE_SUPABASE_URL || 'https://<project>.supabase.co').replace(/\/+$/, '')}/functions/v1/payments?webhook=midtrans`

export function PaymentSettings() {
  const { cafe, features } = useOutletContext()
  const { supabase } = useAuth()
  const load = useCallback(async () => {
    const [settings, summary] = await Promise.all([
      supabase.from('cafe_settings').select('payment_gateway_enabled, payment_gateway_provider, payment_qris_expiry_minutes').eq('cafe_id', cafe.id).maybeSingle(),
      supabase.rpc('payment_gateway_summary', { p_cafe_id: cafe.id, p_from: '2020-01-01', p_to: '2100-01-01' }),
    ])
    if (settings.error) throw new Error(friendlyError(settings.error))
    return { settings: settings.data, summary: summary.data }
  }, [cafe.id, supabase])
  const { data, error, reload } = useLoader(features?.payments ? load : null)

  if (!features?.payments) return <Card className="settings-card"><CardHeader title="Pembayaran online" /><EmptyState compact title="Belum tersedia" description={PAYMENTS_REQUIRED} /></Card>
  if (error) return <Card className="settings-card"><ErrorState compact message={error} onRetry={reload} /></Card>
  if (!data) return <Card className="settings-card"><SkeletonRows rows={4} label="Memuat pengaturan" /></Card>
  return <PaymentForm key={JSON.stringify(data.settings)} cafe={cafe} settings={data.settings} summary={data.summary} onSaved={reload} />
}

function PaymentForm({ cafe, settings, summary, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [enabled, setEnabled] = useState(settings.payment_gateway_enabled)
  const [expiry, setExpiry] = useState(String(settings.payment_qris_expiry_minutes))
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState(null)
  const dirty = enabled !== settings.payment_gateway_enabled || Number(expiry) !== Number(settings.payment_qris_expiry_minutes)

  async function save() {
    setSaving(true)
    const { error } = await supabase.from('cafe_settings').update({ payment_gateway_enabled: enabled, payment_qris_expiry_minutes: Number(expiry) })
      .eq('cafe_id', cafe.id).select('cafe_id').maybeSingle()
    setSaving(false)
    if (error) return toast({ tone: 'error', title: 'Gagal menyimpan', description: friendlyError(error) })
    toast({ tone: 'success', title: enabled ? 'QRIS online aktif' : 'QRIS online dimatikan', description: enabled ? 'Pelanggan & kasir bisa membuat QR dinamis.' : 'Pembayaran kembali tunai / QRIS manual.' })
    onSaved()
    return undefined
  }

  async function runTest() {
    setTesting(true)
    setTest(null)
    try {
      const result = await callPayments(supabase, { action: 'reconcile', cafe_id: cafe.id })
      setTest({ ok: true, text: `Terhubung ke layanan pembayaran (${result.checked} tagihan dicek).` })
    } catch (caught) {
      setTest({ ok: false, text: caught.message })
    }
    setTesting(false)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(WEBHOOK_URL)
      toast({ tone: 'success', title: 'URL webhook disalin' })
    } catch {
      toast({ tone: 'error', title: 'Tidak bisa menyalin', description: WEBHOOK_URL })
    }
  }

  return (
    <div className="settings-stack">
      <Card className="settings-card">
        <CardHeader title="QRIS online (Midtrans)"
          description="QR dinamis sesuai total pesanan. Pesanan lunas otomatis setelah bank mengonfirmasi lewat gateway; tidak ada yang bisa menandai lunas dari aplikasi."
          actions={settings.payment_gateway_enabled ? <Badge tone="green">Aktif</Badge> : <Badge tone="neutral">Nonaktif</Badge>} />
        <div className="settings-fields">
          <div className="inv-switch-line settings-span">
            <span><strong>Terima QRIS online</strong><small>Muncul sebagai “QRIS · bayar sekarang” di aplikasi dan “QRIS otomatis” di kasir. Tunai & QRIS manual tetap ada.</small></span>
            <Switch checked={enabled} onChange={setEnabled} label="Terima QRIS online" onLabel="Aktif" offLabel="Nonaktif" />
          </div>
          <Select label="QR berlaku selama" value={expiry} onChange={(event) => setExpiry(event.target.value)}
            options={[5, 10, 15, 30, 60].map((value) => ({ value: String(value), label: `${value} menit` }))} hint="Setelah lewat, pelanggan membuat QR baru" />
        </div>
        <div className="settings-actions"><Button onClick={save} loading={saving} disabled={!dirty}>Simpan</Button></div>
      </Card>

      <Card className="settings-card">
        <CardHeader title="Sambungkan ke Midtrans" description="Dilakukan sekali. Kunci server Midtrans hanya disimpan di server (Supabase), tidak pernah di aplikasi atau database." />
        <ol className="pay-steps">
          <li><strong>Deploy Edge Function “payments”</strong> dari file <code>supabase/functions/payments/index.ts</code> (Verify JWT: off).</li>
          <li><strong>Isi Secrets</strong> di Supabase → Edge Functions → Secrets: <code>MIDTRANS_SERVER_KEY</code> dan <code>MIDTRANS_ENV</code> (<code>sandbox</code> untuk uji, <code>production</code> untuk asli).</li>
          <li>
            <strong>Tempel URL ini</strong> di Midtrans Dashboard → Settings → Payment → Notification URL:
            <span className="pay-webhook"><code>{WEBHOOK_URL}</code><Button size="sm" variant="secondary" icon={Copy} onClick={copy}>Salin</Button></span>
          </li>
          <li><strong>Uji di sandbox</strong>: pesan dari aplikasi, pilih QRIS, bayar dengan simulator QRIS Midtrans → pesanan berubah lunas sendiri.</li>
        </ol>
        <div className="pay-test">
          <Button variant="secondary" icon={PlugZap} onClick={runTest} loading={testing}>Tes koneksi</Button>
          {test && <span className={test.ok ? 'pay-test-ok' : 'ui-field-error'}>{test.ok && <CheckCircle2 size={16} aria-hidden="true" />} {test.text}</span>}
          <span className="text-muted">Webhook terakhir: {summary?.last_webhook_at ? formatRelative(summary.last_webhook_at) : 'belum pernah'}</span>
        </div>
      </Card>
    </div>
  )
}
