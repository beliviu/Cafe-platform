/*
 * Kode QR dari teks (qr_string QRIS dari gateway) — digambar sebagai SVG di perangkat.
 */
import { useMemo } from 'react'
import { View } from 'react-native'
import Svg, { Path, Rect } from 'react-native-svg'
// Build CommonJS paket ini hanya punya ekspor default (named export hanya di versi ESM)
// eslint-disable-next-line import/no-named-as-default
import qrcode from 'qrcode-generator'

export function QrCode({ value, size = 240, label = 'Kode QR' }) {
  const matrix = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const count = qr.getModuleCount()
    let path = ''
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`
      }
    }
    return { count, path }
  }, [value])
  const margin = 4
  const total = matrix.count + margin * 2
  return (
    <View accessibilityRole="image" accessibilityLabel={label}>
      <Svg width={size} height={size} viewBox={`${-margin} ${-margin} ${total} ${total}`}>
        <Rect x={-margin} y={-margin} width={total} height={total} fill="#FFFFFF" />
        <Path d={matrix.path} fill="#000000" />
      </Svg>
    </View>
  )
}
