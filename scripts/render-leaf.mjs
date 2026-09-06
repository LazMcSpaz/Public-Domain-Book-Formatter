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
 *
 *   node scripts/render-leaf.mjs <scan.pdf> <leaf> <out.png> [scale] --find "<words>"
 *
 * `--find` cuts a band around a phrase instead of rendering the whole leaf, and
 * exists to serve a standing ruling: every query put to the editor arrives with
 * a crop, and the crop shows **the sentence** — five or six words of context
 * either side — because a word the pixels cannot settle is settled, if at all,
 * by what the sentence needs.
 *
 * Locating that band by hand is the slow half of raising a query, and it is the
 * half a machine should do: the scan's own text layer already knows which line
 * the phrase is on and where that line sits. So the phrase is matched against
 * the layer on letters and digits alone — the layer's damage is punctuation and
 * lost spaces, and matching on those would fail on exactly the leaves worth
 * looking at — and the band is that line with `--context` lines above and below
 * it (2 by default, which is the ruling's three-or-four-line band).
 *
 * It reports the box it cut. A leaf whose layer does not hold the phrase says
 * so and renders nothing, rather than handing back a confident crop of the
 * wrong place.
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const at = argv.indexOf(name)
  if (at < 0) return fallback
  const v = argv[at + 1]
  argv.splice(at, 2)
  return v
}
const find = opt('--find', null)
const context = Number(opt('--context', '2'))
const [scan, leafArg, out, scaleArg = '3'] = argv
if (!scan || leafArg === undefined || !out) {
  console.error('usage: node scripts/render-leaf.mjs <scan.pdf> <leaf> <out.png> [scale]')
  console.error('       ... --find "<words>" [--context <lines>]')
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
  async ({ workerSrc, b64, leaf, scale, find, context }) => {
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

    let band = null
    if (find) {
      // Group the layer into lines on the baseline, as dump-layer.mjs does.
      const items = (await pg.getTextContent()).items.filter((i) => 'str' in i)
      const lines = []
      let cur = null
      for (const it of items) {
        const y = it.transform[5]
        if (!cur || Math.abs(y - cur.y) > 2) {
          cur = { y, top: y, text: '' }
          lines.push(cur)
        }
        cur.text += it.str
        cur.top = Math.max(cur.top, y + (it.height ?? 0))
      }
      // Letters and digits only: the layer's damage is punctuation and lost
      // spaces, so matching on those fails on the leaves worth looking at.
      //
      // Matched against the whole leaf rather than line by line, because a
      // printed book breaks words: the first phrase this was tried on was
      // "Apocalypse", set as `Apo-` / `calypse` across a line end, and a
      // per-line search reported the leaf did not contain a word plainly on it.
      // Stripping to letters and digits makes the break disappear on its own;
      // the match then has to be walked back to the line it starts in.
      const bare = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
      const want = bare(find)
      let whole = ''
      const startsAt = lines.map((l) => {
        const from = whole.length
        whole += bare(l.text)
        return from
      })
      const hit = whole.indexOf(want)
      if (hit < 0) return { missing: true, pages: doc.numPages }
      let at = 0
      while (at + 1 < lines.length && startsAt[at + 1] <= hit) at++
      const lo = Math.max(0, at - context)
      const hi = Math.min(lines.length - 1, at + context)
      // PDF y counts up from the foot; the canvas counts down from the head.
      const pageH = pg.getViewport({ scale: 1 }).height
      const topPt = lines[lo].top
      const botPt = lines[hi].y
      band = {
        y: Math.max(0, Math.round((pageH - topPt - 6) * scale)),
        h: Math.round((topPt - botPt + 18) * scale),
        line: lines[at].text
      }
      band.h = Math.min(band.h, c.height - band.y)
    }
    return { w: c.width, h: c.height, pages: doc.numPages, band }
  },
  { workerSrc, b64, leaf, scale, find, context }
)
if (size.missing) {
  console.error(`leaf ${leaf}: the scan's text layer does not hold "${find}" — nothing rendered`)
  await browser.close()
  process.exit(1)
}
// `locator.screenshot()` takes no clip — it silently returns the whole element,
// which on the first band cut looked exactly like a working crop of the wrong
// size. `page.screenshot` is the one that clips, and the canvas sits at 0,0 in
// a body with no margin, so page coordinates are canvas coordinates.
if (size.band) {
  // The clip is taken against the VIEWPORT, not the canvas, so a band low on a
  // leaf lands outside the default 1280x720 and Playwright refuses it. Three of
  // six bands cut cleanly before this turned up, which is the shape of bug that
  // gets called flaky rather than found.
  await page.setViewportSize({ width: size.w, height: size.band.y + size.band.h })
  await page.screenshot({
    path: out,
    clip: { x: 0, y: size.band.y, width: size.w, height: size.band.h }
  })
} else await page.locator('#c').screenshot({ path: out })
await browser.close()
console.log(
  size.band
    ? `leaf ${leaf} of ${size.pages} -> ${out} (${size.w} x ${size.band.h}, band at y ${size.band.y})\n  on: ${size.band.line.trim()}`
    : `leaf ${leaf} of ${size.pages} -> ${out} (${size.w} x ${size.h})`
)
