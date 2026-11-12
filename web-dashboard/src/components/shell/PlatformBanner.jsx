import { Link } from 'react-router-dom'
import { formatDate } from '../../lib/format.js'
import { usePlatformStatus } from '../../lib/platformBilling.js'

/** Pemberitahuan dari Dailybrew: kafe dinonaktifkan, atau langganan lewat jatuh tempo (masa tenggang). */
export function PlatformBanner({ supabase, cafeId, isOwner }) {
  const status = usePlatformStatus(supabase, cafeId)
  if (!status) return null
  if (status.suspended) {
    return (
      <div className="shell-banner" role="alert">
        <span>
          <strong>Kafe dinonaktifkan oleh Dailybrew.</strong> Pesanan baru belum bisa diterima; data tetap aman.
          {status.suspended_reason ? ` Alasan: ${status.suspended_reason}` : ''} {isOwner ? 'Hubungi Dailybrew untuk mengaktifkan kembali.' : 'Hubungi owner kafe.'}
        </span>
      </div>
    )
  }
  if (status.in_grace && isOwner) {
    return (
      <div className="shell-banner is-warning" role="status">
        <span>Langganan sudah lewat jatuh tempo. Fitur paket tetap jalan sampai {formatDate(status.grace_until)}.</span>
        <Link to="/settings/subscription">Bayar sekarang</Link>
      </div>
    )
  }
  return null
}
