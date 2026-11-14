/*
 * /status — halaman status sistem publik (file SQL 18, public_status). Tanpa login, tanpa data kafe.
 * Diperbarui otomatis setiap 60 detik.
 */
import { useCallback, useEffect, useState } from 'react'
import { Activity, CheckCircle2, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth.js'
import { BrandMark } from '../../components/shell/AppShell.jsx'
import { Badge, Button, EmptyState, ErrorState, SkeletonRows } from '../../components/ui/index.js'
import { usePublicBrand, useDocumentBranding } from '../../lib/branding.js'
import { formatDateTime } from '../../lib/format.js'
import { fetchPublicStatus, INCIDENT_STATUS, OVERALL_TEXT, SERVICE_STATUS } from '../../lib/platformScale.js'

const IMPACT = { minor: 'Gangguan kecil', major: 'Gangguan besar', maintenance: 'Pemeliharaan' }

export function StatusPage() {
  const { supabase } = useAuth()
  const brand = usePublicBrand(supabase)
  const [state, setState] = useState({ data: undefined, error: '' })
  const [attempt, setAttempt] = useState(0)
  useDocumentBranding(brand, 'Status layanan')
  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    if (!supabase) return undefined
    let active = true
    fetchPublicStatus(supabase).then(
      (data) => { if (active) setState({ data, error: '' }) },
      (caught) => { if (active) setState((current) => ({ ...current, error: caught.message })) },
    )
    const timer = window.setInterval(reload, 60000)
    return () => { active = false; window.clearInterval(timer) }
  }, [attempt, reload, supabase])

  const { data, error } = state
  const active = (data?.incidents || []).filter((item) => item.status !== 'resolved')
  const history = (data?.incidents || []).filter((item) => item.status === 'resolved')
  const overall = data?.overall || 'operational'

  return (
    <main className="status-page">
      <header className="status-head">
        <Link to="/" className="status-brand"><BrandMark brand={brand} size={36} /><span>{brand.name}</span></Link>
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={reload}>Muat ulang</Button>
      </header>

      <section className={`status-hero is-${overall}`} aria-live="polite">
        {data === undefined && !error ? <SkeletonRows rows={1} /> : (
          <>
            <span className="status-hero-icon">{overall === 'operational' ? <CheckCircle2 size={28} aria-hidden="true" /> : <Activity size={28} aria-hidden="true" />}</span>
            <div>
              <h1>{data === null ? 'Status layanan' : OVERALL_TEXT[overall]}</h1>
              <p>{data?.updated_at ? `Diperbarui ${formatDateTime(data.updated_at)}` : 'Halaman ini aktif setelah pembaruan sistem diterapkan.'}</p>
            </div>
          </>
        )}
      </section>

      {error && <ErrorState message={error} onRetry={reload} />}

      {data && (
        <>
          <section className="status-section" aria-labelledby="status-services">
            <h2 id="status-services">Layanan</h2>
            <ul className="status-services">
              {data.services.map((service) => {
                const meta = SERVICE_STATUS[service.status] || SERVICE_STATUS.operational
                return (
                  <li key={service.key}>
                    <span><strong>{service.name}</strong><small>{service.description}</small></span>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </li>
                )
              })}
            </ul>
          </section>

          {active.length > 0 && (
            <section className="status-section" aria-labelledby="status-active">
              <h2 id="status-active">Sedang berlangsung</h2>
              {active.map((incident) => <Incident key={incident.id} incident={incident} />)}
            </section>
          )}

          <section className="status-section" aria-labelledby="status-history">
            <h2 id="status-history">Riwayat 90 hari</h2>
            {history.length === 0
              ? <EmptyState compact icon={CheckCircle2} title="Tidak ada insiden" description="Belum ada gangguan tercatat dalam 90 hari terakhir." />
              : history.map((incident) => <Incident key={incident.id} incident={incident} />)}
          </section>
        </>
      )}
      <footer className="status-foot"><Link to="/login">Masuk dashboard</Link> · <Link to="/daftar">Daftar kafe baru</Link></footer>
    </main>
  )
}

function Incident({ incident }) {
  const meta = INCIDENT_STATUS[incident.status] || INCIDENT_STATUS.investigating
  return (
    <article className="status-incident">
      <header>
        <h3>{incident.title}</h3>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </header>
      <p className="status-incident-meta">
        {IMPACT[incident.impact] || incident.impact} · mulai {formatDateTime(incident.started_at)}
        {incident.resolved_at ? ` · selesai ${formatDateTime(incident.resolved_at)}` : ''}
      </p>
      <ol className="status-updates">
        {incident.updates.map((update, index) => (
          <li key={`${update.created_at}-${index}`}>
            <strong>{(INCIDENT_STATUS[update.status] || INCIDENT_STATUS.investigating).label}</strong>
            <span>{update.body}</span>
            <time dateTime={update.created_at}>{formatDateTime(update.created_at)}</time>
          </li>
        ))}
      </ol>
    </article>
  )
}
