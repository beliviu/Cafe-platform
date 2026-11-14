import { useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, Search } from 'lucide-react'
import { Skeleton } from '../components/Skeleton.jsx'

/**
 * Palet perintah (Ctrl/Cmd+K).
 * - entries: [{ key, label, hint?, group?, icon, run }] — halaman & perintah yang selalu ada.
 * - search:  async (query) => entries — pencarian data (kafe, produk, pesanan). Dipanggil setelah 2 huruf,
 *            ditunda 220 ms. Kesalahan pencarian tidak menghalangi daftar halaman.
 */
export function CommandPalette({ open, onClose, entries, search, placeholder = 'Cari halaman atau perintah…' }) {
  const ref = useRef(null)
  const listRef = useRef(null)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [remote, setRemote] = useState({ query: '', items: [], loading: false })

  const trimmed = query.trim()
  const local = useMemo(() => {
    const words = trimmed.toLocaleLowerCase('id').split(/\s+/).filter(Boolean)
    return words.length ? entries.filter((entry) => words.every((word) => `${entry.label} ${entry.hint || ''}`.toLocaleLowerCase('id').includes(word))) : entries
  }, [entries, trimmed])

  useEffect(() => {
    if (!search || !open || trimmed.length < 2) return undefined
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setRemote((current) => ({ ...current, loading: true }))
      try {
        const items = await search(trimmed)
        if (!cancelled) setRemote({ query: trimmed, items: Array.isArray(items) ? items : [], loading: false })
      } catch {
        if (!cancelled) setRemote({ query: trimmed, items: [], loading: false })
      }
    }, 220)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [search, open, trimmed])

  const remoteItems = search && trimmed.length >= 2 && remote.query === trimmed ? remote.items : []
  const searching = Boolean(search) && trimmed.length >= 2 && (remote.loading || remote.query !== trimmed)
  const all = [...local, ...remoteItems]
  const active = Math.min(cursor, Math.max(0, all.length - 1))

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function close() {
    setQuery('')
    setCursor(0)
    onClose()
  }
  function choose(entry) {
    if (!entry) return
    close()
    entry.run()
  }
  function onKeyDown(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setCursor(Math.min(all.length - 1, active + 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setCursor(Math.max(0, active - 1)) }
    if (event.key === 'Enter') { event.preventDefault(); choose(all[active]) }
  }

  let lastGroup = null
  return (
    <dialog ref={ref} className="cmdk" aria-label="Cari"
      onCancel={(event) => { event.preventDefault(); close() }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <div className="cmdk-panel">
        <label className="cmdk-search">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">{placeholder}</span>
          <input autoFocus value={query} placeholder={placeholder} role="combobox" aria-expanded="true" aria-controls="cmdk-list"
            aria-activedescendant={all[active] ? `cmdk-${active}` : undefined}
            onChange={(event) => { setQuery(event.target.value); setCursor(0) }} onKeyDown={onKeyDown} />
          <kbd>Esc</kbd>
        </label>
        <ul id="cmdk-list" ref={listRef} className="cmdk-list" role="listbox" aria-busy={searching || undefined}>
          {all.map((entry, index) => {
            const Icon = entry.icon
            const heading = entry.group && entry.group !== lastGroup ? entry.group : null
            lastGroup = entry.group || lastGroup
            return [
              heading && <li key={`h-${heading}`} className="cmdk-heading" role="presentation">{heading}</li>,
              <li key={entry.key} id={`cmdk-${index}`} role="option" aria-selected={index === active}
                className={`cmdk-item${index === active ? ' is-active' : ''}`} onMouseMove={() => setCursor(index)} onMouseDown={(event) => { event.preventDefault(); choose(entry) }}>
                <span className="cmdk-icon">{Icon && <Icon size={16} aria-hidden="true" />}</span>
                <span className="cmdk-label">{entry.label}</span>
                {entry.hint && <span className="cmdk-hint">{entry.hint}</span>}
                {index === active && <CornerDownLeft size={14} aria-hidden="true" className="cmdk-enter" />}
              </li>,
            ]
          })}
          {searching && [0, 1].map((row) => (
            <li key={`s-${row}`} className="cmdk-item is-skeleton" role="presentation"><Skeleton width={30} height={30} radius={8} /><Skeleton width={row ? '38%' : '52%'} /></li>
          ))}
          {!searching && all.length === 0 && <li className="cmdk-empty" role="presentation">Tidak ada yang cocok dengan “{trimmed}”.</li>}
        </ul>
        <footer className="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> pilih</span><span><kbd>Enter</kbd> buka</span><span><kbd>Esc</kbd> tutup</span></footer>
      </div>
    </dialog>
  )
}
