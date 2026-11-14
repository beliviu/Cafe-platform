import { useEffect, useId, useRef, useState } from 'react'

/**
 * Menu tarik-turun sederhana (ekspor, aksi baris).
 * trigger: ({ open, toggle, props }) => elemen tombol; props wajib disebar ke tombol.
 * items: [{ label, icon, onSelect, tone?: 'danger', disabled? }]
 */
export function Menu({ trigger, items, align = 'end', label }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const itemRefs = useRef([])
  const menuId = useId()

  useEffect(() => {
    if (!open) return undefined
    itemRefs.current.find(Boolean)?.focus()
    function handlePointer(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointer)
    return () => document.removeEventListener('pointerdown', handlePointer)
  }, [open])

  function close(refocus = true) {
    setOpen(false)
    if (refocus) rootRef.current?.querySelector('[aria-haspopup="menu"]')?.focus()
  }

  function handleKeyDown(event) {
    const enabled = itemRefs.current.filter((node) => node && !node.disabled)
    const index = enabled.indexOf(document.activeElement)
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault()
      close(event.key === 'Escape')
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      enabled[(index + delta + enabled.length) % enabled.length]?.focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      enabled[event.key === 'Home' ? 0 : enabled.length - 1]?.focus()
    }
  }

  return (
    <div className="ui-menu-root" ref={rootRef}>
      {trigger({
        open,
        props: {
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'aria-controls': open ? menuId : undefined,
          onClick: () => setOpen((current) => !current),
        },
      })}
      {open && (
        <div className={`ui-menu ui-menu-${align}`} role="menu" id={menuId} aria-label={label} onKeyDown={handleKeyDown}>
          {items.map((item, index) => {
            const Icon = item.icon
            return (
              <button
                key={item.label}
                ref={(node) => { itemRefs.current[index] = node }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                className={`ui-menu-item${item.tone === 'danger' ? ' is-danger' : ''}`}
                onClick={() => {
                  close(false)
                  item.onSelect()
                }}
              >
                {Icon && <Icon size={16} aria-hidden="true" />}
                <span>{item.label}</span>
                {item.hint && <small>{item.hint}</small>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
