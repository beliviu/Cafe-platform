/*
 * Notifikasi push (Expo). Token perangkat disimpan lewat RPC push_register (file 08);
 * pengiriman dilakukan Edge Function push-send. Web tidak memakai push (kotak masuk tetap ada).
 * Butuh build EAS (projectId di app.json → extra.eas.projectId); di Expo Go Android push tidak tersedia.
 */
import { useEffect } from 'react'
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import { router } from 'expo-router'
import { useAuth } from '../auth/useAuth.js'
import { notificationTarget } from './useNotifications.js'

const TOKEN_KEY = 'dailybrew.pushToken'
const nativePush = Platform.OS === 'ios' || Platform.OS === 'android'
// Dimuat hanya di Android/iOS — di web modul ini tidak didukung (hanya memunculkan peringatan)
const Notifications = nativePush ? require('expo-notifications') : null

if (nativePush) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  })
}

/** Minta izin & daftarkan token. Mengembalikan alasan bila tidak bisa (untuk ditampilkan). */
export async function registerPush(supabase) {
  if (!nativePush) return { ok: false, reason: 'web' }
  if (!Device.isDevice) return { ok: false, reason: 'emulator' }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
  if (!projectId) return { ok: false, reason: 'no_project' }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Pesanan', importance: Notifications.AndroidImportance.HIGH })
  }
  let { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status
  if (status !== 'granted') return { ok: false, reason: 'denied' }
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data
  const { error } = await supabase.rpc('push_register', { p_token: token, p_platform: Platform.OS })
  if (error) return { ok: false, reason: 'server' }
  await AsyncStorage.setItem(TOKEN_KEY, token)
  return { ok: true }
}

/** Saat keluar: perangkat ini berhenti menerima notifikasi akun tersebut. */
export async function unregisterPush(supabase) {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY)
    if (token && supabase) await supabase.rpc('push_unregister', { p_token: token })
    await AsyncStorage.removeItem(TOKEN_KEY)
  } catch {
    // tidak menghalangi proses keluar
  }
}

/** Daftarkan push setelah login & buka layar terkait saat notifikasi diketuk. */
export function usePushSetup() {
  const { session, supabase } = useAuth()
  const userId = session?.user?.id

  useEffect(() => {
    if (!userId || !supabase || !nativePush) return
    registerPush(supabase).catch(() => {})
  }, [supabase, userId])

  useEffect(() => {
    if (!nativePush) return undefined
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const target = notificationTarget(response.notification.request.content.data)
      if (target) router.push(target)
    })
    return () => subscription.remove()
  }, [])
}
