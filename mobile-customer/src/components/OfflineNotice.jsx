/*
 * Pemberitahuan "offline" untuk app versi web (event online/offline browser).
 * Di Android/iOS tidak ditampilkan (butuh paket NetInfo); permintaan baca tetap dicoba ulang otomatis.
 */
import { useEffect, useState } from 'react'
import { Platform, View } from 'react-native'
import { WifiOff } from 'lucide-react-native'
import { Text } from './ui/Text.jsx'
import { makeStyles, useTheme } from '../theme/useTheme.js'

export function OfflineNotice() {
  const styles = useStyles()
  const { STATUS_TONES } = useTheme()
  const [online, setOnline] = useState(true)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined
    const sync = () => setOnline(window.navigator.onLine)
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync) }
  }, [])
  if (online) return null
  return (
    <View style={styles.bar} accessibilityRole="alert">
      <WifiOff size={16} color={STATUS_TONES.amber.fg} />
      <Text size="sm" weight="600" style={{ color: STATUS_TONES.amber.fg }}>Tidak ada koneksi internet. Pesanan baru bisa dikirim setelah tersambung.</Text>
    </View>
  )
}

const useStyles = makeStyles(({ STATUS_TONES }) => ({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: STATUS_TONES.amber.bg },
}))
