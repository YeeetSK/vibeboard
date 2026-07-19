import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'native', 'kblight.swift')
const outDir = path.join(root, 'build')
const outBin = path.join(outDir, 'kblight')

if (process.platform !== 'darwin') {
  console.log('build-kblight: skip (non-macOS)')
  process.exit(0)
}

if (!existsSync(source)) {
  console.error('build-kblight: missing native/kblight.swift')
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })

try {
  execFileSync('swiftc', [source, '-O', '-o', outBin], { stdio: 'inherit' })
  console.log(`build-kblight: wrote ${outBin}`)
} catch (error) {
  console.warn(
    'build-kblight: swiftc failed - keyboard backlight alerts will try to compile on first use.',
    error instanceof Error ? error.message : error
  )
  process.exit(0)
}
