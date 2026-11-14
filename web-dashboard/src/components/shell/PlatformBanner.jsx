import { X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatDate } from '../../lib/format.js'
import { useOwnerNotifications, usePlatformStatus } from '../../lib/platformBilling.js'
import { INCIDENT_STATUS, useActiveIncidents } from '../../lib/platformScale.js'
import { ContactDailybrew } from '../platform/ContactDailybrew.jsx'

const TONE = { danger: '', warning: ' is-warning', info: ' is-info', success: ' is-info' }

/**
 * Pemberitahuan dari Dailybrew di atas setiap halaman:
 * - kafe dinonaktifkan (owner & staff) + tombol hubungi Dailybrew (owner)
 * - langganan lewat jatuh tempo / masa tenggang (owner)
 * - notifikasi owner (file 15): tagihan H-7, H-1, telat, masa coba habis, pengumuman admin — bisa ditutup
 * - file 18: insiden sistem yang sedang berlangsung (halaman /status), pendaftaran menunggu persetujuan
 */
export function PlatformBanner(props) {
  const incidents = useActiveIncidents(props.supabase)
  return (
    <>
      {incidents.slice(0, 2).map((incident) => (
        <div key={incident.id} className={`shell-banner${incident.impact === 'major' ? '' : ' is-warning'}`} role="status">
          <span>
            <strong>{incident.impact === 'maintenance' ? 'Pemeliharaan' : 'Gangguan'}: {incident.title}.</strong>
            {' '}{(INCIDENT_STATUS[incident.status] || INCIDENT_STATUS.investigating).label}{incident.updates?.[0]?.body ? ` — ${incident.updates[0].body}` : ''}
          </span>
          <span className="shell-banner-actions"><a href="/status" target="_blank" rel="noreferrer">Status layanan</a></span>
        </div>
      ))}
      <AccountBanner {...props} />
    </>
  )
}

function AccountBanner({ supabase, cafeId, cafeName, isOwner }) {
  const status = usePlatformStatus(supabase, cafeId)
  const { items, dismiss } = useOwnerNotifications(supabase, cafeId, isOwner)
  const cafe = { id: cafeId, name: cafeName }

  // File 17: nonaktif otomatis karena tagihan → owner cukup membayar, kafe aktif lagi otomatis
  if (status?.suspended && status.suspended_kind === 'billing') {
    return (
      <div className="shell-banner" role="alert">
        <span>
          <strong>Kafe dinonaktifkan sementara karena langganan belum dibayar.</strong> Pesanan baru belum bisa diterima; data tetap aman.
          {' '}{isOwner ? 'Kafe aktif lagi otomatis begitu pembayaran terkonfirmasi.' : 'Hubungi owner kafe.'}
        </span>
        {isOwner && <span className="shell-banner-actions"><Link to="/settings/subscription">Bayar sekarang</Link></span>}
      </div>
    )
  }

  // File 18: daftar sendiri saat mode persetujuan menyala
  if (status?.suspended && status.suspended_kind === 'approval') {
    const rejected = /ditolak/i.test(status.suspended_reason || '')
    return (
      <div className={`shell-banner${rejected ? '' : ' is-info'}`} role="status">
        <span>
          <strong>{rejected ? 'Pendaftaran tidak disetujui.' : 'Pendaftaran sedang ditinjau Dailybrew.'}</strong>
          {' '}{rejected ? (status.suspended_reason || '') : 'Sambil menunggu, Anda bisa menyiapkan menu, meja, dan pengaturan. Pesanan bisa diterima setelah disetujui.'}
        </span>
        {isOwner && <ContactDailybrew cafe={cafe} topic="Saya baru mendaftar dan ingin menanyakan status persetujuan." label="Hubungi Dailybrew" size="sm" />}
      </div>
    )
  }

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
  const hasInvoiceNote = (items || []).some((item) => item.kind.startsWith('invoice_') || item.kind === 'suspend_warning')
  return (
    <>
      {status?.suspend_at && isOwner && !hasInvoiceNote && (
        <div className="shell-banner" role="alert">
          <span>Langganan belum dibayar. Kafe dinonaktifkan otomatis pada {formatDate(status.suspend_at)} bila tagihan belum lunas.</span>
          <Link to="/settings/subscription">Bayar sekarang</Link>
        </div>
      )}
      {!status?.suspend_at && status?.in_grace && isOwner && !hasInvoiceNote && (
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
            {item.link && <Link to={item.link}>{item.kind.startsWith('invoice_') || item.kind === 'suspend_warning' || item.kind === 'cafe_suspended' ? 'Bayar sekarang' : 'Lihat'}</Link>}
            <button type="button" aria-label="Tutup pemberitahuan" onClick={() => dismiss(item.id)}><X size={16} aria-hidden="true" /></button>
          </span>
        </div>
      ))}
    </>
  )
}
