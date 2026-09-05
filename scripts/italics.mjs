#!/usr/bin/env node
/**
 * Which runs of a scanned book's text layer are set in italic.
 *
 *   node scripts/italics.mjs <scan.pdf> <first> <last> > runs.json
 *
 * A Google scan's text layer carries ONE synthetic font for the whole page, so
 * pdf.js can say where every run is and not what face it is in. On a book that
 * uses italic for emphasis that is not a cosmetic loss: emphasis is content
 * here, it reaches the PDF, and a reading that drops it has lost something the
 * scan plainly shows.
 *
 * So it is measured. Within each run's own pixel box, take the column ink
 * profile of the upper half of the x-height and of the lower half and
 * and search for the shear that makes the column profile most peaked. Vertical
 * stems pile up when the shear matches the face's slant, so roman peaks at zero
 * and italic at a positive lean. Reported in hundredths of a unit of rise. Validated against a leaf read by eye first: every roman run came back
 * 0 and the two italic passages came back 2 to 3, with the one mixed run (roman
 * running into italic mid-line) at 1, which is the right answer for it.
 *
 * **Reported, never applied.** A run at lag 1 is a run for a person to look at,
 * not an edit. Rendering and measuring happen in the same browser pass so the
 * pixels never leave it.
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const [scan, firstArg, lastArg, scaleArg = '4'] = process.argv.slice(2)
if (!scan || firstArg === undefined || lastArg === undefined) {
  console.error('usage: node scripts/italics.mjs <scan.pdf> <first> <last> [scale]')
  process.exit(2)
}
const require = createRequire(import.meta.url)
const pdfSrc =
  readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'), 'utf8') +
  '\nwindow.pdfjsLib = { getDocument, GlobalWorkerOptions };'
const workerSrc = readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8')

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true
})
const page = await browser.newPage()
await page.setContent('<!doctype html><body style="margin:0"><canvas id=c></canvas></body>')
await page.addScriptTag({ content: pdfSrc, type: 'module' })
await page.waitForFunction(() => !!window.pdfjsLib)

const out = await page.evaluate(
  async ({ workerSrc, b64, first, last, scale }) => {
    const pdfjs = window.pdfjsLib
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
      new Blob([workerSrc], { type: 'text/javascript' })
    )
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: false }).promise
    const c = document.getElementById('c')
    const ctx = c.getContext('2d', { willReadFrequently: true })
    const pages = []
    for (let leaf = first; leaf <= last && leaf < doc.numPages; leaf++) {
      const pg = await doc.getPage(leaf + 1)
      const viewport = pg.getViewport({ scale })
      c.width = Math.ceil(viewport.width)
      c.height = Math.ceil(viewport.height)
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, c.width, c.height)
      await pg.render({ canvasContext: ctx, viewport }).promise
      const W = c.width,
        H = c.height
      const d = ctx.getImageData(0, 0, W, H).data
      const dark = (x, y) => d[(y * W + x) * 4] < 128
      const items = (await pg.getTextContent()).items.filter((i) => 'str' in i && i.str.trim())
      const runs = []
      for (const i of items) {
        const x = i.transform[4] * scale
        const w = i.width * scale
        const hh = (i.height || i.transform[3]) * scale
        const yb = H - i.transform[5] * scale
        const x0 = Math.max(0, Math.round(x)),
          x1 = Math.min(W, Math.round(x + w))
        const y0 = Math.max(0, Math.round(yb - hh * 1.25)),
          y1 = Math.min(H, Math.round(yb + hh * 0.35))
        let lag = null
        if (x1 - x0 >= 20 && y1 - y0 >= 8) {
          const rows = []
          for (let y = y0; y < y1; y++) {
            let n = 0
            for (let xx = x0; xx < x1; xx++) if (dark(xx, y)) n++
            rows.push(n)
          }
          const peak = Math.max(...rows)
          const dense = []
          for (let k = 0; k < rows.length; k++) if (rows[k] > peak * 0.4) dense.push(y0 + k)
          if (dense.length >= 6) {
            const a = dense[0],
              b = dense[dense.length - 1] + 1,
              ym = (a + b) / 2
            const wpx = x1 - x0
            // A SHEAR SEARCH. Shear the band by a trial slope and measure how
            // peaked its column profile becomes: vertical stems pile into tall
            // narrow columns when the shear matches the face's own slant, and
            // smear at every other angle. The score is the sum of squares of the
            // profile, which is maximal when the ink is concentrated.
            //
            // This is the third method tried here and the first that works on
            // the whole book. Cross-correlating the top and bottom halves of the
            // x-height was right in principle and read one roman paragraph of
            // leaf 9 as 6, 2, 0, 0, -2, 2, because inter-word spaces dominate
            // the correlation. Differencing the two halves' centres of mass was
            // worse still: it has no alignment in it at all, and scored known
            // italic at -41 and known roman at 174.
            let best = -1
            for (let si = -4; si <= 12; si++) {
              const sl = -si / 20
              const prof = new Float64Array(wpx + 32)
              for (let y = a; y < b; y++) {
                const dx = sl * (y - ym)
                for (let xx = x0; xx < x1; xx++) {
                  if (dark(xx, y)) {
                    const k = Math.round(xx - x0 + dx) + 16
                    if (k >= 0 && k < prof.length) prof[k]++
                  }
                }
              }
              let sc = 0
              for (let k = 0; k < prof.length; k++) sc += prof[k] * prof[k]
              if (sc > best) {
                best = sc
                lag = si * -5
              }
            }
          }
        }
        runs.push({ x: i.transform[4], y: i.transform[5], w: i.width, t: i.str, slant: lag })
      }
      pages.push({ leaf, runs })
    }
    return pages
  },
  {
    workerSrc,
    b64: readFileSync(scan).toString('base64'),
    first: Number(firstArg),
    last: Number(lastArg),
    scale: Number(scaleArg)
  }
)
await browser.close()
console.log(JSON.stringify(out))
