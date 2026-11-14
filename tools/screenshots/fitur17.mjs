/*
 * Screenshot + alur fitur file 17 (data tiruan): Keuangan platform (5 tab), kartu Penagihan di detail kafe,
 * tagihan dengan diskon & kuitansi, halaman Langganan owner (promo, referral, banner nonaktif).
 *   node fitur17.mjs   (dev server web :5173 & admin :5174 dengan VITE_MOCK=1)
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const WEB = process.env.WEB_URL || 'http://localhost:5173'
const ADMIN = process.env.ADMIN_URL || 'http://localhost:5174'
const out = new URL('./out/fitur17/', import.meta.url)
await mkdir(out, { recursive: true })
const file = (name) => decodeURIComponent(new URL(name, out).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

const TARGETS = [
  ['admin-keuangan', `${ADMIN}/keuangan`],
  ['admin-keuangan-promo', `${ADMIN}/keuangan?tab=promo`],
  ['admin-keuangan-referral', `${ADMIN}/keuangan?tab=referral`],
  ['admin-keuangan-cabang', `${ADMIN}/keuangan?tab=cabang`],
  ['admin-keuangan-pengaturan', `${ADMIN}/keuangan?tab=pengaturan`],
  ['admin-kafe-c1', `${ADMIN}/kafe/c1`],
  ['admin-kafe-c6', `${ADMIN}/kafe/c6`],
  ['admin-tagihan', `${ADMIN}/tagihan`],
  ['owner-langganan', `${WEB}/preview/owner/settings/subscription`],
  ['owner-nonaktif', `${WEB}/preview/owner/settings/subscription?mock_billing=suspended`],
  ['owner-akan-nonaktif', `${WEB}/preview/owner/settings/subscription?mock_billing=warning`],
]
const browser = await chromium.launch()
const problems = []
const watch = (page, label) => {
  page.on('pageerror', (error) => problems.push(`${label}: ${error.message}`))
  page.on('console', (message) => { if (message.type() === 'error' && !/mock: status normal|tidak ada di mock/.test(message.text())) problems.push(`${label}: console: ${message.text().slice(0, 200)}`) })
}

for (const [name, url] of TARGETS) {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const theme of width === 1440 ? ['dark', 'light'] : ['dark']) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
      await context.addInitScript((mode) => { try { window.localStorage.setItem('dailybrew.theme', mode) } catch { /* abaikan */ } }, theme)
      const page = await context.newPage()
      watch(page, `${name} ${width} ${theme}`)
      await page.goto(url, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1200)
      await page.screenshot({ path: file(`${name}-${width}-${theme}.png`), fullPage: true })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      if (overflow > 1) problems.push(`${name} ${width} ${theme}: halaman bisa digeser horizontal ${overflow}px`)
      await context.close()
      console.log('ok', name, width, theme)
    }
  }
}

// Owner: promo salah → pesan; promo benar → total berubah; unduh kuitansi
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const page = await context.newPage()
  watch(page, 'alur owner')
  await page.goto(`${WEB}/preview/owner/settings/subscription`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Punya kode promo?' }).click()
  await page.getByLabel('Kode promo').fill('ngawur')
  await page.getByRole('button', { name: 'Pakai', exact: true }).click()
  await page.waitForTimeout(400)
  const promoError = await page.locator('.billing-promo .ui-field-error').textContent().catch(() => '')
  if (!/tidak dikenal/.test(promoError || '')) problems.push(`promo salah: pesan tidak muncul (${promoError})`)
  await page.getByLabel('Kode promo').fill('hemat20')
  await page.getByRole('button', { name: 'Pakai', exact: true }).click()
  await page.waitForTimeout(500)
  const total = await page.locator('.billing-breakdown .is-total dd').textContent().catch(() => '')
  if (!/229\.200/.test(total || '')) problems.push(`promo HEMAT20: total seharusnya Rp 229.200, tampil "${total}"`)
  await page.screenshot({ path: file('owner-promo-dipasang.png'), fullPage: true })
  await page.getByRole('button', { name: /Lepas kode promo/ }).click()
  await page.waitForTimeout(500)
  if (await page.getByText('Promo HEMAT20').count()) problems.push('promo tidak terlepas')
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
    page.getByRole('button', { name: 'Unduh kuitansi INV-2610-00018' }).click(),
  ])
  if (!download) problems.push('kuitansi owner: tidak ada unduhan')
  else if (download.suggestedFilename() !== 'Kuitansi-KW-2610-00018.pdf') problems.push(`kuitansi owner: nama berkas ${download.suggestedFilename()}`)
  await context.close()
}

// Admin: validasi promo baru, simpan; atur kredit; unduh kuitansi
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const page = await context.newPage()
  watch(page, 'alur admin')
  await page.goto(`${ADMIN}/keuangan?tab=promo`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Promo baru' }).first().click()
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()
  await page.waitForTimeout(300)
  const errors = await page.locator('.ui-dialog .ui-field-error').allTextContents()
  if (errors.length < 2) problems.push(`validasi promo baru kurang: ${JSON.stringify(errors)}`)
  await page.screenshot({ path: file('admin-promo-validasi.png') })
  await page.getByRole('textbox', { name: 'Kode', exact: true }).fill('ramadan 25')
  await page.locator('.ui-dialog input[type="number"]').first().fill('25')
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()
  await page.waitForTimeout(800)
  if (!(await page.getByText('RAMADAN25').count())) problems.push('promo baru tidak muncul di tabel')

  await page.goto(`${ADMIN}/kafe/c1`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Atur kredit' }).click()
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()
  await page.waitForTimeout(300)
  if ((await page.locator('.ui-dialog .ui-field-error').count()) < 2) problems.push('validasi atur kredit kurang')
  await page.getByRole('textbox', { name: 'Nominal' }).fill('25000')
  await page.getByRole('textbox', { name: 'Alasan' }).fill('Kompensasi')
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()
  await page.waitForTimeout(800)
  if (!(await page.getByText('Kompensasi').count())) problems.push('riwayat kredit tidak bertambah')
  await page.screenshot({ path: file('admin-kredit-diatur.png'), fullPage: true })

  await page.goto(`${ADMIN}/tagihan`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
    page.getByRole('button', { name: 'Unduh kuitansi INV-2611-00009' }).click(),
  ])
  if (!download) problems.push('kuitansi admin: tidak ada unduhan')
  await context.close()
}

await browser.close()
if (problems.length) {
  console.log('\nMasalah:')
  for (const line of [...new Set(problems)]) console.log(' -', line)
  process.exit(1)
}
console.log('\nTidak ada masalah')
