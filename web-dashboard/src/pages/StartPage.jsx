/*
 * /mulai — wizard setup 8 langkah untuk owner (file SQL 18 owner_setup_progress; data sama dengan admin di file 16).
 * Setiap langkah dicentang otomatis dari data yang sudah diisi; tombol membawa ke halaman pengaturannya.
 * SetupCard: kartu ringkas di Dashboard selama setup belum lengkap.
 */
import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Check, PartyPopper } from 'lucide-react'
import { Link, useLocation, useOutletContext } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Progress, SkeletonRows } from '../components/ui/index.js'
import { fetchSetupProgress, ownerBase, SETUP_STEPS } from '../lib/platformScale.js'

function useSetup(supabase, cafeId) {
  const [state, setState] = useState({ data: undefined, error: '' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!supabase || !cafeId) return undefined
    let active = true
    fetchSetupProgress(supabase, cafeId).then(
      (data) => { if (active) setState({ data, error: '' }) },
      (caught) => { if (active) setState({ data: undefined, error: caught.message }) },
    )
    return () => { active = false }
  }, [attempt, cafeId, supabase])
  return { ...state, reload: useCallback(() => setAttempt((value) => value + 1), []) }
}

export function StartPage() {
  const { cafe } = useOutletContext()
  const { supabase } = useAuth()
  const { pathname } = useLocation()
  const base = ownerBase(pathname)
  const { data, error, reload } = useSetup(supabase, cafe.id)

  return (
    <div className="page page-narrow">
      <PageHeader eyebrow="Mulai" title="Siapkan kafe Anda" description="Delapan langkah agar kafe siap menerima pesanan. Langkah dicentang otomatis begitu datanya terisi." />
      {error ? <ErrorState message={error} onRetry={reload} />
        : data === undefined ? <Card><SkeletonRows rows={8} /></Card>
          : data === null ? <Card><EmptyState title="Belum tersedia" description="Panduan setup aktif setelah pembaruan sistem diterapkan." /></Card>
            : (
              <Card>
                <div className="start-progress">
                  <strong className="tabular">{data.done} dari {data.total} langkah</strong>
                  <Progress value={(data.done / data.total) * 100} tone={data.done === data.total ? 'good' : undefined} label="Kemajuan setup" />
                </div>
                {data.done === data.total && (
                  <p className="start-done"><PartyPopper size={18} aria-hidden="true" /> Semua langkah selesai. Kafe Anda siap berjualan.</p>
                )}
                <ol className="start-steps">
                  {data.steps.map((step) => {
                    const meta = SETUP_STEPS[step.key] || {}
                    const next = !step.done && step.key === data.stuck_key
                    return (
                      <li key={step.key} className={`${step.done ? 'is-done' : ''}${next ? ' is-next' : ''}`}>
                        <span className="start-mark" aria-hidden="true">{step.done ? <Check size={16} /> : step.no}</span>
                        <span className="start-text">
                          <strong>{step.label}</strong>
                          <small>{step.done ? 'Selesai' : meta.hint}</small>
                        </span>
                        {!step.done && meta.to && (
                          <Button as={Link} to={`${base}${meta.to}`} size="sm" variant={next ? 'primary' : 'secondary'} iconRight={next ? ArrowRight : undefined}>
                            {next ? 'Lanjutkan' : 'Buka'}
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ol>
                <span className="sr-only">{data.done} dari {data.total} langkah selesai</span>
              </Card>
            )}
    </div>
  )
}

/** Kartu di Dashboard: tampil selama setup belum lengkap. */
export function SetupCard({ supabase, cafeId }) {
  const { pathname } = useLocation()
  const { data } = useSetup(supabase, cafeId)
  if (!data || data.done >= data.total) return null
  const nextStep = data.steps.find((step) => step.key === data.stuck_key)
  return (
    <Card className="start-card">
      <CardHeader title="Siapkan kafe Anda" description={nextStep ? `Langkah berikutnya: ${nextStep.label}` : undefined}
        actions={<Button as={Link} to={`${ownerBase(pathname)}/mulai`} size="sm" iconRight={ArrowRight}>Lanjutkan setup</Button>} />
      <div className="start-progress">
        <strong className="tabular">{data.done}/{data.total}</strong>
        <Progress value={(data.done / data.total) * 100} label="Kemajuan setup" />
      </div>
    </Card>
  )
}
