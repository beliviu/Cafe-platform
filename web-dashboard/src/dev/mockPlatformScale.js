/*
 * KHUSUS DEV: fungsi file SQL 18 untuk pratinjau (status sistem, flag, wizard setup, lihat-sebagai).
 * ?mock_incident=1 → ada insiden aktif (banner di web owner & halaman /status).
 */
const iso = (offsetMinutes) => new Date(Date.now() + offsetMinutes * 60000).toISOString()

function publicStatus() {
  const incident = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mock_incident') === '1'
  return {
    updated_at: iso(0),
    overall: incident ? 'degraded' : 'operational',
    services: [
      { key: 'web', name: 'Dashboard web', description: 'Dashboard owner & staff', status: 'operational' },
      { key: 'app', name: 'Aplikasi pelanggan', description: 'Menu, QR meja, dan pesanan pelanggan', status: 'operational' },
      { key: 'payments', name: 'Pembayaran', description: 'QRIS & pembayaran online', status: incident ? 'degraded' : 'operational' },
      { key: 'notifications', name: 'Notifikasi', description: 'Email & pemberitahuan', status: 'operational' },
    ],
    incidents: [
      ...(incident ? [{
        id: 'inc-2', title: 'Konfirmasi QRIS terlambat', impact: 'minor', status: 'identified', services: ['payments'], started_at: iso(-42), resolved_at: null,
        updates: [
          { status: 'identified', body: 'Penyebab ada di penyedia pembayaran. Pesanan tetap tercatat; status lunas menyusul otomatis.', created_at: iso(-15) },
          { status: 'investigating', body: 'Sebagian pembayaran QRIS terlambat dikonfirmasi. Sedang kami cek.', created_at: iso(-42) },
        ],
      }] : []),
      {
        id: 'inc-1', title: 'Email notifikasi tertunda', impact: 'minor', status: 'resolved', services: ['notifications'], started_at: iso(-60 * 24 * 9), resolved_at: iso(-60 * 24 * 9 + 70),
        updates: [
          { status: 'resolved', body: 'Semua email tertunda sudah terkirim.', created_at: iso(-60 * 24 * 9 + 70) },
          { status: 'investigating', body: 'Email pengingat tagihan terlambat terkirim.', created_at: iso(-60 * 24 * 9) },
        ],
      },
    ],
  }
}

const SETUP = [
  ['identity', 'Identitas dan logo', true], ['hours', 'Jam buka', true], ['charges', 'Pajak', true], ['menu', 'Kategori dan produk', true],
  ['tables', 'Meja dan QR', false], ['staff', 'Staff', true], ['payment', 'Pembayaran (QRIS)', false], ['receipt', 'Struk', false],
]

export function scaleRpc(fixtures, name, args) {
  const ok = (data) => ({ data, error: null })
  switch (name) {
    case 'public_status':
      return ok(publicStatus())
    case 'cafe_flags':
      return ok({ pos_baru: true })
    case 'owner_setup_progress':
      return ok({
        done: SETUP.filter((step) => step[2]).length, total: 8,
        steps: SETUP.map(([key, label, done], index) => ({ no: index + 1, key, label, done })),
        stuck_key: 'tables', stuck_step: 'Meja dan QR',
      })
    case 'owner_signup_status':
      return ok({ signup_status: 'approved', signup_at: iso(-60 * 24 * 3), city: 'Bandung' })
    case 'impersonation_context':
      return ok({
        session_id: args.p_session, cafe_id: fixtures.cafe.id, expires_at: iso(23), started_at: iso(-7),
        cafe_name: fixtures.cafe.name, admin_name: 'Sapto (Support)', owner: { ...fixtures.profile, role: 'owner' },
      })
    case 'pa_impersonate_end':
      return ok({ ended: 1 })
    default:
      return null
  }
}
