/*
 * Bunyi "ding-dong" pesanan baru, dibuat langsung dengan Web Audio (tanpa file audio).
 * Browser hanya mengizinkan suara setelah ada interaksi pengguna — unlockAlertSound()
 * dipanggil pada klik/ketukan pertama di halaman.
 */
let context = null

function getContext() {
  if (!context) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return null
    context = new AudioContextClass()
  }
  return context
}

export function unlockAlertSound() {
  const audio = getContext()
  if (audio?.state === 'suspended') audio.resume().catch(() => {})
}

export function soundReady() {
  return context?.state === 'running'
}

function tone(audio, frequency, start, duration) {
  const oscillator = audio.createOscillator()
  const gain = audio.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.value = frequency
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(0.28, start + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  oscillator.connect(gain).connect(audio.destination)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.05)
}

export function playNewOrderSound() {
  const audio = getContext()
  if (!audio || audio.state !== 'running') return false
  const now = audio.currentTime
  tone(audio, 880, now, 0.35)
  tone(audio, 660, now + 0.22, 0.5)
  return true
}
