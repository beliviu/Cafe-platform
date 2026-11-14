/*
 * Membuat styles/tokens.generated.css dari theme/theme.js (aksen bawaan, mode gelap & terang).
 * Blok ini hanya untuk tampilan pertama sebelum JS jalan; setelah itu applyTheme() menimpanya.
 *   node shared/ui/scripts/build-tokens.mjs
 */
import { writeFile } from 'node:fs/promises'
import { buildTheme, DEFAULT_ACCENT } from '../theme/theme.js'

const block = (selector, mode) => {
  const { vars } = buildTheme({ color: DEFAULT_ACCENT, mode })
  const lines = Object.entries(vars).map(([key, value]) => `  ${key}: ${value};`).join('\n')
  return `${selector} {\n  color-scheme: ${mode};\n${lines}\n}\n`
}

const css = `/* DIBUAT OTOMATIS oleh scripts/build-tokens.mjs — jangan diubah manual. Ubah theme/theme.js lalu jalankan ulang. */\n`
  + block(':root,\n:root[data-theme="dark"]', 'dark') + '\n' + block(':root[data-theme="light"]', 'light')

await writeFile(new URL('../styles/tokens.generated.css', import.meta.url), css)
console.log('tokens.generated.css diperbarui')
