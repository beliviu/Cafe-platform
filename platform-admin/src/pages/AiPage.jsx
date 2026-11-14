/*
 * Tanya AI platform (file SQL 18 + Edge Function platform-advisor).
 * Angka dihitung SQL (pa_ai_facts) — tabel "Paling berisiko" di bawah selalu tampil, walau AI belum diaktifkan.
 * AI hanya menjelaskan angka itu; kuota per admin per hari, setiap pertanyaan tercatat.
 */
import { useCallback, useState } from 'react'
import { Send, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, SkeletonRows, TextField,
} from '../components/ui/index.js'
import { HEALTH_META, optional, rpc, useLoader } from '../lib/api.js'
import { formatDateTime, formatNumber, formatRupiah } from '../lib/format.js'
import { supabase } from '../lib/supabase.js'

const SUGGESTIONS = [
  'Kafe mana yang paling mungkin berhenti bulan depan, dan kenapa?',
  'Kafe masa coba mana yang perlu dibantu setup minggu ini?',
  'Ringkas kondisi pembayaran: siapa yang telat dan berapa lama?',
]

async function ask(question) {
  const { data, error } = await supabase.functions.invoke('platform-advisor', { body: { question } })
  if (error) {
    let message = error.message
    try {
      const body = await error.context?.json?.()
      if (body?.error) message = body.error
    } catch { /* bukan JSON */ }
    throw new Error(/failed to send a request|not found/i.test(message) ? 'Edge Function platform-advisor belum di-deploy.' : message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export function AiPage() {
  const load = useCallback(() => Promise.all([optional(rpc('pa_ai_quota')), optional(rpc('pa_ai_facts')), optional(rpc('pa_ai_history', { p_limit: 10 }))]), [])
  const { data, error, loading, reload } = useLoader(load)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState(null)
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState('')

  async function submit(text) {
    const value = (text ?? question).trim()
    if (value.length < 3) { setAskError('Tulis pertanyaan minimal 3 karakter'); return }
    setQuestion(value)
    setAsking(true)
    setAskError('')
    try {
      const result = await ask(value)
      setAnswer({ question: value, ...result })
      reload()
    } catch (caught) {
      setAskError(caught.message)
    } finally {
      setAsking(false)
    }
  }

  if (error) return <div className="page"><PageHeader title="Tanya AI" /><ErrorState message={error} onRetry={reload} /></div>
  const [quota, facts, history] = data || []
  const pending = loading && !data
  if (data && quota === null) {
    return <div className="page"><PageHeader title="Tanya AI" /><Card><EmptyState icon={Sparkles} title="Belum aktif" description="Halaman ini aktif setelah file SQL 18 dijalankan." /></Card></div>
  }

  return (
    <div className="page pa-stack">
      <PageHeader eyebrow="Analisis" title="Tanya AI" description="Tanya kondisi kafe pelanggan. Angka dihitung database; AI hanya menjelaskan dan tidak mengarang angka." />

      <Card>
        <form className="ai-ask" onSubmit={(event) => { event.preventDefault(); submit() }}>
          <TextField label="Pertanyaan" multiline rows={2} value={question} maxLength={500} placeholder="mis. Kafe mana yang paling mungkin berhenti bulan depan?"
            onChange={(event) => { setQuestion(event.target.value); setAskError('') }} error={askError}
            hint={quota ? `Sisa ${formatNumber(quota.remaining)} dari ${formatNumber(quota.limit)} pertanyaan hari ini` : undefined} />
          <div className="ai-ask-actions">
            <div className="ai-suggestions">
              {SUGGESTIONS.map((text) => <button key={text} type="button" className="ai-chip" disabled={asking} onClick={() => submit(text)}>{text}</button>)}
            </div>
            <Button type="submit" icon={Send} loading={asking} disabled={quota?.remaining === 0}>Tanya</Button>
          </div>
        </form>
        {answer && (
          <div className="ai-answer" aria-live="polite">
            <strong>{answer.question}</strong>
            <div className="ai-answer-body">{answer.answer.split(/\n+/).map((line, index) => <p key={index}>{line}</p>)}</div>
            <small>{answer.truncated ? 'Jawaban terpotong. ' : ''}Model {answer.model} · sisa {formatNumber(answer.remaining)} pertanyaan hari ini</small>
          </div>
        )}
      </Card>

      <Card padding="none">
        <div className="ov-card-head"><CardHeader title="Paling berisiko berhenti" description={facts?.risk_formula || 'Dihitung dari skor kesehatan, tagihan telat, login owner, dan masa coba'} /></div>
        <div className="ov-card-body">
          {pending ? <SkeletonRows rows={5} /> : !facts?.cafes_by_risk?.length ? <EmptyState compact icon={Sparkles} title="Belum ada data" description="Muncul setelah ada kafe aktif atau masa coba." /> : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th scope="col">Kafe</th><th scope="col" className="num">Poin risiko</th><th scope="col">Kesehatan</th><th scope="col">Alasan</th><th scope="col" className="num">MRR</th></tr></thead>
                <tbody>
                  {facts.cafes_by_risk.slice(0, 10).map((row) => {
                    const health = HEALTH_META[row.health_label]
                    return (
                      <tr key={row.cafe}>
                        <td><span className="pa-cell-main"><strong>{row.cafe}</strong><small>{row.plan || '—'} · {row.state === 'trial' ? 'masa coba' : row.state === 'past_due' ? 'telat bayar' : 'aktif'}</small></span></td>
                        <td className="num tabular"><strong>{formatNumber(row.risk_points)}</strong></td>
                        <td>{health ? <Badge tone={health.tone}>{row.health_score} · {health.label}</Badge> : <span className="pa-muted">Belum ada</span>}</td>
                        <td><small className="ai-reasons">{[...(row.health_reasons || []), row.overdue_invoice_days > 0 ? `Tagihan telat ${row.overdue_invoice_days} hari` : null, row.owner_last_login_days >= 14 ? `Owner tidak login ${row.owner_last_login_days} hari` : null].filter(Boolean).slice(0, 3).join(' · ') || '—'}</small></td>
                        <td className="num tabular">{formatRupiah(row.monthly_price)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {history?.length > 0 && (
        <Card>
          <CardHeader title="Pertanyaan saya" description="10 terakhir" />
          <ul className="ai-history">
            {history.map((item) => (
              <li key={item.id}>
                <button type="button" className="link-button" onClick={() => setAnswer({ question: item.question, answer: item.answer || '(tidak ada jawaban)', model: '—', remaining: quota?.remaining ?? 0 })}>{item.question}</button>
                <small>{formatDateTime(item.created_at)}{item.status !== 'answered' ? ' · gagal' : ''}</small>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="ui-field-hint">Butuh tindakan? Buka kafe dari <Link to="/kafe" className="link-button">daftar kafe</Link> untuk chat WA owner atau kirim panduan setup.</p>
    </div>
  )
}
