/*
 * Tim: anggota (akun staff), jadwal shift, log aktivitas.
 * Data: RPC cafe_team_members & owner_set_member_title, tabel staff_shifts & audit_logs (file 04),
 * akun staff lewat Edge Function staff-admin.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useOutletContext } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, Copy, KeyRound, MoreHorizontal, Pencil, Plus, RefreshCw, UserCheck, UserPlus, UserX,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, Dialog, EmptyState, ErrorState, IconButton, Menu, PageHeader, Select,
  SkeletonRows, TextField, useToast,
} from '../../components/ui/index.js'
import { friendlyError, PHASE3_REQUIRED } from '../../lib/db.js'
import {
  addDaysToKey, formatDateTime, formatRelative, formatRupiah, formatTime, initials, jakartaDateKey, startOfJakartaDay,
} from '../../lib/format.js'
import { fetchTeam, generatePassword, ROLE_LABELS, setMemberTitle, staffAdmin } from '../../lib/team.js'

const TABS = [
  { to: '.', label: 'Anggota', end: true },
  { to: 'shifts', label: 'Jadwal shift' },
  { to: 'activity', label: 'Log aktivitas' },
]

function useTeam(supabase, cafeId, enabled) {
  const [state, setState] = useState({ loading: Boolean(enabled), members: [], error: '' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    fetchTeam(supabase, cafeId)
      .then((members) => { if (active) setState({ loading: false, members, error: '' }) })
      .catch((error) => { if (active) setState({ loading: false, members: [], error: error.message }) })
    return () => { active = false }
  }, [attempt, cafeId, enabled, supabase])
  const reload = useCallback(() => setAttempt((value) => value + 1), [])
  return { ...state, reload }
}

export function TeamLayout() {
  const context = useOutletContext()
  const { supabase } = useAuth()
  const team = useTeam(supabase, context.cafe.id, Boolean(context.features?.phase3))
  return (
    <div className="page">
      <PageHeader eyebrow="Tim" title="Tim kafe" description="Akun staff, jadwal kerja, dan jejak perubahan data." />
      <nav className="settings-tabs" aria-label="Bagian tim">
        {TABS.map((tab) => (
          <NavLink key={tab.label} to={tab.to} end={tab.end} className={({ isActive }) => `settings-tab${isActive ? ' is-active' : ''}`}>{tab.label}</NavLink>
        ))}
      </nav>
      {context.features?.phase3
        ? <Outlet context={{ ...context, team }} />
        : <Card><EmptyState title="Belum tersedia" description={PHASE3_REQUIRED} /></Card>}
    </div>
  )
}

/* ====================================================================
 * Anggota
 * ==================================================================== */

function PasswordField({ value, onChange, label = 'Password awal' }) {
  const { toast } = useToast()
  return (
    <div className="password-field">
      <TextField label={label} value={value} onChange={(event) => onChange(event.target.value)} minLength={8} maxLength={72}
        hint="Minimal 8 karakter. Berikan ke staff; mereka bisa masuk dengan email & password ini." autoComplete="off" />
      <div className="password-tools">
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => onChange(generatePassword())}>Buat acak</Button>
        <Button size="sm" variant="ghost" icon={Copy} onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            toast({ tone: 'success', title: 'Password disalin' })
          } catch {
            toast({ tone: 'error', title: 'Tidak bisa menyalin', description: 'Salin manual dari kolom password.' })
          }
        }}>Salin</Button>
      </div>
    </div>
  )
}

function AddStaffDialog({ onClose, onCreated }) {
  const { supabase } = useAuth()
  const [form, setForm] = useState(() => ({ full_name: '', email: '', job_title: '', password: generatePassword() }))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(null)
  const set = (key) => (event) => { setForm((current) => ({ ...current, [key]: event.target.value })); setError('') }

  async function submit(event) {
    event.preventDefault()
    const values = { ...form, full_name: form.full_name.trim(), email: form.email.trim().toLowerCase(), job_title: form.job_title.trim() }
    if (values.full_name.length < 2) return setError('Nama minimal 2 karakter.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return setError('Email tidak valid.')
    if (values.password.length < 8) return setError('Password minimal 8 karakter.')
    setBusy(true)
    try {
      await staffAdmin(supabase, { action: 'create', ...values })
      setCreated(values)
      onCreated()
    } catch (caught) {
      setError(caught.message)
    }
    setBusy(false)
  }

  if (created) {
    return (
      <Dialog title="Akun staff dibuat" onClose={onClose} footer={<Button onClick={onClose}>Selesai</Button>}>
        <p className="dialog-copy">Berikan data masuk ini ke <strong>{created.full_name}</strong>. Password tidak bisa dilihat lagi setelah jendela ini ditutup.</p>
        <dl className="credential-box">
          <div><dt>Email</dt><dd>{created.email}</dd></div>
          <div><dt>Password</dt><dd><code>{created.password}</code></dd></div>
        </dl>
        <p className="settings-note">Staff masuk lewat halaman login web yang sama dan langsung diarahkan ke halaman Pesanan.</p>
      </Dialog>
    )
  }

  return (
    <Dialog
      title="Tambah staff"
      description="Akun dibuat langsung tanpa email undangan."
      onClose={busy ? undefined : onClose}
      dismissible={!busy}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="add-staff-form" loading={busy} icon={UserPlus}>Buat akun</Button></>}
    >
      <form id="add-staff-form" className="dialog-form" onSubmit={submit} noValidate>
        <TextField label="Nama lengkap" value={form.full_name} onChange={set('full_name')} maxLength={80} autoFocus />
        <TextField label="Email" type="email" value={form.email} onChange={set('email')} maxLength={254} autoComplete="off" />
        <TextField label="Jabatan" value={form.job_title} onChange={set('job_title')} maxLength={40} placeholder="Mis. Kasir, Barista, Kepala shift" list="job-titles" />
        <datalist id="job-titles"><option value="Kasir" /><option value="Barista" /><option value="Kepala shift" /><option value="Dapur" /></datalist>
        <PasswordField value={form.password} onChange={(value) => { setForm((current) => ({ ...current, password: value })); setError('') }} />
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}

function TitleDialog({ member, onClose, onSaved }) {
  const { supabase } = useAuth()
  const [value, setValue] = useState(member.job_title || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    try {
      await setMemberTitle(supabase, member.id, value)
      onSaved()
      onClose()
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
  }
  return (
    <Dialog title={`Jabatan ${member.full_name || ''}`} size="sm" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Batal</Button><Button type="submit" form="title-form" loading={busy}>Simpan</Button></>}>
      <form id="title-form" onSubmit={submit} noValidate>
        <TextField label="Jabatan" value={value} onChange={(event) => { setValue(event.target.value); setError('') }} maxLength={40} list="job-titles" autoFocus error={error} />
        <datalist id="job-titles"><option value="Kasir" /><option value="Barista" /><option value="Kepala shift" /><option value="Dapur" /></datalist>
      </form>
    </Dialog>
  )
}

function ResetPasswordDialog({ member, onClose }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [password, setPassword] = useState(() => generatePassword())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault()
    if (password.length < 8) return setError('Password minimal 8 karakter.')
    setBusy(true)
    try {
      await staffAdmin(supabase, { action: 'reset_password', user_id: member.id, password })
      toast({ tone: 'success', title: 'Password diganti', description: `Berikan password baru ke ${member.full_name}.` })
      onClose()
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
  }
  return (
    <Dialog title={`Reset password ${member.full_name || ''}`} onClose={busy ? undefined : onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="reset-form" loading={busy} icon={KeyRound}>Ganti password</Button></>}>
      <form id="reset-form" onSubmit={submit} noValidate>
        <PasswordField label="Password baru" value={password} onChange={(value) => { setPassword(value); setError('') }} />
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}

export function MembersPage() {
  const { team, profile } = useOutletContext()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [dialog, setDialog] = useState(null)

  async function setActive(member, active) {
    await staffAdmin(supabase, { action: active ? 'reactivate' : 'deactivate', user_id: member.id })
    toast({ tone: 'success', title: active ? `${member.full_name} aktif kembali` : `${member.full_name} dinonaktifkan` })
    team.reload()
  }

  const activeCount = team.members.filter((member) => member.is_active).length

  return (
    <Card padding="none">
      <div className="table-card-head">
        <CardHeader
          title="Anggota tim"
          description={team.loading ? 'Memuat…' : `${activeCount} aktif · ${team.members.length - activeCount} nonaktif`}
          actions={<Button icon={UserPlus} onClick={() => setDialog({ type: 'add' })}>Tambah staff</Button>}
        />
      </div>
      {team.loading ? <div className="table-card-body"><SkeletonRows rows={3} label="Memuat tim" /></div>
        : team.error ? <div className="table-card-body"><ErrorState compact message={team.error} onRetry={team.reload} /></div>
          : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Nama</th><th scope="col">Jabatan</th><th scope="col">Peran</th>
                    <th scope="col">Status</th><th scope="col">Terakhir masuk</th><th scope="col"><span className="sr-only">Aksi</span></th>
                  </tr>
                </thead>
                <tbody>
                  {team.members.map((member) => {
                    const isSelf = member.id === profile.id
                    const isStaff = member.role === 'staff'
                    return (
                      <tr key={member.id} className={member.is_active ? '' : 'is-muted'}>
                        <td>
                          <span className="member-cell">
                            <span className="member-avatar" aria-hidden="true">{initials(member.full_name || '?')}</span>
                            <span><strong>{member.full_name || 'Tanpa nama'}{isSelf ? ' (Anda)' : ''}</strong><small>{member.email || ''}</small></span>
                          </span>
                        </td>
                        <td>{member.job_title || <span className="text-muted">—</span>}</td>
                        <td><Badge tone={member.role === 'owner' ? 'brand' : 'neutral'} dot={false}>{ROLE_LABELS[member.role] || member.role}</Badge></td>
                        <td>{member.is_active ? <Badge tone="green">Aktif</Badge> : <Badge tone="neutral">Nonaktif</Badge>}</td>
                        <td className="text-muted">{member.last_sign_in_at ? formatRelative(member.last_sign_in_at) : 'Belum pernah'}</td>
                        <td className="cell-actions">
                          <Menu
                            label={`Aksi untuk ${member.full_name}`}
                            trigger={({ props }) => <IconButton icon={MoreHorizontal} label={`Aksi untuk ${member.full_name}`} size="sm" {...props} />}
                            items={[
                              { label: 'Ubah jabatan', icon: Pencil, onSelect: () => setDialog({ type: 'title', member }) },
                              ...(isStaff ? [
                                { label: 'Reset password', icon: KeyRound, onSelect: () => setDialog({ type: 'reset', member }) },
                                member.is_active
                                  ? { label: 'Nonaktifkan', icon: UserX, tone: 'danger', onSelect: () => setDialog({ type: 'deactivate', member }) }
                                  : { label: 'Aktifkan kembali', icon: UserCheck, onSelect: () => setActive(member, true).catch((error) => toast({ tone: 'error', title: 'Gagal mengaktifkan', description: error.message })) },
                              ] : []),
                            ]}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

      {dialog?.type === 'add' && <AddStaffDialog onClose={() => setDialog(null)} onCreated={team.reload} />}
      {dialog?.type === 'title' && <TitleDialog member={dialog.member} onClose={() => setDialog(null)} onSaved={team.reload} />}
      {dialog?.type === 'reset' && <ResetPasswordDialog member={dialog.member} onClose={() => setDialog(null)} />}
      {dialog?.type === 'deactivate' && (
        <ConfirmDialog
          title={`Nonaktifkan ${dialog.member.full_name}?`}
          description="Staff tidak bisa masuk lagi dan langsung kehilangan akses ke data kafe. Riwayat pesanan yang pernah diproses tetap tersimpan. Bisa diaktifkan kembali kapan saja."
          confirmLabel="Nonaktifkan"
          onConfirm={async () => { await setActive(dialog.member, false); setDialog(null) }}
          onClose={() => setDialog(null)}
        />
      )}
    </Card>
  )
}

/* ====================================================================
 * Jadwal shift
 * ==================================================================== */

const DAY_NAMES = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']

function weekStartKey(dateKey) {
  const weekday = (new Date(`${dateKey}T12:00:00Z`).getUTCDay() + 6) % 7 // 0 = Senin
  return addDaysToKey(dateKey, -weekday)
}

function shiftHours(shift) {
  return (new Date(shift.ends_at) - new Date(shift.starts_at)) / 3_600_000
}

function formatHours(hours) {
  return `${hours.toLocaleString('id-ID', { maximumFractionDigits: 1 })} jam`
}

/** Tanggal (YYYY-MM-DD) + jam (HH:MM) WIB → ISO. Jam selesai ≤ jam mulai berarti lewat tengah malam. */
function toRange(dateKey, start, end) {
  const startsAt = new Date(`${dateKey}T${start}:00+07:00`)
  let endsAt = new Date(`${dateKey}T${end}:00+07:00`)
  if (endsAt <= startsAt) endsAt = new Date(`${addDaysToKey(dateKey, 1)}T${end}:00+07:00`)
  return { starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() }
}

function ShiftDialog({ members, initial, cafeId, onClose, onSaved }) {
  const { supabase } = useAuth()
  const [form, setForm] = useState({ user_id: initial.userId || members[0]?.id || '', date: initial.dateKey, start: '08:00', end: '16:00', note: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key) => (event) => { setForm((current) => ({ ...current, [key]: event.target.value })); setError('') }
  const range = form.date && form.start && form.end ? toRange(form.date, form.start, form.end) : null
  const hours = range ? shiftHours(range) : 0

  async function submit(event) {
    event.preventDefault()
    if (!form.user_id || !range) return setError('Lengkapi karyawan, tanggal, dan jam.')
    if (hours > 16) return setError('Satu shift maksimal 16 jam.')
    setBusy(true)
    const { error: insertError } = await supabase.from('staff_shifts').insert({ cafe_id: cafeId, user_id: form.user_id, ...range, note: form.note.trim() || null })
    setBusy(false)
    if (insertError) return setError(friendlyError(insertError))
    onSaved()
    onClose()
  }

  return (
    <Dialog title="Tambah shift" size="sm" onClose={busy ? undefined : onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="shift-form" loading={busy}>Simpan shift</Button></>}>
      <form id="shift-form" className="dialog-form" onSubmit={submit} noValidate>
        <Select label="Karyawan" value={form.user_id} onChange={set('user_id')} options={members.map((member) => ({ value: member.id, label: member.full_name || 'Tanpa nama' }))} />
        <TextField label="Tanggal" type="date" value={form.date} onChange={set('date')} />
        <div className="dialog-row">
          <TextField label="Mulai" type="time" value={form.start} onChange={set('start')} />
          <TextField label="Selesai" type="time" value={form.end} onChange={set('end')} />
        </div>
        {range && <p className="ui-field-hint">{formatHours(hours)}{form.end <= form.start ? ' · selesai keesokan hari' : ''}</p>}
        <TextField label="Catatan" value={form.note} onChange={set('note')} maxLength={80} placeholder="Opsional, mis. buka toko" />
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}

export function ShiftsPage() {
  const { cafe, team } = useOutletContext()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [weekKey, setWeekKey] = useState(() => weekStartKey(jakartaDateKey()))
  const [state, setState] = useState({ loading: true, shifts: [], error: '' })
  const [attempt, setAttempt] = useState(0)
  const [dialog, setDialog] = useState(null)

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDaysToKey(weekKey, index)), [weekKey])
  const todayKey = jakartaDateKey()
  const members = team.members.filter((member) => member.is_active)

  useEffect(() => {
    let active = true
    supabase.from('staff_shifts')
      .select('id, user_id, starts_at, ends_at, note')
      .eq('cafe_id', cafe.id)
      .gte('starts_at', startOfJakartaDay(weekKey).toISOString())
      .lt('starts_at', startOfJakartaDay(addDaysToKey(weekKey, 7)).toISOString())
      .order('starts_at')
      .then(({ data, error }) => {
        if (active) setState({ loading: false, shifts: data || [], error: error ? friendlyError(error) : '' })
      })
    return () => { active = false }
  }, [attempt, cafe.id, supabase, weekKey])

  const reload = () => { setState((current) => ({ ...current, loading: true })); setAttempt((value) => value + 1) }

  async function removeShift(shift) {
    const { error } = await supabase.from('staff_shifts').delete().eq('id', shift.id)
    if (error) return toast({ tone: 'error', title: 'Shift gagal dihapus', description: friendlyError(error) })
    setState((current) => ({ ...current, shifts: current.shifts.filter((row) => row.id !== shift.id) }))
  }

  const byCell = new Map()
  const hoursByMember = new Map()
  for (const shift of state.shifts) {
    const key = `${shift.user_id}:${jakartaDateKey(shift.starts_at)}`
    byCell.set(key, [...(byCell.get(key) || []), shift])
    hoursByMember.set(shift.user_id, (hoursByMember.get(shift.user_id) || 0) + shiftHours(shift))
  }
  const rangeLabel = `${new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${days[0]}T00:00:00Z`))} – ${new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${days[6]}T00:00:00Z`))}`

  return (
    <Card padding="none">
      <div className="table-card-head">
        <CardHeader
          title="Jadwal minggu ini"
          description={rangeLabel}
          actions={(
            <div className="week-nav">
              <IconButton icon={ChevronLeft} label="Minggu sebelumnya" size="sm" variant="secondary" onClick={() => setWeekKey((key) => addDaysToKey(key, -7))} />
              <Button size="sm" variant="secondary" onClick={() => setWeekKey(weekStartKey(todayKey))}>Minggu ini</Button>
              <IconButton icon={ChevronRight} label="Minggu berikutnya" size="sm" variant="secondary" onClick={() => setWeekKey((key) => addDaysToKey(key, 7))} />
              <Button size="sm" icon={Plus} onClick={() => setDialog({ dateKey: days.includes(todayKey) ? todayKey : days[0] })} disabled={!members.length}>Tambah shift</Button>
            </div>
          )}
        />
      </div>
      {team.loading || state.loading ? <div className="table-card-body"><SkeletonRows rows={4} label="Memuat jadwal" /></div>
        : state.error || team.error ? <div className="table-card-body"><ErrorState compact message={state.error || team.error} onRetry={reload} /></div>
          : !members.length ? <div className="table-card-body"><EmptyState compact title="Belum ada anggota aktif" description="Tambahkan staff di tab Anggota terlebih dulu." /></div>
            : (
              <div className="table-scroll">
                <table className="data-table shift-table">
                  <thead>
                    <tr>
                      <th scope="col">Karyawan</th>
                      {days.map((day, index) => (
                        <th scope="col" key={day} className={day === todayKey ? 'is-today' : ''}>
                          {DAY_NAMES[index]} <span className="tabular">{Number(day.slice(8))}</span>
                        </th>
                      ))}
                      <th scope="col" className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member.id}>
                        <th scope="row">
                          <span className="member-cell">
                            <span className="member-avatar" aria-hidden="true">{initials(member.full_name || '?')}</span>
                            <span><strong>{member.full_name}</strong><small>{member.job_title || ROLE_LABELS[member.role]}</small></span>
                          </span>
                        </th>
                        {days.map((day) => {
                          const shifts = byCell.get(`${member.id}:${day}`) || []
                          return (
                            <td key={day} className={`shift-cell${day === todayKey ? ' is-today' : ''}`}>
                              {shifts.map((shift) => (
                                <Menu
                                  key={shift.id}
                                  label="Aksi shift"
                                  trigger={({ props }) => (
                                    <button type="button" className="shift-chip" title={shift.note || undefined} {...props}>
                                      <span className="tabular">{formatTime(shift.starts_at)}–{formatTime(shift.ends_at)}</span>
                                      {shift.note && <small>{shift.note}</small>}
                                    </button>
                                  )}
                                  items={[{ label: 'Hapus shift', tone: 'danger', onSelect: () => removeShift(shift) }]}
                                />
                              ))}
                              <button type="button" className="shift-add" aria-label={`Tambah shift ${member.full_name} ${day}`}
                                onClick={() => setDialog({ dateKey: day, userId: member.id })}>
                                <Plus size={14} aria-hidden="true" />
                              </button>
                            </td>
                          )
                        })}
                        <td className="num tabular">{hoursByMember.get(member.id) ? formatHours(hoursByMember.get(member.id)) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      {dialog && <ShiftDialog members={members} initial={dialog} cafeId={cafe.id} onClose={() => setDialog(null)} onSaved={reload} />}
    </Card>
  )
}

/* ====================================================================
 * Log aktivitas
 * ==================================================================== */

const ENTITY_LABELS = {
  cafes: 'info kafe',
  cafe_settings: 'pengaturan bisnis',
  categories: 'kategori',
  products: 'produk',
  product_option_groups: 'grup varian',
  product_options: 'pilihan varian',
  cafe_tables: 'meja',
  staff_shifts: 'shift',
  profiles: 'anggota tim',
  staff_account: 'akun staff',
  ingredients: 'bahan baku',
  suppliers: 'supplier',
  purchase_orders: 'purchase order',
  supplier_payments: 'pembayaran supplier',
  recipe: 'resep',
  cashier_sessions: 'sesi kasir',
  cash_movements: 'kas masuk/keluar',
  refunds: 'refund',
  accounts: 'akun keuangan',
  accounting_periods: 'periode akuntansi',
  accounting_setup: 'mulai pembukuan',
  journal_entries: 'jurnal',
  expenses: 'beban',
  vouchers: 'voucher',
}
const ACTION_LABELS = { insert: 'Menambah', update: 'Mengubah', delete: 'Menghapus' }
const FIELD_LABELS = {
  name: 'nama', price: 'harga', is_available: 'tersedia', description: 'deskripsi', category_id: 'kategori', image_url: 'foto',
  sort_order: 'urutan', app_name: 'nama tampilan', logo_url: 'logo', tagline: 'tagline', brand_color: 'warna brand',
  brand_color_2: 'warna gradasi', address: 'alamat', phone: 'telepon', opening_hours: 'jam buka',
  accepted_payment_methods: 'metode bayar', tax_enabled: 'pajak aktif', tax_rate: 'tarif pajak', tax_name: 'nama pajak',
  tax_inclusive: 'pajak termasuk harga', service_charge_enabled: 'service aktif', service_charge_rate: 'tarif service',
  service_charge_taxable: 'service kena pajak', rounding_unit: 'pembulatan', order_types: 'jenis pesanan',
  receipt_header: 'teks atas struk', receipt_footer: 'teks bawah struk', receipt_show_logo: 'logo di struk',
  receipt_show_address: 'alamat di struk', receipt_paper_mm: 'lebar kertas', label: 'nama meja', area: 'area',
  capacity: 'kursi', is_active: 'aktif', job_title: 'jabatan', role: 'peran', price_delta: 'harga tambahan',
  is_required: 'wajib', selection_type: 'jenis pilihan', is_default: 'bawaan', max_select: 'maks. pilihan',
  starts_at: 'mulai', ends_at: 'selesai', note: 'catatan', email: 'email', password: 'password',
  sku: 'kode', category: 'kategori', unit: 'satuan', min_stock: 'stok minimum', purchase_unit: 'kemasan beli',
  purchase_unit_size: 'isi kemasan', lead_time_days: 'waktu kirim (hari)', default_supplier_id: 'supplier utama',
  contact_name: 'kontak', ordering_paused: 'pesanan app dijeda', qr: 'QR meja', code: 'kode', discount_value: 'nilai diskon', is_public: 'tampil di app',
  cash_flow: 'kelompok arus kas', paid_on: 'tanggal lunas', dibalik: 'alasan pembalik', go_live: 'mulai pembukuan', total_aset: 'total aset awal',
  payment_terms_days: 'termin (hari)', notes: 'catatan', status: 'status', supplier_id: 'supplier',
  paid_amount: 'dibayar', voided_at: 'dibatalkan', baris_resep: 'baris resep',
}
const MONEY_FIELDS = new Set(['price', 'price_delta', 'paid_amount'])
const STATUS_VALUES = { draft: 'draf', ordered: 'dipesan', partial: 'diterima sebagian', received: 'diterima', cancelled: 'dibatalkan' }

function formatValue(field, value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'ya' : 'tidak'
  if (MONEY_FIELDS.has(field)) return formatRupiah(value)
  if (field === 'starts_at' || field === 'ends_at') return formatDateTime(value)
  if (field === 'logo_url' || field === 'image_url') return 'gambar'
  if (field === 'status' && STATUS_VALUES[value]) return STATUS_VALUES[value]
  if (field === 'default_supplier_id' || field === 'supplier_id') return 'diubah'
  if (field === 'voided_at') return formatDateTime(value)
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return 'diubah'
  const text = String(value)
  return text.length > 40 ? `${text.slice(0, 40)}…` : text
}

function describeChanges(log) {
  if (log.action !== 'update' || !log.changes) {
    if (log.entity === 'staff_account' && log.changes) {
      return Object.entries(log.changes).map(([field, value]) => `${FIELD_LABELS[field] || field}: ${formatValue(field, value)}`).join(' · ')
    }
    return ''
  }
  return Object.entries(log.changes)
    .filter(([field]) => !['id', 'cafe_id'].includes(field))
    .slice(0, 4)
    .map(([field, pair]) => {
      const [before, after] = Array.isArray(pair) ? pair : [null, pair]
      return `${FIELD_LABELS[field] || field}: ${formatValue(field, before)} → ${formatValue(field, after)}`
    })
    .join(' · ')
}

const PAGE_SIZE = 50

export function ActivityPage() {
  const { cafe, team } = useOutletContext()
  const { supabase } = useAuth()
  const [entity, setEntity] = useState('all')
  const [state, setState] = useState({ loading: true, logs: [], error: '', done: false })
  const [page, setPage] = useState(0)

  useEffect(() => {
    let active = true
    let query = supabase.from('audit_logs')
      .select('id, actor_id, action, entity, entity_id, label, changes, created_at')
      .eq('cafe_id', cafe.id)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (entity !== 'all') query = query.eq('entity', entity)
    query.then(({ data, error }) => {
      if (!active) return
      setState((current) => ({
        loading: false,
        logs: page === 0 ? data || [] : [...current.logs, ...(data || [])],
        error: error ? friendlyError(error) : '',
        done: (data || []).length < PAGE_SIZE,
      }))
    })
    return () => { active = false }
  }, [cafe.id, entity, page, supabase])

  const names = new Map(team.members.map((member) => [member.id, member.full_name]))

  return (
    <Card padding="none">
      <div className="table-card-head">
        <CardHeader
          title="Log aktivitas"
          description="Perubahan menu, pengaturan, meja, jadwal, dan akun staff. Hanya owner yang bisa melihat."
          actions={(
            <Select hideLabel label="Jenis data" value={entity}
              onChange={(event) => { setEntity(event.target.value); setPage(0); setState((current) => ({ ...current, loading: true })) }}
              options={[{ value: 'all', label: 'Semua data' }, ...Object.entries(ENTITY_LABELS).map(([value, label]) => ({ value, label: label[0].toUpperCase() + label.slice(1) }))]} />
          )}
        />
      </div>
      {state.loading && !state.logs.length ? <div className="table-card-body"><SkeletonRows rows={5} label="Memuat log" /></div>
        : state.error ? <div className="table-card-body"><ErrorState compact message={state.error} onRetry={() => { setPage(0); setState((current) => ({ ...current, loading: true })) }} /></div>
          : !state.logs.length ? <div className="table-card-body"><EmptyState compact title="Belum ada aktivitas" description="Perubahan berikutnya akan tercatat di sini secara otomatis." /></div>
            : (
              <>
                <ol className="activity-list">
                  {state.logs.map((log) => {
                    const detail = describeChanges(log)
                    const actor = log.actor_id ? names.get(log.actor_id) || 'Pengguna lain' : 'Sistem'
                    return (
                      <li key={log.id}>
                        <span className={`activity-dot is-${log.action}`} aria-hidden="true" />
                        <div className="activity-body">
                          <p>
                            <strong>{actor}</strong> {ACTION_LABELS[log.action]?.toLowerCase()} {ENTITY_LABELS[log.entity] || log.entity}
                            {log.label ? <> <q>{log.label}</q></> : null}
                          </p>
                          {detail && <p className="activity-detail">{detail}</p>}
                        </div>
                        <time className="activity-time" dateTime={log.created_at} title={formatDateTime(log.created_at)}>{formatRelative(log.created_at)}</time>
                      </li>
                    )
                  })}
                </ol>
                {!state.done && (
                  <div className="table-card-foot">
                    <Button variant="secondary" loading={state.loading} onClick={() => { setState((current) => ({ ...current, loading: true })); setPage((value) => value + 1) }}>
                      Muat lebih banyak
                    </Button>
                  </div>
                )}
              </>
            )}
    </Card>
  )
}
