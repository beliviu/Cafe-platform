/*
 * Pengaturan → Umum → Zona berbahaya: owner mereset semua transaksi kafenya (file SQL 19, owner_reset_transactions).
 * Wajib mengetik nama kafe persis. Database yang memeriksa: hanya owner kafe ini, hanya data kafe ini.
 */
import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Button, Card, CardHeader, Dialog, TextField, useToast } from '../ui/index.js'
import { formatNumber } from '../../lib/format.js'

const MISSING = /could not find the function|schema cache/i

export function ResetTransactionsCard({ cafe, readOnly = false }) {
  const [open, setOpen] = useState(false)
  return (
    <Card className="settings-card danger-zone">
      <CardHeader title="Zona berbahaya" description="Untuk memulai operasi dari nol setelah masa uji coba." />
      <div className="danger-zone-row">
        <span>
          <strong>Reset semua transaksi</strong>
          <small>Hapus pesanan, pembayaran, kasir, pembukuan, pembelian, pengeluaran, riwayat stok, dan poin pelanggan. Menu, meja, akun tim, dan pengaturan tetap ada.</small>
        </span>
        <Button variant="danger-soft" icon={RotateCcw} onClick={() => setOpen(true)} disabled={readOnly}>Reset transaksi</Button>
      </div>
      {open && <ResetDialog cafe={cafe} onClose={() => setOpen(false)} />}
    </Card>
  )
}

function ResetDialog({ cafe, onClose }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const matches = confirm.trim() === cafe.name.trim()

  async function submit(event) {
    event.preventDefault()
    if (!matches) { setError(`Ketik "${cafe.name}" persis untuk melanjutkan`); return }
    setBusy(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('owner_reset_transactions', { p_cafe_id: cafe.id, p_confirm: confirm })
    if (rpcError) {
      setError(MISSING.test(rpcError.message) ? 'Fitur ini aktif setelah file SQL 19 dijalankan.' : rpcError.message)
      setBusy(false)
      return
    }
    toast({ title: 'Transaksi direset', description: `${formatNumber(data?.orders ?? 0)} pesanan dan semua data transaksi dihapus. Kafe siap mulai dari nol.` })
    // Muat ulang agar semua halaman (dashboard, laporan, stok) membaca data yang sudah kosong
    window.setTimeout(() => window.location.assign(window.location.pathname.replace(/\/settings.*$/, '') || '/'), 900)
  }

  return (
    <Dialog title="Reset semua transaksi?" description="Tindakan ini tidak bisa dibatalkan." size="sm" onClose={busy ? undefined : onClose} dismissible={!busy}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button>
        <Button type="submit" form="reset-form" variant="danger" icon={RotateCcw} loading={busy} disabled={!matches}>Hapus semua transaksi</Button></>}>
      <form id="reset-form" className="dialog-form" onSubmit={submit} noValidate>
        <div className="danger-lists">
          <div>
            <strong>Dihapus</strong>
            <ul>
              <li>Semua pesanan, pembayaran, refund</li>
              <li>Sesi kasir & pembukuan</li>
              <li>Pembelian, pengeluaran, riwayat stok</li>
              <li>Poin pelanggan & pemakaian voucher</li>
              <li>Stok bahan jadi 0</li>
            </ul>
          </div>
          <div>
            <strong>Tetap ada</strong>
            <ul>
              <li>Menu, kategori, harga</li>
              <li>Meja & QR</li>
              <li>Akun owner, staff, pelanggan</li>
              <li>Bahan, resep, supplier, voucher</li>
              <li>Pengaturan & langganan</li>
            </ul>
          </div>
        </div>
        <TextField label={`Ketik nama kafe: ${cafe.name}`} value={confirm} autoComplete="off" spellCheck={false} error={error}
          onChange={(event) => { setConfirm(event.target.value); setError('') }} />
      </form>
    </Dialog>
  )
}
