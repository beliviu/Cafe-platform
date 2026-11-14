/*
 * Pengaturan → Tampilan: mode gelap/terang/ikuti sistem, warna aksen, sudut kartu, animasi, pratinjau langsung.
 * - Mode, sudut, dan animasi: per perangkat, langsung berlaku.
 * - Warna aksen = warna brand kafe yang sudah ada (cafes.brand_color). Disimpan lewat saveCafe()
 *   yang sama dengan bagian "Brand & tampilan", jadi ikut berlaku di aplikasi customer.
 */
import { useState } from 'react'
import { Save } from 'lucide-react'
import { useOutletContext } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth.js'
import { AppearancePanel, Button, Card, CardHeader, DEFAULT_ACCENT, isHex, useToast } from '../../components/ui/index.js'
import { saveCafe } from '../../lib/cafe.js'

export function AppearanceSettings() {
  const { cafe, features, updateCafe } = useOutletContext()
  const { supabase } = useAuth()
  const { toast } = useToast()
  const saved = isHex(cafe.brand_color) ? cafe.brand_color.toUpperCase() : DEFAULT_ACCENT
  const [accent, setAccent] = useState(saved)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dirty = accent !== saved
  const canSave = Boolean(features?.branding)

  async function save() {
    setBusy(true)
    setError('')
    try {
      const result = await saveCafe(supabase, cafe, features, { brand_color: accent })
      updateCafe(result)
      toast({ title: 'Warna aksen disimpan', description: 'Berlaku di web dan aplikasi customer.' })
    } catch (caught) {
      setError(caught.message || 'Warna gagal disimpan. Coba lagi.')
    }
    setBusy(false)
  }

  return (
    <Card className="settings-card">
      <CardHeader title="Tampilan" description="Mode, sudut kartu, dan animasi tersimpan di perangkat ini. Warna aksen berlaku untuk seluruh kafe." />
      <AppearancePanel
        accent={accent}
        onAccentChange={setAccent}
        accentDisabled={!canSave}
        accentHint={canSave ? 'Warna aksen mengikuti warna brand kafe.' : 'Warna aksen bisa diubah setelah pembaruan database brand diterapkan.'}
      >
        <div className="appearance-save">
          <Button icon={Save} loading={busy} disabled={!dirty || !canSave} onClick={save}>Simpan warna aksen</Button>
          {dirty && <Button variant="ghost" disabled={busy} onClick={() => setAccent(saved)}>Batalkan</Button>}
          {dirty && <span className="appearance-dirty">Belum disimpan</span>}
        </div>
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </AppearancePanel>
    </Card>
  )
}
