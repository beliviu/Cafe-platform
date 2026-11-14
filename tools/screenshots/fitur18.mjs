/*
 * Screenshot + alur fitur file 18 (data tiruan): tim admin & peran, pendaftaran, feature flag, status sistem, Tanya AI,
 * pengaturan & template email, lihat-sebagai, /daftar, /status, /mulai, banner insiden.
 *   node fitur18.mjs   (web :5173 dengan VITE_ADMIN_APP_URL=http://localhost:5174; admin :5174 dengan VITE_MOCK=1 VITE_OWNER_APP_URL=http://localhost:5173)
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const WEB = process.env.WEB_URL || 'http://localhost:5173'
const ADMIN = process.env.ADMIN_URL || 'http://localhost:5174'
const out = new URL('./out/fitur18/', import.meta.url)
await mkdir(out, { recursive: true })
const file = (name) => decodeURIComponent(new URL(name, out).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

const TARGETS = [
  ['admin-tim', `${ADMIN}/tim`],
  ['admin-pendaftaran', `${ADMIN}/pendaftaran`],
  ['admin-fitur', `${ADMIN}/fitur`],
  ['admin-status', `${ADMIN}/status-sistem`],
  ['admin-tanya-ai', `${ADMIN}/tanya-ai`],
  ['admin-pengaturan', `${ADMIN}/pengaturan`],
  ['admin-kafe-c2', `${ADMIN}/kafe/c2`],
  ['admin-kafe-support', `${ADMIN}/kafe/c2?mock_role=support`],
  ['web-daftar', `${WEB}/preview/public/daftar`],
  ['web-status', `${WEB}/preview/public/status?mock_incident=1`],
  ['web-mulai', `${WEB}/preview/owner/mulai`],
  ['web-dashboard-insiden', `${WEB}/preview/owner?mock_incident=1`],
  ['web-lihat-sebagai', `${WEB}/lihat-sebagai?sesi=demo&mock=1`],
]
const browser = await chromium.launch()
const problems = []
const IGNORE = /mock: status normal|tidak ada di mock|belum ada|Failed to load resource|challenges\.cloudflare/i
const watch = (page, label) => {
  page.on('pageerror', (error) => problems.push(`${label}: ${error.message}`))
  page.on('console', (message) => { if (message.type() === 'error' && !IGNORE.test(message.text())) problems.push(`${label}: console: ${message.text().slice(0, 200)}`) })
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

async function open(url, label, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  watch(page, label)
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  return { context, page }
}

// Menu per peran
{
  for (const [role, mustHave, mustNot] of [
    ['support', ['Tiket bantuan', 'Status sistem', 'Pendaftaran'], ['Keuangan', 'Tim admin', 'Analitik']],
    ['finance', ['Keuangan', 'Analitik', 'Tagihan'], ['Tiket bantuan', 'Tim admin', 'Pendaftaran']],
    ['super', ['Tim admin', 'Keuangan', 'Tiket bantuan', 'Feature flag'], []],
  ]) {
    const { context, page } = await open(`${ADMIN}/?mock_role=${role}`, `menu ${role}`)
    const nav = await page.locator('nav').first().innerText()
    for (const item of mustHave) if (!nav.includes(item)) problems.push(`menu ${role}: seharusnya ada "${item}"`)
    for (const item of mustNot) if (nav.includes(item)) problems.push(`menu ${role}: seharusnya TIDAK ada "${item}"`)
    await context.close()
  }
  const { context, page } = await open(`${ADMIN}/kafe/c2?mock_role=support`, 'detail kafe support')
  if (await page.getByRole('button', { name: 'Nonaktifkan' }).count()) problems.push('support: tombol Nonaktifkan seharusnya tersembunyi')
  if (await page.getByRole('button', { name: 'Buat tagihan' }).count()) problems.push('support: tombol Buat tagihan seharusnya tersembunyi')
  if (!(await page.getByRole('button', { name: 'Lihat sebagai owner' }).count())) problems.push('support: tombol Lihat sebagai owner seharusnya ada')
  await context.close()
}

// /daftar: validasi lalu sukses
{
  const { context, page } = await open(`${WEB}/preview/public/daftar`, 'alur daftar')
  await page.getByRole('button', { name: /Daftar & mulai coba/ }).click()
  await page.waitForTimeout(300)
  const errors = await page.locator('.login-form .ui-field-error').count()
  if (errors < 6) problems.push(`daftar: validasi kurang (${errors})`)
  await page.screenshot({ path: file('alur-daftar-validasi.png'), fullPage: true })
  await page.getByLabel('Nama kafe').fill('Kopi Tepi Sawah')
  await page.getByLabel('Nama Anda (owner)').fill('Wulan')
  await page.getByRole('textbox', { name: 'Email' }).fill('wulan@tepisawah.id')
  await page.getByLabel('Nomor WhatsApp').fill('081255501111')
  await page.getByLabel('Kota').fill('Yogyakarta')
  await page.getByRole('textbox', { name: 'Password' }).fill('rahasia123')
  await page.getByRole('button', { name: /Daftar & mulai coba/ }).click()
  await page.waitForTimeout(800)
  if (!(await page.getByText('Cek email Anda').count())) problems.push('daftar: layar sukses tidak muncul')
  await page.screenshot({ path: file('alur-daftar-sukses.png'), fullPage: true })
  await context.close()
}

// Admin: Tanya AI, undang tim, insiden, template, flag massal, lihat-sebagai
{
  const { context, page } = await open(`${ADMIN}/tanya-ai`, 'alur admin')
  await page.getByRole('button', { name: /paling mungkin berhenti/ }).first().click()
  await page.waitForTimeout(800)
  if (!(await page.locator('.ai-answer').count())) problems.push('Tanya AI: jawaban tidak tampil')
  await page.screenshot({ path: file('alur-tanya-ai.png'), fullPage: true })

  await page.goto(`${ADMIN}/tim`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Undang anggota' }).click()
  await page.getByRole('button', { name: 'Buat akun' }).click()
  await page.waitForTimeout(300)
  if ((await page.locator('.ui-dialog .ui-field-error').count()) < 2) problems.push('undang tim: validasi kurang')
  await page.getByRole('textbox', { name: 'Nama' }).fill('Dewi')
  await page.getByRole('textbox', { name: 'Email' }).fill('dewi@dailybrew.id')
  await page.getByRole('button', { name: 'Buat akun' }).click()
  await page.waitForTimeout(600)
  if (!(await page.getByText('Password ini hanya tampil sekali').count())) problems.push('undang tim: layar password sementara tidak muncul')
  await page.screenshot({ path: file('alur-undang-tim.png') })
  await page.getByRole('button', { name: 'Selesai' }).click()

  await page.goto(`${ADMIN}/status-sistem`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Insiden baru' }).click()
  await page.getByRole('button', { name: 'Umumkan' }).click()
  await page.waitForTimeout(300)
  if (!(await page.locator('.ui-dialog .ui-field-error').count())) problems.push('insiden: validasi tidak muncul')
  await page.getByRole('textbox', { name: 'Judul' }).fill('Dashboard lambat')
  await page.getByRole('checkbox', { name: 'Dashboard web' }).check()
  await page.getByRole('textbox', { name: 'Keterangan untuk kafe' }).fill('Halaman laporan memuat lebih lama dari biasanya.')
  await page.getByRole('button', { name: 'Umumkan' }).click()
  await page.waitForTimeout(600)
  if (!(await page.getByText('Dashboard lambat').count())) problems.push('insiden baru tidak tampil')

  await page.goto(`${ADMIN}/pengaturan`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await page.locator('.tpl-list button').nth(1).click()
  await page.waitForTimeout(500)
  const iframe = await page.locator('.tpl-preview iframe').count()
  if (!iframe) problems.push('template: pratinjau tidak tampil')
  await page.screenshot({ path: file('alur-template-email.png') })
  await page.keyboard.press('Escape')

  await page.goto(`${ADMIN}/fitur`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Uji coba ke kafe' }).click()
  await page.waitForTimeout(500)
  await page.locator('.flag-pick input[type="checkbox"]').first().check()
  await page.getByRole('button', { name: /Simpan untuk 1 kafe/ }).click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: file('alur-flag-massal.png'), fullPage: true })

  await page.goto(`${ADMIN}/kafe/c2`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await page.locator('.flag-list li').first().getByRole('radio', { name: 'Mati' }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Lihat sebagai owner' }).click()
  await page.getByRole('button', { name: 'Buka tampilan owner' }).click()
  await page.waitForTimeout(300)
  if (!(await page.locator('.ui-dialog .ui-field-error').count())) problems.push('lihat-sebagai: validasi alasan tidak muncul')
  await page.getByRole('textbox', { name: 'Alasan' }).fill('Owner lapor laporan kosong, cek tampilan')
  const [popup] = await Promise.all([
    context.waitForEvent('page', { timeout: 5000 }).catch(() => null),
    page.getByRole('button', { name: 'Buka tampilan owner' }).click(),
  ])
  if (!popup) problems.push('lihat-sebagai: jendela owner tidak terbuka')
  else {
    await popup.waitForTimeout(4000)
    const text = await popup.locator('body').innerText()
    // Token mock admin diterima → jendela lewat dari tahap menunggu (meski Supabase sungguhan menolak token tiruan)
    if (/harus dibuka dari dashboard admin/i.test(text)) problems.push('lihat-sebagai: token tidak diterima lewat postMessage')
    if (!popup.url().includes('/lihat-sebagai?sesi=imp-new')) problems.push(`lihat-sebagai: alamat jendela ${popup.url()}`)
    await popup.screenshot({ path: file('alur-lihat-sebagai-handshake.png') })
  }
  await context.close()
}

await browser.close()
if (problems.length) {
  console.log('\nMasalah:')
  for (const line of [...new Set(problems)]) console.log(' -', line)
  process.exit(1)
}
console.log('\nTidak ada masalah')
