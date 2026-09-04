#!/usr/bin/env node
/**
 * Crop a region of a scan's **embedded image at its native resolution**.
 *
 * This exists because of a mistake that cost real time. Every crop in this
 * project had been taken from `drive.mjs leaf`, which renders the PDF page at a
 * requested DPI — and rendering *resamples*. Asking for 900 DPI from a page
 * whose embedded raster is 215 DPI does not produce detail; it produces a
 * four-times interpolation of pixels the scan never had, which then traces into
 * mush. The Revelation pamphlet's device was written off as untraceable on that
 * basis, and it is not: read straight out of the PDF's image XObject it is
 * ~290 px across, comparable to the eye emblem that traced perfectly well.
 *
 *   node scripts/native-crop.mjs <scan.pdf> <x> <y> <w> <h> <out.png> [scale] [threshold] [erode]
 *
 * `x y w h` are in the embedded image's own pixels — run with `--info` first to
 * see how big that is. `scale` resamples the crop for viewing or for tracing
 * (6 is a good figure: bicubic interpolation recovers sub-pixel edge position
 * from the antialiasing, which is not the same as inventing structure).
 *
 * `threshold` turns the crop bilevel at a luminance you choose, and `erode`
 * shrinks the ink by that radius. Both exist for tracing: marching squares
 * follows the OUTER boundary of the ink, so a threshold loose enough to keep
 * hairlines connected still renders them heavier than the paper. Thresholding
 * at ~135 and eroding by 2 at 6x restored this device's line weight. Otsu is
 * not usable on pre-thresholded input — it has two values to separate and
 * returns 0 — so pass `--threshold` to `trace-device.mjs` as well.
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { PDFDocument, PDFName } from 'pdf-lib'

const [scan, ...rest] = process.argv.slice(2)
if (!scan) {
  console.error(
    'usage: node scripts/native-crop.mjs <scan.pdf> <x> <y> <w> <h> <out.png> [scale] [threshold] [erode]'
  )
  console.error('       node scripts/native-crop.mjs <scan.pdf> --info')
  process.exit(2)
}

const doc = await PDFDocument.load(readFileSync(scan), { ignoreEncryption: true })
const page = doc.getPages()[0]
const xobjects = page.node.Resources().lookup(PDFName.of('XObject'))
if (!xobjects) {
  console.error('no image XObject on leaf 0 — this page is not a single scanned raster')
  process.exit(1)
}

let image = null
for (const [, ref] of xobjects.entries()) {
  const obj = doc.context.lookup(ref)
  const w = obj.dict.get(PDFName.of('Width'))?.numberValue
  const h = obj.dict.get(PDFName.of('Height'))?.numberValue
  if (w && h && (!image || w * h > image.w * image.h)) {
    image = { w, h, bytes: obj.contents, filter: obj.dict.get(PDFName.of('Filter'))?.toString() }
  }
}

const { width: ptW, height: ptH } = page.getSize()
console.log(
  `embedded image ${image.w} x ${image.h} (${image.filter}), page ${ptW} x ${ptH} pt` +
    ` — about ${Math.round(image.w / (ptW / 72))} dpi`
)
if (rest[0] === '--info') process.exit(0)

if (image.filter !== '/DCTDecode') {
  console.error(`this crops JPEG (/DCTDecode) rasters; this page holds ${image.filter}`)
  process.exit(1)
}

const [x, y, w, h, out, scale = 1, threshold = 0, erode = 0] = rest
const b64 = Buffer.from(image.bytes).toString('base64')

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true
})
const tab = await browser.newPage()
await tab.setContent('<html><body></body></html>')

const dataUrl = await tab.evaluate(
  async ([b64, x, y, w, h, scale, threshold, erode]) => {
    const img = new Image()
    img.src = 'data:image/jpeg;base64,' + b64
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = scale !== 1
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height)

    if (threshold > 0) {
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const px = frame.data
      for (let i = 0; i < px.length; i += 4) {
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
        const v = lum < threshold ? 0 : 255
        px[i] = px[i + 1] = px[i + 2] = v
        px[i + 3] = 255
      }
      if (erode > 0) {
        const W = canvas.width
        const H = canvas.height
        const src = new Uint8Array(W * H)
        for (let i = 0, j = 0; i < px.length; i += 4, j++) src[j] = px[i] < 128 ? 1 : 0
        const dst = new Uint8Array(W * H)
        for (let yy = 0; yy < H; yy++) {
          for (let xx = 0; xx < W; xx++) {
            let keep = 1
            for (let dy = -erode; dy <= erode && keep; dy++) {
              for (let dx = -erode; dx <= erode; dx++) {
                if (dx * dx + dy * dy > erode * erode) continue
                const ny = yy + dy
                const nx = xx + dx
                if (ny < 0 || ny >= H || nx < 0 || nx >= W || !src[ny * W + nx]) {
                  keep = 0
                  break
                }
              }
            }
            dst[yy * W + xx] = keep
          }
        }
        for (let i = 0, j = 0; i < px.length; i += 4, j++) {
          const v = dst[j] ? 0 : 255
          px[i] = px[i + 1] = px[i + 2] = v
          px[i + 3] = 255
        }
      }
      ctx.putImageData(frame, 0, 0)
    }
    return canvas.toDataURL('image/png')
  },
  [b64, Number(x), Number(y), Number(w), Number(h), Number(scale), Number(threshold), Number(erode)]
)

writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'))
console.log(`wrote ${out} (${Math.round(w * scale)} x ${Math.round(h * scale)})`)
await browser.close()
