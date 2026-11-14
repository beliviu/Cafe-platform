/*
 * Kotak masuk tiket bantuan owner → admin (file 16): status, prioritas, penanggung jawab, waktu respons.
 * Daftar ikut diperbarui lewat Realtime saat ada tiket atau balasan baru.
 */
import { useCallback, useEffect, useState } from 'react'
import { Inbox, LifeBuoy } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Badge, Card, EmptyState, ErrorState, KpiCard, PageHeader, SearchInput, SkeletonRows, Tabs } from '../components/ui/index.js'
import { optional, rpc, TICKET_CATEGORY, TICKET_PRIORITY, TICKET_STATUS, useLoader } from '../lib/api.js'
import { formatNumber, formatRelative } from '../lib/format.js'
import { supabase } from '../lib/supabase.js'

function minutesLabel(value) {
  if (value == null) return '—'
  const minutes = Number(value)
  if (minutes < 60) return `${formatNumber(minutes)} mnt`
  const hours = minutes / 60
  return hours < 24 ? `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(hours)} jam` : `${formatNumber(Math.round(hours / 24))} hari`
}

export function TicketsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const status = params.get('status') || ''
  const [search, setSearch] = useState(params.get('q') || '')
  const [query, setQuery] = useState(search)

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const load = useCallback(() => optional(rpc('pa_tickets_list', { p_status: status || null, p_search: query || null, p_limit: 100, p_offset: 0 })), [query, status])
  const { data, error, loading, reload } = useLoader(load)

  // Tiket baru / balasan owner langsung muncul
  useEffect(() => {
    if (!supabase?.channel) return undefined
    const channel = supabase.channel('platform-tickets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_tickets' }, reload)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [reload])

  const counts = data?.counts || {}
  const tabs = [
    { value: '', label: 'Semua', count: (counts.new || 0) + (counts.in_progress || 0) + (counts.resolved || 0) },
    { value: 'new', label: 'Baru', count: counts.new || 0 },
    { value: 'in_progress', label: 'Diproses', count: counts.in_progress || 0 },
    { value: 'resolved', label: 'Selesai', count: counts.resolved || 0 },
  ]

  return (
    <div className="page page-wide pa-stack">
      <PageHeader eyebrow="Layanan" title="Tiket bantuan" description="Pertanyaan dan kendala dari owner kafe. Balasan terkirim ke dashboard owner sebagai notifikasi." />

      {data === null ? (
        <Card><EmptyState icon={LifeBuoy} title="Belum aktif" description="Kotak masuk tiket aktif setelah file SQL 16 dijalankan di Supabase." /></Card>
      ) : (
        <>
          <div className="ui-kpi-grid">
            <KpiCard label="Baru" loading={loading && !data} value={data ? counts.new || 0 : undefined} caption="Belum dibalas" />
            <KpiCard label="Diproses" loading={loading && !data} value={data ? counts.in_progress || 0 : undefined} caption="Menunggu tindak lanjut" />
            <KpiCard label="Belum dibaca" loading={loading && !data} value={data ? counts.unread || 0 : undefined} caption="Ada pesan owner yang baru" />
            <KpiCard label="Respons pertama" loading={loading && !data} value={data ? minutesLabel(data.avg_first_response_minutes) : undefined} caption="Rata-rata 30 hari" />
          </div>

          <div className="toolbar">
            <Tabs label="Status tiket" options={tabs} value={status} onChange={(value) => setParams((current) => {
              const next = new URLSearchParams(current)
              if (value) next.set('status', value)
              else next.delete('status')
              return next
            }, { replace: true })} />
            <SearchInput className="toolbar-search toolbar-end" value={search} onChange={setSearch} placeholder="Cari judul, nomor, atau kafe…" />
          </div>

          <Card padding="none">
            {error ? <ErrorState message={error} onRetry={reload} />
              : loading && !data ? <SkeletonRows rows={5} label="Memuat tiket" />
                : data.rows.length === 0 ? (
                  <EmptyState icon={Inbox} title={query || status ? 'Tidak ada tiket yang cocok' : 'Kotak masuk kosong'}
                    description={query || status ? 'Coba ubah pencarian atau status.' : 'Tiket dari menu "Bantuan Dailybrew" di dashboard owner akan muncul di sini.'} />
                ) : (
                  <div className="table-scroll">
                    <table className="data-table tk-table">
                      <thead>
                        <tr>
                          <th scope="col">Tiket</th>
                          <th scope="col">Kafe</th>
                          <th scope="col">Prioritas</th>
                          <th scope="col">Status</th>
                          <th scope="col">Ditangani</th>
                          <th scope="col">Terakhir</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.rows.map((ticket) => {
                          const open = () => navigate(`/tiket/${ticket.id}`)
                          const statusMeta = TICKET_STATUS[ticket.status] || TICKET_STATUS.new
                          const priority = TICKET_PRIORITY[ticket.priority] || TICKET_PRIORITY.normal
                          return (
                            <tr key={ticket.id} className={`pa-row-link${ticket.admin_unread ? ' is-unread' : ''}`} tabIndex={0} onClick={open}
                              onKeyDown={(event) => { if (event.key === 'Enter') open() }}>
                              <td>
                                <span className="pa-cell-main">
                                  <strong>{ticket.admin_unread && <span className="tk-dot" aria-label="Belum dibaca" />}{ticket.title}</strong>
                                  <small className="tabular">{ticket.number} · {TICKET_CATEGORY[ticket.category] || ticket.category} · {formatNumber(ticket.message_count)} pesan</small>
                                </span>
                              </td>
                              <td>{ticket.cafe_name}</td>
                              <td><Badge tone={priority.tone} dot={false}>{priority.label}</Badge></td>
                              <td><Badge tone={statusMeta.tone}>{statusMeta.label}</Badge></td>
                              <td>{ticket.assigned_name || <span className="pa-muted">Belum ada</span>}</td>
                              <td className="tabular">{formatRelative(ticket.last_message_at)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
          </Card>
        </>
      )}
    </div>
  )
}
