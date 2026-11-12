import { useState } from 'react'
import { MessageCircle, Send } from 'lucide-react'
import { Button, Dialog, SegmentedControl, TextField, useToast } from './ui/index.js'
import { rpc } from '../lib/api.js'
import { formatWa, WA_TEMPLATES, waLink, waMessage } from '../lib/whatsapp.js'

/**
 * Tombol "Chat WA": pilih template → pesan terisi otomatis (bisa diedit) → buka wa.me di tab baru.
 * ctx: { cafeId, cafeName, ownerName, phone, amount, dueAt, invoiceNumber, planName }
 */
export function WhatsAppButton({ ctx, defaultTemplate = 'bebas', size = 'sm', variant = 'secondary', label = 'Chat WA', onMissingPhone }) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [template, setTemplate] = useState(defaultTemplate)
  const [text, setText] = useState('')

  function start() {
    if (!ctx.phone) {
      if (onMissingPhone) onMissingPhone()
      else toast({ tone: 'error', title: 'Nomor WA owner belum diisi', description: 'Isi dulu di detail kafe.' })
      return
    }
    setTemplate(defaultTemplate)
    setText(waMessage(defaultTemplate, ctx))
    setOpen(true)
  }

  function choose(next) {
    setTemplate(next)
    setText(waMessage(next, ctx))
  }

  function send() {
    // Buka tab dulu (harus langsung dari klik agar tidak diblokir browser), lalu catat di audit
    window.open(waLink(ctx.phone, text), '_blank', 'noopener,noreferrer')
    rpc('pa_log_whatsapp', { p_cafe: ctx.cafeId, p_template: template, p_phone: ctx.phone }).catch(() => null)
    setOpen(false)
  }

  return (
    <>
      <Button size={size} variant={variant} icon={MessageCircle} onClick={start}>{label}</Button>
      {open && (
        <Dialog title={`WhatsApp ke ${ctx.ownerName || 'owner'}`} description={`${ctx.cafeName} · ${formatWa(ctx.phone)}`} onClose={() => setOpen(false)}
          footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Batal</Button><Button icon={Send} onClick={send} disabled={!text.trim()}>Buka WhatsApp</Button></>}>
          <div className="dialog-form">
            <SegmentedControl label="Template pesan" options={WA_TEMPLATES.map((item) => ({ value: item.key, label: item.label }))} value={template} onChange={choose} size="sm" />
            <TextField label="Pesan" multiline rows={9} value={text} onChange={(event) => setText(event.target.value)} />
            <p className="ui-field-hint">WhatsApp terbuka di tab baru dengan pesan ini; tekan kirim di sana. Klik ini dicatat di log audit.</p>
          </div>
        </Dialog>
      )}
    </>
  )
}
