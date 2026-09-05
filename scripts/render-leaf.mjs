#!/usr/bin/env node
/**
 * Render one leaf of any scan to a PNG, without the dev server.
 *
 *   node scripts/render-leaf.mjs <scan.pdf> <leaf> <out.png> [scale]
 *
 * `drive.mjs leaf` does this too and does it better, but it needs the whole app
 * served and a browser held open. This is for the case that keeps coming up
 * while reading: one page of one scan, looked at once, to settle something the
 * text layer cannot. `native-crop.mjs` is the other half and is the one to
 * reach for when detail matters, because it reads the embedded raster at its
 * own resolution rather than resampling a render; but it only handles JPEG, and
 * a great many scans (every Google book here) are JBIG2, which is why this
 * exists.
 *
 * `scale` is a multiple of the PDF's own 72 dpi page box, so 4 is about 290 dpi.
 * Going far above the embedded raster's own resolution buys nothing: check it
 * with `native-crop.mjs --info` first where that works.
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const [scan, leafArg, out, scaleArg = '3'] = process.argv.slice(2)
if (!scan || leafArg === undefined || !out) {
  console.error('usage: node scripts/render-leaf.mjs <scan.pdf> <leaf> <out.png> [scale]')
  process.exit(2)
}
const leaf = Number(leafArg)
const scale = Number(scaleArg)
const require = createRequire(import.meta.url)
// pdf.js ships only as an ES module here, and a page created with setContent
// cannot import one over file:// — Chromium refuses the local resource. So the
// module's source is injected and its two entry points handed to the window
// from inside module scope, which is the one place they are in scope.
const pdfSrc =
  readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'), 'utf8') +
  '\nwindow.pdfjsLib = { getDocument, GlobalWorkerOptions };'
const workerSrc = readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8')
const b64 = readFileSync(scan).toString('base64')

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  args: ['--allow-file-access-from-files']
})
const page = await browser.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.error('page:', m.text())
})
await page.setContent(`<!doctype html><body style="margin:0"><canvas id=c></canvas></body>`)
await page.addScriptTag({ content: pdfSrc, type: 'module' })
await page.waitForFunction(() => !!window.pdfjsLib)
const size = await page.evaluate(
  async ({ workerSrc, b64, leaf, scale }) => {
    const pdfjs = window.pdfjsLib
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
      new Blob([workerSrc], { type: 'text/javascript' })
    )
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: false }).promise
    if (leaf < 0 || leaf >= doc.numPages) throw new Error(`leaf ${leaf} of ${doc.numPages}`)
    const pg = await doc.getPage(leaf + 1)
    const viewport = pg.getViewport({ scale })
    const c = document.getElementById('c')
    c.width = Math.ceil(viewport.width)
    c.height = Math.ceil(viewport.height)
    await pg.render({ canvasContext: c.getContext('2d'), viewport }).promise
    return { w: c.width, h: c.height, pages: doc.numPages }
  },
  { workerSrc, b64, leaf, scale }
)
await page.locator('#c').screenshot({ path: out })
await browser.close()
console.log(`leaf ${leaf} of ${size.pages} -> ${out} (${size.w} x ${size.h})`)
