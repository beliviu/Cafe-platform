/*
 * Pengaturan → Langganan: ajak kafe lain (referral) + saldo kredit (file SQL 17).
 * Kafe baru memakai kode → diskon tagihan pertama; pengundang dapat kredit setelah kafe itu membayar.
 * Kredit otomatis memotong tagihan berikutnya (dihitung server). Kartu tidak tampil sebelum file 17 dijalankan.
 */
import { useEffect, useState } from 'react'
import { Check, Copy, Gift, MessageCircle } from 'lucide-react'
import { Badge, Button, Card, CardHeader, TextField, useToast } from '../ui/index.js'
import { formatDate, formatRupiah } from '../../lib/format.js'
import { claimReferral, fetchReferralInfo } from '../../lib/platformBilling.js'

const STATUS = {
  pending: { label: 'Menunggu bayar pertama', tone: 'blue' },
  rewarded: { label: 'Kredit diterima', tone: 'green' },
  cancelled: { label: 'Batal', tone: 'neutral' },
}

export function ReferralCard({ supabase, cafeId, cafeName, onClaimed }) {
  const { toast } = useToast()
  const [info, setInfo] = useState(undefined)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [copied, setCopied] = useState(false)
  const [code, setCode] = useState('')
  const [claimError, setClaimError] = useState('')
  const [claiming, setClaiming] = useState(false)

  useEffect(() => {
    let active = true
    fetchReferralInfo(supabase, cafeId).then(
      (data) => { if (active) setInfo(data) },
      (caught) => { if (active) setError(caught.message) },
    )
    return () => { active = false }
  }, [attempt, cafeId, supabase])

  if (info === null || (info === undefined && !error)) return null // file 17 belum dijalankan / masih memuat
  if (error) return null

  const message = [
    `Halo! ${cafeName || 'Kafe kami'} pakai Dailybrew untuk kasir, pesanan, dan laporan.`,
    `Daftar pakai kode ${info.code} dan dapat diskon ${info.discount_pct}% di tagihan pertama.`,
  ].join('\n')

  async function copy() {
    try {
      await navigator.clipboard.writeText(info.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ tone: 'danger', title: 'Gagal menyalin', description: `Salin manual: ${info.code}` })
    }
  }

  async function claim(event) {
    event.preventDefault()
    if (!code.trim()) { setClaimError('Isi kode referral'); return }
    setClaiming(true)
    setClaimError('')
    try {
      const result = await claimReferral(supabase, cafeId, code)
      toast({ title: 'Kode referral dipakai', description: `Diskon ${result.discount_pct}% berlaku di tagihan pertama (diajak ${result.referrer_name}).` })
      setCode('')
      setAttempt((value) => value + 1)
      onClaimed?.()
    } catch (caught) {
      setClaimError(caught.message)
    } finally {
      setClaiming(false)
    }
  }

  const reward = formatRupiah(info.reward_amount)
  return (
    <Card className="settings-card">
      <CardHeader title="Ajak kafe lain"
        description={`Kafe yang daftar dengan kode Anda dapat diskon ${info.discount_pct}% di tagihan pertama. Anda dapat kredit ${reward} setelah mereka membayar.`} />

      <div className="referral-code">
        <span className="referral-code-value" aria-label={`Kode referral ${info.code.split('').join(' ')}`}>{info.code}</span>
        <Button size="sm" variant="secondary" icon={copied ? Check : Copy} onClick={copy}>{copied ? 'Tersalin' : 'Salin kode'}</Button>
        <Button size="sm" variant="ghost" icon={MessageCircle} onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener')}>
          Bagikan ke WhatsApp
        </Button>
      </div>

      <dl className="referral-stats">
        <div><dt>Kredit tersedia</dt><dd>{formatRupiah(info.credit_available)}</dd></div>
        <div><dt>Total kredit referral</dt><dd>{formatRupiah(info.earned_total)}</dd></div>
        <div><dt>Kafe diajak</dt><dd>{info.referrals.length}</dd></div>
      </dl>
      {Number(info.credit_balance) > Number(info.credit_available) && (
        <p className="ui-field-hint">{formatRupiah(Number(info.credit_balance) - Number(info.credit_available))} sudah dipakai di tagihan yang menunggu pembayaran.</p>
      )}

      {info.referrals.length > 0 && (
        <ul className="billing-list is-history" aria-label="Kafe yang diajak">
          {info.referrals.map((item) => {
            const status = STATUS[item.status] || STATUS.pending
            return (
              <li key={`${item.cafe_name}-${item.created_at}`}>
                <span className="billing-main">
                  <strong>{item.cafe_name}</strong>
                  <small>Bergabung {formatDate(item.created_at)}{item.rewarded_at ? ` · kredit ${formatRupiah(item.reward_amount)} pada ${formatDate(item.rewarded_at)}` : ''}</small>
                </span>
                <Badge tone={status.tone}>{status.label}</Badge>
              </li>
            )
          })}
        </ul>
      )}

      {info.claimed && (
        <p className="referral-note">
          <Gift size={16} aria-hidden="true" />
          <span>
            Kafe Anda bergabung lewat kode <strong>{info.claimed.code}</strong> dari {info.claimed.referrer_name}
            {info.claimed.status === 'pending' ? ` — diskon ${info.claimed.discount_pct}% berlaku di tagihan pertama.` : '.'}
          </span>
        </p>
      )}
      {info.can_claim && (
        <form className="referral-claim" onSubmit={claim} noValidate>
          <TextField label="Punya kode referral?" hint={`Bisa dipakai sampai ${formatDate(info.claim_until)}, sebelum pembayaran pertama.`}
            value={code} autoComplete="off" spellCheck={false} maxLength={12} error={claimError}
            onChange={(event) => { setCode(event.target.value.toUpperCase()); setClaimError('') }} />
          <Button type="submit" size="sm" loading={claiming}>Pakai kode</Button>
        </form>
      )}
    </Card>
  )
}
