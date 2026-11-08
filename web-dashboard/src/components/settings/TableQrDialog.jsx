/*
 * QR satu meja: pratinjau, salin tautan, unduh PNG, cetak, dan ganti QR (token baru).
 */
import { useState } from 'react'
import { Copy, Download, Printer, RefreshCw } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Button, ConfirmDialog, Dialog, useToast } from '../ui/index.js'
import { CUSTOMER_APP_URL } from '../../config/platform.js'
import { printTableQrSheet, qrMatrix, qrPngDataUrl, tableQrUrl } from '../../lib/qr.js'
import { rpc } from '../../lib/pos.js'

export function TableQrDialog({ table, cafeName, onClose, onRotated }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [confirm, setConfirm] = useState(false)
  const url = tableQrUrl(table.qr_token)
  const { size, path } = qrMatrix(url)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast({ tone: 'success', title: 'Tautan disalin' })
    } catch {
      toast({ tone: 'error', title: 'Tidak bisa menyalin', description: url })
    }
  }

  function download() {
    const link = document.createElement('a')
    link.href = qrPngDataUrl(url)
    link.download = `qr-meja-${table.label.replace(/\s+/g, '-').toLowerCase()}.png`
    link.click()
  }

  return (
    <>
      <Dialog size="sm" title={`QR meja ${table.label}`} description="Tempel di meja. Pelanggan scan → menu terbuka dengan meja ini terpilih otomatis." onClose={onClose}
        footer={<Button variant="ghost" onClick={onClose}>Tutup</Button>}>
        <div className="qr-preview">
          <svg viewBox={`-4 -4 ${size + 8} ${size + 8}`} role="img" aria-label={`Kode QR meja ${table.label}`} shapeRendering="crispEdges">
            <rect x="-4" y="-4" width={size + 8} height={size + 8} fill="#fff" />
            <path d={path} fill="#000" />
          </svg>
          <code className="qr-url">{url}</code>
          {!CUSTOMER_APP_URL && <p className="ui-field-error">Isi VITE_CUSTOMER_APP_URL (alamat app customer versi web) sebelum mencetak QR.</p>}
          <div className="qr-actions">
            <Button variant="secondary" size="sm" icon={Copy} onClick={copy}>Salin tautan</Button>
            <Button variant="secondary" size="sm" icon={Download} onClick={download}>Unduh PNG</Button>
            <Button variant="secondary" size="sm" icon={Printer} onClick={() => printTableQrSheet([table], cafeName) || toast({ tone: 'error', title: 'Jendela cetak diblokir' })}>Cetak</Button>
          </div>
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => setConfirm(true)}>Ganti QR</Button>
        </div>
      </Dialog>
      {confirm && (
        <ConfirmDialog tone="danger" title={`Ganti QR meja ${table.label}?`} confirmLabel="Ganti QR"
          description="QR lama langsung tidak berlaku (mis. bila QR difoto/disebar orang). Cetak & tempel QR baru setelah ini."
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            const token = await rpc(supabase, 'table_qr_rotate', { p_table_id: table.id })
            toast({ tone: 'success', title: 'QR baru dibuat', description: 'Jangan lupa cetak ulang.' })
            setConfirm(false)
            onRotated(token)
            return true
          }} />
      )}
    </>
  )
}
