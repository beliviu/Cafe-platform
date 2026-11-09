import { useEffect } from 'react'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useFonts } from 'expo-font'
import { AuthProvider } from '../auth/AuthProvider.jsx'
import { BrandProvider } from '../brand/BrandProvider.jsx'
import { CartProvider } from '../cart/CartProvider.jsx'
import { ToastProvider } from '../components/ui.jsx'
import { FONTS } from '../theme/tokens.js'
import { usePushSetup } from '../lib/push.js'
import { OfflineNotice } from '../components/OfflineNotice.jsx'
import { useTheme } from '../theme/useTheme.js'

/** Pendaftaran push & navigasi saat notifikasi diketuk (perlu di dalam AuthProvider). */
function PushSetup() {
  usePushSetup()
  return null
}

SplashScreen.preventAutoHideAsync().catch(() => {})

/* Satu keluarga per font; ketebalan dipilih lewat fontWeight. */
const BRAND_FONTS = [
  {
    fontFamily: FONTS.sans,
    fontDefinitions: [
      { path: require('@expo-google-fonts/plus-jakarta-sans/400Regular/PlusJakartaSans_400Regular.ttf'), weight: 400 },
      { path: require('@expo-google-fonts/plus-jakarta-sans/500Medium/PlusJakartaSans_500Medium.ttf'), weight: 500 },
      { path: require('@expo-google-fonts/plus-jakarta-sans/600SemiBold/PlusJakartaSans_600SemiBold.ttf'), weight: 600 },
      { path: require('@expo-google-fonts/plus-jakarta-sans/700Bold/PlusJakartaSans_700Bold.ttf'), weight: 700 },
      { path: require('@expo-google-fonts/plus-jakarta-sans/800ExtraBold/PlusJakartaSans_800ExtraBold.ttf'), weight: 800 },
    ],
  },
  {
    fontFamily: FONTS.serif,
    fontDefinitions: [
      { path: require('@expo-google-fonts/fraunces/500Medium/Fraunces_500Medium.ttf'), weight: 500 },
      { path: require('@expo-google-fonts/fraunces/600SemiBold/Fraunces_600SemiBold.ttf'), weight: 600 },
      { path: require('@expo-google-fonts/fraunces/700Bold/Fraunces_700Bold.ttf'), weight: 700 },
    ],
  },
]

/** Navigasi + status bar yang mengikuti tema aktif (harus di dalam BrandProvider). */
function ThemedStack() {
  const { COLORS, dark } = useTheme()
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <PushSetup />
      <OfflineNotice />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: COLORS.canvas },
        headerTintColor: COLORS.text,
        headerTitleStyle: { fontFamily: FONTS.sans, fontWeight: '700', fontSize: 17 },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: COLORS.canvas },
      }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: 'Masuk' }} />
        <Stack.Screen name="register" options={{ title: 'Buat akun' }} />
        <Stack.Screen name="product/[id]" options={{ title: 'Detail produk' }} />
        <Stack.Screen name="cart" options={{ title: 'Keranjang' }} />
        <Stack.Screen name="checkout" options={{ title: 'Checkout' }} />
        <Stack.Screen name="payment/[id]" options={{ title: 'Pembayaran' }} />
        <Stack.Screen name="order/[id]" options={{ title: 'Status pesanan' }} />
        <Stack.Screen name="meja/[token]" options={{ title: 'QR meja' }} />
        <Stack.Screen name="forgot-password" options={{ title: 'Lupa password' }} />
        <Stack.Screen name="reset-password" options={{ title: 'Password baru' }} />
        <Stack.Screen name="loyalty" options={{ title: 'Poin & member' }} />
        <Stack.Screen name="payments" options={{ title: 'Riwayat pembayaran' }} />
        <Stack.Screen name="wishlist" options={{ title: 'Wishlist' }} />
        <Stack.Screen name="vouchers" options={{ title: 'Voucher' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifikasi' }} />
        <Stack.Screen name="support/index" options={{ title: 'Bantuan' }} />
        <Stack.Screen name="support/new" options={{ title: 'Hubungi kafe' }} />
        <Stack.Screen name="support/[id]" options={{ title: 'Percakapan' }} />
      </Stack>
    </>
  )
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(BRAND_FONTS)

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {})
  }, [fontsLoaded, fontError])

  // Bila font gagal dimuat, aplikasi tetap jalan dengan font sistem.
  if (!fontsLoaded && !fontError) return null

  return (
    <AuthProvider>
      <BrandProvider>
        <CartProvider>
          <ToastProvider>
            <ThemedStack />
          </ToastProvider>
        </CartProvider>
      </BrandProvider>
    </AuthProvider>
  )
}
