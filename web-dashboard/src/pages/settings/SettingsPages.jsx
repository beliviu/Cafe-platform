/*
 * Tab Pengaturan: Umum, Operasional, Pajak & biaya, Struk.
 * (Meja ada di TablesSettings.jsx.)
 */
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth.js'
import { BrandingSection } from '../../components/settings/BrandingSection.jsx'
import {
  CafeInfoSection, OpeningHoursSection, PaymentMethodsSection, ProfileSection,
} from '../../components/settings/CafeSections.jsx'
import { SectionFooter } from '../../components/settings/SettingsShared.jsx'
import {
  Button, Card, CardHeader, EmptyState, ErrorState, RupiahInput, SegmentedControl, SkeletonRows, Switch, TextField, useToast,
} from '../../components/ui/index.js'
import { ORDER_TYPE_LABELS, saveCafeSettings } from '../../lib/cafeSettings.js'
import { PHASE3_REQUIRED } from '../../lib/db.js'
import { formatNumber, formatRupiah } from '../../lib/format.js'
import { computeCharges } from '../../lib/pricing.js'
import { brandOf } from '../../lib/branding.js'

/* ---------- Umum ---------- */

export function GeneralSettings() {
  const { cafe, profile, features, updateCafe, updateProfile } = useOutletContext()
  return (
    <div className="settings-stack">
      <BrandingSection
        key={`brand-${cafe.app_name}-${cafe.logo_url}-${cafe.tagline}-${cafe.brand_color}-${cafe.brand_color_2}`}
        cafe={cafe}
        features={features}
        onSaved={updateCafe}
      />
      <div className="settings-grid">
        <CafeInfoSection key={`info-${cafe.name}-${cafe.address}-${cafe.phone}-${cafe.description}`} cafe={cafe} features={features} onSaved={updateCafe} />
        <ProfileSection key={`profile-${profile.full_name}-${profile.phone}`} profile={profile} onSaved={updateProfile} />
      </div>
    </div>
  )
}

/* ---------- Bagian yang butuh cafe_settings ---------- */

function SettingsGate({ title, children }) {
  const { features, settingsState } = useOutletContext()
  if (!features?.phase3) {
    return <Card className="settings-card"><CardHeader title={title} /><EmptyState compact title="Belum tersedia" description={PHASE3_REQUIRED} /></Card>
  }
  if (settingsState.loading) return <Card className="settings-card"><SkeletonRows rows={3} label="Memuat pengaturan" /></Card>
  if (settingsState.error) return <Card className="settings-card"><ErrorState compact message={settingsState.error} onRetry={settingsState.reload} /></Card>
  return children(settingsState.settings, settingsState.replace)
}

/** Form kecil berbasis cafe_settings: simpan sebagian kolom, deteksi perubahan. */
function useSettingsForm(settings, keys, onSaved) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const initial = Object.fromEntries(keys.map((key) => [key, settings[key]]))
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const dirty = keys.some((key) => JSON.stringify(form[key]) !== JSON.stringify(initial[key]))

  async function save(values, successTitle) {
    setSaving(true)
    try {
      const saved = await saveCafeSettings(supabase, settings.cafe_id, values)
      onSaved(saved)
      toast({ tone: 'success', title: successTitle })
    } catch (caught) {
      toast({ tone: 'error', title: 'Pengaturan gagal disimpan', description: caught.message })
    }
    setSaving(false)
  }

  return { form, setForm, dirty, saving, save, reset: () => setForm(initial) }
}

/* ---------- Operasional ---------- */

function OrderTypesSection({ settings, onSaved }) {
  const { form, setForm, dirty, saving, save, reset } = useSettingsForm(settings, ['order_types'], onSaved)
  const [error, setError] = useState('')

  function toggle(type) {
    setForm((current) => ({
      order_types: current.order_types.includes(type)
        ? current.order_types.filter((item) => item !== type)
        : [...current.order_types, type],
    }))
    setError('')
  }

  function handleSubmit(event) {
    event.preventDefault()
    if (!form.order_types.length) {
      setError('Pilih minimal satu jenis pesanan.')
      return
    }
    save({ order_types: ['dine_in', 'takeaway'].filter((type) => form.order_types.includes(type)) }, 'Jenis pesanan disimpan')
  }

  return (
    <Card as="form" onSubmit={handleSubmit} noValidate className="settings-card">
      <CardHeader title="Jenis pesanan" description="Pilihan yang muncul di POS dan checkout customer." />
      <div className="ui-choice-grid">
        {Object.entries(ORDER_TYPE_LABELS).map(([type, label]) => {
          const checked = form.order_types.includes(type)
          return (
            <label key={type} className={`ui-choice${checked ? ' is-selected' : ''}`}>
              <input type="checkbox" checked={checked} onChange={() => toggle(type)} />
              <span>{label}</span>
            </label>
          )
        })}
      </div>
      {error && <p className="ui-field-error" role="alert">{error}</p>}
      <SectionFooter dirty={dirty} saving={saving} onReset={reset}>
        <Button type="submit" loading={saving} disabled={!dirty}>Simpan</Button>
      </SectionFooter>
    </Card>
  )
}

export function OperationsSettings() {
  const { cafe, features, updateCafe } = useOutletContext()
  return (
    <div className="settings-grid">
      <OpeningHoursSection key={`hours-${JSON.stringify(cafe.opening_hours)}`} cafe={cafe} features={features} onSaved={updateCafe} />
      <div className="settings-column">
        <PaymentMethodsSection key={`pay-${cafe.accepted_payment_methods}`} cafe={cafe} features={features} onSaved={updateCafe} />
        <SettingsGate title="Jenis pesanan">
          {(settings, replace) => <OrderTypesSection key={settings.updated_at} settings={settings} onSaved={replace} />}
        </SettingsGate>
      </div>
    </div>
  )
}

/* ---------- Pajak & biaya ---------- */

const CHARGE_KEYS = [
  'tax_enabled', 'tax_name', 'tax_rate', 'tax_inclusive',
  'service_charge_enabled', 'service_charge_rate', 'service_charge_taxable', 'rounding_unit',
]
const ROUNDING_OPTIONS = [
  { value: 0, label: 'Tanpa' },
  { value: 100, label: 'Rp 100' },
  { value: 500, label: 'Rp 500' },
  { value: 1000, label: 'Rp 1.000' },
]

function percentError(value) {
  const number = Number(value)
  return value === '' || !Number.isFinite(number) || number < 0 || number > 100 ? 'Isi 0–100.' : ''
}

function ChargesForm({ settings, onSaved }) {
  const { form, setForm, dirty, saving, save, reset } = useSettingsForm(settings, CHARGE_KEYS, onSaved)
  const [sample, setSample] = useState(100000)
  const [errors, setErrors] = useState({})
  const set = (key) => (value) => {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: '' }))
  }
  const preview = computeCharges(sample, { ...form, tax_rate: Number(form.tax_rate) || 0, service_charge_rate: Number(form.service_charge_rate) || 0 })

  function handleSubmit(event) {
    event.preventDefault()
    const nextErrors = {
      tax_rate: form.tax_enabled ? percentError(form.tax_rate) : '',
      service_charge_rate: form.service_charge_enabled ? percentError(form.service_charge_rate) : '',
      tax_name: form.tax_enabled && !String(form.tax_name).trim() ? 'Nama pajak wajib diisi.' : '',
    }
    setErrors(nextErrors)
    if (Object.values(nextErrors).some(Boolean)) return
    save({
      ...form,
      tax_name: String(form.tax_name).trim(),
      tax_rate: Number(form.tax_rate),
      service_charge_rate: Number(form.service_charge_rate),
    }, 'Pajak & biaya disimpan')
  }

  return (
    <form className="charges-layout" onSubmit={handleSubmit} noValidate>
      <div className="settings-column">
        <Card className="settings-card">
          <CardHeader
            title="Pajak"
            description="Mis. PB1 restoran 10%. Matikan bila kafe belum memungut pajak."
            actions={<Switch checked={form.tax_enabled} onChange={set('tax_enabled')} label="Pungut pajak" onLabel="Aktif" offLabel="Nonaktif" />}
          />
          <div className={`settings-fields${form.tax_enabled ? '' : ' is-muted'}`}>
            <TextField label="Nama pajak" value={form.tax_name} onChange={(event) => set('tax_name')(event.target.value)} maxLength={20} disabled={!form.tax_enabled} error={errors.tax_name} />
            <TextField label="Tarif" value={form.tax_rate} onChange={(event) => set('tax_rate')(event.target.value)} inputMode="decimal" suffix="%" disabled={!form.tax_enabled} error={errors.tax_rate} />
            <div className="settings-span">
              <span className="ui-field-label">Cara hitung</span>
              <SegmentedControl
                label="Cara hitung pajak"
                value={form.tax_inclusive ? 'in' : 'ex'}
                onChange={(value) => set('tax_inclusive')(value === 'in')}
                options={[{ value: 'ex', label: 'Ditambahkan ke total' }, { value: 'in', label: 'Sudah termasuk harga menu' }]}
              />
            </div>
          </div>
        </Card>

        <Card className="settings-card">
          <CardHeader
            title="Service charge"
            description="Biaya layanan dari subtotal pesanan."
            actions={<Switch checked={form.service_charge_enabled} onChange={set('service_charge_enabled')} label="Pungut service charge" onLabel="Aktif" offLabel="Nonaktif" />}
          />
          <div className={`settings-fields${form.service_charge_enabled ? '' : ' is-muted'}`}>
            <TextField label="Tarif" value={form.service_charge_rate} onChange={(event) => set('service_charge_rate')(event.target.value)} inputMode="decimal" suffix="%" disabled={!form.service_charge_enabled} error={errors.service_charge_rate} />
            <label className="settings-check">
              <input type="checkbox" checked={form.service_charge_taxable} disabled={!form.service_charge_enabled} onChange={(event) => set('service_charge_taxable')(event.target.checked)} />
              <span>Service charge ikut dikenai pajak</span>
            </label>
          </div>
        </Card>

        <Card className="settings-card">
          <CardHeader title="Pembulatan total" description="Total akhir dibulatkan ke kelipatan terdekat." />
          <SegmentedControl label="Pembulatan" value={Number(form.rounding_unit)} onChange={set('rounding_unit')} options={ROUNDING_OPTIONS} />
          <SectionFooter dirty={dirty} saving={saving} onReset={reset}>
            <Button type="submit" loading={saving} disabled={!dirty}>Simpan pajak & biaya</Button>
          </SectionFooter>
        </Card>
      </div>

      <aside className="charges-preview" aria-label="Contoh perhitungan">
        <span className="charges-preview-label">Contoh perhitungan</span>
        <RupiahInput label="Subtotal pesanan" value={sample} onChange={(value) => setSample(value ?? 0)} />
        <dl className="charges-lines">
          <div><dt>Subtotal</dt><dd className="tabular">{formatRupiah(preview.subtotal)}</dd></div>
          {preview.serviceRate > 0 && <div><dt>Service {preview.serviceRate}%</dt><dd className="tabular">{formatRupiah(preview.service)}</dd></div>}
          {preview.taxRate > 0 && (
            <div>
              <dt>{form.tax_name || 'Pajak'} {preview.taxRate}%{preview.taxInclusive ? ' (termasuk)' : ''}</dt>
              <dd className="tabular">{preview.taxInclusive ? `(${formatRupiah(preview.tax)})` : formatRupiah(preview.tax)}</dd>
            </div>
          )}
          {preview.rounding !== 0 && <div><dt>Pembulatan</dt><dd className="tabular">{formatRupiah(preview.rounding)}</dd></div>}
          <div className="charges-total"><dt>Total dibayar</dt><dd className="tabular">{formatRupiah(preview.total)}</dd></div>
        </dl>
        <p className="charges-note">
          Berlaku untuk pesanan baru setelah POS dan checkout versi baru aktif (fase 5). Pesanan yang sudah ada tidak berubah.
          Total final selalu dihitung ulang oleh database.
        </p>
      </aside>
    </form>
  )
}

export function ChargesSettings() {
  return (
    <SettingsGate title="Pajak & biaya">
      {(settings, replace) => <ChargesForm key={settings.updated_at} settings={settings} onSaved={replace} />}
    </SettingsGate>
  )
}

/* ---------- Struk ---------- */

const RECEIPT_KEYS = ['receipt_header', 'receipt_footer', 'receipt_show_logo', 'receipt_show_address', 'receipt_paper_mm']

function ReceiptForm({ settings, onSaved }) {
  const { cafe } = useOutletContext()
  const brand = brandOf(cafe)
  const { form, setForm, dirty, saving, save, reset } = useSettingsForm(settings, RECEIPT_KEYS, onSaved)
  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }))
  const example = computeCharges(54000, settings)

  function handleSubmit(event) {
    event.preventDefault()
    save({
      ...form,
      receipt_header: form.receipt_header?.trim() || null,
      receipt_footer: form.receipt_footer?.trim() || null,
    }, 'Pengaturan struk disimpan')
  }

  return (
    <form className="charges-layout" onSubmit={handleSubmit} noValidate>
      <Card className="settings-card">
        <CardHeader title="Isi struk" description="Dicetak dari POS kasir (fase 5) dan label pesanan staff." />
        <div className="settings-fields">
          <TextField className="settings-span" label="Teks atas" multiline rows={2} maxLength={200} value={form.receipt_header || ''}
            onChange={(event) => set('receipt_header')(event.target.value)} placeholder="Mis. NPWP, jam buka, atau salam" />
          <TextField className="settings-span" label="Teks bawah" multiline rows={3} maxLength={300} value={form.receipt_footer || ''}
            onChange={(event) => set('receipt_footer')(event.target.value)} placeholder="Mis. Terima kasih! Wi-Fi: kopisenja / sandi: …" />
          <label className="settings-check">
            <input type="checkbox" checked={form.receipt_show_logo} onChange={(event) => set('receipt_show_logo')(event.target.checked)} />
            <span>Tampilkan logo</span>
          </label>
          <label className="settings-check">
            <input type="checkbox" checked={form.receipt_show_address} onChange={(event) => set('receipt_show_address')(event.target.checked)} />
            <span>Tampilkan alamat & telepon</span>
          </label>
          <div className="settings-span">
            <span className="ui-field-label">Lebar kertas</span>
            <SegmentedControl label="Lebar kertas" value={Number(form.receipt_paper_mm)} onChange={set('receipt_paper_mm')}
              options={[{ value: 58, label: '58 mm' }, { value: 80, label: '80 mm' }]} />
          </div>
        </div>
        <SectionFooter dirty={dirty} saving={saving} onReset={reset}>
          <Button type="submit" loading={saving} disabled={!dirty}>Simpan struk</Button>
        </SectionFooter>
      </Card>

      <aside className="receipt-preview-wrap" aria-label="Pratinjau struk">
        <span className="charges-preview-label">Pratinjau (contoh pesanan)</span>
        <div className={`receipt-preview is-${form.receipt_paper_mm}`}>
          {form.receipt_show_logo && brand.logoUrl && <img src={brand.logoUrl} alt="" className="receipt-logo" />}
          <strong className="receipt-name">{brand.businessName}</strong>
          {form.receipt_show_address && (cafe.address || cafe.phone) && (
            <span className="receipt-muted">{[cafe.address, cafe.phone].filter(Boolean).join(' · ')}</span>
          )}
          {form.receipt_header && <span className="receipt-text">{form.receipt_header}</span>}
          <hr />
          <div className="receipt-row"><span>A-012 · Makan di tempat</span><span>Meja 4</span></div>
          <hr />
          <div className="receipt-row"><span>2 × Es Kopi Susu</span><span>36.000</span></div>
          <div className="receipt-row"><span>1 × Croissant</span><span>18.000</span></div>
          <hr />
          <div className="receipt-row"><span>Subtotal</span><span>{formatNumber(Math.round(example.subtotal))}</span></div>
          {example.serviceRate > 0 && <div className="receipt-row"><span>Service {example.serviceRate}%</span><span>{formatNumber(Math.round(example.service))}</span></div>}
          {example.taxRate > 0 && <div className="receipt-row"><span>{settings.tax_name} {example.taxRate}%{example.taxInclusive ? ' (termasuk)' : ''}</span><span>{formatNumber(Math.round(example.tax))}</span></div>}
          {example.rounding !== 0 && <div className="receipt-row"><span>Pembulatan</span><span>{formatNumber(Math.round(example.rounding))}</span></div>}
          <div className="receipt-row receipt-total"><span>TOTAL</span><span>{formatRupiah(example.total)}</span></div>
          {form.receipt_footer && <><hr /><span className="receipt-text">{form.receipt_footer}</span></>}
        </div>
      </aside>
    </form>
  )
}

export function ReceiptSettings() {
  return (
    <SettingsGate title="Struk">
      {(settings, replace) => <ReceiptForm key={settings.updated_at} settings={settings} onSaved={replace} />}
    </SettingsGate>
  )
}
