import { useCallback, useState } from 'react'
import { Ban, CalendarPlus, Check, FilePlus2, Gift, KeyRound, Minus, PackageCheck, Pencil, PlayCircle } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { AuditTable } from '../components/AuditTable.jsx'
import { InvoiceTable } from '../components/InvoiceTable.jsx'
import { OutboxTable } from '../components/OutboxTable.jsx'
import { useCrumbs } from '../components/shell/crumbs.js'
import { WhatsAppButton } from '../components/WhatsAppButton.jsx'
import {
  ChangePlanDialog, ExtendDialog, InvoiceDialog, OwnerWhatsAppDialog, ResetPasswordDialog, SuspendDialog, TrialDialog,
} from '../components/SubscriptionDialogs.jsx'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, IconButton, PageHeader, SkeletonRows } from '../components/ui/index.js'
import { FEATURES, LIMITS, rpc, STATE_META, useLoader } from '../lib/api.js'
import { formatDate, formatDateTime, formatNumber, formatRupiah } from '../lib/format.js'
import { formatWa } from '../lib/whatsapp.js'

const SUB_STATUS = { active: 'Aktif', trialing: 'Masa coba', past_due: 'Telat bayar', cancelled: 'Berhenti' }

export function CafeDetailPage() {
  const { cafeId } = useParams()
  const [dialog, setDialog] = useState(null)
  const load = useCallback(() => Promise.all([
    rpc('pa_cafe_detail', { p_cafe: cafeId }),
    rpc('pa_plans_list'),
    rpc('pa_invoices_list', { p_cafe: cafeId, p_limit: 50 }),
    rpc('pa_audit_list', { p_cafe: cafeId, p_limit: 30 }),
    rpc('pa_cafe_outbox', { p_cafe: cafeId, p_limit: 30 }).catch(() => null), // null sebelum file 15
  ]), [cafeId])
  const { data, error, loading, reload } = useLoader(load)
  useCrumbs(data ? [{ label: data[0].cafe.name }] : [{ label: 'Detail' }])

  if (error) return <div className="page"><PageHeader title="Detail kafe" /><ErrorState message={error} onRetry={reload} /></div>
  if (loading && !data) return <div className="page"><PageHeader title="Memuat…" /><Card><SkeletonRows rows={6} /></Card></div>

  const [detail, plans, invoices, audit, outbox] = data
  const { cafe, subscription, summary, usage, effective_plan: effective } = detail
  const meta = STATE_META[summary.state] || STATE_META.active
  const owners = detail.members.filter((member) => member.role === 'owner')
  const staff = detail.members.filter((member) => member.role === 'staff')
  const done = () => { setDialog(null); reload() }
  const dialogProps = { cafe, subscription, plans, onClose: () => setDialog(null), onDone: done }
  const openInvoice = invoices.rows.find((invoice) => invoice.state === 'overdue') || invoices.rows.find((invoice) => invoice.state === 'pending')
  const waCtx = {
    cafeId: cafe.id, cafeName: cafe.name, ownerName: owners[0]?.full_name, phone: cafe.owner_whatsapp, planName: summary.plan_name,
    amount: openInvoice?.amount, dueAt: openInvoice?.due_at, invoiceNumber: openInvoice?.number,
  }

  return (
    <div className="page pa-stack">
      <PageHeader eyebrow="Kafe" title={cafe.name}
        actions={(
          <div className="pa-actions">
            <WhatsAppButton ctx={waCtx} size="md" defaultTemplate={openInvoice ? 'tagihan' : 'bebas'} onMissingPhone={() => setDialog({ type: 'whatsapp' })} />
            <Button variant={cafe.suspended_at ? 'primary' : 'danger-soft'} icon={cafe.suspended_at ? PlayCircle : Ban} onClick={() => setDialog({ type: 'suspend' })}>
              {cafe.suspended_at ? 'Aktifkan kembali' : 'Nonaktifkan'}
            </Button>
          </div>
        )}>
        <div className="pa-actions"><Badge tone={meta.tone}>{meta.label}</Badge>{summary.plan_name && <span className="pa-muted">Paket {summary.plan_name}</span>}</div>
      </PageHeader>

      {cafe.suspended_at && (
        <div className="pa-banner" role="status">
          <Ban size={16} aria-hidden="true" />
          <span>Dinonaktifkan {formatDateTime(cafe.suspended_at)}{cafe.suspended_reason ? ` — ${cafe.suspended_reason}` : ''}. Pesanan baru ditolak.</span>
        </div>
      )}

      <div className="fin-grid">
        <Card>
          <CardHeader title="Langganan" description={summary.plan_name ? `Paket ${summary.plan_name}` : 'Belum ada data langganan'} />
          <dl className="fin-position">
            <div><dt>Status</dt><dd>{SUB_STATUS[subscription?.status] || '—'}</dd></div>
            {subscription?.status === 'trialing' && <div><dt>Masa coba sampai</dt><dd>{subscription.trial_ends_at ? formatDate(subscription.trial_ends_at) : 'Tanpa batas'}</dd></div>}
            <div><dt>Berlaku sampai</dt><dd>{subscription?.current_period_end ? formatDate(subscription.current_period_end) : 'Tanpa batas'}</dd></div>
            <div><dt>Biaya / bulan</dt><dd className="tabular">{Number(summary.monthly_price) ? formatRupiah(summary.monthly_price) : '—'}{subscription?.price_override != null ? ' (harga kustom)' : ''}</dd></div>
            <div><dt>Fitur yang berlaku sekarang</dt><dd>Paket {effective.name}</dd></div>
            {subscription?.notes && <div><dt>Catatan</dt><dd>{subscription.notes}</dd></div>}
          </dl>
          <div className="pa-actions pa-card-actions">
            <Button size="sm" variant="secondary" icon={PackageCheck} onClick={() => setDialog({ type: 'plan' })}>Ganti paket</Button>
            <Button size="sm" variant="secondary" icon={CalendarPlus} onClick={() => setDialog({ type: 'extend' })}>Perpanjang</Button>
            <Button size="sm" variant="secondary" icon={Gift} onClick={() => setDialog({ type: 'trial' })}>Beri masa coba</Button>
            <Button size="sm" icon={FilePlus2} onClick={() => setDialog({ type: 'invoice' })}>Buat tagihan</Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Profil" />
          <dl className="fin-position">
            <div><dt>Terdaftar</dt><dd>{formatDate(cafe.created_at)}</dd></div>
            {cafe.phone && <div><dt>Telepon</dt><dd>{cafe.phone}</dd></div>}
            {cafe.address && <div><dt>Alamat</dt><dd>{cafe.address}</dd></div>}
            <div><dt>Pesanan 30 hari</dt><dd className="tabular">{formatNumber(detail.orders_30d)}</dd></div>
            <div><dt>Pesanan terakhir</dt><dd>{detail.last_order_at ? formatDateTime(detail.last_order_at) : 'Belum ada'}</dd></div>
          </dl>
          <CardHeader as="h3" title="Owner" />
          {owners.length === 0 ? <p className="pa-muted">Belum ada owner.</p> : (
            <ul className="pa-plan-list">
              {owners.map((member) => (
                <li key={member.id}>
                  <span className="pa-cell-main"><strong>{member.full_name || '—'}</strong><small>{member.email} · masuk terakhir {member.last_sign_in_at ? formatDateTime(member.last_sign_in_at) : 'belum pernah'}</small></span>
                  <IconButton icon={KeyRound} label="Reset password owner" size="sm" onClick={() => setDialog({ type: 'password', member })} />
                </li>
              ))}
            </ul>
          )}
          <dl className="fin-position pa-wa-row">
            <div>
              <dt>WhatsApp owner</dt>
              <dd>
                {cafe.owner_whatsapp ? formatWa(cafe.owner_whatsapp) : <span className="pa-muted">Belum diisi</span>}
                <IconButton icon={Pencil} label="Ubah nomor WhatsApp owner" size="sm" onClick={() => setDialog({ type: 'whatsapp' })} />
              </dd>
            </div>
          </dl>
          <p className="pa-muted pa-note">{formatNumber(staff.length)} akun staff ({formatNumber(staff.filter((member) => member.is_active).length)} aktif)</p>
        </Card>

        <Card>
          <CardHeader title="Pemakaian" description={`Batas paket ${effective.name} yang berlaku`} />
          <ul className="fin-bars">
            {LIMITS.map((item) => {
              const used = Number(usage?.[item.key] ?? 0)
              const limit = effective.limits?.[item.key]
              const ratio = limit ? Math.min(used / limit, 1) : 0
              return (
                <li key={item.key}>
                  <span className="fin-bars-label"><span>{item.label}</span><span className="tabular">{formatNumber(used)}{limit ? ` / ${formatNumber(limit)}` : ' · tanpa batas'}</span></span>
                  {limit ? <span className="fin-bars-track" aria-hidden="true"><span className={ratio >= 1 ? 'is-full' : ''} style={{ width: `${Math.max(ratio * 100, 2)}%` }} /></span> : null}
                </li>
              )
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Modul" description={`Paket ${effective.name}`} />
          <ul className="sub-features pa-features">
            {FEATURES.map((item) => {
              const on = effective.features?.includes(item.key)
              return (
                <li key={item.key} className={on ? '' : 'is-off'}>
                  {on ? <Check size={16} aria-hidden="true" /> : <Minus size={16} aria-hidden="true" />}
                  <span>{item.label}</span>
                  <span className="sr-only">{on ? 'aktif' : 'tidak aktif'}</span>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>

      <Card padding="none">
        <div className="table-card-head"><CardHeader title="Tagihan" description="Tagihan kafe ini, terbaru di atas" /></div>
        {invoices.rows.length === 0
          ? <EmptyState compact title="Belum ada tagihan" description="Buat tagihan dari kartu Langganan." />
          : <InvoiceTable rows={invoices.rows} showCafe={false} onChanged={reload} />}
      </Card>

      {outbox && (
        <Card padding="none">
          <div className="table-card-head"><CardHeader title="Status email" description="Email notifikasi ke owner kafe ini (30 terakhir)" /></div>
          {outbox.length === 0
            ? <EmptyState compact title="Belum ada email" description="Pengingat tagihan & masa coba dikirim otomatis lewat Edge Function notify." />
            : <OutboxTable rows={outbox} />}
        </Card>
      )}

      <Card padding="none">
        <div className="table-card-head"><CardHeader title="Log audit" description="30 aksi terakhir untuk kafe ini" actions={<Link to={`/audit?kafe=${cafe.id}`} className="link-button">Semua</Link>} /></div>
        {audit.rows.length === 0 ? <EmptyState compact title="Belum ada aksi" /> : <AuditTable rows={audit.rows} showCafe={false} />}
      </Card>

      {dialog?.type === 'plan' && <ChangePlanDialog {...dialogProps} />}
      {dialog?.type === 'extend' && <ExtendDialog {...dialogProps} />}
      {dialog?.type === 'trial' && <TrialDialog {...dialogProps} />}
      {dialog?.type === 'invoice' && <InvoiceDialog {...dialogProps} />}
      {dialog?.type === 'suspend' && <SuspendDialog {...dialogProps} />}
      {dialog?.type === 'password' && <ResetPasswordDialog {...dialogProps} member={dialog.member} />}
      {dialog?.type === 'whatsapp' && <OwnerWhatsAppDialog {...dialogProps} />}
    </div>
  )
}
