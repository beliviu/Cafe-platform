import { useState } from 'react'
import { Modal, Pressable, View } from 'react-native'
import { AlertTriangle } from 'lucide-react-native'
import { RADIUS } from '../../theme/tokens.js'
import { Button } from './Button.jsx'
import { Text } from './Text.jsx'
import { makeStyles, useTheme } from '../../theme/useTheme.js'

/**
 * Konfirmasi aksi berisiko (keluar akun, kosongkan keranjang, batalkan).
 * onConfirm boleh async — tombol menampilkan loading sampai selesai.
 */
export function ConfirmDialog({ visible, title, description, confirmLabel = 'Ya, lanjutkan', cancelLabel = 'Batal', tone = 'danger', onConfirm, onClose }) {
  const styles = useStyles()
  const { STATUS_TONES } = useTheme()
  const [busy, setBusy] = useState(false)

  async function handleConfirm() {
    setBusy(true)
    try {
      await onConfirm?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? undefined : onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose} accessibilityLabel="Tutup dialog">
        <Pressable style={styles.panel} accessibilityViewIsModal onPress={() => {}}>
          {tone === 'danger' && (
            <View style={styles.icon}><AlertTriangle size={22} color={STATUS_TONES.red.fg} /></View>
          )}
          <Text serif weight="600" size="xl" accessibilityRole="header">{title}</Text>
          {description ? <Text tone="secondary" style={styles.description}>{description}</Text> : null}
          <View style={styles.actions}>
            <Button title={cancelLabel} variant="secondary" onPress={onClose} disabled={busy} style={styles.action} />
            <Button title={confirmLabel} variant={tone === 'danger' ? 'danger' : 'primary'} onPress={handleConfirm} loading={busy} style={styles.action} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const useStyles = makeStyles(({ COLORS, STATUS_TONES, SHADOW }) => ({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: COLORS.overlay },
  panel: { width: '100%', maxWidth: 400, gap: 10, padding: 22, backgroundColor: COLORS.card, borderRadius: RADIUS.xl, ...SHADOW.lg },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: STATUS_TONES.red.bg, borderRadius: 22, marginBottom: 2 },
  description: { lineHeight: 21 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  action: { flex: 1 },
}))
