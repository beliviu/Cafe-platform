/*
 * Pengaturan → Langganan: tagihan Dailybrew + bayar online (Midtrans Snap) + pilih paket sendiri.
 * Butuh file SQL 14 & Edge Function "subscription-billing". Sebelum itu kartu ini tidak tampil.
 * Lunas hanya ditandai server (webhook / cek status ke Midtrans), tidak pernah oleh web ini.
 */
import { useCallback, useEffect, useState } from 'react'
import { CreditCard, RefreshCw } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, CardHeader, Select, useToast } from '../ui/index.js'
import { formatDate, formatRupiah } from '../../lib/format.js'
import { callBilling, fetchOwnerInvoices, INVOICE_STATE, requestInvoice } from '../../lib/platformBilling.js'

const MONTHS = [1, 3, 6, 12].map((value) => ({ value: String(value), label: `${value} bulan` }))

export function BillingCard({ supabase, cafeId, plans, currentPlan, onPaid }) {
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
      await pay(invoice.id)
    } catch (caught) {
      setError(caught.message)
      setBusy('')
      load()
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
          {open.map((invoice) => {
            const meta = INVOICE_STATE[invoice.state] || INVOICE_STATE.pending
            return (
              <li key={invoice.id}>
                <span className="billing-main">
                  <strong>{invoice.plan_name} · {invoice.months} bulan</strong>
                  <small>{invoice.number} · {formatDate(invoice.period_start)} – {formatDate(invoice.period_end)} · jatuh tempo {formatDate(invoice.due_at)}</small>
                </span>
                <Badge tone={meta.tone}>{meta.label}</Badge>
                <strong className="tabular">{formatRupiah(invoice.amount)}</strong>
                <Button size="sm" icon={CreditCard} loading={busy === invoice.id} disabled={Boolean(busy)} onClick={() => pay(invoice.id)}>Bayar</Button>
              </li>
            )
          })}
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
      <p className="ui-field-hint">Paket aktif begitu pembayaran terkonfirmasi. Transfer bank manual? Hubungi Dailybrew dan sebutkan nomor tagihan.</p>
      {error && <p className="ui-field-error" role="alert">{error}</p>}

      {history.length > 0 && (
        <>
          <CardHeader as="h3" title="Riwayat pembayaran" />
          <ul className="billing-list is-history">
            {history.map((invoice) => (
              <li key={invoice.id}>
                <span className="billing-main"><strong>{invoice.plan_name} · {invoice.months} bulan</strong><small>{invoice.number} · dibayar {formatDate(invoice.paid_at)}</small></span>
                <strong className="tabular">{formatRupiah(invoice.amount)}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}
