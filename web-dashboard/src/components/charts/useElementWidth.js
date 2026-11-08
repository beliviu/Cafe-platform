import { useEffect, useRef, useState } from 'react'

/** Lebar elemen dalam piksel (ResizeObserver) — agar chart digambar di ukuran aslinya. */
export function useElementWidth(initial = 640) {
  const ref = useRef(null)
  const [width, setWidth] = useState(initial)

  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width)
      if (next > 0) setWidth(next)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}

/** Batas atas "bulat" + tick untuk sumbu Y. */
export function niceScale(max, tickCount = 4) {
  if (!max || max <= 0) return { max: 1, ticks: [0, 1] }
  const rough = max / tickCount
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough)
  const niceMax = Math.ceil(max / step) * step
  const ticks = []
  for (let value = 0; value <= niceMax + step / 2; value += step) ticks.push(value)
  return { max: niceMax, ticks }
}
