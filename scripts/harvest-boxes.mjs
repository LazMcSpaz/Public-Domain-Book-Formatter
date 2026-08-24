#!/usr/bin/env node
/**
 * Harvest real OCR word boxes off a real scan, into a test fixture.
 *
 * Every geometric bug the draft module has had appeared only when a real page
 * went through it, and none were caught by tests built from hand-written
 * boxes. That is not bad luck: the faults live in the *shape of real OCR
 * output* — a mis-segmented box 76 pixels tall, a drop capital read as a
 * stray `=`, two consecutive lines whose boxes touch — and nobody writing a
 * fixture by hand invents those, because nobody knows they are there.
 *
 * So the fixture is not written. It is measured, once, and committed.
 *
 * ## What makes this testable without labelling every leaf by hand
 *
 * **Tesseract emits words in reading order.** That is a ground truth nobody
 * has to produce: whatever else the draft does, the words it lays out must
 * come back in the sequence OCR read them, because both are reading the same
 * single-column page. A word that moves has been scrambled. So the word array
 * here is stored in **OCR emission order**, never sorted, and
 * `test/draft-real.test.ts` asserts the draft preserves it.
 *
 * Hand-checked expectations — how many paragraphs a leaf really has, what its
 * running head really says — are added beside the fixture as they are verified
 * against a render. Those cost a person's time, so they are spent on the
 * leaves where the automatic oracle cannot help.
 *
 * ## Usage
 *
 *   node scripts/harvest-boxes.mjs <scan.pdf> <fixture-name> <leaf> [leaf...]
 *
 * Needs the vite dev server up (it imports the app's own OCR through it, so
 * the boxes are the ones the app would get, not an approximation).
 */
import { chromium } from 'playwright'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile, copyFile, unlink, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const ORIGIN = process.env.HARVEST_ORIGIN ?? 'http://localhost:5173'
const OUT = resolve(REPO, 'test/fixtures/boxes')

const [scanArg, name, ...leafArgs] = process.argv.slice(2)
if (!scanArg || !name || leafArgs.length === 0) {
  console.error('harvest-boxes <scan.pdf> <fixture-name> <leaf> [leaf...]')
  process.exit(1)
}
const leaves = leafArgs.map(Number)
if (leaves.some((n) => !Number.isInteger(n) || n < 0)) {
  console.error('Leaves are whole numbers, counted from 0.')
  process.exit(1)
}

const scan = resolve(REPO, scanArg)
const bytes = await readFile(scan)
// The scan's digest travels with the fixture. Without it nobody can tell,
// years from now, which book a set of boxes came off — and a fixture whose
// provenance is unknown is a fixture nobody dares change.
const sha = createHash('sha256').update(bytes).digest('hex')

// Served rather than passed through `evaluate`: a 19 MB scan is 26 MB of
// base64 and the fixture script is not worth that. `public/*.pdf` is
// gitignored, and this is removed in the `finally`.
const served = resolve(REPO, 'public/_harvest.pdf')
await copyFile(scan, served)

const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('  page:', m.text())
  })
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' })

  const harvested = await page.evaluate(
    async ([repo, list]) => {
      const pdf = await import(`/@fs${repo}/src/platform/browser/pdf.ts`)
      const ocrMod = await import(`/@fs${repo}/src/platform/browser/ocr.ts`)
      const recon = await import(`/@fs${repo}/src/platform/browser/recon.ts`)

      const response = await fetch('/_harvest.pdf')
      const file = new File([await response.blob()], '_harvest.pdf', { type: 'application/pdf' })

      const doc = await pdf.openPdf(file)
      const engine = new ocrMod.OcrEngine()
      const out = []
      try {
        for (const pageIndex of list) {
          const rendered = await pdf.renderPage(doc, pageIndex, recon.RECON_DPI)
          const result = await engine.recognize(rendered.canvas, pageIndex)
          out.push({
            pageIndex,
            width: rendered.canvas.width,
            height: rendered.canvas.height,
            meanConfidence: Math.round(result.meanConfidence),
            // NOT sorted. This is Tesseract's own emission order, which is the
            // reading order, which is the oracle.
            words: result.words.map((w) => [
              w.text,
              Math.round(w.confidence),
              Math.round(w.bbox.x0),
              Math.round(w.bbox.y0),
              Math.round(w.bbox.x1),
              Math.round(w.bbox.y1)
            ])
          })
          rendered.canvas.width = 0
          rendered.canvas.height = 0
        }
      } finally {
        await engine.dispose()
        await doc.destroy?.()
      }
      return { dpi: recon.RECON_DPI, leaves: out }
    },
    [REPO, leaves]
  )

  await mkdir(OUT, { recursive: true })
  const fixture = {
    // Everything a reader needs to know what they are looking at, and enough
    // to re-harvest it if the OCR engine or the DPI ever changes.
    scan: scanArg.split('/').pop(),
    sha256: sha,
    dpi: harvested.dpi,
    harvestedWith: 'scripts/harvest-boxes.mjs',
    note: 'Words are in Tesseract emission order — the reading order. Never sort this array.',
    leaves: harvested.leaves
  }
  const path = resolve(OUT, `${name}.json`)
  await writeFile(path, JSON.stringify(fixture, null, 1) + '\n', 'utf8')
  console.log(
    JSON.stringify(
      {
        wrote: `test/fixtures/boxes/${name}.json`,
        leaves: harvested.leaves.map((l) => ({
          pageIndex: l.pageIndex,
          words: l.words.length,
          meanConfidence: l.meanConfidence
        }))
      },
      null,
      2
    )
  )
} finally {
  await browser.close()
  await unlink(served).catch(() => {})
}
