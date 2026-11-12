import { X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatDate } from '../../lib/format.js'
import { useOwnerNotifications, usePlatformStatus } from '../../lib/platformBilling.js'
import { ContactDailybrew } from '../platform/ContactDailybrew.jsx'

const TONE = { danger: '', warning: ' is-warning', info: ' is-info', success: ' is-info' }

/**
 * Pemberitahuan dari Dailybrew di atas setiap halaman:
 * - kafe dinonaktifkan (owner & staff) + tombol hubungi Dailybrew (owner)
 * - langganan lewat jatuh tempo / masa tenggang (owner)
 * - notifikasi owner (file 15): tagihan H-7, H-1, telat, masa coba habis, pengumuman admin — bisa ditutup
 */
export function PlatformBanner({ supabase, cafeId, cafeName, isOwner }) {
  const status = usePlatformStatus(supabase, cafeId)
  const { items, dismiss } = useOwnerNotifications(supabase, cafeId, isOwner)
  const cafe = { id: cafeId, name: cafeName }

  if (status?.suspended) {
    return (
      <div className="shell-banner" role="alert">
        <span>
          <strong>Kafe dinonaktifkan oleh Dailybrew.</strong> Pesanan baru belum bisa diterima; data tetap aman.
          {status.suspended_reason ? ` Alasan: ${status.suspended_reason}` : ''} {isOwner ? '' : 'Hubungi owner kafe.'}
        </span>
        {isOwner && <ContactDailybrew cafe={cafe} topic="Kafe kami dinonaktifkan. Mohon bantuan untuk mengaktifkan kembali." label="Hubungi Dailybrew" size="sm" />}
      </div>
    )
  }

  // Banner tagihan dari notifikasi sudah mencakup masa tenggang; tampilkan pesan tenggang hanya bila tidak ada
  const hasInvoiceNote = (items || []).some((item) => item.kind.startsWith('invoice_'))
  return (
    <>
      {status?.in_grace && isOwner && !hasInvoiceNote && (
        <div className="shell-banner is-warning" role="status">
          <span>Langganan sudah lewat jatuh tempo. Fitur paket tetap jalan sampai {formatDate(status.grace_until)}.</span>
          <Link to="/settings/subscription">Bayar sekarang</Link>
        </div>
      )}
      {(items || []).slice(0, 3).map((item) => (
        <div key={item.id} className={`shell-banner${TONE[item.severity] || ' is-info'}`} role={item.severity === 'danger' ? 'alert' : 'status'}>
          <span>
            <strong>{item.title}.</strong> {item.body}
          </span>
          <span className="shell-banner-actions">
            {item.link && <Link to={item.link}>{item.kind.startsWith('invoice_') ? 'Bayar sekarang' : 'Lihat'}</Link>}
            <button type="button" aria-label="Tutup pemberitahuan" onClick={() => dismiss(item.id)}><X size={16} aria-hidden="true" /></button>
          </span>
        </div>
      ))}
    </>
  )
}
