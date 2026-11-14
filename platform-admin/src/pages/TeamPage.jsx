/*
 * Tim admin (file SQL 18): undang anggota (Edge Function platform-admin → invite_admin), ganti peran, nonaktifkan.
 * Khusus Super admin — ditegakkan di database (pa_admins_list / pa_admin_update) & Edge Function (pa_admin_can).
 */
import { useCallback, useState } from 'react'
import { Copy, KeyRound, ShieldCheck, ShieldOff, UserPlus, Users } from 'lucide-react'
import { useAuth } from '../auth/useAuth.js'
import {
  Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, PageHeader, Select, SkeletonRows, TextField, useToast,
} from '../components/ui/index.js'
import { optional, platformAction, rpc, useLoader } from '../lib/api.js'
import { formatDateTime } from '../lib/format.js'
import { ROLE_META } from '../lib/roles.js'

const ROLE_OPTIONS = Object.entries(ROLE_META).map(([value, meta]) => ({ value, label: meta.label }))

function tempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint32Array(14)
  window.crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('')
}

export function TeamPage() {
  const { toast } = useToast()
  const { refresh } = useAuth()
  const load = useCallback(() => optional(rpc('pa_admins_list')), [])
  const { data, error, loading, reload } = useLoader(load)
  const [inviting, setInviting] = useState(false)
  const [toggling, setToggling] = useState(null)

  async function changeRole(member, role) {
    try {
      await rpc('pa_admin_update', { p_user: member.user_id, p_role: role })
      toast({ title: 'Peran diganti', description: `${member.full_name} sekarang ${ROLE_META[role].label}.` })
      reload()
      refresh()
    } catch (caught) {
      toast({ tone: 'danger', title: 'Peran tidak diganti', description: caught.message })
    }
  }

  if (error) return <div className="page"><PageHeader title="Tim admin" /><ErrorState message={error} onRetry={reload} /></div>
  return (
    <div className="page pa-stack">
      <PageHeader eyebrow="Sistem" title="Tim admin" description="Siapa saja yang bisa membuka dashboard platform, dan sebatas apa."
        actions={<Button icon={UserPlus} onClick={() => setInviting(true)} disabled={!data}>Undang anggota</Button>} />

      <div className="team-roles">
        {Object.entries(ROLE_META).map(([key, meta]) => (
          <Card key={key} className="team-role">
            <Badge tone={meta.tone}>{meta.label}</Badge>
            <p>{meta.description}</p>
          </Card>
        ))}
      </div>

      <Card padding="none">
        {loading && !data ? <div className="ov-card-body"><SkeletonRows rows={4} /></div>
          : data === null ? <EmptyState icon={Users} title="Belum aktif" description="Halaman ini aktif setelah file SQL 18 dijalankan." />
            : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th scope="col">Anggota</th><th scope="col">Peran</th><th scope="col">2FA</th><th scope="col">Masuk terakhir</th><th scope="col">Status</th><th scope="col" className="cell-actions"><span className="sr-only">Aksi</span></th></tr></thead>
                  <tbody>
                    {data.map((member) => (
                      <tr key={member.user_id}>
                        <td><span className="pa-cell-main"><strong>{member.full_name || '—'}{member.is_me ? ' (Anda)' : ''}</strong><small>{member.email}</small></span></td>
                        <td>
                          {member.is_me ? <Badge tone={ROLE_META[member.role]?.tone}>{ROLE_META[member.role]?.label}</Badge> : (
                            <Select label={`Peran ${member.full_name}`} hideLabel value={member.role} options={ROLE_OPTIONS} disabled={!member.is_active}
                              onChange={(event) => changeRole(member, event.target.value)} />
                          )}
                        </td>
                        <td>{member.mfa === null ? '—' : member.mfa ? <Badge tone="green">Aktif</Badge> : <Badge tone="amber">Belum</Badge>}</td>
                        <td>{member.last_sign_in_at ? formatDateTime(member.last_sign_in_at) : 'Belum pernah'}</td>
                        <td>{member.is_active ? <Badge tone="green">Aktif</Badge> : <Badge tone="neutral">Nonaktif</Badge>}</td>
                        <td className="cell-actions">
                          {!member.is_me && (
                            <Button size="sm" variant={member.is_active ? 'danger-soft' : 'secondary'} icon={member.is_active ? ShieldOff : ShieldCheck}
                              onClick={() => setToggling(member)}>{member.is_active ? 'Nonaktifkan' : 'Aktifkan'}</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </Card>
      <p className="ui-field-hint">Peran ditegakkan oleh database: menu yang disembunyikan tetap tidak bisa dipanggil langsung. Minimal satu Super admin aktif selalu dijaga.</p>

      {inviting && <InviteDialog onClose={() => setInviting(false)} onDone={() => { setInviting(false); reload() }} />}
      {toggling && (
        <ConfirmDialog
          title={toggling.is_active ? `Nonaktifkan ${toggling.full_name}?` : `Aktifkan ${toggling.full_name}?`}
          description={toggling.is_active ? 'Akun ini langsung tidak bisa membuka dashboard platform. Sesi lihat-sebagai miliknya diakhiri.' : 'Akun ini bisa masuk lagi dengan peran sebelumnya.'}
          confirmLabel={toggling.is_active ? 'Nonaktifkan' : 'Aktifkan'}
          tone={toggling.is_active ? 'danger' : 'primary'}
          onClose={() => setToggling(null)}
          onConfirm={async () => {
            await rpc('pa_admin_update', { p_user: toggling.user_id, p_active: !toggling.is_active })
            toast({ title: toggling.is_active ? 'Anggota dinonaktifkan' : 'Anggota diaktifkan' })
            setToggling(null)
            reload()
          }}
        />
      )}
    </div>
  )
}

function InviteDialog({ onClose, onDone }) {
  const { toast } = useToast()
  const [form, setForm] = useState({ email: '', full_name: '', role: 'support', password: tempPassword() })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(null)
  const set = (key) => (event) => { setForm((current) => ({ ...current, [key]: event.target.value })); setErrors({}) }

  async function submit(event) {
    event.preventDefault()
    const next = {}
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = 'Email tidak valid'
    if (form.full_name.trim().length < 2) next.full_name = 'Nama minimal 2 karakter'
    if (form.password.length < 8) next.password = 'Minimal 8 karakter'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      await platformAction('invite_admin', { ...form, email: form.email.trim() })
      setCreated(form)
    } catch (caught) {
      setErrors({ form: caught.message })
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Dashboard platform Dailybrew\nEmail: ${created.email}\nPassword sementara: ${created.password}\nSaat pertama masuk, Anda diminta memasang 2FA.`)
      toast({ title: 'Disalin', description: 'Kirim lewat jalur pribadi, lalu minta ganti password.' })
    } catch {
      toast({ tone: 'danger', title: 'Gagal menyalin' })
    }
  }

  if (created) {
    return (
      <Dialog title="Anggota ditambahkan" size="sm" onClose={onDone}
        footer={<><Button variant="ghost" onClick={onDone}>Selesai</Button><Button icon={Copy} onClick={copy}>Salin info masuk</Button></>}>
        <dl className="fin-position">
          <div><dt>Email</dt><dd>{created.email}</dd></div>
          <div><dt>Peran</dt><dd>{ROLE_META[created.role].label}</dd></div>
          <div><dt>Password sementara</dt><dd className="tabular">{created.password}</dd></div>
        </dl>
        <p className="ui-field-hint">Password ini hanya tampil sekali. Saat pertama masuk, anggota wajib memasang 2FA.</p>
      </Dialog>
    )
  }
  return (
    <Dialog title="Undang anggota tim" size="sm" onClose={busy ? undefined : onClose} dismissible={!busy}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="invite-form" loading={busy} icon={UserPlus}>Buat akun</Button></>}>
      <form id="invite-form" className="dialog-form" onSubmit={submit} noValidate>
        <TextField label="Nama" value={form.full_name} maxLength={80} error={errors.full_name} onChange={set('full_name')} />
        <TextField label="Email" type="email" value={form.email} maxLength={254} error={errors.email} onChange={set('email')} />
        <Select label="Peran" value={form.role} options={ROLE_OPTIONS} onChange={set('role')} hint={ROLE_META[form.role].description} />
        <TextField label="Password sementara" value={form.password} error={errors.password} onChange={set('password')}
          suffix={<button type="button" className="pa-inline-btn" onClick={() => setForm((current) => ({ ...current, password: tempPassword() }))} aria-label="Buat password baru"><KeyRound size={16} aria-hidden="true" /></button>} />
        {errors.form && <p className="ui-field-error" role="alert">{errors.form}</p>}
      </form>
    </Dialog>
  )
}
