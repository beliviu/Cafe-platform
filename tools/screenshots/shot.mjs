/*
 * Screenshot QA tampilan (data tiruan, tidak menyentuh database).
 *   node shot.mjs <label> [filter]
 * label  = nama folder hasil (mis. "before", "after")
 * filter = potongan nama target (opsional), mis. "admin" atau "pos"
 *
 * Prasyarat: kedua server dev jalan —
 *   web-dashboard : npx vite --port 5173
 *   platform-admin: VITE_MOCK=1 npx vite --port 5174
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const WEB = process.env.WEB_URL || 'http://localhost:5173'
const ADMIN = process.env.ADMIN_URL || 'http://localhost:5174'

const TARGETS = [
  { name: 'admin-beranda', url: `${ADMIN}/` },
  { name: 'owner-dashboard', url: `${WEB}/preview/owner` },
  { name: 'staff-papan', url: `${WEB}/preview/staff`, sizes: ['1280x800', '1024x768', '390x844'] },
  { name: 'staff-pos', url: `${WEB}/preview/staff/pos`, sizes: ['1280x800', '1024x768', '390x844'] },
]
// Halaman lain (sapuan cepat): node shot.mjs <label> lain
const OTHERS = [
  ['admin-kafe', `${ADMIN}/kafe`], ['admin-kafe-detail', `${ADMIN}/kafe/c1`], ['admin-tagihan', `${ADMIN}/tagihan`], ['admin-pengaturan', `${ADMIN}/pengaturan`],
  ['owner-transaksi', `${WEB}/preview/owner/orders`], ['owner-produk', `${WEB}/preview/owner/products`], ['owner-stok', `${WEB}/preview/owner/inventory`],
  ['owner-keuangan', `${WEB}/preview/owner/finance`], ['owner-tampilan', `${WEB}/preview/owner/settings/appearance`], ['owner-pengaturan', `${WEB}/preview/owner/settings`],
  ['staff-riwayat', `${WEB}/preview/staff/history`], ['staff-menu', `${WEB}/preview/staff/menu`],
].map(([name, url]) => ({ name: `lain-${name}`, url, sizes: ['1440x900', '390x844'], themes: ['dark'] }))
const SIZES = ['1440x900', '390x844']
const THEMES = ['dark', 'light']

const [label = 'shot', filter = ''] = process.argv.slice(2)
const outDir = new URL(`./out/${label}/`, import.meta.url)
await mkdir(outDir, { recursive: true })

const browser = await chromium.launch()
const problems = []
for (const target of [...TARGETS, ...OTHERS].filter((item) => (filter ? item.name.includes(filter) : !item.name.startsWith('lain-')))) {
  for (const size of target.sizes || SIZES) {
    const [width, height] = size.split('x').map(Number)
    for (const theme of target.themes || THEMES) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
      await context.addInitScript((mode) => {
        try { window.localStorage.setItem('dailybrew.theme', mode) } catch { /* abaikan */ }
      }, theme)
      const page = await context.newPage()
      page.on('pageerror', (error) => problems.push(`${target.name} ${size} ${theme}: ${error.message}`))
      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`${target.name} ${size} ${theme}: console: ${message.text().slice(0, 200)}`)
      })
      await page.goto(target.url, { waitUntil: 'networkidle' })
      await page.waitForTimeout(target.wait ?? 900)
      const file = new URL(`${target.name}-${width}-${theme}.png`, outDir)
      await page.screenshot({ path: decodeURIComponent(file.pathname.replace(/^\/([A-Za-z]:)/, '$1')), fullPage: true })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      if (overflow > 1) problems.push(`${target.name} ${size} ${theme}: halaman bisa digeser horizontal ${overflow}px`)
      await context.close()
      console.log('ok', target.name, size, theme)
    }
  }
}
await browser.close()
if (problems.length) {
  console.log('\nMasalah:')
  for (const line of [...new Set(problems)]) console.log(' -', line)
}
