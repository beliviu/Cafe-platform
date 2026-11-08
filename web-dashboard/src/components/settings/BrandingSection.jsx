/*
 * Pengaturan → Brand & tampilan (white-label).
 * Owner mengganti logo, nama tampilan, tagline, dan warna brand.
 * Berlaku langsung di web owner/staff (sidebar, tab browser, warna tombol) dan aplikasi customer.
 * Kolom: cafes.app_name, logo_url, tagline, brand_color (file usulan 03), brand_color_2 (file 04, gradasi).
 */
import { useEffect, useRef, useState } from 'react'
import { Check, ImageUp, Palette, RefreshCw, Smartphone, Trash2 } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Badge, Button, Card, CardHeader, EmptyState, TextField, useToast } from '../ui/index.js'
import { BrandMark } from '../shell/AppShell.jsx'
import { ImageCropDialog } from '../products/ImageCropDialog.jsx'
import { brandOf, removeCafeAsset, uploadCafeLogo } from '../../lib/branding.js'
import {
  BRAND_COLOR_PRESETS, BRAND_GRADIENT_PRESETS, DEFAULT_BRAND_COLOR, brandFill, brandScale, describeBrandColor, isHexColor,
} from '../../lib/color.js'
import { LOGO_IMAGE_SIZE } from '../../lib/imageCrop.js'
import { saveCafe } from '../../lib/cafe.js'
import { SectionFooter } from './SettingsShared.jsx'

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_SOURCE_SIZE = 10 * 1024 * 1024

function initialForm(cafe) {
  return {
    app_name: cafe.app_name || '',
    tagline: cafe.tagline || '',
    brand_color: cafe.brand_color || '',
    brand_color_2: cafe.brand_color_2 || '',
  }
}

function PhonePreview({ brand }) {
  return (
    <div className="brand-phone" aria-hidden="true">
      <div className="brand-phone-notch" />
      <div className="brand-phone-header">
        <BrandMark brand={brand} size={34} />
        <span>
          <strong>{brand.name}</strong>
          <small>{brand.tagline || 'Pesan menu favoritmu'}</small>
        </span>
      </div>
      <div className="brand-phone-card">
        <span className="brand-phone-thumb" />
        <span className="brand-phone-lines"><i /><i /></span>
      </div>
      <div className="brand-phone-card">
        <span className="brand-phone-thumb" />
        <span className="brand-phone-lines"><i /><i /></span>
      </div>
      <span className="brand-phone-button">Tambah ke keranjang</span>
    </div>
  )
}

export function BrandingSection({ cafe, features, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const initial = initialForm(cafe)
  const [form, setForm] = useState(initial)
  const [logoFile, setLogoFile] = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)
  const [removeLogo, setRemoveLogo] = useState(false)
  const [cropSource, setCropSource] = useState(null)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const fileInput = useRef(null)
  const objectUrls = useRef([])

  useEffect(() => () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url)), [])

  if (!features?.branding) {
    return (
      <Card className="settings-card">
        <CardHeader icon={Palette} title="Brand & tampilan" description="Logo, nama tampilan, dan warna untuk web & aplikasi." />
        <EmptyState
          compact
          icon={Palette}
          title="Belum tersedia"
          description="Jalankan file supabase/usulan/03-branding-kafe.sql di Supabase SQL Editor, lalu muat ulang halaman ini."
        />
      </Card>
    )
  }

  const dirty = Boolean(logoFile) || removeLogo || Object.keys(initial).some((key) => form[key] !== initial[key])
  const colorInfo = describeBrandColor(form.brand_color)
  const scale = brandScale(isHexColor(form.brand_color) ? form.brand_color : DEFAULT_BRAND_COLOR)
  const gradientMode = Boolean(form.brand_color_2)
  const previewStyle = {
    ...Object.fromEntries(Object.entries(scale).map(([step, value]) => [`--brand-${step}`, value])),
    '--brand-fill': brandFill(form.brand_color, form.brand_color_2),
  }
  const currentLogo = removeLogo ? null : logoPreview || cafe.logo_url || null
  const previewBrand = brandOf({ ...cafe, app_name: form.app_name, tagline: form.tagline, logo_url: currentLogo })

  function trackUrl(file) {
    const url = URL.createObjectURL(file)
    objectUrls.current.push(url)
    return url
  }

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: '' }))
  }

  function chooseLogo(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setErrors((current) => ({ ...current, logo: 'Format logo harus PNG, JPG, atau WebP.' }))
      return
    }
    if (file.size > MAX_SOURCE_SIZE) {
      setErrors((current) => ({ ...current, logo: 'Ukuran file maksimal 10 MB.' }))
      return
    }
    setErrors((current) => ({ ...current, logo: '' }))
    setCropSource(trackUrl(file))
  }

  function reset() {
    setForm(initial)
    setLogoFile(null)
    setLogoPreview(null)
    setRemoveLogo(false)
    setErrors({})
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const values = {
      app_name: form.app_name.replace(/\s+/g, ' ').trim() || null,
      tagline: form.tagline.replace(/\s+/g, ' ').trim() || null,
      brand_color: form.brand_color ? form.brand_color.toUpperCase() : null,
    }
    if (features?.phase3) {
      values.brand_color_2 = form.brand_color_2 ? form.brand_color_2.toUpperCase() : null
      // Gradasi butuh warna awal: pakai bawaan bila owner belum memilih
      if (values.brand_color_2 && !values.brand_color) values.brand_color = DEFAULT_BRAND_COLOR
    }
    const nextErrors = {}
    if (values.app_name && values.app_name.length < 2) nextErrors.app_name = 'Nama tampilan minimal 2 karakter.'
    if (values.brand_color && !isHexColor(values.brand_color)) nextErrors.brand_color = 'Gunakan format warna #RRGGBB.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    setSaving(true)
    let uploaded = null
    try {
      if (logoFile) {
        uploaded = await uploadCafeLogo(supabase, cafe.id, logoFile)
        values.logo_url = uploaded.url
      } else if (removeLogo) {
        values.logo_url = null
      }
      const saved = await saveCafe(supabase, cafe, features, values)
      const replaced = cafe.logo_url && cafe.logo_url !== saved.logo_url
      const cleanupError = replaced ? await removeCafeAsset(supabase, cafe.logo_url) : null
      onSaved(saved)
      setLogoFile(null)
      setLogoPreview(null)
      setRemoveLogo(false)
      setForm(initialForm(saved))
      toast({
        tone: 'success',
        title: 'Brand disimpan',
        description: cleanupError ? 'Logo lama gagal dibersihkan dari penyimpanan, tetapi tidak dipakai lagi.' : 'Sudah berlaku di web dan aplikasi customer.',
      })
    } catch (caught) {
      if (uploaded) await removeCafeAsset(supabase, uploaded.url)
      toast({ tone: 'error', title: 'Brand gagal disimpan', description: caught.message })
    }
    setSaving(false)
  }

  return (
    <Card as="form" onSubmit={handleSubmit} noValidate className="settings-card">
      <CardHeader
        icon={Palette}
        title="Brand & tampilan"
        description="Logo, nama, dan warna ini dipakai di web owner, web staff, dan aplikasi customer."
      />

      <div className="brand-layout">
        <div className="brand-form">
          <div className="brand-logo-row">
            <span className={`brand-logo-preview${currentLogo ? ' has-logo' : ''}`}>
              {currentLogo ? <img src={currentLogo} alt="Logo saat ini" /> : <ImageUp size={26} aria-hidden="true" />}
            </span>
            <div className="brand-logo-actions">
              <strong>Logo</strong>
              <span>PNG transparan atau persegi, minimal 512 × 512 px.</span>
              <div className="brand-logo-buttons">
                <input ref={fileInput} className="sr-only" type="file" accept={ACCEPTED_TYPES.join(',')} onChange={chooseLogo} tabIndex={-1} />
                <Button variant="secondary" size="sm" icon={currentLogo ? RefreshCw : ImageUp} onClick={() => fileInput.current?.click()}>
                  {currentLogo ? 'Ganti logo' : 'Unggah logo'}
                </Button>
                {currentLogo && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Trash2}
                    onClick={() => {
                      setLogoFile(null)
                      setLogoPreview(null)
                      setRemoveLogo(Boolean(cafe.logo_url))
                    }}
                  >
                    Hapus
                  </Button>
                )}
              </div>
              {errors.logo && <p className="ui-field-error" role="alert">{errors.logo}</p>}
            </div>
          </div>

          <TextField
            label="Nama tampilan"
            value={form.app_name}
            onChange={(event) => setField('app_name', event.target.value)}
            maxLength={40}
            placeholder={cafe.name}
            error={errors.app_name}
            hint="Muncul di sidebar, tab browser, dan aplikasi customer. Kosongkan untuk memakai nama kafe."
          />
          <TextField
            label="Tagline"
            value={form.tagline}
            onChange={(event) => setField('tagline', event.target.value)}
            maxLength={80}
            placeholder="Mis. Kopi susu gula aren sejak 2019"
            hint={`${form.tagline.length}/80 karakter · tampil di bawah nama pada aplikasi customer.`}
          />

          <fieldset className="brand-colors">
            <legend className="ui-field-label">Warna brand</legend>
            <div className="brand-mode" role="radiogroup" aria-label="Gaya warna">
              <button
                type="button"
                role="radio"
                aria-checked={!gradientMode}
                className={`brand-mode-option${!gradientMode ? ' is-selected' : ''}`}
                onClick={() => setField('brand_color_2', '')}
              >
                <span className="brand-mode-sample" style={{ background: scale[600] }} />
                Solid
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={gradientMode}
                disabled={!features?.phase3}
                className={`brand-mode-option${gradientMode ? ' is-selected' : ''}`}
                onClick={() => {
                  const preset = BRAND_GRADIENT_PRESETS[0]
                  setForm((current) => ({ ...current, brand_color: current.brand_color || preset.from, brand_color_2: preset.to }))
                }}
              >
                <span className="brand-mode-sample" style={{ background: brandFill(form.brand_color || BRAND_GRADIENT_PRESETS[0].from, form.brand_color_2 || BRAND_GRADIENT_PRESETS[0].to) }} />
                Gradasi
              </button>
            </div>
            {!features?.phase3 && <p className="ui-field-hint">Gradasi aktif setelah file 04-owner-dashboard.sql dijalankan.</p>}

            {gradientMode ? (
              <>
                <div className="brand-swatches">
                  {BRAND_GRADIENT_PRESETS.map((preset) => {
                    const selected = form.brand_color.toUpperCase() === preset.from && form.brand_color_2.toUpperCase() === preset.to
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        className={`brand-swatch${selected ? ' is-selected' : ''}`}
                        onClick={() => setForm((current) => ({ ...current, brand_color: preset.from, brand_color_2: preset.to }))}
                        aria-pressed={selected}
                      >
                        <span style={{ background: brandFill(preset.from, preset.to) }}>{selected && <Check size={14} aria-hidden="true" />}</span>
                        {preset.label}
                      </button>
                    )
                  })}
                </div>
                <div className="brand-gradient-custom">
                  <label className="brand-color-input">
                    <input
                      type="color"
                      value={isHexColor(form.brand_color) ? form.brand_color : DEFAULT_BRAND_COLOR}
                      onChange={(event) => setField('brand_color', event.target.value.toUpperCase())}
                    />
                    <span><small>Warna awal</small><code>{(form.brand_color || DEFAULT_BRAND_COLOR).toUpperCase()}</code></span>
                  </label>
                  <span className="brand-gradient-arrow" aria-hidden="true">→</span>
                  <label className="brand-color-input">
                    <input
                      type="color"
                      value={isHexColor(form.brand_color_2) ? form.brand_color_2 : DEFAULT_BRAND_COLOR}
                      onChange={(event) => setField('brand_color_2', event.target.value.toUpperCase())}
                    />
                    <span><small>Warna akhir</small><code>{form.brand_color_2.toUpperCase()}</code></span>
                  </label>
                </div>
                <p className="ui-field-hint">Gradasi dipakai di tombol utama, tanda brand, dan sorotan ringkasan. Teks & tabel tetap memakai warna awal agar mudah dibaca.</p>
              </>
            ) : (
              <div className="brand-swatches">
                <button
                  type="button"
                  className={`brand-swatch is-default${!form.brand_color ? ' is-selected' : ''}`}
                  onClick={() => setField('brand_color', '')}
                  aria-pressed={!form.brand_color}
                >
                  <span style={{ background: DEFAULT_BRAND_COLOR }}>{!form.brand_color && <Check size={14} aria-hidden="true" />}</span>
                  Bawaan
                </button>
                {BRAND_COLOR_PRESETS.filter((preset) => preset.value !== DEFAULT_BRAND_COLOR).map((preset) => {
                  const selected = form.brand_color.toUpperCase() === preset.value
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      className={`brand-swatch${selected ? ' is-selected' : ''}`}
                      onClick={() => setField('brand_color', preset.value)}
                      aria-pressed={selected}
                    >
                      <span style={{ background: preset.value }}>{selected && <Check size={14} aria-hidden="true" />}</span>
                      {preset.label}
                    </button>
                  )
                })}
                <label className="brand-swatch brand-swatch-custom">
                  <input
                    type="color"
                    value={isHexColor(form.brand_color) ? form.brand_color : DEFAULT_BRAND_COLOR}
                    onChange={(event) => setField('brand_color', event.target.value.toUpperCase())}
                    aria-label="Pilih warna sendiri"
                  />
                  Pilih sendiri
                </label>
              </div>
            )}
            {errors.brand_color && <p className="ui-field-error" role="alert">{errors.brand_color}</p>}
            {colorInfo?.changed && (
              <p className="ui-field-hint">
                Warna ini terlalu terang untuk teks putih, jadi otomatis digelapkan menjadi <code>{colorInfo.adjusted}</code> agar tetap terbaca.
              </p>
            )}
          </fieldset>
        </div>

        <aside className="brand-preview" aria-label="Pratinjau brand" style={previewStyle}>
          <span className="brand-preview-label">Pratinjau</span>
          <div className="brand-preview-sidebar">
            <div className="brand-preview-web">
              <BrandMark brand={previewBrand} size={32} />
              <span className="brand-preview-name">{previewBrand.name}</span>
            </div>
            <div className="brand-preview-nav">
              <span className="is-active">Dashboard</span>
              <span>Produk</span>
            </div>
          </div>
          <span className="brand-preview-button">Simpan</span>
          <PhonePreview brand={previewBrand} />
          <Badge tone="neutral" dot={false} className="brand-preview-note"><Smartphone size={12} aria-hidden="true" /> Ikon app di layar HP berubah saat rilis versi berikutnya</Badge>
        </aside>
      </div>

      <SectionFooter dirty={dirty} saving={saving} onReset={reset}>
        <Button type="submit" loading={saving} disabled={!dirty}>Simpan brand</Button>
      </SectionFooter>

      {cropSource && (
        <ImageCropDialog
          src={cropSource}
          title="Atur logo"
          description="Geser dan perbesar logo. Hasilnya persegi 512 × 512 px dan latar transparan tetap dipertahankan."
          doneLabel="Pakai logo ini"
          allowPadding
          cropOptions={{ size: LOGO_IMAGE_SIZE, baseName: 'logo', transparent: true }}
          onCancel={() => setCropSource(null)}
          onDone={(file) => {
            setLogoFile(file)
            setLogoPreview(trackUrl(file))
            setRemoveLogo(false)
            setCropSource(null)
          }}
        />
      )}
    </Card>
  )
}
