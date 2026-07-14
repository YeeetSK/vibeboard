import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import pngToIco from 'png-to-ico'
import { PNG } from 'pngjs'

const source = process.argv[2] ?? '/Users/oliveralexy/Documents/image.png'
const buildDir = path.resolve('build')
const iconsetDir = path.join(buildDir, 'icon.iconset')
const iconPng = path.join(buildDir, 'icon.png')

if (!fs.existsSync(source)) {
  throw new Error(`Icon source not found: ${source}`)
}

fs.mkdirSync(buildDir, { recursive: true })
fs.writeFileSync(iconPng, normalizeIconPng(source))
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
  execFileSync('sips', ['-z', String(size), String(size), iconPng, '--out', path.join(iconsetDir, name)], {
    stdio: 'ignore'
  })
}

execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', path.join(buildDir, 'icon.icns')], {
  stdio: 'ignore'
})
fs.rmSync(iconsetDir, { recursive: true, force: true })

const icoBuffer = await pngToIco(iconPng)
fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer)

console.log('Generated build/icon.png, build/icon.icns, build/icon.ico')

function normalizeIconPng(sourcePath) {
  const input = PNG.sync.read(fs.readFileSync(sourcePath))
  const crop = findVisibleBounds(input)
  const outputSize = 1024
  const output = new PNG({ width: outputSize, height: outputSize })

  for (let index = 0; index < output.data.length; index += 4) {
    output.data[index] = 0
    output.data[index + 1] = 0
    output.data[index + 2] = 0
    output.data[index + 3] = 255
  }

  for (let y = 0; y < outputSize; y += 1) {
    for (let x = 0; x < outputSize; x += 1) {
      const sourceX = crop.x + (x / (outputSize - 1)) * Math.max(1, crop.width - 1)
      const sourceY = crop.y + (y / (outputSize - 1)) * Math.max(1, crop.height - 1)
      const pixel = sampleBilinear(input, sourceX, sourceY)
      const index = (y * outputSize + x) * 4
      const alpha = pixel[3] / 255

      output.data[index] = Math.round(pixel[0] * alpha)
      output.data[index + 1] = Math.round(pixel[1] * alpha)
      output.data[index + 2] = Math.round(pixel[2] * alpha)
      output.data[index + 3] = 255
    }
  }

  return PNG.sync.write(output)
}

function findVisibleBounds(image) {
  let minX = image.width
  let minY = image.height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = image.data[(y * image.width + x) * 4 + 3]
      if (alpha > 8) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, width: image.width, height: image.height }
  }

  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

function sampleBilinear(image, x, y) {
  const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(y)))
  const x1 = Math.max(0, Math.min(image.width - 1, x0 + 1))
  const y1 = Math.max(0, Math.min(image.height - 1, y0 + 1))
  const tx = x - x0
  const ty = y - y0
  const top = mixPixel(readPixel(image, x0, y0), readPixel(image, x1, y0), tx)
  const bottom = mixPixel(readPixel(image, x0, y1), readPixel(image, x1, y1), tx)
  return mixPixel(top, bottom, ty)
}

function readPixel(image, x, y) {
  const index = (y * image.width + x) * 4
  return [image.data[index], image.data[index + 1], image.data[index + 2], image.data[index + 3]]
}

function mixPixel(left, right, amount) {
  return left.map((channel, index) => channel + (right[index] - channel) * amount)
}
