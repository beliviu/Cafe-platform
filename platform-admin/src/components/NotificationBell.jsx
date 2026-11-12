/*
 * Lonceng notifikasi admin (file 15): badge belum dibaca, panel daftar, tandai dibaca / semua,
 * update langsung lewat Supabase Realtime (tabel platform_notifications, RLS: admin 2FA saja).
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Bell, CheckCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from './ui/index.js'
import { supabase } from '../lib/supabase.js'
import { formatRelative } from '../lib/format.js'

const MISSING = /could not find the function|schema cache/i

export function NotificationBell() {
  const navigate = useNavigate()
  const panelId = useId()
  const wrapRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [data, setData] = useState({ unread: 0, rows: [], missing: false })
  const [attempt, setAttempt] = useState(0)
  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    if (!supabase) return undefined
    let active = true
    supabase.rpc('pa_notifications_list', { p_limit: 30 }).then(({ data: result, error }) => {
      if (!active) return
      if (error) setData((current) => ({ ...current, missing: MISSING.test(error.message) }))
      else setData({ unread: Number(result.unread) || 0, rows: result.rows || [], missing: false })
    })
    return () => { active = false }
  }, [attempt])

  // Realtime: notifikasi baru langsung muncul
  useEffect(() => {
    if (!supabase || data.missing) return undefined
    const channel = supabase.channel('platform-notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_notifications' }, reload)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [data.missing, reload])

  // Tutup saat klik di luar / Esc
  useEffect(() => {
    if (!open) return undefined
    function onDown(event) { if (!wrapRef.current?.contains(event.target)) setOpen(false) }
    function onKey(event) { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  async function markRead(ids) {
    await supabase.rpc('pa_notifications_mark_read', { p_ids: ids })
    reload()
  }

  function openItem(item) {
    if (!item.read_at) markRead([item.id])
    setOpen(false)
    if (item.link) navigate(item.link)
  }

  const badge = data.unread > 99 ? '99+' : data.unread
  return (
    <div className="ps-bell" ref={wrapRef}>
      <button type="button" className="ps-bell-btn" aria-label={data.unread ? `Notifikasi, ${data.unread} belum dibaca` : 'Notifikasi'}
        aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
        <Bell size={18} aria-hidden="true" />
        {data.unread > 0 && <span className="ps-bell-badge tabular" aria-hidden="true">{badge}</span>}
      </button>
      {open && (
        <div className="ps-bell-panel" id={panelId} role="dialog" aria-label="Notifikasi">
          <header>
            <strong>Notifikasi</strong>
            {data.unread > 0 && <Button size="sm" variant="ghost" icon={CheckCheck} onClick={() => markRead(null)}>Tandai semua dibaca</Button>}
          </header>
          {data.missing ? (
            <p className="ps-bell-empty">Notifikasi aktif setelah file SQL 15 dijalankan.</p>
          ) : data.rows.length === 0 ? (
            <p className="ps-bell-empty">Belum ada notifikasi. Kafe baru, tagihan lunas, dan tagihan telat akan muncul di sini.</p>
          ) : (
            <ul>
              {data.rows.map((item) => (
                <li key={item.id}>
                  <button type="button" className={`ps-note is-${item.severity}${item.read_at ? '' : ' is-unread'}`} onClick={() => openItem(item)}>
                    <span className="ps-note-dot" aria-hidden="true" />
                    <span className="ps-note-text">
                      <strong>{item.title}</strong>
                      {item.body && <span>{item.body}</span>}
                      <small>{formatRelative(item.created_at)}</small>
                    </span>
                    {!item.read_at && <span className="sr-only">belum dibaca</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
