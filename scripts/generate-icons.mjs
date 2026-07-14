import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import pngToIco from 'png-to-ico'

const source = process.argv[2] ?? '/Users/oliveralexy/Documents/image.png'
const buildDir = path.resolve('build')
const iconsetDir = path.join(buildDir, 'icon.iconset')

if (!fs.existsSync(source)) {
  throw new Error(`Icon source not found: ${source}`)
}

fs.mkdirSync(buildDir, { recursive: true })
fs.copyFileSync(source, path.join(buildDir, 'icon.png'))
fs.rmSync(iconsetDir, { recursive: true, force: true })
fs.mkdirSync(iconsetDir, { recursive: true })

const sizes = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png']
]

for (const [size, name] of sizes) {
  execFileSync('sips', ['-z', String(size), String(size), path.join(buildDir, 'icon.png'), '--out', path.join(iconsetDir, name)], {
    stdio: 'ignore'
  })
}

execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', path.join(buildDir, 'icon.icns')], {
  stdio: 'ignore'
})
fs.rmSync(iconsetDir, { recursive: true, force: true })

const icoBuffer = await pngToIco(path.join(buildDir, 'icon.png'))
fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer)

console.log('Generated build/icon.png, build/icon.icns, build/icon.ico')
