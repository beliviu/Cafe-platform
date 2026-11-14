/*
 * Feature flag per kafe (file SQL 18). Tiga pilihan per fitur: ikuti paket · nyala · mati.
 * Flag menang atas paket (cafe_has_feature) dan dibaca web owner. Setiap perubahan tercatat di log audit.
 */
import { useCallback, useState } from 'react'
import { Flag } from 'lucide-react'
import { Badge, Card, CardHeader, EmptyState, SkeletonRows, useToast } from './ui/index.js'
import { optional, rpc, useLoader } from '../lib/api.js'
import { formatDate } from '../lib/format.js'

const CHOICES = [
  { value: 'plan', label: 'Ikuti paket' },
  { value: 'on', label: 'Nyala' },
  { value: 'off', label: 'Mati' },
]

export function FlagChoice({ label, value, onChange, disabled }) {
  return (
    <span className="flag-choice" role="radiogroup" aria-label={label}>
      {CHOICES.map((choice) => (
        <button key={choice.value} type="button" role="radio" aria-checked={value === choice.value} disabled={disabled}
          className={`flag-choice-item${value === choice.value ? ' is-selected' : ''} is-${choice.value}`} onClick={() => value !== choice.value && onChange(choice.value)}>
          {choice.label}
        </button>
      ))}
    </span>
  )
}

export function FlagsCard({ cafeId, canEdit }) {
  const { toast } = useToast()
  const load = useCallback(() => optional(rpc('pa_cafe_flags', { p_cafe: cafeId })), [cafeId])
  const { data, loading, reload } = useLoader(load)
  const [busy, setBusy] = useState('')

  async function setFlag(feature, choice) {
    setBusy(feature.key)
    try {
      const result = await rpc('pa_flag_set', { p_cafe: cafeId, p_feature: feature.key, p_enabled: choice === 'plan' ? null : choice === 'on', p_note: null, p_expires_at: null })
      toast({ title: `${feature.label}: ${result.effective ? 'aktif' : 'tidak aktif'}`, description: choice === 'plan' ? 'Kembali mengikuti paket.' : 'Flag disimpan dan tercatat di log audit.' })
      reload()
    } catch (caught) {
      toast({ tone: 'danger', title: 'Flag tidak disimpan', description: caught.message })
    } finally {
      setBusy('')
    }
  }

  if (data === null) return null
  return (
    <Card>
      <CardHeader title="Feature flag" description="Nyalakan atau matikan fitur untuk kafe ini di luar batas paket" />
      {loading && !data ? <SkeletonRows rows={4} /> : data.length === 0 ? <EmptyState compact icon={Flag} title="Belum ada fitur" /> : (
        <ul className="flag-list">
          {data.map((feature) => {
            const choice = feature.flag === true && !feature.flag_expired ? 'on' : feature.flag === false && !feature.flag_expired ? 'off' : 'plan'
            return (
              <li key={feature.key}>
                <span className="pa-cell-main">
                  <strong>{feature.label}{feature.kind === 'beta' && <Badge tone="blue" size="sm">Beta</Badge>}</strong>
                  <small>
                    {feature.in_plan ? 'Termasuk paket' : 'Tidak termasuk paket'} · sekarang {feature.effective ? 'aktif' : 'tidak aktif'}
                    {feature.expires_at && !feature.flag_expired ? ` · flag sampai ${formatDate(feature.expires_at)}` : ''}
                  </small>
                </span>
                <FlagChoice label={`Flag ${feature.label}`} value={choice} disabled={!canEdit || busy === feature.key} onChange={(value) => setFlag(feature, value)} />
              </li>
            )
          })}
        </ul>
      )}
      {!canEdit && <p className="ui-field-hint">Hanya Super admin yang bisa mengubah flag.</p>}
    </Card>
  )
}
