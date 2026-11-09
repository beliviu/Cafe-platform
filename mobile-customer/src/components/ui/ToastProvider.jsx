import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react-native'
import { RADIUS } from '../../theme/tokens.js'
import { Text } from './Text.jsx'
import { ToastContext } from './ToastContext.js'
import { makeStyles, useTheme } from '../../theme/useTheme.js'

const TONES = {
  success: { icon: CheckCircle2, key: 'green' },
  error: { icon: AlertCircle, key: 'red' },
  info: { icon: Info, key: 'blue' },
}

function ToastView({ toast, onDismiss }) {
  const styles = useStyles()
  const { STATUS_TONES } = useTheme()
  const [progress] = useState(() => new Animated.Value(0))
  useEffect(() => {
    Animated.spring(progress, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 220 }).start()
  }, [progress])
  const tone = TONES[toast.tone] || TONES.info
  const Icon = tone.icon
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityRole={toast.tone === 'error' ? 'alert' : 'text'}
      style={[styles.toast, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }] }]}
    >
      <Icon size={20} color={STATUS_TONES[tone.key].fg} />
      <View style={styles.text}>
        <Text weight="700" size="sm">{toast.title}</Text>
        {toast.description ? <Text size="xs" tone="muted">{toast.description}</Text> : null}
      </View>
      {toast.action ? (
        <Pressable accessibilityRole="button" onPress={() => { toast.action.onPress(); onDismiss(toast.id) }} hitSlop={10} style={styles.action}>
          <Text weight="700" size="sm" tone="brand">{toast.action.label}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  )
}

/** Toast di bagian atas layar (tidak menutupi tab bar / sticky cart bar). */
export function ToastProvider({ children }) {
  const styles = useStyles()
  const insets = useSafeAreaInsets()
  const [toasts, setToasts] = useState([])
  const counter = useRef(0)

  const dismiss = useCallback((id) => setToasts((current) => current.filter((item) => item.id !== id)), [])
  const toast = useCallback(({ title, description, tone = 'success', duration = 2600, action }) => {
    const id = ++counter.current
    setToasts((current) => [...current.slice(-1), { id, title, description, tone, action }])
    setTimeout(() => dismiss(id), duration)
    return id
  }, [dismiss])

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <View pointerEvents="box-none" style={[styles.region, { top: insets.top + 8 }]}>
        {toasts.map((item) => <ToastView key={item.id} toast={item} onDismiss={dismiss} />)}
      </View>
    </ToastContext.Provider>
  )
}

const useStyles = makeStyles(({ COLORS, SHADOW }) => ({
  region: { position: 'absolute', left: 16, right: 16, gap: 8, alignItems: 'center' },
  toast: {
    width: '100%', maxWidth: 440, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, ...SHADOW.md,
  },
  text: { flex: 1, gap: 2 },
  action: { paddingHorizontal: 6, paddingVertical: 4 },
}))
