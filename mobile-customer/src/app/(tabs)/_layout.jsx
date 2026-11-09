import { StyleSheet, View } from 'react-native'
import { Tabs } from 'expo-router'
import { Coffee, House, ReceiptText, UserRound } from 'lucide-react-native'
import { useCart } from '../../cart/useCart.js'
import { useBrand } from '../../brand/useBrand.js'
import { FONTS } from '../../theme/tokens.js'
import { useTheme } from '../../theme/useTheme.js'

function TabIcon({ icon: Icon, focused }) {
  const { COLORS, dark } = useTheme()
  return (
    <View style={[styles.iconPill, focused && { backgroundColor: COLORS.primarySoft }]}>
      <Icon size={21} color={focused ? COLORS.primaryPressed : dark ? COLORS.navMuted : COLORS.textMuted} strokeWidth={focused ? 2.3 : 1.9} />
    </View>
  )
}

export default function TabLayout() {
  const { COLORS, dark } = useTheme()
  const { itemCount } = useCart()
  const { brand } = useBrand()

  return (
    <Tabs screenOptions={{
      headerShown: false,
      headerStyle: { backgroundColor: COLORS.canvas },
      headerTintColor: COLORS.text,
      headerTitleStyle: { fontFamily: FONTS.sans, fontWeight: '700' },
      headerShadowVisible: false,
      sceneStyle: { backgroundColor: COLORS.canvas },
      tabBarStyle: {
        backgroundColor: dark ? COLORS.nav : COLORS.card, borderTopColor: dark ? COLORS.borderSubtle : COLORS.border,
        borderTopLeftRadius: 22, borderTopRightRadius: 22, height: 70, paddingTop: 8, paddingBottom: 10,
      },
      tabBarActiveTintColor: COLORS.primaryPressed,
      tabBarInactiveTintColor: dark ? COLORS.navMuted : COLORS.textMuted,
      tabBarLabelStyle: { fontFamily: FONTS.sans, fontSize: 11, fontWeight: '700' },
      tabBarBadgeStyle: { backgroundColor: brand.colors.primary, color: COLORS.textOnPrimary, fontFamily: FONTS.sans, fontSize: 10, fontWeight: '700' },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Beranda', tabBarIcon: ({ focused }) => <TabIcon icon={House} focused={focused} /> }} />
      <Tabs.Screen
        name="menu"
        options={{
          title: 'Menu',
          tabBarIcon: ({ focused }) => <TabIcon icon={Coffee} focused={focused} />,
          tabBarBadge: itemCount > 0 ? itemCount : undefined,
          tabBarAccessibilityLabel: itemCount > 0 ? `Menu, ${itemCount} item di keranjang` : 'Menu',
        }}
      />
      <Tabs.Screen name="orders" options={{ title: 'Pesanan', tabBarIcon: ({ focused }) => <TabIcon icon={ReceiptText} focused={focused} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil', tabBarIcon: ({ focused }) => <TabIcon icon={UserRound} focused={focused} /> }} />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  iconPill: { width: 54, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 15 },
})
