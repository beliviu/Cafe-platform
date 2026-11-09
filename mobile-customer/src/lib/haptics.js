import { Platform } from 'react-native'
import * as Haptics from 'expo-haptics'

const supported = Platform.OS === 'ios' || Platform.OS === 'android'

/** Getar ringan — mis. saat menambah item ke keranjang. Diam-diam diabaikan di web/perangkat tanpa haptic. */
export function tapLight() {
  if (supported) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
}

export function notifySuccess() {
  if (supported) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
}

export function notifyWarning() {
  if (supported) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
}
