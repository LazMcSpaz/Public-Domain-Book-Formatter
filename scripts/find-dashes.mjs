#!/usr/bin/env node
/**
 * Find the horizontal rules a scan's text layer threw away — em dashes.
 *
 * Written for *Unseen Forces*, where the digitiser's OCR encodes not one em
 * dash in the whole book: the layer renders `Cherubim—the` as `Cherubim the`
 * and `Man-bull—all` as `Man-bull-all`, so a reading drafted from that layer
 * loses every one of them, sometimes changing the sense. Nothing in the text
 * can find them, because in the layer they are a space or a hyphen and both are
 * legitimate characters. Only the pixels know.
 *
 *   node scripts/find-dashes.mjs <scan.pdf> <leaf> [leaf...] [--scale 4] [--min 0.55]
 *
 * A dash is a run of ink much wider than any stroke in the face, sitting at
 * mid-height with paper above and below it. `--min` is that width as a fraction
 * of the **font size**, which makes the test independent of the render scale
 * and of the book.
 *
 * The separation is wide and was measured rather than assumed. On this book's
 * text face, at leaf 10: hyphens run 0.56 em, the widest letter stroke (an `f`
 * crossbar, an `e` bar, an `m` serif) 0.75 em, and em dashes 0.99 and 1.21 em.
 * A default of 0.85 sits in empty space between the two groups.
 *
 * The paper-above-and-below test is what separates a dash from an underline or
 * a letter's own crossbar, and it probes a fifth of an em away rather than a
 * fixed three pixels — at three it lands inside a thick dash's own ink and
 * throws the dash away, which is how the first run found one of leaf 10's two
 * and reported the leaf as nearly clean.
 *
 * It reports each find with the layer's text for that line, which is what lets
 * a dash be put back in the right place in a transcription.
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const argv = process.argv.slice(2)
const opt = (n, d) => {
  const at = argv.indexOf(n)
  if (at < 0) return d
  const v = argv[at + 1]
  argv.splice(at, 2)
  return v
}
const scale = Number(opt('--scale', '4'))
const minEm = Number(opt('--min', '0.85'))
const loose = argv.includes('--loose') && argv.splice(argv.indexOf('--loose'), 1)
const [scan, ...leaves] = argv
if (!scan || !leaves.length) {
  console.error('usage: node scripts/find-dashes.mjs <scan.pdf> <leaf> [leaf...]')
  process.exit(2)
}

const require = createRequire(import.meta.url)
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
await page.setContent('<!doctype html><body style="margin:0"><canvas id=c></canvas></body>')
await page.addScriptTag({ content: pdfSrc, type: 'module' })
await page.waitForFunction(() => !!window.pdfjsLib)

const found = await page.evaluate(
  async ({ workerSrc, b64, leaves, scale, minEm, loose }) => {
    const pdfjs = window.pdfjsLib
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
      new Blob([workerSrc], { type: 'text/javascript' })
    )
    const doc = await pdfjs.getDocument({
      data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
      useSystemFonts: false
    }).promise
    const out = []
    for (const leaf of leaves) {
      if (leaf < 0 || leaf >= doc.numPages) continue
      const pg = await doc.getPage(leaf + 1)
      const viewport = pg.getViewport({ scale })
      const c = document.getElementById('c')
      c.width = Math.ceil(viewport.width)
      c.height = Math.ceil(viewport.height)
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, c.width, c.height)
      await pg.render({ canvasContext: ctx, viewport }).promise
      const px = ctx.getImageData(0, 0, c.width, c.height).data
      const W = c.width
      const dark = (x, y) => px[(y * W + x) * 4] < 128

      // The layer's lines, to name the place and to give the x-height.
      const items = (await pg.getTextContent()).items.filter((i) => 'str' in i)
      const pageH = pg.getViewport({ scale: 1 }).height
      const lines = []
      let cur = null
      for (const it of items) {
        const y = it.transform[5]
        if (!cur || Math.abs(y - cur.y) > 2) {
          // The layer reports height 0 for every item in this scan, which made
          // the first version's threshold 0 and matched every pixel on the
          // page. The font size is in the transform's horizontal scale and is
          // always there, so that is what the ratio is taken against.
          cur = { y, size: Math.abs(it.transform[0]) || 10, text: '' }
          lines.push(cur)
        }
        cur.text += it.str
      }
      for (const l of lines) {
        // The em is the font size; the test is a ratio, so it holds at any
        // render scale and on any book. The floor stops a degenerate size from
        // matching the whole page, which is how this failed first time.
        const em = l.size * scale
        const min = Math.max(8, Math.round(em * minEm))
        const top = Math.round((pageH - l.y - l.size) * scale)
        const bot = Math.round((pageH - l.y) * scale)
        if (top < 1 || bot >= c.height - 1) continue
        const hits = []
        for (let y = top; y <= bot; y++) {
          let run = 0
          for (let x = 1; x < W; x++) {
            if (dark(x, y)) run++
            else {
              if (run >= min) {
                const x0 = x - run
                // paper above and below over the same span: a dash floats,
                // where a letter stroke joins something and an underline sits
                // under ink.
                const probe = Math.max(4, Math.round(em * 0.2))
                let clear = true
                for (let k = x0; k < x && clear; k++)
                  if (dark(k, y - probe) || dark(k, y + probe)) clear = false
                if (clear || loose) hits.push({ x0, w: run, y, ratio: +(run / em).toFixed(2) })
              }
              run = 0
            }
          }
        }
        // one dash can ink several rows; keep one per cluster
        const kept = []
        for (const h of hits.sort((a, b) => a.x0 - b.x0))
          if (!kept.some((k) => Math.abs(k.x0 - h.x0) < 8)) kept.push(h)
        for (const k of kept) out.push({ leaf, ...k, line: l.text.trim() })
      }
    }
    return out
  },
  { workerSrc, b64, leaves: leaves.map(Number), scale, minEm, loose: !!loose }
)
await browser.close()
for (const f of found)
  console.log(`leaf ${f.leaf}  x${f.x0} y${f.y}  ${f.w}px (${f.ratio} em)  ${f.line}`)
console.log(`-- ${found.length} rule(s) in ${leaves.length} leaf/leaves`)
