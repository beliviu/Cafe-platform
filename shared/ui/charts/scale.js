/** Skala sumbu "rapi": { max, ticks } dengan langkah 1/2/2,5/5 × 10^n. */
export function niceScale(maxValue, tickCount = 4) {
  if (!(maxValue > 0)) return { max: 1, ticks: [0, 1] }
  const rough = maxValue / tickCount
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].find((unit) => unit * power >= rough) * power
  const max = Math.ceil(maxValue / step) * step
  const ticks = []
  for (let value = 0; value <= max + step / 2; value += step) ticks.push(Number(value.toPrecision(12)))
  return { max, ticks }
}

/** Batang dengan ujung atas membulat dan dasar persegi. */
export function barPath(x, y, width, height, radius = 4) {
  if (height <= 0) return ''
  const r = Math.min(radius, width / 2, height)
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
