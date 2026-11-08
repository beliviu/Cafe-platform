/*
 * Pilih varian & add-on sebelum masuk keranjang. Aturan grup sama dengan place_order:
 * pilih satu / beberapa (maks.), wajib, pilihan habis tidak bisa dipilih.
 */
import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Button, Dialog, IconButton, TextField } from '../ui/index.js'
import { formatRupiah } from '../../lib/format.js'
import { defaultSelection, newLine } from '../../lib/pos.js'

export function OptionPickerDialog({ product, groups, initialLine, onClose, onSubmit }) {
  const [selected, setSelected] = useState(() => (initialLine
    ? Object.fromEntries(groups.map((group) => [group.id, initialLine.options.filter((option) => group.options.some((item) => item.id === option.id)).map((option) => option.id)]))
    : defaultSelection(groups)))
  const [quantity, setQuantity] = useState(initialLine?.quantity || 1)
  const [notes, setNotes] = useState(initialLine?.notes || '')
  const [error, setError] = useState('')

  const chosen = groups.flatMap((group) => group.options.filter((option) => (selected[group.id] || []).includes(option.id)))
  const unit = Number(product.price) + chosen.reduce((sum, option) => sum + Number(option.price_delta || 0), 0)

  function toggle(group, optionId) {
    setError('')
    setSelected((current) => {
      const list = current[group.id] || []
      if (group.selection_type === 'single') return { ...current, [group.id]: list.includes(optionId) && !group.is_required ? [] : [optionId] }
      if (list.includes(optionId)) return { ...current, [group.id]: list.filter((id) => id !== optionId) }
      const max = group.max_select || 99
      if (list.length >= max) {
        setError(`${group.name}: maksimal ${max} pilihan`)
        return current
      }
      return { ...current, [group.id]: [...list, optionId] }
    })
  }

  function submit(event) {
    event.preventDefault()
    const missing = groups.find((group) => group.is_required && !(selected[group.id] || []).length)
    if (missing) return setError(`Pilih ${missing.name.toLowerCase()}`)
    onSubmit({ ...newLine(product, chosen, quantity, notes.trim()), ...(initialLine ? { id: initialLine.id } : {}) })
    return undefined
  }

  return (
    <Dialog
      title={product.name}
      description={formatRupiah(product.price)}
      onClose={onClose}
      footer={(
        <>
          <div className="pos-qty" role="group" aria-label="Jumlah">
            <IconButton icon={Minus} label="Kurangi" variant="secondary" disabled={quantity <= 1} onClick={() => setQuantity((value) => Math.max(1, value - 1))} />
            <strong className="tabular">{quantity}</strong>
            <IconButton icon={Plus} label="Tambah" variant="secondary" disabled={quantity >= 99} onClick={() => setQuantity((value) => Math.min(99, value + 1))} />
          </div>
          <Button type="submit" form="option-picker">{initialLine ? 'Simpan' : 'Tambah'} · {formatRupiah(unit * quantity)}</Button>
        </>
      )}
    >
      <form id="option-picker" className="pos-options" onSubmit={submit} noValidate>
        {groups.map((group) => (
          <fieldset key={group.id} className="pos-option-group">
            <legend>
              {group.name}
              <small>{group.is_required ? 'Wajib' : 'Opsional'}{group.selection_type === 'multiple' ? ` · maks. ${group.max_select || group.options.length}` : ''}</small>
            </legend>
            <div className="pos-option-grid">
              {group.options.map((option) => {
                const active = (selected[group.id] || []).includes(option.id)
                return (
                  <label key={option.id} className={`ui-choice pos-choice${active ? ' is-selected' : ''}${option.is_available ? '' : ' is-disabled'}`}>
                    <input
                      type={group.selection_type === 'single' ? 'radio' : 'checkbox'}
                      name={`group-${group.id}`}
                      checked={active}
                      disabled={!option.is_available}
                      onChange={() => toggle(group, option.id)}
                    />
                    <span>{option.name}</span>
                    <small className="tabular">{!option.is_available ? 'Habis' : Number(option.price_delta) ? `+${formatRupiah(option.price_delta)}` : 'Gratis'}</small>
                  </label>
                )
              })}
            </div>
          </fieldset>
        ))}
        <TextField label="Catatan item" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={200} placeholder="Mis. less ice, tanpa gula" />
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}
