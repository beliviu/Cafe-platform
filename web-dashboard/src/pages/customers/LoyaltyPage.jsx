/*
 * Pelanggan → Loyalti & voucher (file 08): daftar member & penyesuaian poin, voucher, aturan program poin.
 */
import { useCallback, useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { Gift, Pencil, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import {
  Badge, Button, Card, CardHeader, Dialog, Drawer, EmptyState, ErrorState, IconButton, PageHeader, RupiahInput, SearchInput, SegmentedControl,
  Select, SkeletonRows, StatCard, Switch, TextField, useToast,
} from '../../components/ui/index.js'
import { CUSTOMER_REQUIRED, friendlyError } from '../../lib/db.js'
import { formatDate, formatNumber, formatRelative, formatRupiah } from '../../lib/format.js'
import { useLoader } from '../../lib/inventory.js'
import { rpc } from '../../lib/pos.js'

const TABS = [
  { value: 'members', label: 'Member' },
  { value: 'vouchers', label: 'Voucher' },
  { value: 'program', label: 'Program poin' },
]

export function LoyaltyPage() {
  const { cafe, features } = useOutletContext()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((item) => item.value === params.get('tab')) ? params.get('tab') : 'members'
  return (
    <div className="page page-wide">
      <PageHeader eyebrow="Pelanggan" title="Loyalti & voucher" description="Poin, tingkat member, dan promo untuk pelanggan aplikasi." />
      {!features?.customer ? <Card><EmptyState title="Belum tersedia" description={CUSTOMER_REQUIRED} /></Card> : (
        <div className="inv-page">
          <section className="toolbar" aria-label="Bagian loyalti">
            <SegmentedControl label="Bagian" value={tab} onChange={(value) => setParams({ tab: value }, { replace: true })} options={TABS} />
          </section>
          {tab === 'members' && <Members cafe={cafe} />}
          {tab === 'vouchers' && <Vouchers cafe={cafe} />}
          {tab === 'program' && <Program cafe={cafe} />}
        </div>
      )}
    </div>
  )
}

/* ---------- Member ---------- */

function Members({ cafe }) {
  const { supabase } = useAuth()
  const [query, setQuery] = useState('')
  const [adjusting, setAdjusting] = useState(null)
  const load = useCallback(async () => {
    const [members, settings] = await Promise.all([
      rpc(supabase, 'loyalty_customers', { p_cafe_id: cafe.id }),
      supabase.from('cafe_settings').select('loyalty_enabled').eq('cafe_id', cafe.id).maybeSingle(),
    ])
    return { members: members || [], enabled: Boolean(settings.data?.loyalty_enabled) }
  }, [cafe.id, supabase])
  const { data, error, reload, loading } = useLoader(load)
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id')
    return (data?.members || []).filter((member) => !needle || (member.full_name || '').toLocaleLowerCase('id').includes(needle))
  }, [data, query])

  if (error) return <Card><ErrorState message={error} onRetry={reload} /></Card>
  const members = data?.members || []
  const outstanding = members.reduce((sum, member) => sum + member.points_balance, 0)
  return (
    <>
      {data && !data.enabled && (
        <div className="inv-alert" role="status"><Gift size={18} aria-hidden="true" /><div><strong>Program poin belum aktif</strong><p>Pelanggan belum mendapat poin. Nyalakan di tab Program poin.</p></div></div>
      )}
      <section className="dash-stats inv-stats" aria-label="Ringkasan member">
        <StatCard label="Member" value={formatNumber(members.length)} caption="Pelanggan dengan akun poin" loading={!data} />
        <StatCard tone="neutral" label="Poin beredar" value={formatNumber(outstanding)} caption="Belum ditukar" loading={!data} />
        <StatCard tone="neutral" label="Belanja member" value={formatRupiah(members.reduce((sum, member) => sum + Number(member.lifetime_spend), 0))} caption="Sepanjang waktu" loading={!data} />
      </section>
      <section className="toolbar" aria-label="Cari member">
        <SearchInput value={query} onChange={setQuery} placeholder="Cari nama member…" label="Cari member" className="toolbar-search" />
      </section>
      <Card padding="none" className={`table-card${loading && data ? ' is-refreshing' : ''}`}>
        {!data ? <SkeletonRows rows={5} label="Memuat member" /> : !members.length ? (
          <EmptyState icon={Gift} title="Belum ada member" description="Member muncul setelah pelanggan menyelesaikan pesanan saat program poin aktif." />
        ) : !rows.length ? <EmptyState compact title="Tidak ada yang cocok" description="Ubah kata kunci." /> : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th scope="col">Member</th><th scope="col">Tingkat</th><th scope="col" className="num">Poin</th><th scope="col" className="num">Belanja</th><th scope="col" className="num">Pesanan</th><th scope="col">Terakhir</th><th scope="col"><span className="sr-only">Aksi</span></th></tr></thead>
              <tbody>
                {rows.map((member) => (
                  <tr key={member.customer_id}>
                    <td><strong>{member.full_name || 'Pelanggan'}</strong></td>
                    <td><Badge tone="brand" size="sm" dot={false}>{member.tier || '—'}</Badge></td>
                    <td className="num tabular">{formatNumber(member.points_balance)}</td>
                    <td className="num tabular">{formatRupiah(member.lifetime_spend)}</td>
                    <td className="num tabular">{formatNumber(member.orders)}</td>
                    <td className="nowrap">{member.last_order_at ? formatRelative(member.last_order_at) : '—'}</td>
                    <td className="cell-actions"><Button size="sm" variant="ghost" onClick={() => setAdjusting(member)}>Sesuaikan poin</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {adjusting && <AdjustDialog cafe={cafe} member={adjusting} onClose={() => setAdjusting(null)} onSaved={reload} />}
    </>
  )
}

function AdjustDialog({ cafe, member, onClose, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [direction, setDirection] = useState('add')
  const [points, setPoints] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    const value = Number(points)
    if (!Number.isInteger(value) || value <= 0) return setError('Isi jumlah poin')
    if (note.trim().length < 3) return setError('Tulis alasan')
    setSaving(true)
    try {
      await rpc(supabase, 'loyalty_adjust', { p_cafe_id: cafe.id, p_customer_id: member.customer_id, p_points: direction === 'add' ? value : -value, p_note: note.trim() })
      toast({ tone: 'success', title: 'Poin disesuaikan', description: `${member.full_name || 'Member'} ${direction === 'add' ? '+' : '−'}${formatNumber(value)} poin` })
      onSaved()
      onClose()
    } catch (caught) {
      setError(caught.message)
      setSaving(false)
    }
    return undefined
  }

  return (
    <Dialog size="sm" title={`Sesuaikan poin · ${member.full_name || 'Member'}`} description={`Saldo sekarang ${formatNumber(member.points_balance)} poin. Tercatat di riwayat poin pelanggan.`}
      onClose={saving ? undefined : onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button><Button onClick={submit} loading={saving}>Simpan</Button></>}>
      <div className="inv-form">
        <SegmentedControl label="Arah" value={direction} onChange={setDirection} options={[{ value: 'add', label: 'Tambah' }, { value: 'remove', label: 'Kurangi' }]} />
        <TextField label="Jumlah poin" inputMode="numeric" value={points} onChange={(event) => { setPoints(event.target.value.replace(/\D/g, '')); setError('') }} />
        <TextField label="Alasan" value={note} maxLength={200} placeholder="Mis. kompensasi pesanan terlambat" onChange={(event) => { setNote(event.target.value); setError('') }} />
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}

/* ---------- Voucher ---------- */

const VOUCHER_COLUMNS = 'id, code, name, discount_type, discount_value, max_discount, min_subtotal, starts_at, ends_at, usage_limit, per_customer_limit, is_public, is_active, created_at'

function voucherState(voucher) {
  const now = new Date().toISOString()
  if (!voucher.is_active) return { label: 'Nonaktif', tone: 'neutral' }
  if (voucher.starts_at && voucher.starts_at > now) return { label: 'Terjadwal', tone: 'blue' }
  if (voucher.ends_at && voucher.ends_at <= now) return { label: 'Berakhir', tone: 'neutral' }
  return { label: 'Berlaku', tone: 'green' }
}

function Vouchers({ cafe }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [editing, setEditing] = useState(null)
  const load = useCallback(async () => {
    const [vouchers, uses] = await Promise.all([
      supabase.from('vouchers').select(VOUCHER_COLUMNS).eq('cafe_id', cafe.id).order('created_at', { ascending: false }),
      supabase.from('voucher_redemptions').select('voucher_id, amount, status').eq('cafe_id', cafe.id).eq('status', 'applied'),
    ])
    const failure = vouchers.error || uses.error
    if (failure) throw new Error(friendlyError(failure))
    const usage = new Map()
    for (const row of uses.data || []) {
      const entry = usage.get(row.voucher_id) || { count: 0, total: 0 }
      usage.set(row.voucher_id, { count: entry.count + 1, total: entry.total + Number(row.amount) })
    }
    return { vouchers: vouchers.data || [], usage }
  }, [cafe.id, supabase])
  const { data, error, reload, loading } = useLoader(load)

  async function toggle(voucher, value) {
    const { error: saveError } = await supabase.from('vouchers').update({ is_active: value }).eq('id', voucher.id).select('id').maybeSingle()
    if (saveError) toast({ tone: 'error', title: 'Gagal mengubah voucher', description: friendlyError(saveError) })
    else reload()
  }

  if (error) return <Card><ErrorState message={error} onRetry={reload} /></Card>
  return (
    <>
      <section className="toolbar" aria-label="Aksi voucher">
        <span className="text-muted">Pelanggan memasukkan kode di checkout. Diskon dihitung & dicek ulang oleh database.</span>
        <Button icon={Plus} className="toolbar-end" onClick={() => setEditing({})}>Buat voucher</Button>
      </section>
      <Card padding="none" className={`table-card${loading && data ? ' is-refreshing' : ''}`}>
        {!data ? <SkeletonRows rows={4} label="Memuat voucher" /> : !data.vouchers.length ? (
          <EmptyState icon={Gift} title="Belum ada voucher" description="Buat promo seperti diskon 10% atau potongan Rp5.000 untuk pelanggan app."
            action={<Button icon={Plus} onClick={() => setEditing({})}>Buat voucher</Button>} />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th scope="col">Kode</th><th scope="col">Diskon</th><th scope="col">Syarat</th><th scope="col">Periode</th><th scope="col" className="num">Dipakai</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Aksi</span></th></tr></thead>
              <tbody>
                {data.vouchers.map((voucher) => {
                  const state = voucherState(voucher)
                  const usage = data.usage.get(voucher.id) || { count: 0, total: 0 }
                  return (
                    <tr key={voucher.id} className={voucher.is_active ? '' : 'is-muted'}>
                      <td><span className="inv-name"><strong className="tabular">{voucher.code}</strong><small>{voucher.name}{voucher.is_public ? ' · tampil di app' : ' · kode rahasia'}</small></span></td>
                      <td className="nowrap">{voucher.discount_type === 'percent' ? `${Number(voucher.discount_value)}%` : formatRupiah(voucher.discount_value)}{voucher.max_discount ? <small className="cell-sub">maks. {formatRupiah(voucher.max_discount)}</small> : null}</td>
                      <td>{Number(voucher.min_subtotal) ? `Min. ${formatRupiah(voucher.min_subtotal)}` : 'Tanpa minimal'}<small className="cell-sub">{voucher.per_customer_limit}× per pelanggan{voucher.usage_limit ? ` · kuota ${voucher.usage_limit}` : ''}</small></td>
                      <td className="nowrap">{voucher.starts_at || voucher.ends_at ? `${voucher.starts_at ? formatDate(voucher.starts_at) : 'Sekarang'} – ${voucher.ends_at ? formatDate(voucher.ends_at) : 'seterusnya'}` : 'Tanpa batas'}</td>
                      <td className="num tabular">{formatNumber(usage.count)}{usage.total ? <small className="cell-sub">{formatRupiah(usage.total)}</small> : null}</td>
                      <td><Badge tone={state.tone} size="sm">{state.label}</Badge></td>
                      <td className="cell-actions">
                        <Switch size="sm" checked={voucher.is_active} onChange={(value) => toggle(voucher, value)} label={`Voucher ${voucher.code} aktif`} />
                        <IconButton icon={Pencil} size="sm" label={`Ubah ${voucher.code}`} onClick={() => setEditing(voucher)} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <VoucherDrawer cafe={cafe} voucher={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={reload} />}
    </>
  )
}

const toLocalInput = (iso) => (iso ? new Date(new Date(iso).getTime() + 7 * 3600000).toISOString().slice(0, 16) : '')
const fromLocalInput = (value) => (value ? new Date(`${value}:00+07:00`).toISOString() : null)

function VoucherDrawer({ cafe, voucher, onClose, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [form, setForm] = useState(() => ({
    code: voucher?.code || '', name: voucher?.name || '', discount_type: voucher?.discount_type || 'percent', discount_value: voucher ? String(Number(voucher.discount_value)) : '',
    max_discount: voucher?.max_discount ? Number(voucher.max_discount) : '', min_subtotal: voucher ? Number(voucher.min_subtotal) || '' : '',
    starts_at: toLocalInput(voucher?.starts_at), ends_at: toLocalInput(voucher?.ends_at), usage_limit: voucher?.usage_limit ? String(voucher.usage_limit) : '',
    per_customer_limit: String(voucher?.per_customer_limit || 1), is_public: voucher?.is_public ?? true, is_active: voucher?.is_active ?? true,
  }))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (key) => (value) => { setForm((current) => ({ ...current, [key]: value?.target ? value.target.value : value })); setError('') }

  async function submit(event) {
    event.preventDefault()
    const code = form.code.trim().toUpperCase()
    const value = Number(String(form.discount_value).replace(',', '.'))
    if (!/^[A-Z0-9_-]{3,20}$/.test(code)) return setError('Kode 3–20 karakter: huruf besar, angka, - atau _')
    if (form.name.trim().length < 3) return setError('Tulis nama promo')
    if (!(value > 0) || (form.discount_type === 'percent' && value > 100)) return setError(form.discount_type === 'percent' ? 'Persen 1–100' : 'Isi nominal diskon')
    if (form.starts_at && form.ends_at && form.ends_at <= form.starts_at) return setError('Tanggal berakhir harus setelah mulai')
    setSaving(true)
    const row = {
      cafe_id: cafe.id, code, name: form.name.trim(), discount_type: form.discount_type, discount_value: value,
      max_discount: form.discount_type === 'percent' && Number(form.max_discount) > 0 ? Number(form.max_discount) : null,
      min_subtotal: Number(form.min_subtotal) || 0, starts_at: fromLocalInput(form.starts_at), ends_at: fromLocalInput(form.ends_at),
      usage_limit: Number(form.usage_limit) > 0 ? Number(form.usage_limit) : null, per_customer_limit: Math.max(1, Number(form.per_customer_limit) || 1),
      is_public: form.is_public, is_active: form.is_active,
    }
    const result = voucher
      ? await supabase.from('vouchers').update(row).eq('id', voucher.id).select('id').maybeSingle()
      : await supabase.from('vouchers').insert(row).select('id').maybeSingle()
    setSaving(false)
    if (result.error) return setError(result.error.code === '23505' ? `Kode ${code} sudah dipakai` : friendlyError(result.error))
    toast({ tone: 'success', title: voucher ? 'Voucher diperbarui' : 'Voucher dibuat', description: code })
    onSaved()
    onClose()
    return undefined
  }

  return (
    <Drawer title={voucher ? `Ubah ${voucher.code}` : 'Buat voucher'} description="Diskon dipotong dari subtotal sebelum pajak & service." onClose={saving ? undefined : onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button><Button type="submit" form="voucher-form" loading={saving}>Simpan</Button></>}>
      <form id="voucher-form" className="inv-form" onSubmit={submit} noValidate>
        <div className="inv-form-row">
          <TextField label="Kode" value={form.code} maxLength={20} placeholder="NGOPI10" onChange={(event) => set('code')(event.target.value.toUpperCase().replace(/\s/g, ''))} />
          <Select label="Jenis" value={form.discount_type} onChange={set('discount_type')} options={[{ value: 'percent', label: 'Persen (%)' }, { value: 'amount', label: 'Nominal (Rp)' }]} />
        </div>
        <TextField label="Nama promo (tampil di app)" value={form.name} maxLength={80} placeholder="Diskon 10% semua menu" onChange={set('name')} />
        <div className="inv-form-row">
          {form.discount_type === 'percent'
            ? <TextField label="Diskon" suffix="%" inputMode="decimal" value={form.discount_value} onChange={(event) => set('discount_value')(event.target.value.replace(/[^\d,.]/g, ''))} />
            : <RupiahInput label="Potongan" value={form.discount_value} onChange={set('discount_value')} />}
          {form.discount_type === 'percent' ? <RupiahInput label="Maksimal potongan" value={form.max_discount} onChange={set('max_discount')} hint="Kosong = tanpa batas" /> : <span />}
        </div>
        <div className="inv-form-row">
          <RupiahInput label="Minimal belanja" value={form.min_subtotal} onChange={set('min_subtotal')} hint="Kosong = tanpa minimal" />
          <TextField label="Per pelanggan" suffix="kali" inputMode="numeric" value={form.per_customer_limit} onChange={(event) => set('per_customer_limit')(event.target.value.replace(/\D/g, ''))} />
        </div>
        <div className="inv-form-row">
          <TextField label="Mulai (WIB)" type="datetime-local" value={form.starts_at} onChange={set('starts_at')} hint="Kosong = langsung berlaku" />
          <TextField label="Berakhir (WIB)" type="datetime-local" value={form.ends_at} onChange={set('ends_at')} hint="Kosong = tanpa batas" />
        </div>
        <TextField label="Kuota total" suffix="pemakaian" inputMode="numeric" value={form.usage_limit} placeholder="Tanpa batas" onChange={(event) => set('usage_limit')(event.target.value.replace(/\D/g, ''))} />
        <div className="inv-switch-line">
          <span><strong>Tampilkan di app</strong><small>Mati = kode rahasia (hanya yang tahu kodenya, mis. dari Instagram).</small></span>
          <Switch checked={form.is_public} onChange={set('is_public')} label="Tampilkan di app" />
        </div>
        <div className="inv-switch-line">
          <span><strong>Aktif</strong><small>Voucher nonaktif tidak bisa dipakai.</small></span>
          <Switch checked={form.is_active} onChange={set('is_active')} label="Voucher aktif" />
        </div>
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Drawer>
  )
}

/* ---------- Program poin ---------- */

const PROGRAM_KEYS = 'loyalty_enabled, loyalty_spend_per_point, loyalty_point_value, loyalty_min_redeem, loyalty_max_redeem_pct, loyalty_tiers'

function Program({ cafe }) {
  const { supabase } = useAuth()
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('cafe_settings').select(PROGRAM_KEYS).eq('cafe_id', cafe.id).maybeSingle()
    if (error) throw new Error(friendlyError(error))
    return data
  }, [cafe.id, supabase])
  const { data, error, reload } = useLoader(load)
  if (error) return <Card><ErrorState message={error} onRetry={reload} /></Card>
  if (!data) return <Card><SkeletonRows rows={5} label="Memuat program" /></Card>
  return <ProgramForm key={JSON.stringify(data)} cafe={cafe} settings={data} onSaved={reload} />
}

let tierSeed = 0
const tierRow = (tier = {}) => ({ key: `t${(tierSeed += 1)}`, name: tier.name || '', min_spend: tier.min_spend ?? '', multiplier: tier.multiplier ? String(tier.multiplier) : '1' })

function ProgramForm({ cafe, settings, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [form, setForm] = useState(() => ({
    enabled: settings.loyalty_enabled, spend: Number(settings.loyalty_spend_per_point), value: Number(settings.loyalty_point_value),
    min: String(settings.loyalty_min_redeem), pct: String(settings.loyalty_max_redeem_pct),
  }))
  const [tiers, setTiers] = useState(() => (settings.loyalty_tiers || []).map(tierRow))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (key) => (value) => { setForm((current) => ({ ...current, [key]: value })); setError('') }
  const updateTier = (key, patch) => { setTiers((current) => current.map((tier) => (tier.key === key ? { ...tier, ...patch } : tier))); setError('') }

  async function save(event) {
    event.preventDefault()
    const spend = Number(form.spend)
    const value = Number(form.value)
    const min = Number(form.min)
    const pct = Number(form.pct)
    if (!(spend >= 1000)) return setError('Belanja per poin minimal Rp1.000')
    if (!(value >= 1)) return setError('Isi nilai 1 poin')
    if (!Number.isInteger(min) || min < 1) return setError('Minimal tukar ≥ 1 poin')
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) return setError('Maksimal potongan 1–100%')
    const cleaned = tiers.map((tier) => ({ name: tier.name.trim(), min_spend: Number(tier.min_spend) || 0, multiplier: Number(String(tier.multiplier).replace(',', '.')) }))
    if (!cleaned.length || cleaned.length > 6) return setError('Isi 1–6 tingkat')
    if (cleaned.some((tier) => tier.name.length < 2 || !(tier.multiplier >= 1 && tier.multiplier <= 5))) return setError('Setiap tingkat butuh nama dan pengali 1–5')
    if (!cleaned.some((tier) => tier.min_spend === 0)) return setError('Harus ada tingkat awal dengan belanja Rp0')
    if (new Set(cleaned.map((tier) => tier.min_spend)).size !== cleaned.length) return setError('Batas belanja tiap tingkat harus berbeda')
    setSaving(true)
    const { error: saveError } = await supabase.from('cafe_settings').update({
      loyalty_enabled: form.enabled, loyalty_spend_per_point: spend, loyalty_point_value: value, loyalty_min_redeem: min, loyalty_max_redeem_pct: pct,
      loyalty_tiers: cleaned.sort((a, b) => a.min_spend - b.min_spend),
    }).eq('cafe_id', cafe.id).select('cafe_id').maybeSingle()
    setSaving(false)
    if (saveError) return setError(friendlyError(saveError))
    toast({ tone: 'success', title: 'Program poin disimpan' })
    onSaved()
    return undefined
  }

  const returnRate = form.spend ? (Number(form.value) / Number(form.spend)) * 100 : 0
  return (
    <form className="fin-grid is-wide-left" onSubmit={save} noValidate>
      <Card className="settings-card">
        <CardHeader title="Aturan poin" description="Poin didapat saat pesanan app selesai, dikurangi saat refund, dan dikembalikan bila pesanan yang memakai poin dibatalkan." />
        <div className="inv-form">
          <div className="inv-switch-line">
            <span><strong>Program poin aktif</strong><small>Mati = pelanggan tidak mendapat & tidak bisa menukar poin (saldo tetap tersimpan).</small></span>
            <Switch checked={form.enabled} onChange={set('enabled')} label="Program poin aktif" />
          </div>
          <div className="inv-form-row">
            <RupiahInput label="Belanja untuk 1 poin" value={form.spend} onChange={set('spend')} />
            <RupiahInput label="Nilai 1 poin saat ditukar" value={form.value} onChange={set('value')} />
          </div>
          <div className="inv-form-row">
            <TextField label="Minimal tukar" suffix="poin" inputMode="numeric" value={form.min} onChange={(event) => set('min')(event.target.value.replace(/\D/g, ''))} />
            <TextField label="Maksimal potongan" suffix="% belanja" inputMode="numeric" value={form.pct} onChange={(event) => set('pct')(event.target.value.replace(/\D/g, ''))} />
          </div>
          <p className="ui-field-hint">Pelanggan mendapat kembali ±{returnRate.toFixed(1).replace('.', ',')}% dari belanja (sebelum pengali tingkat). Potongan poin tercatat sebagai diskon penjualan di laporan.</p>
        </div>
      </Card>
      <Card className="settings-card">
        <CardHeader title="Tingkat member" description="Naik otomatis berdasarkan total belanja. Pengali memperbanyak poin." />
        <div className="loy-tiers">
          {tiers.map((tier) => (
            <div key={tier.key} className="loy-tier">
              <TextField hideLabel label="Nama tingkat" value={tier.name} maxLength={20} placeholder="Silver" onChange={(event) => updateTier(tier.key, { name: event.target.value })} />
              <RupiahInput hideLabel label="Belanja minimal" value={tier.min_spend} onChange={(value) => updateTier(tier.key, { min_spend: value })} />
              <TextField hideLabel label="Pengali" prefix="×" inputMode="decimal" value={tier.multiplier} onChange={(event) => updateTier(tier.key, { multiplier: event.target.value.replace(/[^\d,.]/g, '') })} />
              <IconButton icon={Trash2} size="sm" variant="danger" label={`Hapus tingkat ${tier.name}`} disabled={tiers.length <= 1} onClick={() => setTiers((current) => current.filter((item) => item.key !== tier.key))} />
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={Plus} disabled={tiers.length >= 6} onClick={() => setTiers((current) => [...current, tierRow()])}>Tambah tingkat</Button>
        </div>
        {error && <p className="ui-field-error" role="alert">{error}</p>}
        <div className="settings-actions"><Button type="submit" loading={saving}>Simpan program</Button></div>
      </Card>
    </form>
  )
}
