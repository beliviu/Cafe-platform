/*
 * Analitik → Advisor bisnis (file 11 + Edge Function "advisor").
 * - Jawaban cepat: kalimat dari paket fakta bi_advisor_facts (database), tanpa AI, selalu tersedia.
 * - Tanya AI: pertanyaan bebas; Claude hanya menjelaskan paket fakta yang sama (tanpa data pribadi pelanggan).
 */
import { useCallback, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Info, Send, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui/index.js'
import { PeriodPicker } from '../../components/finance/PeriodPicker.jsx'
import { BI_REQUIRED } from '../../lib/db.js'
import { QUESTIONS, callAdvisor, dataQualityNotes, dateKeyLabel, quickAnswer } from '../../lib/bi.js'
import { periodFor, periodLabel } from '../../lib/finance.js'
import { formatDateTime, formatNumber } from '../../lib/format.js'
import { useLoader } from '../../lib/inventory.js'
import { rpc } from '../../lib/pos.js'

const AI_HINTS = {
  ai_not_configured: 'Tanya AI belum diaktifkan di server. Pengelola perlu men-deploy Edge Function "advisor" dan mengisi secret ANTHROPIC_API_KEY. Jawaban cepat tetap bisa dipakai.',
  plan_feature: 'Tanya AI termasuk paket Pro & Enterprise. Jawaban cepat tetap bisa dipakai di semua paket.',
}

export function AdvisorPage() {
  const { cafe, features } = useOutletContext()
  const { supabase } = useAuth()
  const [period, setPeriod] = useState(() => ({ ...periodFor('this-month'), key: 'this-month' }))
  const [question, setQuestion] = useState('revenue')

  const loadFacts = useCallback(
    () => rpc(supabase, 'bi_advisor_facts', { p_cafe_id: cafe.id, p_from: period.from, p_to: period.to }),
    [cafe.id, period.from, period.to, supabase],
  )
  const facts = useLoader(features?.bi ? loadFacts : null)

  if (!features?.bi) return <div className="page page-wide"><Header /><Card><EmptyState title="Belum tersedia" description={BI_REQUIRED} /></Card></div>

  const answer = facts.data ? quickAnswer(question, facts.data) : null
  const quality = dataQualityNotes(facts.data)

  return (
    <div className="page page-wide">
      <Header />
      <div className="bi-page">
        <section className="toolbar" aria-label="Periode">
          <PeriodPicker value={period} onChange={setPeriod} />
          <span className="bi-muted">
            {periodLabel(period)}
            {facts.data && ` · dibandingkan ${dateKeyLabel(facts.data.period.previous_from)} – ${dateKeyLabel(facts.data.period.previous_to)}`}
          </span>
        </section>

        <div className="bi-grid is-wide-left">
          <Card className={facts.loading && facts.data ? 'is-refreshing' : ''}>
            <CardHeader title="Jawaban cepat" description="Dihitung langsung dari data kasir, stok, dan pembukuan. Tanpa AI." />
            <div className="advisor-questions" role="group" aria-label="Pilih pertanyaan">
              {QUESTIONS.map((item) => (
                <button key={item.key} type="button" className="advisor-question" aria-pressed={question === item.key} onClick={() => setQuestion(item.key)}>
                  {item.label}
                </button>
              ))}
            </div>
            <div className="advisor-answer" aria-live="polite">
              {facts.error ? <ErrorState compact message={facts.error} onRetry={facts.reload} />
                : !answer ? <SkeletonRows rows={4} label="Menghitung" /> : (
                  <>
                    <p className="advisor-headline">{answer.headline}</p>
                    {answer.points.length > 0 && <section className="advisor-section"><h3>Rinciannya</h3><ul>{answer.points.map((point) => <li key={point}>{point}</li>)}</ul></section>}
                    {answer.actions.length > 0 && <section className="advisor-section"><h3>Yang bisa dilakukan</h3><ul>{answer.actions.map((point) => <li key={point}>{point}</li>)}</ul></section>}
                    {answer.notes.length > 0 && <section className="advisor-section is-notes"><h3>Catatan</h3><ul>{answer.notes.map((point) => <li key={point}>{point}</li>)}</ul></section>}
                  </>
                )}
            </div>
          </Card>

          <div className="bi-page">
            <AskAi cafeId={cafe.id} period={period} />
            {quality.length > 0 && (
              <div className="bi-notice" role="note">
                <Info size={18} aria-hidden="true" />
                <div><strong>Agar jawaban lebih lengkap</strong><ul>{quality.map((note) => <li key={note}>{note}</li>)}</ul></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function AskAi({ cafeId, period }) {
  const { supabase } = useAuth()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [failure, setFailure] = useState(null)

  const loadMeta = useCallback(async () => {
    const [quota, history] = await Promise.all([
      rpc(supabase, 'bi_advisor_quota', { p_cafe_id: cafeId }),
      supabase.from('ai_advisor_logs').select('id, question, answer, status, created_at').eq('cafe_id', cafeId).eq('status', 'answered')
        .order('created_at', { ascending: false }).limit(8),
    ])
    return { quota, history: history.error ? [] : history.data || [] }
  }, [cafeId, supabase])
  const meta = useLoader(loadMeta)
  const quota = meta.data?.quota
  const blockedHint = quota && !quota.allowed ? 'plan_feature' : null
  const canAsk = text.trim().length >= 3 && !busy && quota?.allowed && quota.remaining > 0

  async function ask(event) {
    event.preventDefault()
    if (!canAsk) return
    setBusy(true)
    setFailure(null)
    try {
      const data = await callAdvisor(supabase, { cafe_id: cafeId, question: text.trim(), from: period.from, to: period.to })
      setResult({ question: text.trim(), ...data })
      setText('')
      meta.reload()
    } catch (caught) {
      setFailure({ message: AI_HINTS[caught.hint] || caught.message, hint: caught.hint })
    }
    setBusy(false)
  }

  return (
    <>
      <Card>
        <CardHeader title="Tanya AI" description="Pertanyaan bebas tentang bisnismu. AI hanya memakai angka dari sistem untuk periode yang dipilih." />
        {blockedHint ? <p className="bi-note">{AI_HINTS.plan_feature}</p> : (
          <form className="advisor-ai-form" onSubmit={ask}>
            <label className="sr-only" htmlFor="advisor-question">Pertanyaan</label>
            <textarea id="advisor-question" value={text} maxLength={500} placeholder="Mis. Hari apa sebaiknya saya bikin promo, dan produk apa?"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) ask(event) }} />
            <div className="advisor-ai-actions">
              <span className="bi-note">{quota ? `Sisa ${formatNumber(quota.remaining)} dari ${formatNumber(quota.limit)} pertanyaan hari ini` : meta.error ? '' : 'Memuat kuota…'}</span>
              <Button type="submit" icon={Send} loading={busy} disabled={!canAsk}>Tanya AI</Button>
            </div>
          </form>
        )}
        {meta.error && <p className="ui-field-error" role="alert">{meta.error}</p>}
        {failure && <p className={failure.hint === 'ai_not_configured' ? 'bi-note' : 'ui-field-error'} role="alert">{failure.message}</p>}
        {result && (
          <div className="advisor-answer" aria-live="polite">
            <p className="bi-note"><strong>{result.question}</strong></p>
            <p className="advisor-ai-answer">{result.answer}</p>
            <p className="bi-note">Dijawab AI dari data {dateKeyLabel(result.period?.from)} – {dateKeyLabel(result.period?.to)}. Cek angka penting di Jawaban cepat sebelum mengambil keputusan.{result.truncated ? ' Jawaban terpotong karena terlalu panjang.' : ''}</p>
          </div>
        )}
        <p className="bi-note"><ShieldCheck size={13} aria-hidden="true" /> Yang dikirim ke AI: angka ringkasan kafe (penjualan, produk, stok, beban). Nama dan kontak pelanggan tidak dikirim.</p>
      </Card>
      {meta.data?.history?.length > 0 && (
        <Card>
          <CardHeader title="Riwayat pertanyaan AI" />
          <ul className="advisor-history">
            {meta.data.history.map((row) => (
              <li key={row.id}>
                <details>
                  <summary><span>{row.question}</span><small>{formatDateTime(row.created_at)}</small></summary>
                  <p>{row.answer}</p>
                </details>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}

function Header() {
  return <PageHeader eyebrow="Analitik" title="Advisor bisnis" description="Jawaban atas pertanyaan bisnis dari data kafemu sendiri. Angka dihitung sistem, bukan ditebak." />
}
