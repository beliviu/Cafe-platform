// Salinan dari web-dashboard/src/components/ui/RupiahInput.jsx — sinkronkan manual bila aslinya berubah.
import { parseRupiah } from '../../lib/format.js'
import { TextField } from './Fields.jsx'

/** "28000" → "28.000" */
function formatDigits(value) {
  if (value === '' || value === null || value === undefined) return ''
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(value))
}

/**
 * Input Rupiah terformat (pemisah ribuan otomatis). value: number | ''.
 * Selalu bilangan bulat — harga di kafe tidak memakai sen.
 */
export function RupiahInput({ value, onChange, label = 'Harga', ...props }) {
  return (
    <TextField
      label={label}
      prefix="Rp"
      inputMode="numeric"
      autoComplete="off"
      value={formatDigits(value)}
      onChange={(event) => onChange(parseRupiah(event.target.value))}
      {...props}
    />
  )
}
