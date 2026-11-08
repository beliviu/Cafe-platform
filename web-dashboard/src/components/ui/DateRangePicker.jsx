import { useEffect, useId, useRef, useState } from 'react'
import { CalendarDays, Check, ChevronDown } from 'lucide-react'
import { MAX_RANGE_DAYS, RANGE_PRESETS, resolveRange } from '../../lib/dateRange.js'
import { addDaysToKey } from '../../lib/format.js'
import { Button } from './Button.jsx'

/**
 * Satu kontrol untuk rentang tanggal: preset (Hari ini, 7 hari, 30 hari, Bulan ini)
 * + rentang khusus di bagian bawah. Nilai: { preset, custom: { startKey, endKey } }.
 */
export function DateRangePicker({ value, onChange, presets = RANGE_PRESETS, allowAll = false, label = 'Rentang tanggal' }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const listId = useId()
  const range = value.preset === 'all' ? null : resolveRange(value.preset, value.custom)
  const todayKey = resolveRange('today').todayKey
  const [draft, setDraft] = useState(() => ({
    startKey: value.custom?.startKey || range?.startKey || addDaysToKey(todayKey, -6),
    endKey: value.custom?.endKey || range?.endKey || todayKey,
  }))
  const [draftError, setDraftError] = useState('')

  useEffect(() => {
    if (!open) return undefined
    function handlePointer(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    function handleKey(event) {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const options = allowAll ? [{ value: 'all', label: 'Semua waktu' }, ...presets] : presets
  const selectedLabel = value.preset === 'all'
    ? 'Semua waktu'
    : value.preset === 'custom'
      ? range.label.replace('Hari ini, ', '')
      : options.find((option) => option.value === value.preset)?.label

  function choose(preset) {
    onChange({ preset, custom: value.custom })
    setOpen(false)
    buttonRef.current?.focus()
  }

  function applyCustom(event) {
    event.preventDefault()
    if (!draft.startKey || !draft.endKey) {
      setDraftError('Isi tanggal mulai dan selesai.')
      return
    }
    const [startKey, endKey] = draft.startKey <= draft.endKey ? [draft.startKey, draft.endKey] : [draft.endKey, draft.startKey]
    const next = resolveRange('custom', { startKey, endKey })
    if (next.startKey !== startKey) {
      setDraftError(`Maksimal ${MAX_RANGE_DAYS} hari. Rentang disesuaikan.`)
    } else {
      setDraftError('')
    }
    onChange({ preset: 'custom', custom: { startKey: next.startKey, endKey: next.endKey } })
    setOpen(false)
  }

  return (
    <div className="ui-daterange" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`ui-daterange-button${open ? ' is-open' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
      >
        <CalendarDays size={16} aria-hidden="true" />
        <span className="sr-only">{label}: </span>
        <span>{selectedLabel}</span>
        <ChevronDown size={15} aria-hidden="true" className="ui-daterange-chevron" />
      </button>

      {open && (
        <div className="ui-daterange-popover" id={listId} role="group" aria-label={label}>
          <ul className="ui-daterange-list">
            {options.map((option) => {
              const selected = option.value === value.preset
              return (
                <li key={option.value}>
                  <button type="button" className={`ui-daterange-option${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={() => choose(option.value)}>
                    <span>{option.label}</span>
                    {selected && <Check size={16} strokeWidth={2.6} aria-hidden="true" />}
                  </button>
                </li>
              )
            })}
          </ul>
          <form className="ui-daterange-custom" onSubmit={applyCustom}>
            <span className="ui-daterange-custom-title">Rentang khusus</span>
            <div className="ui-daterange-inputs">
              <label>
                <span>Dari</span>
                <input type="date" max={todayKey} value={draft.startKey} onChange={(event) => setDraft((current) => ({ ...current, startKey: event.target.value }))} />
              </label>
              <label>
                <span>Sampai</span>
                <input type="date" max={todayKey} value={draft.endKey} onChange={(event) => setDraft((current) => ({ ...current, endKey: event.target.value }))} />
              </label>
            </div>
            {draftError && <p className="ui-field-error" role="alert">{draftError}</p>}
            <Button type="submit" size="sm" variant={value.preset === 'custom' ? 'primary' : 'secondary'} block>Terapkan rentang</Button>
          </form>
        </div>
      )}
    </div>
  )
}
