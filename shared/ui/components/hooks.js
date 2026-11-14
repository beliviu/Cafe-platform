import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAppearance } from '../theme/appearance.js'

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * Indikator meluncur: mengukur elemen terpilih (selector) di dalam wadah, lalu menaruh posisinya
 * sebagai CSS variable --ind-x/--ind-y/--ind-w/--ind-h di wadah. CSS yang menganimasikan (pegas).
 * `data-ind="ready"` dipasang setelah posisi pertama, supaya tampilan awal tidak ikut beranimasi.
 */
export function useSlidingIndicator(selector, deps = []) {
  const ref = useRef(null)
  useIsoLayoutEffect(() => {
    const root = ref.current
    if (!root) return undefined
    let frame = 0
    const measure = () => {
      const target = root.querySelector(selector)
      if (!target) {
        root.dataset.ind = 'none'
        return
      }
      const a = root.getBoundingClientRect()
      const b = target.getBoundingClientRect()
      root.style.setProperty('--ind-x', `${b.left - a.left + root.scrollLeft - root.clientLeft}px`)
      root.style.setProperty('--ind-y', `${b.top - a.top + root.scrollTop - root.clientTop}px`)
      root.style.setProperty('--ind-w', `${b.width}px`)
      root.style.setProperty('--ind-h', `${b.height}px`)
      if (root.dataset.ind !== 'ready') {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => { root.dataset.ind = 'ready' })
      }
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(root)
    // Anak-anaknya ikut diamati: isi yang membuka/menutup (grup menu) menggeser posisi elemen terpilih
    if (observer) for (const child of root.children) observer.observe(child)
    document.fonts?.ready?.then(measure).catch(() => {})
    return () => { observer?.disconnect(); cancelAnimationFrame(frame) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ref
}

/** Angka menghitung naik dari nilai sebelumnya ke `value` (ease-out). Tanpa animasi bila dimatikan. */
export function useCountUp(value, { duration = 900 } = {}) {
  const target = Number.isFinite(value) ? value : 0
  const { animate } = useAppearance()
  const [shown, setShown] = useState(0)
  const fromRef = useRef(0)
  useEffect(() => {
    if (!animate) {
      fromRef.current = target
      return undefined
    }
    const from = fromRef.current
    const start = performance.now()
    let frame = 0
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const current = from + (target - from) * (1 - (1 - t) ** 4)
      fromRef.current = current
      setShown(t === 1 ? target : current)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, duration, animate])
  return animate ? shown : target
}

/** Lebar elemen (ResizeObserver) untuk grafik SVG responsif. */
export function useElementWidth(fallback = 600) {
  const ref = useRef(null)
  const [width, setWidth] = useState(fallback)
  useIsoLayoutEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const update = () => setWidth(Math.max(120, Math.round(node.getBoundingClientRect().width)))
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(node)
    return () => observer?.disconnect()
  }, [])
  return [ref, width]
}
