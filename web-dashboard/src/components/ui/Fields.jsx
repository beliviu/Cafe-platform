import { useId } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'

function FieldShell({ id, label, hint, error, children, hideLabel = false, className = '' }) {
  return (
    <div className={`ui-field ${className}`.trim()}>
      {label && <label htmlFor={id} className={`ui-field-label${hideLabel ? ' sr-only' : ''}`}>{label}</label>}
      {children}
      {error ? <p className="ui-field-error" id={`${id}-error`} role="alert">{error}</p>
        : hint ? <p className="ui-field-hint" id={`${id}-hint`}>{hint}</p> : null}
    </div>
  )
}

function describedBy(id, hint, error) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined
}

export function TextField({ label, hint, error, hideLabel, prefix, suffix, multiline = false, className, id: providedId, ...props }) {
  const autoId = useId()
  const id = providedId || autoId
  const InputTag = multiline ? 'textarea' : 'input'
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} hideLabel={hideLabel} className={className}>
      <span className={`ui-input-wrap${error ? ' has-error' : ''}${multiline ? ' is-multiline' : ''}`}>
        {prefix && <span className="ui-input-affix">{prefix}</span>}
        <InputTag id={id} className="ui-input" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...props} />
        {suffix && <span className="ui-input-affix">{suffix}</span>}
      </span>
    </FieldShell>
  )
}

/** options: [{ value, label }] atau [[value, label]] */
export function Select({ label, hint, error, hideLabel, options = [], className, id: providedId, ...props }) {
  const autoId = useId()
  const id = providedId || autoId
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} hideLabel={hideLabel} className={className}>
      <span className={`ui-select-wrap${error ? ' has-error' : ''}`}>
        <select id={id} className="ui-select" aria-describedby={describedBy(id, hint, error)} {...props}>
          {options.map((option) => {
            const [value, optionLabel] = Array.isArray(option) ? option : [option.value, option.label]
            return <option key={value} value={value}>{optionLabel}</option>
          })}
        </select>
        <ChevronDown size={16} className="ui-select-chevron" aria-hidden="true" />
      </span>
    </FieldShell>
  )
}

export function SearchInput({ value, onChange, placeholder = 'Cari…', label = 'Cari', className = '', ...props }) {
  const id = useId()
  return (
    <div className={`ui-search ${className}`.trim()} role="search">
      <label htmlFor={id} className="sr-only">{label}</label>
      <Search size={16} className="ui-search-icon" aria-hidden="true" />
      <input
        id={id}
        type="search"
        className="ui-search-input"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape' && value) { event.stopPropagation(); onChange('') } }}
        {...props}
      />
      {value && (
        <button type="button" className="ui-search-clear" aria-label="Hapus pencarian" onClick={() => onChange('')}>
          <X size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/** Toggle switch dengan label teks yang terlihat (mis. "Tersedia" / "Habis"). */
export function Switch({ checked, onChange, label, onLabel, offLabel, disabled = false, size = 'md' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`ui-switch ui-switch-${size}${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-switch-track" aria-hidden="true"><span className="ui-switch-thumb" /></span>
      {(onLabel || offLabel) && <span className="ui-switch-text">{checked ? onLabel : offLabel}</span>}
    </button>
  )
}
