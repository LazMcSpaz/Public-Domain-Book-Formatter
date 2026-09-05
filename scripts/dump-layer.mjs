#!/usr/bin/env node
/**
 * The scan's own embedded text layer, one leaf at a time, laid out in lines.
 *
 * `verify-against-layer.mjs` *scores* a finished reading against this layer and
 * is deliberately unreadable as prose — it emits a set of words. That is the
 * right shape for checking work already done. It is the wrong shape for the
 * other job the layer can do, which turned out to matter more on at least one
 * document here: being the **draft**.
 *
 * The distinction is the one `PROCESS-reading.md` draws. Reading a leaf is
 * `draft` -> look -> correct -> `transcribe`, and `drive.mjs draft` builds that
 * draft from Tesseract's reading of a re-render. On a typescript that is the
 * only option and it is usually poor. On a **printed** source it is the wrong
 * witness entirely: the digitiser's own OCR was made from the original rather
 * than from a re-render, and on Manly Hall's Revelation pamphlet it measured
 * 34% function words and 6.8 spaces per line against a typescript's half that.
 * Read against the render, it corrected in minutes what would have taken a
 * visual pass hours, and the finished reading scored 81-98% verbatim back
 * against it.
 *
 *   node scripts/dump-layer.mjs <scan.pdf> <leaf> [leaf...]
 *
 * Leaves are 0-based, matching every other verb here.
 *
 * **This is a draft and not a reading.** Its damage is mechanical — `,vhose`
 * for whose, `Spi1·its` for Spirits, `ltad` for had, words run together where a
 * space fell between two text runs — and the point of that is that none of
 * those five classes can produce a *word*. A reader correcting them cannot
 * accidentally invent a plausible sentence, only an implausible one that the
 * render then refuses. Correct it against the pixels; never land it as it
 * stands.
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
// --geom prefixes each line with its left edge and width, in points. On a
// TYPESET source the layer is clean but the paragraphing is not in it: pdf.js
// hands back lines, and a book's paragraph breaks live in the indent of a first
// line and the short measure of a last one. Without those two numbers a reader
// has to guess where paragraphs begin, which is exactly the kind of guess this
// project does not make. Costs nothing on a typescript, where it is ignored.
const geom = args.includes('--geom')
const [scan, ...leaves] = args.filter((a) => a !== '--geom')
if (!scan || leaves.length === 0) {
  console.error('usage: node scripts/dump-layer.mjs [--geom] <scan.pdf> <leaf> [leaf...]')
  process.exit(2)
}

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
// pdf.js writes its font warnings to STDOUT, so on a scan whose embedded fonts
// it cannot resolve they land in the middle of the dumped text. That is not
// cosmetic: this file is used as a draft and as one side of a collation, and
// "Ensure that the standardFontDataUrl API parameter is provided" reads as
// thirty words of the document. `verbosity: 0` is ERRORS only, which is the
// fix at source; overriding console.warn is not, because the warnings are
// raised during getPage as well as during load.
const doc = await pdfjs.getDocument({
  verbosity: 0,
  data: new Uint8Array(readFileSync(scan)),
  useSystemFonts: false
}).promise

for (const leaf of leaves.map(Number)) {
  if (!Number.isInteger(leaf) || leaf < 0 || leaf >= doc.numPages) {
    console.log(`===== leaf ${leaf}: no such page in the scan =====`)
    continue
  }
  const items = (await (await doc.getPage(leaf + 1)).getTextContent()).items.filter(
    (i) => 'str' in i
  )
  // Group into lines on the baseline, and put a space between two runs only
  // where the gap says there was one. pdf.js hands back runs with no space
  // between them, so concatenating produces `inthis` and `damnableadvice`.
  const lines = []
  let cur = null
  for (const it of items) {
    const x = it.transform[4]
    const y = it.transform[5]
    if (!cur || Math.abs(y - cur.y) > 2) {
      cur = { y, x0: x, parts: [], end: null }
      lines.push(cur)
    }
    if (cur.end !== null && x - cur.end > 0.8) cur.parts.push(' ')
    cur.parts.push(it.str)
    cur.end = x + (it.width ?? 0)
  }
  console.log(`===== leaf ${leaf} =====`)
  if (lines.length === 0) console.log('(the scan has no text layer for this page)')
  for (const l of lines) {
    const t = l.parts.join('').replace(/\s+/g, ' ').trim()
    if (!t) continue
    if (geom)
      console.log(`${l.x0.toFixed(0).padStart(4)} ${(l.end - l.x0).toFixed(0).padStart(4)}  ${t}`)
    else console.log(t)
  }
}
