#!/usr/bin/env node
/**
 * A visual reading, checked against the scan's own embedded text layer.
 *
 * The safeguard in `PROCESS-reading.md` is that a leaf is *corrected* rather
 * than authored: OCR supplies a text, the render supplies the pixels, and the
 * job is finding where they differ. A reader that never writes unprompted
 * cannot invent a paragraph.
 *
 * On a badly-scanned typescript that breaks down. Tesseract read the opening
 * line of Manly Hall's manuscript 24 as "‘hen we 5 Ferbir the Prine 2, upon
 * whan $6e500d ek", and a draft bearing no relation to the page is nothing to
 * be wrong against. Where the editor rules that a leaf must be read visually
 * instead, the checking has to move somewhere else — and it must not move to
 * the reader's own opinion of their work, which SPEC §4 forbids and which is
 * worth nothing anyway.
 *
 * It moves here. These scans arrive with an OCR text layer from whoever
 * digitised them, and it is routinely far better than Tesseract's because it
 * was made from the original rather than from a re-render. It is damaged, but
 * it is damaged in ways a human reader is not: it runs words together and
 * mangles letters, where a reader skips lines and normalises spelling. Two
 * witnesses with different failure modes is the whole point.
 *
 *   node scripts/verify-against-layer.mjs <scan.pdf> <batch.json>
 *
 * What it reports, per leaf:
 *
 *   - how much of the reading appears **verbatim** in the layer. Low is not a
 *     failure — the layer is damaged, and 58-79% was normal on manuscript 24.
 *   - every word the layer holds that the reading does not. This is the list
 *     that matters, and it is meant to be *read*, not counted: each entry is
 *     either the layer's own damage (`thedivine`, `saltyasinh`, `sircle`) or a
 *     word the reader missed, and only a person can tell which.
 *
 * It therefore exits 0 whatever it finds. There is no threshold here that
 * could mean anything, and a check that fails on a number nobody can justify
 * gets switched off.
 */
import { readFileSync } from 'node:fs'

const [scan, batchPath] = process.argv.slice(2)
if (!scan || !batchPath) {
  console.error('usage: node scripts/verify-against-layer.mjs <scan.pdf> <batch.json>')
  process.exit(2)
}

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

/** Words worth comparing: short ones are noise in a damaged layer. */
const words = (s) => s.toLowerCase().match(/[a-z']{5,}/gu) ?? []

const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(scan)),
  useSystemFonts: false
}).promise
const batch = JSON.parse(readFileSync(batchPath, 'utf8'))

for (const leaf of batch) {
  const page = leaf.pageIndex + 1
  if (page > doc.numPages) {
    console.log(`leaf ${leaf.pageIndex}: no such page in the scan`)
    continue
  }
  const layerText = (await (await doc.getPage(page)).getTextContent()).items
    .map((i) => ('str' in i ? i.str : ''))
    .join('')
  const layer = new Set(words(layerText))
  const mine = new Set(words(leaf.blocks.map((b) => b.text).join(' ')))

  if (mine.size === 0 && layer.size === 0) {
    console.log(`leaf ${leaf.pageIndex}: blank on both sides`)
    continue
  }
  if (layer.size === 0) {
    console.log(`leaf ${leaf.pageIndex}: NOT CHECKED — the scan has no text layer for this page`)
    continue
  }

  let seen = 0
  for (const w of mine) if (layer.has(w)) seen++
  const absent = [...layer].filter((w) => !mine.has(w))

  const pct = mine.size === 0 ? 0 : Math.round((100 * seen) / mine.size)
  console.log(
    `leaf ${leaf.pageIndex}: ${pct}% of the reading is in the layer verbatim ` +
      `(${mine.size} words read, ${layer.size} in the layer)`
  )
  console.log(`  in the layer and not in the reading (${absent.length}), for a person to read:`)
  console.log(`  ${absent.join(' ') || '(none)'}`)
}
