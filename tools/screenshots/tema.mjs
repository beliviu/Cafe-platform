/*
 * Screenshot tema warna penuh + sidebar mengambang: beberapa preset, gelap & terang, admin & owner.
 *   node tema.mjs   (dev server web :5173 & admin :5174 dengan VITE_MOCK=1)
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const WEB = process.env.WEB_URL || 'http://localhost:5173'
const ADMIN = process.env.ADMIN_URL || 'http://localhost:5174'
const out = new URL('./out/tema/', import.meta.url)
await mkdir(out, { recursive: true })
const file = (name) => decodeURIComponent(new URL(name, out).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const THEME_MODULE = new URL('../../shared/ui/theme/theme.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const COLORS = [['hijau-senja', '#4F9A8A'], ['samudra', '#4F86C6'], ['mawar', '#B0708C']]
const PAGES = [['admin', ADMIN, `${ADMIN}/`], ['owner', WEB, `${WEB}/preview/owner`]]
const browser = await chromium.launch()
const problems = []
for (const [app, origin, url] of PAGES) {
  for (const [name, color] of COLORS) {
    for (const mode of ['dark', 'light']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
      await context.addInitScript((value) => { try { window.localStorage.setItem('dailybrew.theme', value) } catch { /* abaikan */ } }, mode)
      const page = await context.newPage()
      page.on('pageerror', (error) => problems.push(`${app} ${name} ${mode}: ${error.message}`))
      await page.goto(url, { waitUntil: 'networkidle' })
      await page.waitForTimeout(900)
      await page.evaluate(async ({ modulePath, value, themeMode, base }) => {
        const theme = await import(`${base}/@fs/${modulePath}`)
        theme.applyTheme({ color: value, mode: themeMode })
      }, { modulePath: THEME_MODULE, value: color, themeMode: mode, base: origin })
      await page.waitForTimeout(500)
      await page.screenshot({ path: file(`${app}-${name}-${mode}.png`) })
      const floating = await page.evaluate(() => {
        const sidebar = document.querySelector('.sb')
        if (!sidebar) return null
        const rect = sidebar.getBoundingClientRect()
        return { left: rect.left, top: rect.top, radius: getComputedStyle(sidebar).borderTopLeftRadius }
      })
      if (!floating || floating.left < 8 || floating.top < 8 || floating.radius === '0px') problems.push(`${app} ${name} ${mode}: sidebar tidak mengambang ${JSON.stringify(floating)}`)
      await context.close()
      console.log('ok', app, name, mode)
    }
  }
}
await browser.close()
if (problems.length) {
  console.log('\nMasalah:')
  for (const line of [...new Set(problems)]) console.log(' -', line)
  process.exit(1)
}
console.log('\nTidak ada masalah')
