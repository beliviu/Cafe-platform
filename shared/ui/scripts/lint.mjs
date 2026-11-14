/*
 * Menjalankan oxlint untuk shared/ui memakai oxlint milik aplikasi pemanggil
 * (shared/ui tidak punya node_modules sendiri). Dipanggil dari `npm run lint` kedua aplikasi.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const require = createRequire(join(process.cwd(), 'package.json'))
const bin = join(require.resolve('oxlint/package.json'), '..', 'bin', 'oxlint')
const cwd = fileURLToPath(new URL('..', import.meta.url))
const result = spawnSync(process.execPath, [bin, '--deny-warnings', '.'], { cwd, stdio: 'inherit' })
process.exit(result.status ?? 1)
