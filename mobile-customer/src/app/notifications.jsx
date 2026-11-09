import { router } from 'expo-router'
import { Pressable, View } from 'react-native'
import { Bell, LifeBuoy, ReceiptText, Sparkles } from 'lucide-react-native'
import { useAuth } from '../auth/useAuth.js'
import { useBrand } from '../brand/useBrand.js'
import { Button, EmptyState, LoadingState, Screen } from '../components/ui.jsx'
import { Text } from '../components/ui/Text.jsx'
import { formatRelative } from '../lib/format.js'
import { notificationTarget, useNotifications } from '../lib/useNotifications.js'
import { makeStyles } from '../theme/useTheme.js'

const ICONS = { order: ReceiptText, support: LifeBuoy, loyalty: Sparkles, info: Bell }

export default function NotificationsScreen() {
  const styles = useStyles()
  const { session } = useAuth()
  const { brand } = useBrand()
  const { items, loading, unread, markRead } = useNotifications({ limit: 100 })

  if (!session) return <Screen><EmptyState icon={Bell} title="Masuk untuk melihat notifikasi" action={<Button title="Masuk" onPress={() => router.push('/login')} />} /></Screen>
  if (loading) return <Screen><LoadingState label="Memuat notifikasi..." /></Screen>
  return (
    <Screen>
      {unread > 0 ? <Button title={`Tandai ${unread} sudah dibaca`} variant="ghost" size="sm" onPress={() => markRead(null)} style={styles.markAll} /> : null}
      {!items.length ? <EmptyState icon={Bell} title="Belum ada notifikasi" description="Status pesanan, balasan kafe, dan poin akan muncul di sini." /> : items.map((item) => {
        const Icon = ICONS[item.kind] || Bell
        const target = notificationTarget(item.data)
        return (
          <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: !item.read_at }}
            onPress={() => { if (!item.read_at) markRead([item.id]); if (target) router.push(target) }}
            style={[styles.row, !item.read_at && { backgroundColor: brand.colors.primaryTint, borderColor: brand.colors.primarySoft }]}>
            <Icon size={20} color={brand.colors.primaryPressed} />
            <View style={styles.flex}>
              <Text weight={item.read_at ? '600' : '800'} size="sm">{item.title}</Text>
              {item.body ? <Text size="sm" tone="secondary">{item.body}</Text> : null}
              <Text size="xs" tone="muted">{formatRelative(item.created_at)}</Text>
            </View>
            {!item.read_at ? <View style={[styles.dot, { backgroundColor: brand.colors.primary }]} /> : null}
          </Pressable>
        )
      })}
    </Screen>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  markAll: { alignSelf: 'flex-end' },
  row: { flexDirection: 'row', gap: 12, padding: 14, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14 },
  flex: { flex: 1, gap: 3 },
  dot: { width: 9, height: 9, marginTop: 5, borderRadius: 5 },
}))
