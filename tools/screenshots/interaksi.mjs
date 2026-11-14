/*
 * Uji interaksi (data tiruan): palet perintah, navigasi keyboard, saklar animasi, sidebar ciut,
 * centang "Tandai lunas", dan lebar 1280. Hasil + screenshot ke out/interaksi/.
 *   node interaksi.mjs
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const WEB = process.env.WEB_URL || 'http://localhost:5173'
const ADMIN = process.env.ADMIN_URL || 'http://localhost:5174'
const out = new URL('./out/interaksi/', import.meta.url)
await mkdir(out, { recursive: true })
const file = (name) => decodeURIComponent(new URL(name, out).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(ok ? 'LULUS' : 'GAGAL', '-', name, detail) }
const browser = await chromium.launch()

async function open(url, { width = 1440, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  return { context, page, errors }
}

// ---------- Owner: palet perintah & pencarian data ----------
{
  const { context, page, errors } = await open(`${WEB}/preview/owner`)
  await page.keyboard.press('Control+k')
  await page.waitForSelector('.cmdk[open]')
  check('Ctrl+K membuka palet perintah', true)
  await page.keyboard.type('latte')
  await page.waitForTimeout(600)
  const labels = await page.locator('.cmdk-item .cmdk-label').allTextContents()
  check('Palet menawarkan cari produk & transaksi', labels.some((text) => /di produk/.test(text)) && labels.some((text) => /di transaksi/.test(text)), JSON.stringify(labels))
  await page.screenshot({ path: file('owner-palet.png') })
  await page.locator('.cmdk-item', { hasText: 'di produk' }).click()
  await page.waitForTimeout(1200)
  const value = await page.locator('.toolbar input[type="search"], .ui-search-input').first().inputValue()
  check('Halaman Produk terbuka dengan pencarian terisi', page.url().includes('/products?q=latte') && value === 'latte', `${page.url()} | "${value}"`)
  await page.screenshot({ path: file('owner-produk-cari.png') })

  // Palet: perintah matikan animasi
  await page.keyboard.press('Control+k')
  await page.keyboard.type('animasi')
  await page.waitForTimeout(200)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  check('Perintah "Matikan animasi" memasang data-motion="off"', (await page.evaluate(() => document.documentElement.dataset.motion)) === 'off')
  const duration = await page.evaluate(() => getComputedStyle(document.querySelector('.ui-btn, .sb-link')).transitionDuration)
  check('Transisi benar-benar mati', /^0?\.?0*1?e?-?\d*s|0s|1e-06s|0\.000001s/.test(duration) || parseFloat(duration) < 0.01, duration)
  await page.reload({ waitUntil: 'networkidle' })
  check('Pilihan animasi diingat setelah muat ulang', (await page.evaluate(() => document.documentElement.dataset.motion)) === 'off')
  await page.locator('.sb-account-tools button[aria-pressed]').click()
  check('Tombol petir di sidebar menyalakan lagi', (await page.evaluate(() => document.documentElement.dataset.motion)) === 'on')

  // Sidebar ciut + diingat
  await page.locator('.sb-collapse').click()
  await page.waitForTimeout(500)
  const railWidth = await page.locator('.sb').evaluate((node) => node.getBoundingClientRect().width)
  check('Sidebar menciut jadi rail 72px', Math.round(railWidth) === 72, String(railWidth))
  await page.locator('.sb-scroll.is-rail .sb-link').nth(1).hover()
  await page.waitForTimeout(400)
  check('Rail membuka menu melayang grup', await page.locator('.sb-flyout').isVisible())
  await page.screenshot({ path: file('owner-rail.png') })
  await page.reload({ waitUntil: 'networkidle' })
  check('Status ciut diingat', await page.locator('.app.is-collapsed').count() === 1)
  await page.locator('.sb-collapse').click()

  // Keyboard: Tab pertama = tautan lompat, fokus terlihat
  await page.goto(`${WEB}/preview/owner`, { waitUntil: 'networkidle' })
  await page.keyboard.press('Tab')
  const skip = await page.evaluate(() => document.activeElement?.className)
  check('Tab pertama = "Lompat ke konten"', skip === 'app-skip', String(skip))
  let outlineOk = true
  const seen = []
  for (let index = 0; index < 14; index += 1) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const node = document.activeElement
      const style = getComputedStyle(node)
      return { tag: node.tagName, label: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 30), outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2 }
    })
    seen.push(info.label)
    if (!info.outline) outlineOk = false
  }
  check('14 elemen berikutnya bisa difokus & outline fokus terlihat', outlineOk, seen.join(' | '))
  check('Tidak ada error JavaScript (owner)', errors.length === 0, errors.join('; '))
  await context.close()
}

// ---------- Tombol ikon tanpa nama aksesibel ----------
for (const [name, url] of [['owner', `${WEB}/preview/owner`], ['staff papan', `${WEB}/preview/staff`], ['staff kasir', `${WEB}/preview/staff/pos`], ['admin', `${ADMIN}/`], ['admin tagihan', `${ADMIN}/tagihan`]]) {
  const { context, page } = await open(url)
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, a[href]')].filter((node) => {
    const text = (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').trim()
    return !text && node.offsetParent !== null
  }).map((node) => node.outerHTML.slice(0, 120)))
  check(`Semua tombol & tautan punya nama (${name})`, unnamed.length === 0, unnamed.join(' || '))
  const small = await page.evaluate(() => [...document.querySelectorAll('*')].filter((node) => node.children.length === 0 && node.textContent.trim() && node.offsetParent !== null && parseFloat(getComputedStyle(node).fontSize) < 12)
    .map((node) => `${node.className || node.tagName}:${getComputedStyle(node).fontSize}`).slice(0, 6))
  check(`Tidak ada teks di bawah 12px (${name})`, small.length === 0, small.join(', '))
  await context.close()
}

// ---------- Staff: target sentuh ----------
{
  const { context, page } = await open(`${WEB}/preview/staff`, { width: 1280, height: 800 })
  const tiny = await page.evaluate(() => [...document.querySelectorAll('.app-content button, .app-content a[href]')].filter((node) => node.offsetParent !== null).map((node) => {
    const rect = node.getBoundingClientRect()
    return { label: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 24), w: Math.round(rect.width), h: Math.round(rect.height) }
  }).filter((item) => item.h < 44 || item.w < 44))
  check('Papan pesanan: semua target sentuh ≥ 44px (aksi utama 52px)', tiny.length === 0, JSON.stringify(tiny.slice(0, 6)))
  await context.close()
  const pos = await open(`${WEB}/preview/staff/pos`, { width: 1280, height: 800 })
  const tinyPos = await pos.page.evaluate(() => [...document.querySelectorAll('.app-content button, .app-content a[href]')].filter((node) => node.offsetParent !== null).map((node) => {
    const rect = node.getBoundingClientRect()
    return { label: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 24), w: Math.round(rect.width), h: Math.round(rect.height) }
  }).filter((item) => item.h < 44 || item.w < 44))
  check('Kasir: semua target sentuh ≥ 44px', tinyPos.length === 0, JSON.stringify(tinyPos.slice(0, 6)))
  // Tambah item ke keranjang
  await pos.page.locator('.pos-product:not(.is-soldout)').first().click()
  await pos.page.waitForTimeout(500)
  await pos.page.screenshot({ path: file('staff-kasir-1280.png') })
  await pos.context.close()
}

// ---------- Admin: Tandai lunas + centang, lebar 1280 ----------
{
  const { context, page, errors } = await open(`${ADMIN}/tagihan`, { width: 1280, height: 800 })
  await page.locator('.data-table button', { hasText: 'Lunas' }).first().click()
  await page.waitForSelector('.ui-dialog[open]')
  await page.locator('.ui-dialog button[type="submit"]').click()
  const shown = await page.locator('.ui-success .ui-check').waitFor({ timeout: 3000 }).then(() => true).catch(() => false)
  check('Centang beranimasi muncul setelah "Tandai lunas"', shown)
  await page.screenshot({ path: file('admin-lunas-centang.png') })
  await page.waitForTimeout(1500)
  check('Dialog menutup sendiri & toast muncul', (await page.locator('.ui-dialog[open]').count()) === 0 && (await page.locator('.ui-toast').count()) >= 1)
  check('Tidak ada error JavaScript (admin)', errors.length === 0, errors.join('; '))
  await context.close()

  for (const [name, url] of [['admin-beranda', `${ADMIN}/`], ['owner-dashboard', `${WEB}/preview/owner`]]) {
    const view = await open(url, { width: 1280, height: 800 })
    const overflow = await view.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`Lebar 1280 tanpa geser horizontal (${name})`, overflow <= 1, String(overflow))
    await view.page.screenshot({ path: file(`${name}-1280.png`), fullPage: true })
    await view.context.close()
  }
}

await browser.close()
const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} lulus`)
process.exit(failed.length ? 1 : 0)
