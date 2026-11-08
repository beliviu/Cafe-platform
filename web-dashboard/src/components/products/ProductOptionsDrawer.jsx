/*
 * Varian & add-on satu produk. Contoh:
 *   Ukuran (wajib, pilih 1): Regular +0 · Large +5.000
 *   Topping (opsional, pilih beberapa, maks 3): Boba +4.000 · Cheese foam +6.000
 * Disimpan sekaligus (tombol Simpan). Harga final tetap dihitung database saat checkout (fase 5).
 */
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Button, Drawer, EmptyState, ErrorState, IconButton, RupiahInput, SegmentedControl, SkeletonRows, Switch, TextField, useToast } from '../ui/index.js'
import { formatRupiah } from '../../lib/format.js'
import { fetchProductOptions, newGroup, newOption, saveProductOptions, validateGroups } from '../../lib/productOptions.js'

const TEMPLATES = [
  { label: 'Ukuran', selection_type: 'single', is_required: true, options: [['Regular', 0], ['Large', 5000]] },
  { label: 'Suhu', selection_type: 'single', is_required: true, options: [['Dingin', 0], ['Panas', 0]] },
  { label: 'Gula', selection_type: 'single', is_required: false, options: [['Normal', 0], ['Less sugar', 0], ['Tanpa gula', 0]] },
  { label: 'Tambahan', selection_type: 'multiple', is_required: false, options: [['Extra shot', 5000], ['Oat milk', 7000]] },
]

function move(list, index, delta) {
  const next = [...list]
  const target = index + delta
  if (target < 0 || target >= next.length) return list
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function ProductOptionsDrawer({ product, onClose, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [original, setOriginal] = useState(null)
  const [groups, setGroups] = useState([])
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    fetchProductOptions(supabase, product.id)
      .then((data) => { if (active) { setOriginal(data); setGroups(structuredClone(data)); setLoadError('') } })
      .catch((caught) => { if (active) setLoadError(caught.message) })
    return () => { active = false }
  }, [attempt, product.id, supabase])

  const dirty = original && JSON.stringify(groups) !== JSON.stringify(original)

  function updateGroup(groupId, patch) {
    setGroups((current) => current.map((group) => (group.id === groupId ? { ...group, ...patch } : group)))
    setError('')
  }
  function updateOption(groupId, optionId, patch) {
    setGroups((current) => current.map((group) => {
      if (group.id !== groupId) return group
      let options = group.options.map((option) => (option.id === optionId ? { ...option, ...patch } : option))
      // Grup pilih-satu: hanya satu pilihan bawaan
      if (patch.is_default && group.selection_type === 'single') {
        options = options.map((option) => (option.id === optionId ? option : { ...option, is_default: false }))
      }
      return { ...group, options }
    }))
    setError('')
  }

  function addFromTemplate(template) {
    const group = {
      ...newGroup(),
      name: template.label,
      selection_type: template.selection_type,
      is_required: template.is_required,
      options: template.options.map(([name, price], index) => ({ ...newOption(), name, price_delta: price, is_default: template.selection_type === 'single' && index === 0 })),
    }
    setGroups((current) => [...current, group])
  }

  async function save() {
    const message = validateGroups(groups)
    if (message) return setError(message)
    setSaving(true)
    try {
      const saved = await saveProductOptions(supabase, product.id, groups, original)
      setOriginal(saved)
      setGroups(structuredClone(saved))
      onSaved?.(product.id, saved.length)
      toast({ tone: 'success', title: 'Varian disimpan', description: product.name })
    } catch (caught) {
      setError(caught.message)
    }
    setSaving(false)
  }

  return (
    <Drawer
      title="Varian & add-on"
      description={`${product.name} · harga dasar ${formatRupiah(product.price)}`}
      onClose={saving ? undefined : onClose}
      dismissible={!saving}
      size="lg"
      footer={(
        <>
          <span className="drawer-footer-note">{dirty ? 'Ada perubahan yang belum disimpan.' : 'Tampil di POS & aplikasi customer mulai fase pesanan baru.'}</span>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Tutup</Button>
          <Button onClick={save} loading={saving} disabled={!dirty}>Simpan varian</Button>
        </>
      )}
    >
      {loadError ? <ErrorState compact message={loadError} onRetry={() => setAttempt((value) => value + 1)} />
        : !original ? <SkeletonRows rows={3} label="Memuat varian" />
          : (
            <div className="options-editor">
              {!groups.length && (
                <EmptyState compact title="Belum ada varian" description="Tambahkan grup seperti Ukuran, Suhu, atau Topping. Pilih templat di bawah untuk mulai cepat." />
              )}

              {groups.map((group, groupIndex) => (
                <section className="option-group" key={group.id} aria-label={group.name || `Grup ${groupIndex + 1}`}>
                  <header className="option-group-head">
                    <TextField hideLabel label="Nama grup" value={group.name} maxLength={40} placeholder="Nama grup, mis. Ukuran"
                      onChange={(event) => updateGroup(group.id, { name: event.target.value })} className="option-group-name" />
                    <div className="option-group-tools">
                      <IconButton icon={ArrowUp} size="sm" label="Naikkan grup" disabled={groupIndex === 0} onClick={() => setGroups((current) => move(current, groupIndex, -1))} />
                      <IconButton icon={ArrowDown} size="sm" label="Turunkan grup" disabled={groupIndex === groups.length - 1} onClick={() => setGroups((current) => move(current, groupIndex, 1))} />
                      <IconButton icon={Trash2} size="sm" variant="danger" label={`Hapus grup ${group.name}`} onClick={() => setGroups((current) => current.filter((item) => item.id !== group.id))} />
                    </div>
                  </header>

                  <div className="option-group-rules">
                    <SegmentedControl size="sm" label="Jenis pilihan" value={group.selection_type}
                      onChange={(value) => updateGroup(group.id, {
                        selection_type: value,
                        options: value === 'single' ? group.options.map((option, index) => ({ ...option, is_default: option.is_default && index === group.options.findIndex((item) => item.is_default) })) : group.options,
                      })}
                      options={[{ value: 'single', label: 'Pilih satu' }, { value: 'multiple', label: 'Pilih beberapa' }]} />
                    <Switch size="sm" checked={group.is_required} onChange={(value) => updateGroup(group.id, { is_required: value })}
                      label={`${group.name || 'Grup'} wajib dipilih`} onLabel="Wajib" offLabel="Opsional" />
                    {group.selection_type === 'multiple' && (
                      <TextField className="option-max" hideLabel label="Maksimal pilihan" prefix="Maks." value={group.max_select ?? ''} inputMode="numeric" placeholder="∞"
                        onChange={(event) => updateGroup(group.id, { max_select: event.target.value.replace(/\D/g, '').slice(0, 2) || null })} />
                    )}
                  </div>

                  <table className="option-table">
                    <thead>
                      <tr><th scope="col">Pilihan</th><th scope="col">Harga tambahan</th><th scope="col">Bawaan</th><th scope="col">Tersedia</th><th scope="col"><span className="sr-only">Aksi</span></th></tr>
                    </thead>
                    <tbody>
                      {group.options.map((option) => (
                        <tr key={option.id}>
                          <td><TextField hideLabel label="Nama pilihan" value={option.name} maxLength={40} placeholder="Mis. Large"
                            onChange={(event) => updateOption(group.id, option.id, { name: event.target.value })} /></td>
                          <td><RupiahInput hideLabel label="Harga tambahan" value={option.price_delta}
                            onChange={(value) => updateOption(group.id, option.id, { price_delta: value === '' ? 0 : value })} /></td>
                          <td className="option-center">
                            <input type={group.selection_type === 'single' ? 'radio' : 'checkbox'} name={`default-${group.id}`} checked={option.is_default}
                              aria-label={`${option.name || 'Pilihan'} terpilih otomatis`}
                              onChange={(event) => updateOption(group.id, option.id, { is_default: group.selection_type === 'single' ? true : event.target.checked })} />
                          </td>
                          <td className="option-center">
                            <Switch size="sm" checked={option.is_available} onChange={(value) => updateOption(group.id, option.id, { is_available: value })} label={`${option.name || 'Pilihan'} tersedia`} />
                          </td>
                          <td className="option-center">
                            <IconButton icon={Trash2} size="sm" variant="danger" label={`Hapus ${option.name || 'pilihan'}`} disabled={group.options.length === 1}
                              onClick={() => updateGroup(group.id, { options: group.options.filter((item) => item.id !== option.id) })} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Button size="sm" variant="ghost" icon={Plus} onClick={() => updateGroup(group.id, { options: [...group.options, newOption()] })}>Tambah pilihan</Button>
                </section>
              ))}

              <div className="option-add">
                <Button variant="secondary" icon={Plus} onClick={() => setGroups((current) => [...current, newGroup()])}>Grup kosong</Button>
                <span className="option-add-label">atau templat:</span>
                {TEMPLATES.map((template) => (
                  <Button key={template.label} size="sm" variant="ghost" onClick={() => addFromTemplate(template)}>{template.label}</Button>
                ))}
              </div>
              {error && <p className="ui-field-error" role="alert">{error}</p>}
            </div>
          )}
    </Drawer>
  )
}
