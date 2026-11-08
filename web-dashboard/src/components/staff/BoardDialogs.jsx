import { useState } from 'react'
import { Bell, BellOff, Volume2 } from 'lucide-react'
import { Badge, Button, Dialog, Switch, TextField } from '../ui/index.js'
import { playNewOrderSound, unlockAlertSound } from '../../lib/alertSound.js'

function permissionLabel(permission) {
  if (permission === 'granted') return { tone: 'green', text: 'Aktif' }
  if (permission === 'denied') return { tone: 'red', text: 'Diblokir browser' }
  if (permission === 'unsupported') return { tone: 'neutral', text: 'Tidak didukung' }
  return { tone: 'amber', text: 'Belum diizinkan' }
}

/** Pengaturan papan per perangkat: ambang timer, suara, notifikasi browser. */
export function BoardSettingsDialog({ prefs, permission, onRequestPermission, onSave, onClose }) {
  const [warn, setWarn] = useState(String(prefs.warnMinutes))
  const [late, setLate] = useState(String(prefs.lateMinutes))
  const [sound, setSound] = useState(prefs.sound)
  const [error, setError] = useState('')
  const status = permissionLabel(permission)

  function handleSave(event) {
    event.preventDefault()
    const warnMinutes = Number(warn)
    const lateMinutes = Number(late)
    if (!Number.isInteger(warnMinutes) || warnMinutes < 1 || warnMinutes > 60) return setError('Ambang kuning harus 1–60 menit.')
    if (!Number.isInteger(lateMinutes) || lateMinutes <= warnMinutes || lateMinutes > 120) return setError('Ambang merah harus lebih besar dari ambang kuning (maks. 120).')
    onSave({ warnMinutes, lateMinutes, sound })
    return undefined
  }

  return (
    <Dialog
      size="sm"
      title="Pengaturan papan"
      description="Berlaku untuk perangkat ini saja."
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button type="submit" form="board-settings">Simpan</Button>
        </>
      )}
    >
      <form id="board-settings" className="board-settings" onSubmit={handleSave} noValidate>
        <fieldset>
          <legend>Warna timer tunggu</legend>
          <div className="board-settings-row">
            <TextField label="Kuning setelah" suffix="menit" inputMode="numeric" value={warn} onChange={(event) => { setWarn(event.target.value.replace(/\D/g, '')); setError('') }} />
            <TextField label="Merah setelah" suffix="menit" inputMode="numeric" value={late} onChange={(event) => { setLate(event.target.value.replace(/\D/g, '')); setError('') }} />
          </div>
          {error && <p className="ui-field-error" role="alert">{error}</p>}
        </fieldset>
        <div className="board-settings-line">
          <span><strong>Suara pesanan baru</strong><small>Bunyi "ding-dong" saat pesanan masuk.</small></span>
          <Switch checked={sound} onChange={setSound} label="Suara pesanan baru" onLabel="Nyala" offLabel="Mati" />
        </div>
        <Button variant="ghost" size="sm" icon={Volume2} onClick={() => { unlockAlertSound(); window.setTimeout(playNewOrderSound, 60) }}>Tes suara</Button>
        <div className="board-settings-line">
          <span>
            <strong>Notifikasi browser</strong>
            <small>Muncul walau tab ini tidak sedang dibuka.</small>
          </span>
          <Badge tone={status.tone}>{status.text}</Badge>
        </div>
        {permission === 'default' && <Button variant="secondary" size="sm" icon={Bell} onClick={onRequestPermission}>Izinkan notifikasi</Button>}
        {permission === 'denied' && (
          <p className="settings-note"><BellOff size={14} aria-hidden="true" /> Buka pengaturan situs di browser (ikon gembok di bilah alamat) untuk mengizinkan notifikasi.</p>
        )}
      </form>
    </Dialog>
  )
}

const SHORTCUTS = [
  ['1 – 9', 'Pilih kartu (nomor di pojok kartu)'],
  ['Enter', 'Aksi utama kartu terpilih (Konfirmasi / Siap / Selesai)'],
  ['L', 'Tandai lunas kartu terpilih'],
  ['D', 'Buka detail kartu terpilih'],
  ['M', 'Buka daftar menu habis'],
  ['Esc', 'Batal pilih / tutup dialog'],
  ['?', 'Tampilkan bantuan ini'],
]

export function ShortcutsDialog({ onClose }) {
  return (
    <Dialog size="sm" title="Tombol pintas" description="Untuk kasir dengan keyboard. Tidak aktif saat sedang mengetik." onClose={onClose}>
      <dl className="shortcut-list">
        {SHORTCUTS.map(([key, text]) => (
          <div key={key}><dt><kbd>{key}</kbd></dt><dd>{text}</dd></div>
        ))}
      </dl>
    </Dialog>
  )
}
