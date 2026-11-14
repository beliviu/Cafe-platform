import { useState } from 'react'
import { CheckCircle2, FileDown, XCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge, Button, CheckMark, ConfirmDialog, Dialog, IconButton, TextField, motionEnabled, useToast } from './ui/index.js'
import { downloadReceipt, INVOICE_META, rpc } from '../lib/api.js'
import { formatDate, formatRupiah, jakartaDateKey } from '../lib/format.js'

const METHOD = { manual_transfer: 'Transfer', gateway: 'Midtrans', credit: 'Kredit/diskon' }

/** "dari Rp 349.000 · promo HEMAT20 · kredit" — rincian singkat untuk tagihan yang dipotong (file 17) */
function adjustmentNote(invoice) {
  const parts = [`dari ${formatRupiah(invoice.list_amount)}`]
  if (Number(invoice.promo_discount) > 0) parts.push(`promo ${invoice.promo_code}`)
  if (Number(invoice.referral_discount) > 0) parts.push('referral')
  if (Number(invoice.credit_amount) > 0) parts.push(`kredit ${formatRupiah(invoice.credit_amount)}`)
  return parts.join(' · ')
}

function MarkPaidDialog({ invoice, onClose, onDone }) {
  const { toast } = useToast()
  const [paidOn, setPaidOn] = useState(jakartaDateKey())
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      // Tanggal dipilih = hari itu pukul 12.00 WIB
      await rpc('pa_invoice_mark_paid', {
        p_invoice: invoice.id,
        p_paid_at: paidOn ? `${paidOn}T12:00:00+07:00` : null,
        p_ref: reference || null,
        p_note: note || null,
      })
      toast({ title: 'Tagihan lunas', description: `${invoice.cafe_name}: langganan diperpanjang sampai ${formatDate(invoice.period_end)}.` })
      // Centang tergambar sebentar sebelum dialog menutup (langsung menutup bila animasi dimatikan)
      if (motionEnabled()) {
        setDone(true)
        window.setTimeout(onDone, 1000)
      } else onDone()
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
  }

  return (
    <Dialog title={`Tandai lunas ${invoice.number}`} description={`${invoice.cafe_name} · ${formatRupiah(invoice.amount)}`} size="sm" onClose={busy ? undefined : onClose}
      dismissible={!busy}
      footer={done ? null : <><Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button><Button type="submit" form="mark-paid" loading={busy} icon={CheckCircle2}>Tandai lunas</Button></>}>
      {done && (
        <div className="ui-success" role="status">
          <CheckMark size={56} label="Berhasil" />
          <strong>Tagihan lunas</strong>
          <span>Langganan aktif sampai {formatDate(invoice.period_end)}</span>
        </div>
      )}
      <form id="mark-paid" className="dialog-form" onSubmit={submit} hidden={done}>
        <TextField label="Tanggal bayar" type="date" value={paidOn} max={jakartaDateKey()} onChange={(event) => setPaidOn(event.target.value)} />
        <TextField label="Referensi transfer" placeholder="mis. BCA 12/11 a.n. Budi" value={reference} maxLength={120} onChange={(event) => setReference(event.target.value)} />
        <TextField label="Catatan (opsional)" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
        <p className="ui-field-hint">Langganan otomatis aktif sampai {formatDate(invoice.period_end)} dengan paket {invoice.plan_name}.</p>
        {error && <p className="ui-field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  )
}

/** Tabel tagihan + aksi tandai lunas / batalkan. showCafe: tampilkan kolom kafe. */
export function InvoiceTable({ rows, showCafe = true, onChanged }) {
  const { toast } = useToast()
  const [paying, setPaying] = useState(null)
  const [voiding, setVoiding] = useState(null)
  const [voidNote, setVoidNote] = useState('')
  const [downloading, setDownloading] = useState(null)

  async function receipt(invoice) {
    setDownloading(invoice.id)
    try {
      await downloadReceipt(invoice)
    } catch (caught) {
      toast({ tone: 'danger', title: 'Kuitansi gagal diunduh', description: caught.message })
    } finally {
      setDownloading(null)
    }
  }

  return (
    <>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Tagihan</th>
              {showCafe && <th scope="col">Kafe</th>}
              <th scope="col">Periode</th>
              <th scope="col" className="num">Nominal</th>
              <th scope="col">Status</th>
              <th scope="col">Jatuh tempo</th>
              <th scope="col" className="cell-actions"><span className="sr-only">Aksi</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((invoice) => {
              const meta = INVOICE_META[invoice.state] || INVOICE_META.pending
              return (
                <tr key={invoice.id}>
                  <td><span className="pa-cell-main"><strong className="tabular">{invoice.number}</strong><small>{invoice.plan_name} · {invoice.months} bln{invoice.source === 'owner' ? ' · diminta owner' : invoice.source === 'system' ? ' · otomatis' : ''}</small></span></td>
                  {showCafe && <td><Link to={`/kafe/${invoice.cafe_id}`} className="link-button">{invoice.cafe_name}</Link></td>}
                  <td className="tabular">{formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}</td>
                  <td className="num tabular">
                    <span className="pa-cell-main is-num">
                      <span>{formatRupiah(invoice.amount)}</span>
                      {Number(invoice.list_amount) > Number(invoice.amount) && <small>{adjustmentNote(invoice)}</small>}
                    </span>
                  </td>
                  <td>
                    <span className="pa-cell-main">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      {invoice.paid_at && <small>{formatDate(invoice.paid_at)} · {METHOD[invoice.method] || invoice.method}{invoice.payment_ref ? ` · ${invoice.payment_ref}` : ''}</small>}
                    </span>
                  </td>
                  <td className="tabular">{formatDate(invoice.due_at)}</td>
                  <td className="cell-actions">
                    {invoice.status === 'pending' && (
                      <span className="pa-actions">
                        <Button size="sm" variant="secondary" icon={CheckCircle2} onClick={() => setPaying(invoice)}>Lunas</Button>
                        <IconButton icon={XCircle} label="Batalkan tagihan" size="sm" onClick={() => { setVoidNote(''); setVoiding(invoice) }} />
                      </span>
                    )}
                    {invoice.status === 'paid' && (
                      <IconButton icon={FileDown} label={`Unduh kuitansi ${invoice.number}`} size="sm" disabled={downloading === invoice.id}
                        onClick={() => receipt(invoice)} />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {paying && <MarkPaidDialog invoice={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); onChanged() }} />}
      {voiding && (
        <ConfirmDialog
          title={`Batalkan ${voiding.number}?`}
          description={`${voiding.cafe_name} · ${formatRupiah(voiding.amount)}. Tagihan yang dibatalkan tidak bisa dibayar lagi.`}
          confirmLabel="Batalkan tagihan"
          onClose={() => setVoiding(null)}
          onConfirm={async () => {
            await rpc('pa_invoice_void', { p_invoice: voiding.id, p_note: voidNote || null })
            toast({ title: 'Tagihan dibatalkan' })
            setVoiding(null)
            onChanged()
          }}
        >
          <TextField label="Alasan (opsional)" value={voidNote} maxLength={300} onChange={(event) => setVoidNote(event.target.value)} />
        </ConfirmDialog>
      )}
    </>
  )
}
