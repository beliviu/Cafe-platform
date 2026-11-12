/*
 * Pengumuman dari admin ke owner kafe (file 15): tampil sebagai banner di web owner selama 30 hari
 * (atau sampai ditutup owner), opsional juga dikirim lewat email.
 */
import { useCallback, useMemo, useState } from 'react'
import { Megaphone, Send } from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, SearchInput, SegmentedControl, SkeletonRows, Switch, TextField, useToast } from '../components/ui/index.js'
import { rpc, useLoader } from '../lib/api.js'
import { formatDateTime, formatNumber } from '../lib/format.js'

function Composer({ cafes, onSent }) {
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [target, setTarget] = useState('all')
  const [picked, setPicked] = useState([])
  const [search, setSearch] = useState('')
  const [email, setEmail] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const filtered = useMemo(() => {
    const word = search.trim().toLocaleLowerCase('id')
    return word ? cafes.filter((cafe) => `${cafe.name} ${cafe.owner_name || ''}`.toLocaleLowerCase('id').includes(word)) : cafes
  }, [cafes, search])

  async function submit(event) {
    event.preventDefault()
    if (target === 'some' && picked.length === 0) {
      setError('Pilih minimal satu kafe.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await rpc('pa_announce', { p_title: title, p_body: body, p_cafe_ids: target === 'all' ? null : picked, p_send_email: email })
      toast({ title: 'Pengumuman terkirim', description: `Tampil di dashboard ${formatNumber(result.recipients)} kafe${email ? ' & dikirim lewat email' : ''}.` })
      setTitle('')
      setBody('')
      setPicked([])
      onSent()
    } catch (caught) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card as="form" onSubmit={submit}>
      <CardHeader title="Tulis pengumuman" description="Muncul sebagai banner di dashboard owner selama 30 hari atau sampai ditutup" />
      <div className="dialog-form">
        <TextField label="Judul" required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="mis. Pemeliharaan sistem Minggu pukul 01.00" />
        <TextField label="Isi" required multiline rows={5} maxLength={2000} value={body} onChange={(event) => setBody(event.target.value)} />
        <div className="pa-field">
          <span className="ui-field-label">Kirim ke</span>
          <SegmentedControl label="Penerima" options={[{ value: 'all', label: `Semua kafe (${formatNumber(cafes.length)})` }, { value: 'some', label: 'Kafe tertentu' }]} value={target} onChange={setTarget} />
        </div>
        {target === 'some' && (
          <div className="pa-picker">
            <SearchInput value={search} onChange={setSearch} placeholder="Cari kafe…" />
            <ul>
              {filtered.map((cafe) => (
                <li key={cafe.cafe_id}>
                  <label className="settings-check">
                    <input type="checkbox" checked={picked.includes(cafe.cafe_id)}
                      onChange={() => setPicked((list) => (list.includes(cafe.cafe_id) ? list.filter((id) => id !== cafe.cafe_id) : [...list, cafe.cafe_id]))} />
                    <span>{cafe.name}<small className="pa-muted"> · {cafe.owner_name || 'tanpa owner'}</small></span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="ui-field-hint">{formatNumber(picked.length)} kafe dipilih</p>
          </div>
        )}
        <div className="pa-actions">
          <Switch label="Kirim juga lewat email" checked={email} onChange={setEmail} onLabel="Juga kirim email" offLabel="Hanya di dashboard" />
        </div>
        {error && <p className="ui-field-error" role="alert">{error}</p>}
        <div><Button type="submit" icon={Send} loading={busy}>Kirim pengumuman</Button></div>
      </div>
    </Card>
  )
}

export function AnnouncementsPage() {
  const load = useCallback(() => Promise.all([rpc('pa_announcements_list'), rpc('pa_cafes_list', { p_limit: 100 })]), [])
  const { data, error, loading, reload } = useLoader(load)
  const [history, cafes] = data || []

  return (
    <div className="page pa-stack">
      <PageHeader eyebrow="Kelola" title="Pengumuman" description="Kabar dari Dailybrew untuk owner kafe: fitur baru, jadwal pemeliharaan, promo" />
      {error ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <Card><SkeletonRows rows={4} /></Card> : (
        <div className="dash-grid">
          <div className="pa-span-7"><Composer cafes={cafes.rows} onSent={reload} /></div>
          <Card className="pa-span-5" padding="none">
            <div className="table-card-head"><CardHeader title="Riwayat" /></div>
            {history.length === 0 ? <EmptyState compact icon={Megaphone} title="Belum ada pengumuman" description="Pengumuman pertama akan tampil di sini." /> : (
              <ul className="pa-history">
                {history.map((item) => (
                  <li key={item.id}>
                    <strong>{item.title}</strong>
                    <p>{item.body}</p>
                    <span className="pa-actions">
                      <Badge tone="neutral" size="sm" dot={false}>{item.target_cafe_ids ? `${formatNumber(item.recipients)} kafe` : 'Semua kafe'}</Badge>
                      {item.send_email && <Badge tone="blue" size="sm" dot={false}>+ email</Badge>}
                      <small className="pa-muted">{formatNumber(item.read_count)} ditutup · {formatDateTime(item.created_at)}</small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
