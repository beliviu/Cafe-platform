/*
 * Pelanggan → Ulasan (file 08): rating per menu, balas ulasan, sembunyikan ulasan yang tidak pantas.
 */
import { useCallback, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Eye, EyeOff, MessageSquareReply, Star } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, ErrorState, PageHeader, Select, SkeletonRows, StatCard, TextField, useToast } from '../../components/ui/index.js'
import { CUSTOMER_REQUIRED, friendlyError } from '../../lib/db.js'
import { formatNumber, formatRelative } from '../../lib/format.js'
import { useLoader } from '../../lib/inventory.js'
import { rpc } from '../../lib/pos.js'

const FILTERS = [
  { value: 'all', label: 'Semua ulasan' },
  { value: 'low', label: 'Bintang 1–3' },
  { value: 'unreplied', label: 'Belum dibalas' },
  { value: 'hidden', label: 'Disembunyikan' },
]

function Stars({ value }) {
  return (
    <span className="rv-stars" role="img" aria-label={`${value} dari 5 bintang`}>
      {[1, 2, 3, 4, 5].map((star) => <Star key={star} size={14} aria-hidden="true" className={star <= value ? 'is-on' : ''} />)}
    </span>
  )
}

export function ReviewsPage() {
  const { cafe, features } = useOutletContext()
  return (
    <div className="page page-wide">
      <PageHeader eyebrow="Pelanggan" title="Ulasan" description="Rating dari pelanggan yang pesanannya sudah selesai. Balasanmu tampil di aplikasi." />
      {features?.customer ? <ReviewsContent cafe={cafe} /> : <Card><EmptyState title="Belum tersedia" description={CUSTOMER_REQUIRED} /></Card>}
    </div>
  )
}

function ReviewsContent({ cafe }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [filter, setFilter] = useState('all')
  const [product, setProduct] = useState('all')
  const [replying, setReplying] = useState(null)
  const load = useCallback(async () => {
    const [reviews, products] = await Promise.all([
      supabase.from('product_reviews').select('id, product_id, order_id, rating, comment, reply, replied_at, is_hidden, created_at').eq('cafe_id', cafe.id).order('created_at', { ascending: false }).limit(500),
      supabase.from('products').select('id, name').eq('cafe_id', cafe.id),
    ])
    const failure = reviews.error || products.error
    if (failure) throw new Error(friendlyError(failure))
    return { reviews: reviews.data || [], names: new Map((products.data || []).map((row) => [row.id, row.name])) }
  }, [cafe.id, supabase])
  const { data, error, reload, loading } = useLoader(load)

  const visible = useMemo(() => (data?.reviews || []).filter((review) => !review.is_hidden), [data])
  const perProduct = useMemo(() => {
    const map = new Map()
    for (const review of visible) map.set(review.product_id, [...(map.get(review.product_id) || []), review.rating])
    return [...map.entries()].map(([id, list]) => ({ id, name: data.names.get(id) || 'Menu dihapus', count: list.length, avg: list.reduce((a, b) => a + b, 0) / list.length }))
      .sort((a, b) => b.count - a.count)
  }, [data, visible])
  const rows = useMemo(() => (data?.reviews || []).filter((review) => (product === 'all' || review.product_id === product)
    && (filter === 'all' ? !review.is_hidden : filter === 'low' ? review.rating <= 3 && !review.is_hidden : filter === 'unreplied' ? !review.reply && !review.is_hidden : review.is_hidden)), [data, filter, product])

  async function setHidden(review, hidden) {
    try {
      await rpc(supabase, 'review_moderate', { p_review_id: review.id, p_hidden: hidden, p_reply: review.reply })
      toast({ tone: 'success', title: hidden ? 'Ulasan disembunyikan' : 'Ulasan ditampilkan lagi' })
      reload()
    } catch (caught) {
      toast({ tone: 'error', title: 'Gagal', description: caught.message })
    }
  }

  if (error) return <Card><ErrorState message={error} onRetry={reload} /></Card>
  const average = visible.length ? visible.reduce((sum, review) => sum + review.rating, 0) / visible.length : 0
  return (
    <div className="inv-page">
      <section className="dash-stats inv-stats" aria-label="Ringkasan ulasan">
        <StatCard label="Rata-rata rating" value={visible.length ? `${average.toFixed(1).replace('.', ',')} / 5` : '—'} caption={`${formatNumber(visible.length)} ulasan tampil`} loading={!data} />
        <StatCard tone="amber" label="Perlu perhatian" value={formatNumber(visible.filter((review) => review.rating <= 3).length)} caption="Bintang 1–3" loading={!data}
          onClick={() => setFilter('low')} />
        <StatCard tone="neutral" label="Belum dibalas" value={formatNumber(visible.filter((review) => !review.reply).length)} caption="Balasan tampil di app" loading={!data}
          onClick={() => setFilter('unreplied')} />
      </section>
      <div className="fin-grid is-wide-left">
        <div className="inv-page">
          <section className="toolbar" aria-label="Filter ulasan">
            <Select hideLabel label="Filter" value={filter} onChange={(event) => setFilter(event.target.value)} options={FILTERS} />
            <Select hideLabel label="Menu" value={product} onChange={(event) => setProduct(event.target.value)}
              options={[{ value: 'all', label: 'Semua menu' }, ...perProduct.map((item) => ({ value: item.id, label: item.name }))]} />
          </section>
          <Card padding="none" className={loading && data ? 'is-refreshing' : ''}>
            {!data ? <SkeletonRows rows={5} label="Memuat ulasan" /> : !rows.length ? (
              <EmptyState icon={Star} compact title={data.reviews.length ? 'Tidak ada ulasan yang cocok' : 'Belum ada ulasan'} description="Pelanggan bisa memberi ulasan setelah pesanannya selesai." />
            ) : (
              <ul className="rv-list">
                {rows.map((review) => (
                  <li key={review.id} className={review.is_hidden ? 'is-hidden' : ''}>
                    <div className="rv-head">
                      <Stars value={review.rating} />
                      <strong>{data.names.get(review.product_id) || 'Menu dihapus'}</strong>
                      {review.is_hidden && <Badge tone="neutral" size="sm" dot={false}>Disembunyikan</Badge>}
                      <span className="text-muted rv-time">{formatRelative(review.created_at)}</span>
                    </div>
                    {review.comment ? <p className="rv-comment">{review.comment}</p> : <p className="rv-comment text-muted">Tanpa komentar</p>}
                    {review.reply && <p className="rv-reply"><strong>Balasan kafe:</strong> {review.reply}</p>}
                    <div className="rv-actions">
                      <Button size="sm" variant="ghost" icon={MessageSquareReply} onClick={() => setReplying(review)}>{review.reply ? 'Ubah balasan' : 'Balas'}</Button>
                      <Button size="sm" variant="ghost" icon={review.is_hidden ? Eye : EyeOff} onClick={() => setHidden(review, !review.is_hidden)}>{review.is_hidden ? 'Tampilkan' : 'Sembunyikan'}</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card>
          <CardHeader title="Rating per menu" description="Dari ulasan yang tampil" />
          {!perProduct.length ? <p className="text-muted">Belum ada rating.</p> : (
            <ul className="fin-bars">
              {perProduct.map((item) => (
                <li key={item.id}>
                  <span className="fin-bars-label"><span>{item.name}</span><span className="tabular">{item.avg.toFixed(1).replace('.', ',')}</span></span>
                  <span className="fin-bars-track" aria-hidden="true"><span style={{ width: `${(item.avg / 5) * 100}%` }} /></span>
                  <small className="text-muted">{formatNumber(item.count)} ulasan</small>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {replying && <ReplyDialog review={replying} onClose={() => setReplying(null)} onSaved={reload} />}
    </div>
  )
}

function ReplyDialog({ review, onClose, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [reply, setReply] = useState(review.reply || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true)
    try {
      await rpc(supabase, 'review_moderate', { p_review_id: review.id, p_hidden: review.is_hidden, p_reply: reply.trim() || null })
      toast({ tone: 'success', title: reply.trim() ? 'Balasan disimpan' : 'Balasan dihapus' })
      onSaved()
      onClose()
    } catch (caught) {
      setError(caught.message)
      setSaving(false)
    }
  }

  return (
    <Dialog size="sm" title="Balas ulasan" description={review.comment || `${review.rating} bintang tanpa komentar`} onClose={saving ? undefined : onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button><Button onClick={save} loading={saving}>Simpan balasan</Button></>}>
      <TextField label="Balasan (tampil di app)" multiline rows={4} maxLength={500} value={reply} error={error}
        placeholder="Terima kasih atas masukannya! …" onChange={(event) => { setReply(event.target.value); setError('') }} />
    </Dialog>
  )
}
