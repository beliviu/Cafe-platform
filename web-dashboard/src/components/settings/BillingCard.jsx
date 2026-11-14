/*
 * Pengaturan → Langganan: tagihan Dailybrew + bayar online (Midtrans Snap) + pilih paket sendiri.
 * Butuh file SQL 14 & Edge Function "subscription-billing". Sebelum itu kartu ini tidak tampil.
 * Lunas hanya ditandai server (webhook / cek status ke Midtrans), tidak pernah oleh web ini.
 * File 17: rincian diskon (promo/referral) & kredit, pasang kode promo, unduh kuitansi PDF.
 */
import { useCallback, useEffect, useState } from 'react'
import { CreditCard, FileDown, RefreshCw, TicketPercent, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, CardHeader, Select, TextField, useToast } from '../ui/index.js'
import { formatDate, formatRupiah } from '../../lib/format.js'
import { applyPromo, callBilling, downloadReceipt, fetchOwnerInvoices, INVOICE_STATE, requestInvoice } from '../../lib/platformBilling.js'
import { ContactDailybrew } from '../platform/ContactDailybrew.jsx'

const MONTHS = [1, 3, 6, 12].map((value) => ({ value: String(value), label: `${value} bulan` }))
const METHOD = { gateway: 'online', manual_transfer: 'transfer', credit: 'kredit/diskon' }

export function BillingCard({ supabase, cafeId, cafeName, plans, currentPlan, onPaid }) {
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const [invoices, setInvoices] = useState(undefined)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const sellable = (plans || []).filter((plan) => Number(plan.price_monthly) > 0)
  const [plan, setPlan] = useState(() => (sellable.some((item) => item.code === currentPlan) ? currentPlan : sellable[0]?.code || ''))
  const [months, setMonths] = useState('1')

  const [attempt, setAttempt] = useState(0)
  const load = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    let active = true
    fetchOwnerInvoices(supabase, cafeId).then(
      (data) => { if (active) setInvoices(data) },
      (caught) => { if (active) setError(caught.message) },
    )
    return () => { active = false }
  }, [attempt, cafeId, supabase])

  // Kembali dari halaman Midtrans (?bayar=<id tagihan>) → cek status ke server
  const returned = params.get('bayar')
  useEffect(() => {
    if (!returned) return
    let active = true
    callBilling(supabase, { action: 'status', invoice_id: returned })
      .then((result) => {
        if (!active) return
        if (result?.paid) {
          toast({ title: 'Pembayaran diterima', description: 'Langganan sudah diperpanjang. Terima kasih!' })
          onPaid?.()
        } else {
          toast({ tone: 'info', title: 'Pembayaran belum terkonfirmasi', description: 'Status diperbarui otomatis begitu Midtrans mengonfirmasi.' })
        }
      })
      .catch(() => null)
      .finally(() => {
        if (!active) return
        setParams((current) => { const next = new URLSearchParams(current); next.delete('bayar'); return next }, { replace: true })
        load()
      })
    return () => { active = false }
  }, [load, onPaid, returned, setParams, supabase, toast])

  async function pay(invoiceId) {
    setBusy(invoiceId)
    setError('')
    try {
      const returnUrl = `${window.location.origin}${window.location.pathname}?bayar=${invoiceId}`
      const { checkout_url: checkoutUrl } = await callBilling(supabase, { action: 'checkout', invoice_id: invoiceId, return_url: returnUrl })
      window.location.assign(checkoutUrl)
    } catch (caught) {
      setError(caught.message)
      setBusy('')
    }
  }

  async function choosePlan() {
    setBusy('request')
    setError('')
    try {
      const invoice = await requestInvoice(supabase, cafeId, plan, Number(months))
      if (invoice.status === 'paid') {
        // Lunas seluruhnya dengan kredit/diskon
        toast({ title: 'Langganan diperpanjang', description: 'Tagihan lunas dengan kredit/diskon.' })
        setBusy('')
        load()
        onPaid?.()
        return
      }
      await pay(invoice.id)
    } catch (caught) {
      setError(caught.message)
      setBusy('')
      load()
    }
  }

  function replaceInvoice(updated) {
    setInvoices((current) => (current || []).map((item) => (item.id === updated.id ? { ...item, ...updated } : item)))
    if (updated.status === 'paid') {
      toast({ title: 'Tagihan lunas', description: 'Diskon dan kredit menutup seluruh tagihan.' })
      onPaid?.()
    }
  }

  async function receipt(invoice) {
    setBusy(`receipt-${invoice.id}`)
    try {
      await downloadReceipt(supabase, invoice)
    } catch (caught) {
      toast({ tone: 'danger', title: 'Kuitansi gagal diunduh', description: caught.message })
    } finally {
      setBusy('')
    }
  }

  if (invoices === null) return null // file 14 belum dijalankan
  const open = (invoices || []).filter((invoice) => invoice.status === 'pending')
  const history = (invoices || []).filter((invoice) => invoice.status === 'paid').slice(0, 6)
  const selected = sellable.find((item) => item.code === plan)

  return (
    <Card className="settings-card">
      <CardHeader title="Tagihan & pembayaran" description="Bayar online dengan QRIS, transfer virtual account, e-wallet, atau kartu."
        actions={<Button size="sm" variant="ghost" icon={RefreshCw} onClick={load}>Muat ulang</Button>} />

      {open.length > 0 && (
        <ul className="billing-list">
          {open.map((invoice) => (
            <PendingInvoice key={invoice.id} invoice={invoice} busy={busy} onPay={() => pay(invoice.id)}
              onPromo={async (code) => replaceInvoice(await applyPromo(supabase, cafeId, invoice.id, code))} />
          ))}
        </ul>
      )}

      {sellable.length > 0 && (
        <div className="billing-choose">
          <Select label="Paket" value={plan} onChange={(event) => setPlan(event.target.value)}
            options={sellable.map((item) => ({ value: item.code, label: `${item.name} · ${formatRupiah(item.price_monthly)}/bln` }))} />
          <Select label="Lama" value={months} onChange={(event) => setMonths(event.target.value)} options={MONTHS} />
          <Button icon={CreditCard} loading={busy === 'request'} disabled={Boolean(busy) || !selected} onClick={choosePlan}>
            {plan === currentPlan ? 'Perpanjang' : 'Ganti paket'} · {selected ? formatRupiah(Number(selected.price_monthly) * Number(months)) : ''}
          </Button>
        </div>
      )}
      <p className="ui-field-hint">Paket aktif begitu pembayaran terkonfirmasi. Diskon cabang, kode promo, dan kredit dihitung di tagihan. Transfer bank manual? Hubungi Dailybrew dan sebutkan nomor tagihan.</p>
      <div><ContactDailybrew cafe={{ id: cafeId, name: cafeName }} topic={open[0] ? `Soal tagihan ${open[0].number}.` : 'Saya ada pertanyaan soal langganan.'} size="sm" /></div>
      {error && <p className="ui-field-error" role="alert">{error}</p>}

      {history.length > 0 && (
        <>
          <CardHeader as="h3" title="Riwayat pembayaran" />
          <ul className="billing-list is-history">
            {history.map((invoice) => (
              <li key={invoice.id}>
                <span className="billing-main">
                  <strong>{invoice.plan_name} · {invoice.months} bulan</strong>
                  <small>{invoice.number} · dibayar {formatDate(invoice.paid_at)}{METHOD[invoice.method] ? ` · ${METHOD[invoice.method]}` : ''}</small>
                </span>
                <strong className="tabular">{formatRupiah(invoice.amount)}</strong>
                <Button size="sm" variant="ghost" icon={FileDown} loading={busy === `receipt-${invoice.id}`} disabled={Boolean(busy)}
                  onClick={() => receipt(invoice)} aria-label={`Unduh kuitansi ${invoice.number}`}>Kuitansi</Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

function PendingInvoice({ invoice, busy, onPay, onPromo }) {
  const meta = INVOICE_STATE[invoice.state] || INVOICE_STATE.pending
  const [promoOpen, setPromoOpen] = useState(false)
  const [code, setCode] = useState('')
  const [promoError, setPromoError] = useState('')
  const [saving, setSaving] = useState(false)
  const list = Number(invoice.list_amount ?? invoice.amount)
  const adjustments = [
    invoice.promo_code && Number(invoice.promo_discount) > 0 ? { key: 'promo', label: `Promo ${invoice.promo_code}`, value: invoice.promo_discount, removable: true } : null,
    Number(invoice.referral_discount) > 0 ? { key: 'referral', label: 'Diskon referral', value: invoice.referral_discount } : null,
    Number(invoice.credit_amount) > 0 ? { key: 'credit', label: 'Kredit dipakai', value: invoice.credit_amount } : null,
  ].filter(Boolean)
  const canPromo = !invoice.promo_code && !(Number(invoice.referral_discount) > 0)

  async function submit(event) {
    event.preventDefault()
    if (!code.trim()) { setPromoError('Isi kode promo'); return }
    setSaving(true)
    setPromoError('')
    try {
      await onPromo(code)
      setPromoOpen(false)
      setCode('')
    } catch (caught) {
      setPromoError(caught.message)
    } finally {
      setSaving(false)
    }
  }

  async function removePromo() {
    setSaving(true)
    try {
      await onPromo('')
    } catch (caught) {
      setPromoError(caught.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="billing-pending">
      <span className="billing-main">
        <strong>{invoice.plan_name} · {invoice.months} bulan</strong>
        <small>{invoice.number} · {formatDate(invoice.period_start)} – {formatDate(invoice.period_end)} · jatuh tempo {formatDate(invoice.due_at)}</small>
      </span>
      <Badge tone={meta.tone}>{meta.label}</Badge>
      <strong className="tabular">{formatRupiah(invoice.amount)}</strong>
      <Button size="sm" icon={CreditCard} loading={busy === invoice.id} disabled={Boolean(busy) || saving} onClick={onPay}>Bayar</Button>

      {adjustments.length > 0 && (
        <dl className="billing-breakdown">
          <div><dt>Harga</dt><dd className="tabular">{formatRupiah(list)}</dd></div>
          {adjustments.map((item) => (
            <div key={item.key}>
              <dt>
                {item.label}
                {item.removable && (
                  <button type="button" className="billing-remove" onClick={removePromo} disabled={saving} aria-label={`Lepas kode promo ${invoice.promo_code}`}>
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </dt>
              <dd className="tabular">−{formatRupiah(item.value)}</dd>
            </div>
          ))}
          <div className="is-total"><dt>Total</dt><dd className="tabular">{formatRupiah(invoice.amount)}</dd></div>
        </dl>
      )}

      {canPromo && (promoOpen ? (
        <form className="billing-promo" onSubmit={submit} noValidate>
          <TextField label="Kode promo" value={code} autoFocus autoComplete="off" spellCheck={false} maxLength={24}
            onChange={(event) => { setCode(event.target.value.toUpperCase()); setPromoError('') }} error={promoError} />
          <Button type="submit" size="sm" loading={saving}>Pakai</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setPromoOpen(false); setPromoError(''); setCode('') }} disabled={saving}>Batal</Button>
        </form>
      ) : (
        <button type="button" className="billing-promo-toggle" onClick={() => setPromoOpen(true)}>
          <TicketPercent size={16} aria-hidden="true" /> Punya kode promo?
        </button>
      ))}
      {!canPromo && promoError && <p className="ui-field-error" role="alert">{promoError}</p>}
    </li>
  )
}
