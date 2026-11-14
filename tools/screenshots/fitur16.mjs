/*
 * Screenshot halaman fitur file 16 (data tiruan): analitik, tiket, detail kafe, Bantuan Dailybrew.
 *   node fitur16.mjs
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const WEB = process.env.WEB_URL || 'http://localhost:5173'
const ADMIN = process.env.ADMIN_URL || 'http://localhost:5174'
const out = new URL('./out/fitur16/', import.meta.url)
await mkdir(out, { recursive: true })
const file = (name) => decodeURIComponent(new URL(name, out).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

const TARGETS = [
  ['admin-analitik', `${ADMIN}/analitik`],
  ['admin-tiket', `${ADMIN}/tiket`],
  ['admin-tiket-detail', `${ADMIN}/tiket/t1`],
  ['admin-kafe-detail', `${ADMIN}/kafe/c2`],
  ['admin-kafe', `${ADMIN}/kafe`],
  ['owner-bantuan', `${WEB}/preview/owner/bantuan`],
  ['owner-bantuan-detail', `${WEB}/preview/owner/bantuan/tkt-2`],
]
const browser = await chromium.launch()
const problems = []
for (const [name, url] of TARGETS) {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const theme of width === 1440 ? ['dark', 'light'] : ['dark']) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
      await context.addInitScript((mode) => { try { window.localStorage.setItem('dailybrew.theme', mode) } catch { /* abaikan */ } }, theme)
      const page = await context.newPage()
      page.on('pageerror', (error) => problems.push(`${name} ${width} ${theme}: ${error.message}`))
      page.on('console', (message) => { if (message.type() === 'error') problems.push(`${name} ${width} ${theme}: console: ${message.text().slice(0, 200)}`) })
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
// Alur: owner membuat tiket baru
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', (error) => problems.push(`alur tiket: ${error.message}`))
  await page.goto(`${WEB}/preview/owner/bantuan`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Tiket baru' }).click()
  await page.getByRole('button', { name: 'Kirim tiket' }).click()
  await page.waitForTimeout(300)
  const errors = await page.locator('.ui-dialog .ui-field-error').allTextContents()
  if (errors.length < 3) problems.push(`validasi tiket baru kurang: ${JSON.stringify(errors)}`)
  await page.screenshot({ path: file('owner-tiket-validasi.png') })
  await page.locator('.ui-dialog select').selectOption('pesanan')
  await page.getByLabel('Judul').fill('Pesanan dobel di kasir')
  await page.getByLabel('Ceritakan kendalanya').fill('Pesanan A-012 tercatat dua kali.')
  await page.getByRole('button', { name: 'Kirim tiket' }).click()
  await page.waitForURL(/bantuan\/tkt-/, { timeout: 5000 }).catch(() => problems.push('tidak pindah ke detail tiket setelah dibuat'))
  await page.waitForTimeout(800)
  await page.screenshot({ path: file('owner-tiket-dibuat.png'), fullPage: true })
  await context.close()
}
await browser.close()
if (problems.length) {
  console.log('\nMasalah:')
  for (const line of [...new Set(problems)]) console.log(' -', line)
  process.exit(1)
}
console.log('\nTidak ada masalah')
