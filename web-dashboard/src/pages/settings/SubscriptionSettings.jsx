/*
 * Pengaturan → Langganan (file 10): paket, status, fitur, pemakaian vs batas.
 * Perubahan paket dilakukan pengelola platform (belum ada penagihan otomatis).
 */
import { useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Check, Minus } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Badge, Card, CardHeader, EmptyState, ErrorState, SkeletonRows } from '../../components/ui/index.js'
import { friendlyError, SECURITY_REQUIRED } from '../../lib/db.js'
import { formatDate, formatNumber, formatRupiah } from '../../lib/format.js'
import { useLoader } from '../../lib/inventory.js'

const FEATURES = [
  { key: 'inventory', label: 'Inventori, resep & HPP, pembelian' },
  { key: 'finance', label: 'Keuangan & akuntansi' },
  { key: 'loyalty', label: 'Poin & tingkat member' },
  { key: 'qr_ordering', label: 'Pesan dari QR meja' },
  { key: 'payment_gateway', label: 'QRIS online (gateway)' },
  { key: 'ai_advisor', label: 'Tanya AI di Advisor bisnis' },
]
const LIMITS = [
  { key: 'staff', label: 'Staff aktif' },
  { key: 'tables', label: 'Meja' },
  { key: 'products', label: 'Menu' },
]
const STATUS = {
  active: { label: 'Aktif', tone: 'green' },
  trialing: { label: 'Masa coba', tone: 'blue' },
  past_due: { label: 'Menunggu pembayaran', tone: 'amber' },
  cancelled: { label: 'Berhenti', tone: 'red' },
}

export function SubscriptionSettings() {
  const { cafe, features } = useOutletContext()
  const { supabase } = useAuth()
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('cafe_entitlements', { p_cafe_id: cafe.id })
    if (error) throw new Error(friendlyError(error))
    return { ...data, checked_at: Date.now() }
  }, [cafe.id, supabase])
  const { data, error, reload } = useLoader(features?.security ? load : null)

  if (!features?.security) return <Card className="settings-card"><CardHeader title="Langganan" /><EmptyState compact title="Belum tersedia" description={SECURITY_REQUIRED} /></Card>
  if (error) return <Card className="settings-card"><ErrorState compact message={error} onRetry={reload} /></Card>
  if (!data) return <Card className="settings-card"><SkeletonRows rows={4} label="Memuat langganan" /></Card>

  const status = STATUS[data.status] || STATUS.active
  const trialOver = data.status === 'trialing' && data.trial_ends_at && Date.parse(data.trial_ends_at) < data.checked_at
  return (
    <div className="settings-stack">
      <Card className="settings-card">
        <CardHeader title={`Paket ${data.plan.name}`} description={data.plan.description}
          actions={<Badge tone={trialOver ? 'red' : status.tone}>{trialOver ? 'Masa coba habis' : status.label}</Badge>} />
        <dl className="fin-position">
          {data.plan.price_monthly ? <div><dt>Biaya</dt><dd className="tabular">{formatRupiah(data.plan.price_monthly)} / bulan</dd></div> : null}
          {data.status === 'trialing' && data.trial_ends_at ? <div><dt>Masa coba sampai</dt><dd>{formatDate(data.trial_ends_at)}</dd></div> : null}
          {data.current_period_end ? <div><dt>Berlaku sampai</dt><dd>{formatDate(data.current_period_end)}</dd></div> : null}
        </dl>
        {trialOver && <p className="ui-field-error">Masa coba berakhir: fitur paket Pro dikunci sampai langganan diaktifkan. Data tetap aman.</p>}
      </Card>

      <div className="fin-grid">
        <Card className="settings-card">
          <CardHeader title="Pemakaian" description="Batas sesuai paket" />
          <ul className="fin-bars">
            {LIMITS.map((item) => {
              const used = Number(data.usage?.[item.key] ?? 0)
              const limit = data.limits?.[item.key]
              const ratio = limit ? Math.min(used / limit, 1) : 0
              return (
                <li key={item.key}>
                  <span className="fin-bars-label"><span>{item.label}</span><span className="tabular">{formatNumber(used)}{limit ? ` / ${formatNumber(limit)}` : ' · tanpa batas'}</span></span>
                  {limit ? <span className="fin-bars-track" aria-hidden="true"><span className={ratio >= 1 ? 'is-full' : ''} style={{ width: `${Math.max(ratio * 100, 2)}%` }} /></span> : null}
                </li>
              )
            })}
          </ul>
        </Card>
        <Card className="settings-card">
          <CardHeader title="Fitur paket" />
          <ul className="sub-features">
            {FEATURES.map((item) => {
              const on = data.features?.includes(item.key)
              return (
                <li key={item.key} className={on ? '' : 'is-off'}>
                  {on ? <Check size={16} aria-hidden="true" /> : <Minus size={16} aria-hidden="true" />}
                  <span>{item.label}</span>
                  <span className="sr-only">{on ? 'termasuk' : 'tidak termasuk'}</span>
                </li>
              )
            })}
            <li><Check size={16} aria-hidden="true" /><span>Kasir, pesanan app, menu, tim, laporan, prediksi & analitik pelanggan</span></li>
          </ul>
        </Card>
      </div>

      {data.plans?.length > 0 && (
        <Card className="settings-card" padding="none">
          <div className="table-card-head"><CardHeader title="Pilihan paket" description="Hubungi pengelola platform untuk mengganti paket." /></div>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th scope="col">Paket</th><th scope="col" className="num">Biaya / bulan</th>{LIMITS.map((item) => <th key={item.key} scope="col" className="num">{item.label}</th>)}<th scope="col">Fitur</th></tr></thead>
              <tbody>
                {data.plans.map((plan) => (
                  <tr key={plan.code} className={plan.code === data.plan.code ? 'is-selected-row' : ''}>
                    <td><strong>{plan.name}</strong>{plan.code === data.plan.code && <small className="cell-sub">paket kamu</small>}</td>
                    <td className="num tabular">{plan.price_monthly ? formatRupiah(plan.price_monthly) : '—'}</td>
                    {LIMITS.map((item) => <td key={item.key} className="num tabular">{plan.limits?.[item.key] ? formatNumber(plan.limits[item.key]) : 'Tanpa batas'}</td>)}
                    <td>{plan.features?.length ? `${plan.features.length} modul tambahan` : 'Dasar'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
