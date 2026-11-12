/*
 * Pengaturan → WhatsApp untuk Dailybrew (file 15): nomor WA owner yang dipakai tim Dailybrew
 * untuk menghubungi (tagihan, bantuan setup). Terpisah dari nomor kafe untuk pelanggan.
 */
import { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Button, Card, CardHeader, TextField, useToast } from '../ui/index.js'
import { formatWa, saveOwnerWhatsapp, usePlatformContact } from '../../lib/platformBilling.js'
import { ContactDailybrew } from '../platform/ContactDailybrew.jsx'

function Form({ cafe, contact, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [value, setValue] = useState(contact.owner_whatsapp ? formatWa(contact.owner_whatsapp) : '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const saved = await saveOwnerWhatsapp(supabase, cafe.id, value)
      setValue(saved ? formatWa(saved) : '')
      toast({ tone: 'success', title: saved ? 'Nomor WhatsApp disimpan' : 'Nomor WhatsApp dihapus' })
      onSaved()
    } catch (caught) {
      setError(/tidak valid/i.test(caught.message) ? 'Nomor WhatsApp tidak valid. Contoh: 0812 3456 7890' : caught.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card as="form" onSubmit={submit} noValidate className="settings-card">
      <CardHeader icon={MessageCircle} title="WhatsApp untuk Dailybrew" description="Dipakai tim Dailybrew untuk menghubungi Anda soal langganan & bantuan. Tidak ditampilkan ke pelanggan." />
      <div className="settings-fields">
        <TextField label="Nomor WhatsApp owner" inputMode="tel" placeholder="0812 3456 7890" value={value} error={error}
          onChange={(event) => { setValue(event.target.value); setError('') }} hint="Boleh 08…, +62…, atau 62…" />
      </div>
      <div className="settings-contact-actions">
        <Button type="submit" loading={saving}>Simpan nomor</Button>
        <ContactDailybrew cafe={cafe} contact={contact} variant="ghost" />
      </div>
    </Card>
  )
}

export function DailybrewContactCard({ cafe }) {
  const { supabase } = useAuth()
  const { contact, reload } = usePlatformContact(supabase, cafe.id)
  if (!contact) return null // file 15 belum dijalankan
  return <Form key={contact.owner_whatsapp || 'kosong'} cafe={cafe} contact={contact} onSaved={reload} />
}
