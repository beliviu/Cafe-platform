/*
 * Skor kesehatan kafe & progres setup (file 16).
 * Label selalu berupa kata (Sehat / Pantau / Berisiko), warna hanya pendukung.
 */
import { Check, Circle } from 'lucide-react'
import { Badge, Card, CardHeader, EmptyState, LineChart, Progress } from './ui/index.js'
import { WhatsAppButton } from './WhatsAppButton.jsx'
import { HEALTH_META } from '../lib/api.js'
import { formatDate, formatNumber } from '../lib/format.js'

const COMPONENTS = [
  { key: 'orders', label: 'Pesanan 14 hari', detail: (c) => `${formatNumber(c.last_14 ?? 0)} vs ${formatNumber(c.prev_14 ?? 0)} sebelumnya` },
  { key: 'login', label: 'Login owner', detail: (c) => (c.days == null ? 'Belum pernah login' : c.days === 0 ? 'Hari ini' : `${formatNumber(c.days)} hari lalu`) },
  { key: 'modules', label: 'Modul dipakai', detail: (c) => `${(c.used || []).length} dari 4${(c.used || []).length ? ` · ${(c.used || []).map((key) => MODULE_LABEL[key] || key).join(', ')}` : ''}` },
  { key: 'payment', label: 'Riwayat bayar', detail: (c) => (c.overdue_days ? `Telat ${c.overdue_days} hari` : c.late_paid ? `${c.late_paid}× telat (6 bulan)` : c.invoices ? 'Selalu tepat waktu' : 'Belum pernah ditagih') },
]
const MODULE_LABEL = { pos: 'Kasir', inventory: 'Inventori', finance: 'Keuangan', app: 'App customer' }

/** Angka skor dalam lingkaran + label kata. */
export function HealthBadge({ score, label, size = 'md' }) {
  const meta = HEALTH_META[label] || HEALTH_META.watch
  return (
    <span className={`health-badge is-${meta.tone} is-${size}`}>
      <span className="health-score tabular" aria-hidden="true">{score}</span>
      <Badge tone={meta.tone} aria-label={`Skor kesehatan ${score} dari 100, ${meta.label}`}>{meta.label}</Badge>
    </span>
  )
}

export function HealthCard({ health }) {
  const latest = health?.latest
  return (
    <Card className="health-card">
      <CardHeader title="Kesehatan kafe" description={latest ? `Dihitung ${formatDate(latest.day)} · 0–100` : 'Dihitung otomatis setiap pagi'} />
      {!latest ? (
        <EmptyState compact title="Belum ada skor" description="Skor muncul setelah pengecekan harian pertama berjalan (08.00 WIB)." />
      ) : (
        <>
          <div className="health-head">
            <HealthBadge score={latest.score} label={latest.label} size="lg" />
            {latest.reasons?.length ? (
              <ul className="health-reasons">{latest.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            ) : <p className="health-fine">Tidak ada catatan. Kafe ini berjalan baik.</p>}
          </div>
          <ul className="health-components">
            {COMPONENTS.map((item) => {
              const component = latest.components?.[item.key] || {}
              const ratio = component.max ? (component.score / component.max) * 100 : 0
              return (
                <li key={item.key}>
                  <span className="health-component-label"><strong>{item.label}</strong><span className="tabular">{component.score ?? 0}/{component.max ?? 0}</span></span>
                  <Progress value={ratio} tone={ratio >= 75 ? 'good' : ratio >= 40 ? 'warn' : 'bad'} label={`${item.label}: ${component.score ?? 0} dari ${component.max ?? 0}`} />
                  <small>{item.detail(component)}</small>
                </li>
              )
            })}
          </ul>
          {health.history?.length >= 2 ? (
            <LineChart height={160} label="Tren skor kesehatan"
              points={health.history.map((point) => ({ label: formatDate(point.day), short: formatDate(point.day).split(' ').slice(0, 2).join(' '), value: point.score }))}
              format={(value) => `Skor ${Math.round(value)}`} formatAxis={(value) => String(Math.round(value))} />
          ) : <p className="health-fine">Grafik tren muncul setelah 2 hari data.</p>}
        </>
      )}
    </Card>
  )
}

export function SetupCard({ setup, waCtx }) {
  if (!setup) return null
  const complete = setup.done >= setup.total
  return (
    <Card className="setup-card">
      <CardHeader title="Progres setup" description={complete ? 'Semua langkah selesai' : `${setup.done} dari ${setup.total} langkah`}
        actions={complete ? <Badge tone="green">Lengkap</Badge> : (
          <WhatsAppButton size="sm" variant="secondary" label="Kirim panduan" defaultTemplate="setup"
            ctx={{ ...waCtx, stuckStep: setup.stuck_step, setupDone: setup.done }} />
        )} />
      <Progress value={(setup.done / setup.total) * 100} tone={complete ? 'good' : 'accent'} label={`Setup ${setup.done} dari ${setup.total} langkah`} />
      <ol className="setup-steps">
        {setup.steps.map((step) => {
          const stuck = step.key === setup.stuck_key
          return (
            <li key={step.key} className={step.done ? 'is-done' : stuck ? 'is-stuck' : ''}>
              <span className="setup-step-icon" aria-hidden="true">{step.done ? <Check size={14} /> : <Circle size={10} />}</span>
              <span className="setup-step-label">{step.label}</span>
              <span className="setup-step-state">
                {step.done ? 'Selesai' : stuck ? (setup.stuck_days ? `Macet ${formatNumber(setup.stuck_days)} hari` : 'Berikutnya') : 'Belum'}
              </span>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
