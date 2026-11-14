/*
 * Panel "Tampilan": mode gelap/terang/ikuti sistem, warna aksen, sudut kartu, animasi — dengan pratinjau langsung.
 * - Mode, sudut, dan animasi disimpan per browser dan langsung berlaku.
 * - Warna aksen dikendalikan pemanggil (accent + onAccentChange): web owner menyimpannya sebagai warna brand kafe,
 *   dashboard platform ke pengaturan platform. Pratinjau memakai warna yang sedang dipilih walau belum disimpan.
 */
import { useId, useMemo } from 'react'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { Badge } from '../components/Badge.jsx'
import { Button } from '../components/Button.jsx'
import { Switch } from '../components/Fields.jsx'
import { SegmentedControl } from '../components/SegmentedControl.jsx'
import { Sparkline } from '../components/Sparkline.jsx'
import { RADIUS_OPTIONS, useAppearance } from '../theme/appearance.js'
import { ACCENT_PRESETS, DEFAULT_ACCENT, buildTheme, contrast, isHex } from '../theme/theme.js'
import { useThemeMode } from '../theme/themeMode.js'

const MODE_OPTIONS = [
  { value: 'dark', label: 'Gelap', icon: Moon },
  { value: 'light', label: 'Terang', icon: Sun },
  { value: 'system', label: 'Ikuti sistem', icon: Monitor },
]

export function AppearancePanel({ accent, onAccentChange, accentLabel = 'Warna aksen', accentHint, presets = ACCENT_PRESETS, accentDisabled = false, children }) {
  const colorId = useId()
  const { preference, mode, setPreference } = useThemeMode()
  const appearance = useAppearance()
  const current = isHex(accent) ? accent.toUpperCase() : DEFAULT_ACCENT
  const theme = useMemo(() => buildTheme({ color: current, mode }), [current, mode])
  const adjusted = theme.accent !== current
  const isPreset = presets.some((preset) => preset.color.toUpperCase() === current)

  return (
    <div className="appearance">
      <div className="appearance-controls">
        <fieldset className="appearance-field">
          <legend>Mode</legend>
          <SegmentedControl label="Mode tampilan" options={MODE_OPTIONS} value={preference} onChange={setPreference} />
        </fieldset>

        <fieldset className="appearance-field" disabled={accentDisabled}>
          <legend>{accentLabel}</legend>
          <div className="appearance-swatches">
            {presets.map((preset) => {
              const selected = preset.color.toUpperCase() === current
              return (
                <button key={preset.color} type="button" className={`appearance-swatch${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={() => onAccentChange?.(preset.color.toUpperCase())}>
                  <span style={{ background: preset.color }}>{selected && <Check size={14} aria-hidden="true" />}</span>
                  {preset.label}
                </button>
              )
            })}
            <label htmlFor={colorId} className={`appearance-swatch is-custom${isPreset ? '' : ' is-selected'}`}>
              <span style={{ background: isPreset ? undefined : current }}>
                <input id={colorId} type="color" value={current} onChange={(event) => onAccentChange?.(event.target.value.toUpperCase())} />
              </span>
              Warna bebas
            </label>
          </div>
          <p className="appearance-hint">
            {accentHint}{accentHint ? ' ' : ''}
            {adjusted ? `Agar tetap terlihat di mode ${mode === 'dark' ? 'gelap' : 'terang'}, warna disesuaikan menjadi ${theme.accent}. ` : ''}
            Kontras teks di atas aksen {contrast(theme.onAccent, theme.accent).toFixed(1)}:1 (minimal 4,5:1).
          </p>
        </fieldset>

        <fieldset className="appearance-field">
          <legend>Sudut kartu</legend>
          <SegmentedControl label="Sudut kartu" options={RADIUS_OPTIONS} value={appearance.radius} onChange={(radius) => appearance.set({ radius })} />
        </fieldset>

        <fieldset className="appearance-field">
          <legend>Animasi</legend>
          <Switch checked={appearance.motion} onChange={(motion) => appearance.set({ motion })} label="Animasi antarmuka" onLabel="Nyala" offLabel="Mati" />
          {appearance.systemReduced && <p className="appearance-hint">Perangkat ini meminta gerakan dikurangi, jadi animasi tetap dimatikan.</p>}
        </fieldset>
        {children}
      </div>

      <div className="appearance-preview" style={theme.vars} aria-label="Pratinjau tampilan" role="img">
        <div className="appearance-preview-kpi">
          <span>Pendapatan hari ini</span>
          <strong className="tabular">Rp 1.484.000</strong>
          <Sparkline values={[4, 6, 5, 8, 7, 10, 12]} width={200} height={28} fluid />
        </div>
        <div className="appearance-preview-card">
          <div className="appearance-preview-row"><strong>Pesanan A-012</strong><Badge tone="green">Lunas</Badge></div>
          <div className="appearance-preview-row"><span>2× Es Kopi Susu</span><span className="tabular">Rp 48.000</span></div>
          <div className="appearance-preview-actions">
            <Button size="sm" tabIndex={-1}>Tombol utama</Button>
            <Button size="sm" variant="soft" tabIndex={-1}>Lembut</Button>
            <span className="appearance-preview-link">Tautan</span>
          </div>
        </div>
      </div>
    </div>
  )
}
