/*
 * Pengaturan → Pembayaran:
 * - QRIS kafe (file 12): gambar QRIS statis milik kafe, dikonfirmasi manual oleh staff.
 * - QRIS online (file 09): QRIS dinamis lewat Midtrans.
 * Kunci Midtrans TIDAK diisi di sini — hanya di Secrets Edge Function "payments" (server).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { CheckCircle2, Copy, ImageUp, PlugZap, RefreshCw, Trash2 } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Select, SkeletonRows, Switch, useToast } from '../../components/ui/index.js'
import { friendlyError } from '../../lib/db.js'
import { formatRelative } from '../../lib/format.js'
import { useLoader } from '../../lib/inventory.js'
import { callPayments, PAYMENTS_REQUIRED, QRIS_REQUIRED } from '../../lib/payments.js'
import { removeCafeAsset, uploadCafeAsset } from '../../lib/branding.js'

const QRIS_TYPES = ['image/png', 'image/jpeg', 'image/webp']

const WEBHOOK_URL = `${(import.meta.env.VITE_SUPABASE_URL || 'https://<project>.supabase.co').replace(/\/+$/, '')}/functions/v1/payments?webhook=midtrans`

export function PaymentSettings() {
  return (
    <div className="settings-stack">
      <StaticQrisCard />
      {/* QRIS otomatis (Midtrans) disembunyikan atas permintaan owner — pembayaran memakai QRIS kafe. */}
    </div>
  )
}

/** QRIS statis milik kafe: diunggah owner, tampil di app & kasir, lunas dikonfirmasi staff. */
function StaticQrisCard() {
  const { cafe } = useOutletContext()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const fileInput = useRef(null)
  const [preview, setPreview] = useState(null)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('cafe_settings').select('qris_image_url').eq('cafe_id', cafe.id).maybeSingle()
    if (error) return { missing: true }
    return { url: data?.qris_image_url || null }
  }, [cafe.id, supabase])
  const { data, error, reload } = useLoader(load)
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  function choose(event) {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (!chosen) return
    if (!QRIS_TYPES.includes(chosen.type)) {
      setProblem('Format harus PNG, JPG, atau WebP.')
      return
    }
    if (chosen.size > 2 * 1024 * 1024) {
      setProblem('Ukuran maksimal 2 MB. Pakai screenshot QRIS saja.')
      return
    }
    setProblem('')
    setFile(chosen)
    setPreview(URL.createObjectURL(chosen))
  }

  async function save(nextUrl, uploaded) {
    const { error: saveError } = await supabase.from('cafe_settings').update({ qris_image_url: nextUrl }).eq('cafe_id', cafe.id).select('cafe_id').maybeSingle()
    if (saveError) {
      if (uploaded) await removeCafeAsset(supabase, uploaded)
      throw new Error(friendlyError(saveError))
    }
    if (data?.url && data.url !== nextUrl) await removeCafeAsset(supabase, data.url)
  }

  async function upload() {
    setBusy(true)
    try {
      const { url } = await uploadCafeAsset(supabase, cafe.id, file, 'qris')
      await save(url, url)
      setFile(null)
      setPreview(null)
      toast({ tone: 'success', title: 'QRIS kafe dipasang', description: 'Muncul di checkout aplikasi dan di kasir.' })
      reload()
    } catch (caught) {
      toast({ tone: 'error', title: 'QRIS gagal disimpan', description: caught.message })
    }
    setBusy(false)
  }

  async function remove() {
    setBusy(true)
    try {
      await save(null)
      toast({ tone: 'success', title: 'QRIS kafe dilepas' })
      reload()
    } catch (caught) {
      toast({ tone: 'error', title: 'Gagal melepas QRIS', description: caught.message })
    }
    setBusy(false)
  }

  if (error) return <Card className="settings-card"><ErrorState compact message={error} onRetry={reload} /></Card>
  if (!data) return <Card className="settings-card"><SkeletonRows rows={3} label="Memuat QRIS" /></Card>
  if (data.missing) return <Card className="settings-card"><CardHeader title="QRIS kafe" /><EmptyState compact title="Belum tersedia" description={QRIS_REQUIRED} /></Card>
  const shown = preview || data.url
  return (
    <Card className="settings-card">
      <CardHeader title="QRIS kafe"
        description="Gambar QRIS dari bank / e-wallet milik kafe. Pelanggan scan dan mengetik nominal sendiri, lalu staff menandai lunas setelah uang masuk."
        actions={data.url ? <Badge tone="green">Terpasang</Badge> : <Badge tone="neutral">Belum ada</Badge>} />
      <div className="qris-static">
        <button type="button" className={`qris-static-image${shown ? ' has-image' : ''}`} onClick={() => fileInput.current?.click()} aria-label={shown ? 'Ganti gambar QRIS' : 'Unggah gambar QRIS'}>
          {shown ? <img src={shown} alt="QRIS kafe" /> : <span><ImageUp size={26} aria-hidden="true" /><strong>Unggah QRIS</strong><small>PNG/JPG, maks 2 MB</small></span>}
        </button>
        <div className="qris-static-info">
          <ul>
            <li>Pakai gambar QRIS resmi dari aplikasi merchant (bank, GoPay/ShopeePay merchant, dll). Pastikan kode terlihat jelas.</li>
            <li>Di aplikasi, pelanggan memilih <strong>QRIS kafe</strong> saat checkout dan melihat QR ini beserta total yang harus dibayar.</li>
            <li>Di kasir, pilih <strong>QRIS</strong> → QR tampil di layar untuk dipindai pelanggan.</li>
            <li><strong>Selalu cek mutasi</strong> sebelum menandai lunas — QRIS statis tidak terverifikasi otomatis.</li>
          </ul>
          <input ref={fileInput} className="sr-only" type="file" accept={QRIS_TYPES.join(',')} onChange={choose} tabIndex={-1} />
          {problem && <p className="ui-field-error" role="alert">{problem}</p>}
          <div className="settings-actions">
            {file ? (
              <>
                <Button variant="ghost" onClick={() => { setFile(null); setPreview(null) }} disabled={busy}>Batal</Button>
                <Button onClick={upload} loading={busy}>Simpan QRIS</Button>
              </>
            ) : (
              <>
                {data.url && <Button variant="ghost" icon={Trash2} onClick={remove} loading={busy}>Lepas</Button>}
                <Button variant="secondary" icon={data.url ? RefreshCw : ImageUp} onClick={() => fileInput.current?.click()}>{data.url ? 'Ganti gambar' : 'Pilih gambar'}</Button>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

// eslint-disable-next-line no-unused-vars -- disimpan bila QRIS otomatis diaktifkan lagi
function GatewaySettings() {
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
