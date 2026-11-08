import { useEffect, useState } from 'react'

/** Waktu sekarang yang diperbarui tiap `intervalMs` (untuk timer "menunggu X menit"). */
export function useNow(intervalMs = 15000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}
