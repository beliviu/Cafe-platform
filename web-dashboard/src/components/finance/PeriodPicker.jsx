/*
 * Pemilih periode laporan: bulan ini, bulan lalu, kuartal, tahun, bulan tertentu, atau rentang bebas.
 * Nilai: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', key }.
 */
import { useState } from 'react'
import { Select, TextField } from '../ui/index.js'
import { jakartaDateKey } from '../../lib/format.js'
import { MONTHS, pad, periodFor } from '../../lib/finance.js'

export function PeriodPicker({ value, onChange, minDate, single = false }) {
  const today = jakartaDateKey()
  const [year, month] = today.split('-').map(Number)
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - index, 1))
    const key = `m:${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`
    return { value: key, label: `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}` }
  }).filter((option) => !minDate || periodFor(option.value).to >= minDate)
  const [custom, setCustom] = useState(value.key === 'custom')

  if (single) {
    return (
      <TextField label="Per tanggal" hideLabel type="date" value={value.to} max={today} min={minDate || undefined}
        onChange={(event) => event.target.value && onChange({ from: value.from, to: event.target.value, key: 'custom' })} />
    )
  }
  return (
    <div className="period-picker">
      <Select hideLabel label="Periode" value={custom ? 'custom' : value.key}
        onChange={(event) => {
          const key = event.target.value
          if (key === 'custom') {
            setCustom(true)
            return
          }
          setCustom(false)
          onChange({ ...periodFor(key, today), key })
        }}
        options={[
          { value: 'this-month', label: 'Bulan ini' },
          { value: 'last-month', label: 'Bulan lalu' },
          { value: 'last-3', label: '3 bulan terakhir' },
          { value: 'this-year', label: 'Tahun ini' },
          { value: 'last-year', label: 'Tahun lalu' },
          ...months,
          { value: 'custom', label: 'Rentang tanggal…' },
        ]} />
      {custom && (
        <>
          <TextField hideLabel label="Dari" type="date" value={value.from} max={value.to} onChange={(event) => event.target.value && onChange({ ...value, from: event.target.value, key: 'custom' })} />
          <TextField hideLabel label="Sampai" type="date" value={value.to} min={value.from} max={today} onChange={(event) => event.target.value && onChange({ ...value, to: event.target.value, key: 'custom' })} />
        </>
      )}
    </div>
  )
}
