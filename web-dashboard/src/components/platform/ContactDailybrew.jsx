/*
 * Tombol "Hubungi Dailybrew via WhatsApp" (file 15). Nomor diambil dari pengaturan platform
 * (platform_settings.support_whatsapp), pesan berisi nama & ID kafe. Tidak tampil bila nomor belum diisi
 * atau file 15 belum dijalankan.
 */
import { MessageCircle } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { dailybrewWaLink, usePlatformContact } from '../../lib/platformBilling.js'

export function ContactDailybrew({ cafe, topic, label = 'Hubungi Dailybrew via WhatsApp', variant = 'secondary', size = 'md', className = '', contact: given }) {
  const { supabase } = useAuth()
  const { contact: loaded } = usePlatformContact(given === undefined ? supabase : null, cafe?.id)
  const contact = given === undefined ? loaded : given
  if (!contact?.support_whatsapp) return null
  return (
    <a className={`ui-btn ui-btn-${variant} ui-btn-${size} ${className}`.trim()} href={dailybrewWaLink(contact.support_whatsapp, cafe, topic)}
      target="_blank" rel="noopener noreferrer">
      <MessageCircle size={16} aria-hidden="true" />
      <span>{label}</span>
    </a>
  )
}
