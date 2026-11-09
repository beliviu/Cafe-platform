import { View } from 'react-native'
import { Text } from './ui/Text.jsx'
import { makeStyles } from '../theme/useTheme.js'

const SIZE = 21

function isFinderCell(row, column, top, left) {
  const y = row - top
  const x = column - left
  if (x < 0 || x > 6 || y < 0 || y > 6) return null
  return x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4)
}

function isDarkCell(row, column) {
  for (const [top, left] of [[0, 0], [0, SIZE - 7], [SIZE - 7, 0]]) {
    const finderCell = isFinderCell(row, column, top, left)
    if (finderCell !== null) return finderCell
  }
  return (row * 17 + column * 29 + row * column * 5) % 13 < 6
}

const MATRIX = Array.from({ length: SIZE }, (_, row) =>
  Array.from({ length: SIZE }, (_, column) => isDarkCell(row, column)),
)

const INSTRUCTIONS = [
  'Dalam integrasi nyata: buka aplikasi bank atau e-wallet.',
  'Pilih pemindai QRIS dan scan kode merchant resmi.',
  'Konfirmasi pembayaran di aplikasi penyedia.',
]

export function DemoQrisPanel({ total, totalLabel = 'Total sementara', status }) {
  const styles = useStyles()
  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <View>
          <Text style={styles.eyebrow}>PEMBAYARAN · DEMO</Text>
          <Text style={styles.title}>QRIS</Text>
        </View>
        <View style={styles.status}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>{status}</Text>
        </View>
      </View>

      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>DEMO PAYMENT — NOT A REAL TRANSACTION</Text>
        <Text style={styles.noticeCopy}>Tidak ada uang yang ditagihkan. Tagihan pesanan tetap belum lunas.</Text>
      </View>

      <View style={styles.amount}>
        <Text style={styles.amountLabel}>{totalLabel}</Text>
        <Text style={styles.amountValue}>{total}</Text>
      </View>

      <View style={styles.qrFrame} accessibilityRole="image" accessibilityLabel="Pola QR demo, bukan kode pembayaran yang bisa dipindai">
        <View style={styles.matrix}>
          {MATRIX.flatMap((row, rowIndex) => row.map((dark, columnIndex) => (
            <View
              key={`${rowIndex}-${columnIndex}`}
              style={[styles.module, dark && styles.moduleDark]}
            />
          )))}
        </View>
        <View style={styles.demoStamp}>
          <Text style={styles.demoStampText}>DEMO</Text>
          <Text style={styles.demoStampCaption}>NOT PAYABLE</Text>
        </View>
      </View>
      <Text style={styles.codeCaption}>Pola visual saja · tidak terhubung ke merchant atau payment gateway</Text>

      <View style={styles.instructions}>
        <Text style={styles.instructionsTitle}>Alur QRIS saat payment gateway tersedia</Text>
        {INSTRUCTIONS.map((instruction, index) => (
          <View key={instruction} style={styles.instructionRow}>
            <View style={styles.step}><Text style={styles.stepText}>{index + 1}</Text></View>
            <Text style={styles.instructionText}>{instruction}</Text>
          </View>
        ))}
        <Text style={styles.instructionsNote}>Demo ini belum terhubung ke payment gateway. Gunakan tombol simulasi untuk menyelesaikan pratinjau.</Text>
      </View>
    </View>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  panel: { gap: 16, padding: 18, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 20 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  eyebrow: { color: COLORS.accentText, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  title: { marginTop: 2, color: COLORS.ink, fontFamily: 'Fraunces', fontSize: 24, fontWeight: '700' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 7, maxWidth: '52%', paddingHorizontal: 10, paddingVertical: 7, backgroundColor: COLORS.sunken, borderRadius: 20 },
  statusDot: { width: 7, height: 7, backgroundColor: COLORS.accent, borderRadius: 4 },
  statusText: { color: COLORS.textSecondary, fontSize: 10, fontWeight: '700' },
  amount: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  amountLabel: { color: COLORS.muted, fontSize: 12 },
  amountValue: { color: COLORS.ink, fontSize: 18, fontWeight: '800' },
  qrFrame: { position: 'relative', alignSelf: 'center', alignItems: 'center', justifyContent: 'center', width: 198, height: 198, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, borderRadius: 12 },
  matrix: { flexDirection: 'row', flexWrap: 'wrap', width: 168, height: 168, gap: 2, alignContent: 'flex-start' },
  module: { width: 6, height: 6, backgroundColor: '#fff' },
  moduleDark: { backgroundColor: '#1A120D' }, // QR selalu gelap di atas putih agar bisa dipindai
  demoStamp: { position: 'absolute', alignItems: 'center', justifyContent: 'center', width: 88, height: 42, backgroundColor: '#fff', borderWidth: 2, borderColor: COLORS.accent, borderRadius: 7, transform: [{ rotate: '-8deg' }] },
  demoStampText: { color: COLORS.accentText, fontSize: 15, fontWeight: '900', letterSpacing: 1.1, lineHeight: 18 },
  demoStampCaption: { color: COLORS.muted, fontSize: 6, fontWeight: '800', letterSpacing: 0.7 },
  codeCaption: { color: COLORS.muted, fontSize: 10, lineHeight: 15, textAlign: 'center' },
  notice: { gap: 4, padding: 12, backgroundColor: COLORS.accentSoft, borderRadius: 12 },
  noticeTitle: { color: COLORS.accentText, fontSize: 10, fontWeight: '900', letterSpacing: 0.35 },
  noticeCopy: { color: COLORS.textSecondary, fontSize: 11, lineHeight: 16 },
  instructions: { gap: 10 },
  instructionsTitle: { color: COLORS.ink, fontSize: 13, fontWeight: '800' },
  instructionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  step: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primaryTint, borderRadius: 10 },
  stepText: { color: COLORS.primary, fontSize: 10, fontWeight: '800' },
  instructionText: { flex: 1, paddingTop: 1, color: COLORS.textSecondary, fontSize: 11, lineHeight: 16 },
  instructionsNote: { color: COLORS.muted, fontSize: 10, lineHeight: 15 },
}))
