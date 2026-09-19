#!/usr/bin/env node
/**
 * The top lines of every page of a PDF, with the size each was set at.
 *
 *   node scripts/page-heads.mjs <pdf> [lines-per-page]   # JSON to stdout
 *
 * For the formatting pass: the one job on a finished book that is neither
 * reading it nor looking at a single leaf, but asking *the same question of
 * every page at once*. Which pages open a chapter, what each title turned out
 * to be broken into, where a running head is missing, which openings carry a
 * superscription. On a 648-page collection that is thirty-two title pages
 * scattered through six hundred, and finding them by rendering leaves is a
 * morning.
 *
 * It answers from the exported PDF's own text layer rather than from the
 * engine, which is the point: the engine's `LaidOutBook` says what it *meant*
 * to set, and a formatting fault is the gap between that and the bytes. Every
 * title break fixed this session was found here first and then confirmed on a
 * render — propose from the layer, accept from the pixels, the same order
 * everything else here works in.
 *
 * Each page comes back as `[{ t, s }]`: the line's text, and the size of its
 * tallest run. The size is what separates a display line from a running head,
 * since the two sit in the same place on the leaf and nothing about their
 * position tells them apart.
 *
 * `render-leaf.mjs` is the other half and takes over once a page looks wrong:
 * `--band` crops the head of a leaf, which is where these faults live.
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('/home/user/Public-Domain-Book-Formatter/package.json')
const [pdfPath, nLines = '6'] = process.argv.slice(2)
const pdfSrc =
  readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'), 'utf8') +
  '\nwindow.pdfjsLib = { getDocument, GlobalWorkerOptions };'
const workerSrc = readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox']
})
const page = await browser.newPage()
await page.setContent('<!doctype html><body></body>')
await page.addScriptTag({ content: pdfSrc, type: 'module' })
await page.waitForFunction(() => !!window.pdfjsLib)
const b64 = readFileSync(pdfPath).toString('base64')
const out = await page.evaluate(
  async ({ workerSrc, b64, n }) => {
    const pdfjs = window.pdfjsLib
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
      new Blob([workerSrc], { type: 'text/javascript' })
    )
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: false }).promise
    const pages = []
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i)
      const items = (await pg.getTextContent()).items.filter((it) => 'str' in it)
      const lines = []
      let cur = null
      for (const it of items) {
        const y = it.transform[5]
        if (!cur || Math.abs(y - cur.y) > 2) {
          cur = { y, size: 0, text: '' }
          lines.push(cur)
        }
        cur.text += it.str
        cur.size = Math.max(cur.size, Math.abs(it.transform[3] || 0))
      }
      lines.sort((a, b) => b.y - a.y)
      pages.push(
        lines.slice(0, n).map((l) => ({ t: l.text.trim(), s: Math.round(l.size * 10) / 10 }))
      )
    }
    return pages
  },
  { workerSrc, b64, n: Number(nLines) }
)
await browser.close()
console.log(JSON.stringify(out))
