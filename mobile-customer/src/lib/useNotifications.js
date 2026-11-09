/*
 * Kotak masuk notifikasi (tabel notifications, file 08) + jumlah belum dibaca, realtime.
 * available = false bila file 08 belum dijalankan (ikon lonceng disembunyikan).
 */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth.js'

let channelSequence = 0

export function useNotifications({ limit = 50 } = {}) {
  const { session, supabase } = useAuth()
  const [state, setState] = useState({ items: [], available: false, loading: true })
  const userId = session?.user?.id

  const reload = useCallback(async () => {
    if (!supabase || !userId) {
      setState({ items: [], available: false, loading: false })
      return
    }
    const { data, error } = await supabase.from('notifications').select('id, kind, title, body, data, read_at, created_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit)
    setState({ items: error ? [] : data || [], available: !error, loading: false })
  }, [limit, supabase, userId])

  useEffect(() => {
    const timer = setTimeout(reload, 0)
    if (!supabase || !userId) return () => clearTimeout(timer)
    const channel = supabase.channel(`notifications-${userId}-${++channelSequence}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, reload)
      .subscribe()
    return () => { clearTimeout(timer); supabase.removeChannel(channel) }
  }, [reload, supabase, userId])

  const markRead = useCallback(async (ids = null) => {
    if (!supabase) return
    await supabase.rpc('notifications_mark_read', { p_ids: ids })
    reload()
  }, [reload, supabase])

  return { ...state, unread: state.items.filter((item) => !item.read_at).length, reload, markRead }
}

/** Ke mana notifikasi mengarah saat diketuk. */
export function notificationTarget(data) {
  if (data?.order_id) return `/order/${data.order_id}`
  if (data?.ticket_id) return `/support/${data.ticket_id}`
  if (data?.kind === 'loyalty') return '/loyalty'
  return null
}
