/*
 * Perhitungan pajak, service charge, dan pembulatan dari cafe_settings. Salinan dari web-dashboard/src/lib/pricing.js.
 * Di app hanya untuk PERKIRAAN total di checkout — angka final selalu dihitung database.
 *
 * Urutan: subtotal → service charge → pajak (dari subtotal + service bila "service kena pajak")
 *         → pembulatan ke kelipatan terdekat.
 * Pajak "sudah termasuk harga": pajak tidak ditambahkan, hanya dicatat porsinya.
 */

const round2 = (value) => Math.round(value * 100) / 100

export function computeCharges(subtotal, settings) {
  const base = Math.max(0, Number(subtotal) || 0)
  const serviceRate = settings?.service_charge_enabled ? Number(settings.service_charge_rate) || 0 : 0
  const taxRate = settings?.tax_enabled ? Number(settings.tax_rate) || 0 : 0

  const service = round2(base * serviceRate / 100)
  const taxBase = base + (settings?.service_charge_taxable ? service : 0)
  const inclusive = Boolean(settings?.tax_inclusive)
  const tax = round2(inclusive ? taxBase - taxBase / (1 + taxRate / 100) : taxBase * taxRate / 100)

  const beforeRounding = base + service + (inclusive ? 0 : tax)
  const unit = Number(settings?.rounding_unit) || 0
  const total = unit ? Math.round(beforeRounding / unit) * unit : round2(beforeRounding)

  return {
    subtotal: base,
    service,
    serviceRate,
    tax,
    taxRate,
    taxInclusive: inclusive,
    rounding: round2(total - beforeRounding),
    total,
  }
}
