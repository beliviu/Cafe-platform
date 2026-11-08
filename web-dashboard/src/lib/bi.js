/*
 * BI & advisor (file SQL 11 + Edge Function "advisor").
 * Semua angka dihitung database (bi_*). Di sini hanya merangkai kalimat dari angka itu —
 * tidak ada perhitungan keuangan baru dan tidak ada angka karangan.
 */
import { formatDate, formatNumber, formatPercent, formatRupiah } from './format.js'

export const WEEKDAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']
export const CHANNELS = { kasir: 'Kasir', app: 'Aplikasi', qr_meja: 'QR meja' }

export const dateKeyLabel = (key) => (key ? formatDate(`${key}T00:00:00+07:00`) : '—')

export function signedRupiah(value) {
  const amount = Number(value) || 0
  return `${amount > 0 ? '+' : amount < 0 ? '−' : ''}${formatRupiah(Math.abs(amount))}`
}

export function signedPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  const pct = Number(value)
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${formatPercent(Math.abs(pct), 1)}`
}

/** Panggil Edge Function advisor. Error membawa `hint` (ai_not_configured, quota, plan_feature, …). */
export async function callAdvisor(supabase, body) {
  const { data, error } = await supabase.functions.invoke('advisor', { body })
  if (error) {
    let message = error.message
    let hint = null
    try {
      const detail = await error.context?.json?.()
      if (detail?.error) message = detail.error
      hint = detail?.hint || null
    } catch {
      // badan respons bukan JSON
    }
    if (/Failed to send|fetch/i.test(message || '')) {
      message = 'Tanya AI belum terpasang (Edge Function "advisor" belum di-deploy).'
      hint = 'ai_not_configured'
    }
    throw Object.assign(new Error(message), { hint })
  }
  if (data?.error) throw Object.assign(new Error(data.error), { hint: data.hint || null })
  return data
}

/* ---------------------------------------------------------------------
 * Jawaban cepat: kalimat dari paket fakta bi_advisor_facts
 * Setiap jawaban: { headline, points[], actions[], notes[] }
 * ------------------------------------------------------------------- */

export const QUESTIONS = [
  { key: 'revenue', label: 'Kenapa penjualan naik atau turun?' },
  { key: 'profit', label: 'Produk mana yang paling menguntungkan?' },
  { key: 'stock', label: 'Bahan apa yang hampir habis?' },
  { key: 'expenses', label: 'Beban apa yang naik?' },
  { key: 'promote', label: 'Produk apa yang sebaiknya dipromosikan?' },
]

function periodText(facts) {
  const { period } = facts
  return {
    current: `${dateKeyLabel(period.from)} – ${dateKeyLabel(period.to)}`,
    previous: `${dateKeyLabel(period.previous_from)} – ${dateKeyLabel(period.previous_to)}`,
  }
}

function answerRevenue(facts) {
  const rev = facts.revenue
  const cur = rev.current
  const prev = rev.previous
  const text = periodText(facts)
  const change = Number(rev.change)
  const points = []
  const actions = []
  const notes = []
  let headline
  if (!Number(prev.revenue) && !Number(cur.revenue)) {
    return { headline: 'Belum ada penjualan lunas di periode ini maupun pembandingnya.', points: [], actions: [], notes: [] }
  }
  if (!Number(prev.revenue)) {
    headline = `Penjualan ${text.current} ${formatRupiah(cur.revenue)}. Periode pembanding (${text.previous}) belum punya penjualan, jadi belum bisa dibandingkan.`
  } else if (Math.abs(Number(rev.change_pct)) < 1) {
    headline = `Penjualan stabil: ${formatRupiah(cur.revenue)} (${text.current}) vs ${formatRupiah(prev.revenue)} (${text.previous}).`
  } else {
    headline = `Penjualan ${change < 0 ? 'turun' : 'naik'} ${formatRupiah(Math.abs(change))} (${signedPercent(rev.change_pct)}): ${formatRupiah(cur.revenue)} di ${text.current} vs ${formatRupiah(prev.revenue)} di ${text.previous}.`
  }
  if (Number(prev.revenue)) {
    const effectOrders = Number(rev.effect_orders)
    const effectBasket = Number(rev.effect_basket)
    points.push(`Jumlah pesanan lunas ${formatNumber(cur.orders)} vs ${formatNumber(prev.orders)} → menyumbang ${signedRupiah(effectOrders)}.`)
    points.push(`Rata-rata per pesanan ${formatRupiah(cur.aov || 0)} vs ${formatRupiah(prev.aov || 0)} → menyumbang ${signedRupiah(effectBasket)}.`)
    if (change < 0 && effectOrders < 0 && Math.abs(effectOrders) >= Math.abs(effectBasket)) {
      actions.push('Penurunan terutama karena pesanan berkurang: fokus mendatangkan pembeli (promo hari sepi, voucher untuk pelanggan lama, cek jam buka & jeda pesanan).')
    } else if (change < 0 && effectBasket < 0) {
      actions.push('Nilai per pesanan turun: tawarkan paket atau tambahan (upsell) di kasir dan aplikasi.')
    }
  }
  const decreases = rev.products?.decreases || []
  const increases = rev.products?.increases || []
  if (decreases.length) {
    points.push(`Produk yang paling turun: ${decreases.slice(0, 3).map((row) => `${row.name} ${signedRupiah(row.change)} (${formatNumber(row.current_qty)} vs ${formatNumber(row.previous_qty)} terjual)`).join('; ')}.`)
    if (change < 0) actions.push(`Cek kenapa ${decreases[0].name} turun: ketersediaan (sempat habis?), kualitas, atau harga.`)
  }
  if (increases.length) points.push(`Produk yang naik: ${increases.slice(0, 2).map((row) => `${row.name} ${signedRupiah(row.change)}`).join('; ')}.`)
  const channels = (rev.by_channel || []).filter((row) => Number(row.current) !== Number(row.previous))
  if (channels.length > 1 || (channels.length === 1 && (rev.by_channel || []).length > 1)) {
    points.push(`Per kanal: ${channels.map((row) => `${CHANNELS[row.channel] || row.channel} ${formatRupiah(row.current)} vs ${formatRupiah(row.previous)}`).join('; ')}.`)
  }
  const weekdays = (rev.by_weekday || []).filter((row) => row.current_avg !== null && row.previous_avg !== null)
    .map((row) => ({ ...row, diff: Number(row.current_avg) - Number(row.previous_avg) }))
    .sort((a, b) => a.diff - b.diff)
  if (change < 0 && weekdays.length && weekdays[0].diff < 0) {
    points.push(`Hari dengan penurunan rata-rata terbesar: ${WEEKDAYS[weekdays[0].isodow - 1]} (${formatRupiah(weekdays[0].current_avg)} vs ${formatRupiah(weekdays[0].previous_avg)} per hari).`)
  }
  if (Number(cur.days_without_sales) !== Number(prev.days_without_sales)) {
    points.push(`Hari tanpa penjualan: ${formatNumber(cur.days_without_sales)} vs ${formatNumber(prev.days_without_sales)} hari.`)
  }
  if (Number(cur.cancelled_orders) || Number(prev.cancelled_orders)) {
    points.push(`Pesanan dibatalkan: ${formatNumber(cur.cancelled_orders)} (${formatRupiah(cur.cancelled_value)}) vs ${formatNumber(prev.cancelled_orders)} (${formatRupiah(prev.cancelled_value)}).`)
  }
  if (Number(cur.refunds)) points.push(`Refund disetujui: ${formatRupiah(cur.refunds)} (${formatNumber(cur.refund_count)} kali) — belum dikurangkan dari angka penjualan di atas.`)
  if (Number(cur.unpaid_orders)) notes.push(`${formatNumber(cur.unpaid_orders)} pesanan belum lunas tidak dihitung sebagai penjualan.`)
  if (facts.period.partial_today) notes.push('Periode termasuk hari ini yang belum selesai.')
  return { headline, points, actions, notes }
}

function marginText(row) {
  return `${row.name}: laba kotor ${formatRupiah(row.gross_profit)} dari ${formatNumber(row.quantity)} terjual, margin ${formatPercent(row.margin_pct, 1)}${row.basis === 'estimasi' ? ' (estimasi HPP)' : ''}`
}

function answerProfit(facts) {
  const profit = facts.profit
  const top = profit.top_profit || []
  const notes = []
  if ((profit.without_recipe || []).length) {
    notes.push(`${formatNumber(profit.without_recipe.length)} produk belum punya resep sehingga HPP-nya tidak diketahui: ${profit.without_recipe.slice(0, 5).join(', ')}${profit.without_recipe.length > 5 ? ', …' : ''}. Isi di Resep & HPP.`)
  }
  if (top.some((row) => row.basis === 'estimasi')) notes.push('Sebagian HPP adalah estimasi dari resep saat ini (pelacakan stok belum berjalan penuh).')
  if (!top.length) {
    return { headline: 'Belum bisa dihitung: tidak ada pesanan selesai dari produk yang punya resep di periode ini.', points: [], actions: ['Lengkapi resep produk terlaris agar profit per produk bisa dihitung.'], notes }
  }
  const points = top.slice(0, 5).map((row) => marginText(row))
  const actions = []
  const low = (profit.low_margin || []).filter((row) => Number(row.margin_pct) < 50)
  if (low.length) {
    points.push(`Margin terendah: ${low.slice(0, 3).map((row) => `${row.name} ${formatPercent(row.margin_pct, 1)}`).join('; ')}.`)
    actions.push(`Tinjau harga atau resep ${low[0].name}: marginnya ${formatPercent(low[0].margin_pct, 1)}.`)
  }
  if (profit.top_margin?.[0] && profit.top_margin[0].name !== top[0].name) {
    actions.push(`${profit.top_margin[0].name} punya margin tertinggi (${formatPercent(profit.top_margin[0].margin_pct, 1)}) — layak lebih ditonjolkan.`)
  }
  return {
    headline: `Laba kotor terbesar dari ${top[0].name} (${formatRupiah(top[0].gross_profit)}). Total laba kotor produk ber-HPP ${formatRupiah(profit.totals.gross_profit)}.`,
    points, actions, notes,
  }
}

function answerStock(facts) {
  const stock = facts.stock
  const notes = []
  if (stock.basis === 'estimasi') notes.push('Pemakaian bahan diperkirakan dari produk terjual × resep (pelacakan stok belum berjalan penuh).')
  if (stock.basis === 'data_kurang') notes.push('Riwayat penjualan belum 7 hari, jadi tanggal habis belum bisa diperkirakan; daftar di atas hanya bahan di bawah stok minimum.')
  if (!Number(stock.tracked_ingredients)) {
    return { headline: 'Belum ada bahan yang dicatat di Inventori.', points: [], actions: ['Tambahkan bahan & resep di Inventori agar sistem bisa memperingatkan stok menipis.'], notes: [] }
  }
  if (!stock.low.length) {
    return { headline: `Tidak ada bahan yang di bawah minimum atau diperkirakan habis sebelum pengiriman berikutnya (${formatNumber(stock.tracked_ingredients)} bahan dipantau).`, points: [], actions: [], notes }
  }
  const points = stock.low.map((row) => {
    const parts = [`${row.name}: sisa ${formatNumber(row.on_hand)} ${row.unit}`]
    if (row.below_minimum) parts.push(`di bawah minimum ${formatNumber(row.min_stock)} ${row.unit}`)
    if (row.days_left !== null) parts.push(Number(row.days_left) < 1 ? 'sudah habis atau habis hari ini' : `perkiraan habis ${formatNumber(row.days_left)} hari lagi (${dateKeyLabel(row.depletion_date)})`)
    if (Number(row.suggested_quantity) > 0) parts.push(`saran beli ${formatNumber(row.suggested_quantity)} ${row.unit}`)
    return `${parts.join(', ')}.`
  })
  return {
    headline: `${formatNumber(stock.low.length)} bahan perlu segera dibeli${stock.low[0] ? `, paling mendesak ${stock.low[0].name}` : ''}.`,
    points,
    actions: ['Buat draf PO dari Inventori → Perkiraan & belanja.'],
    notes,
  }
}

function answerExpenses(facts) {
  const exp = facts.expenses
  const text = periodText(facts)
  const points = []
  const notes = []
  const actions = []
  let headline
  if (exp.available === false) {
    headline = 'Beban operasional belum tercatat (modul keuangan, file 07, belum aktif).'
  } else {
    const increases = (exp.by_account || []).filter((row) => Number(row.change) > 0)
    const total = Number(exp.total)
    const prevTotal = Number(exp.previous_total)
    headline = increases.length
      ? `Beban ${formatRupiah(total)} vs ${formatRupiah(prevTotal)} (${text.previous}); kenaikan terbesar ${increases[0].account} ${signedRupiah(increases[0].change)}.`
      : `Tidak ada pos beban yang naik: total ${formatRupiah(total)} vs ${formatRupiah(prevTotal)}.`
    for (const row of increases.slice(0, 5)) {
      points.push(`${row.account}: ${formatRupiah(row.current)} vs ${formatRupiah(row.previous)} (${signedRupiah(row.change)}${row.change_pct !== null ? `, ${signedPercent(row.change_pct)}` : ', baru di periode ini'}).`)
    }
    if (increases[0]) actions.push(`Cek rincian ${increases[0].account} di menu Beban: apakah kenaikan wajar (tagihan musiman) atau bisa ditekan.`)
  }
  if (Number(exp.purchases) || Number(exp.previous_purchases)) {
    points.push(`Pembelian bahan (stok masuk): ${formatRupiah(exp.purchases)} vs ${formatRupiah(exp.previous_purchases)}.`)
  }
  if (Number(exp.waste) || Number(exp.previous_waste)) {
    points.push(`Bahan terbuang/rusak/kedaluwarsa: ${formatRupiah(exp.waste)} vs ${formatRupiah(exp.previous_waste)}.`)
    if (Number(exp.waste) > Number(exp.previous_waste)) actions.push('Bahan terbuang naik: cek tanggal kedaluwarsa dan jumlah pembelian.')
  }
  if (exp.available === false) notes.push('Jalankan file 07 dan mulai pembukuan untuk mencatat beban (sewa, gaji, listrik, …).')
  return { headline, points, actions, notes }
}

const REASON_TEXT = { margin_tinggi: 'margin tinggi', penjualan_rendah: 'penjualan masih rendah', penjualan_turun: 'penjualannya turun' }

function answerPromote(facts) {
  const promo = facts.promote
  if (promo.basis !== 'ok') return { headline: 'Belum ada rekomendasi.', points: [], actions: [], notes: [promo.reason] }
  if (!promo.candidates.length) {
    return { headline: 'Tidak ada produk yang marginnya tinggi tetapi penjualannya rendah — produk ber-margin tinggi sudah laku.', points: [], actions: [], notes: [`Median margin ${formatPercent(promo.median_margin_pct, 1)}, median terjual ${formatNumber(promo.median_quantity)}.`] }
  }
  const points = promo.candidates.map((row) => {
    const reasons = row.reasons.map((reason) => REASON_TEXT[reason] || reason).join(', ')
    const rating = row.rating ? `, rating ${formatNumber(row.rating)} dari ${formatNumber(row.rating_count)} ulasan` : ''
    return `${row.name}: margin ${formatPercent(row.margin_pct, 1)}, terjual ${formatNumber(row.quantity)} (periode lalu ${formatNumber(row.previous_quantity)})${rating} — ${reasons}.`
  })
  return {
    headline: `Kandidat promosi utama: ${promo.candidates[0].name}. Setiap tambahan penjualannya memberi laba kotor besar.`,
    points,
    actions: ['Buat voucher atau taruh di posisi teratas menu aplikasi untuk 1–2 minggu, lalu bandingkan penjualannya di sini.'],
    notes: [`Dasar: margin ≥ median (${formatPercent(promo.median_margin_pct, 1)}) dan terjual ≤ median (${formatNumber(promo.median_quantity)}) atau turun; produk habis/stok tipis tidak disarankan. Margin memakai HPP aktual atau estimasi resep.`],
  }
}

export function quickAnswer(key, facts) {
  if (!facts) return null
  if (key === 'revenue') return answerRevenue(facts)
  if (key === 'profit') return answerProfit(facts)
  if (key === 'stock') return answerStock(facts)
  if (key === 'expenses') return answerExpenses(facts)
  if (key === 'promote') return answerPromote(facts)
  return null
}

/** Catatan kualitas data: apa yang membuat jawaban kurang lengkap. */
export function dataQualityNotes(facts) {
  const quality = facts?.data_quality
  if (!quality) return []
  const notes = []
  if (!quality.inventory_tracking) notes.push('Pelacakan stok belum aktif — HPP & pemakaian bahan masih estimasi dari resep.')
  if (quality.products_without_recipe) notes.push(`${formatNumber(quality.products_without_recipe)} produk terjual belum punya resep (HPP tidak diketahui).`)
  if (!quality.accounting_go_live) notes.push('Pembukuan belum dimulai — beban operasional belum tercatat.')
  if (quality.account_order_share_pct !== null && Number(quality.account_order_share_pct) < 30) {
    notes.push(`Hanya ${formatPercent(quality.account_order_share_pct, 1)} pesanan dari akun pelanggan — analitik pelanggan mewakili sebagian kecil pembeli.`)
  }
  return notes
}
