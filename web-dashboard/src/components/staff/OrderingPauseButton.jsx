/*
 * Tombol di papan staff: jeda / buka lagi pesanan dari aplikasi (file 08, cafe_set_ordering_paused).
 * Untuk saat antrean penuh atau bahan habis; pesanan kasir (POS) tetap jalan.
 */
import { useCallback, useEffect, useState } from 'react'
import { PauseCircle, PlayCircle } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Button, Dialog, TextField, useToast } from '../ui/index.js'
import { rpc } from '../../lib/pos.js'

export function OrderingPauseButton({ cafeId }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [paused, setPaused] = useState(null)
  const [dialog, setDialog] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('cafe_settings').select('ordering_paused').eq('cafe_id', cafeId).maybeSingle()
    setPaused(Boolean(data?.ordering_paused))
  }, [cafeId, supabase])

  useEffect(() => {
    const first = setTimeout(load, 0)
    const timer = setInterval(load, 60000)
    return () => { clearTimeout(first); clearInterval(timer) }
  }, [load])

  async function apply(next) {
    setBusy(true)
    try {
      await rpc(supabase, 'cafe_set_ordering_paused', { p_cafe_id: cafeId, p_paused: next, p_message: next ? message.trim() || null : null })
      setPaused(next)
      setDialog(false)
      toast({ tone: next ? 'info' : 'success', title: next ? 'Pesanan app dijeda' : 'Pesanan app dibuka lagi', description: next ? 'Pelanggan melihat pesanmu dan belum bisa checkout.' : undefined })
    } catch (caught) {
      toast({ tone: 'error', title: 'Gagal mengubah', description: caught.message })
    }
    setBusy(false)
  }

  if (paused === null) return null
  return (
    <>
      {paused
        ? <Button variant="danger-soft" icon={PlayCircle} loading={busy} onClick={() => apply(false)}>App dijeda · buka lagi</Button>
        : <Button variant="secondary" icon={PauseCircle} onClick={() => setDialog(true)}>Jeda pesanan app</Button>}
      {dialog && (
        <Dialog size="sm" title="Jeda pesanan dari app?" description="Pelanggan tidak bisa checkout sampai dibuka lagi. Pesanan yang sudah masuk & kasir tetap jalan."
          onClose={busy ? undefined : () => setDialog(false)}
          footer={<><Button variant="ghost" onClick={() => setDialog(false)} disabled={busy}>Batal</Button><Button onClick={() => apply(true)} loading={busy}>Jeda sekarang</Button></>}>
          <TextField label="Pesan untuk pelanggan (opsional)" value={message} maxLength={160} placeholder="Mis. Antrean penuh, coba 15 menit lagi"
            onChange={(event) => setMessage(event.target.value)} />
        </Dialog>
      )}
    </>
  )
}
