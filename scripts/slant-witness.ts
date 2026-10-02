/**
 * Which words a photographed scan prints in italic, read off the pixels.
 *
 *   npx vite-node --config vitest.config.ts scripts/slant-witness.ts <scan.pdf> <out.json>
 *       [--pages 10-40] [--words words.json] [--book book.json]
 *
 * The witness for a book nothing else can speak for. `italic-witness.mjs`
 * believes a face the file names and measures the glyph outlines of a
 * ClearScan layer; neither helps a scan whose OCR layer is drawn in one
 * invisible face (`GlyphLessFont`, a Courier layer) or that has no layer at
 * all. What is left is the type itself: each word is cut from a 300-DPI
 * render and its strokes measured for lean (`strokeSlant`, `italicWords` in
 * `@core/image/slant`), and a run of italic words is written out in the
 * shape `scripts/emphasis-of.ts` takes — `[{ page, text, before, after, how,
 * bbox }]` — so the comparison with the book, and the batch that restores
 * what the book lost, are the ones already tested.
 *
 * Where the words come from:
 *
 * - **the scan's own text layer**, by default: its characters carry the
 *   boxes the OCR drew, which is all the measure needs;
 * - **`--words`**, for a scan with no layer: `[{ page, words: [{ text, x0,
 *   y0, x1, y1 }] }]`, boxes in pixels of the 300-DPI render — Tesseract's
 *   reading, say.
 *
 * `--book` is for a book read from another file than this scan — an EPUB,
 * whose leaves are chapters and not pages. `checkEmphasis` places a run only
 * on its own leaf, so each scan page is given the book leaf whose blocks
 * share most of its word triples, and a page that matches no leaf is left
 * out rather than guessed at.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import * as mupdf from 'mupdf'
import { assembleBook } from '@core/assemble'
import { applyEdits } from '@core/edits'
import { italicWords, pageRoman, strokeSlant, type GrayImage } from '@core/image'

const DPI = 300
/** The share of a page's height its running head, and its foot, sit in. */
const HEAD_BAND = 0.09
const FOOT_BAND = 0.06
/** Pages a run must recur on in those bands to be taken for furniture. */
const FURNITURE_PAGES = 3
const argv = process.argv.slice(2).filter((a) => !a.includes('slant-witness'))
const flag = (name: string): string | null => {
  const at = argv.indexOf(name)
  return at === -1 ? null : (argv[at + 1] ?? null)
}
const flagged = new Set(
  ['--pages', '--words', '--book'].flatMap((f) => {
    const at = argv.indexOf(f)
    return at === -1 ? [] : [at, at + 1]
  })
)
const [scanPath, outPath] = argv.filter((_, i) => !flagged.has(i))
if (!scanPath || !outPath) {
  throw new Error(
    'slant-witness.ts <scan.pdf> <out.json> [--pages a-b] [--words words.json] [--book book.json]'
  )
}

interface Word {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
}

const doc = mupdf.Document.openDocument(readFileSync(scanPath), 'application/pdf')
const pageCount = doc.countPages()
const range = flag('--pages')
const [first, last] = range ? range.split('-').map(Number) : [0, pageCount - 1]
const given: Map<number, Word[]> | null = flag('--words')
  ? new Map(
      (JSON.parse(readFileSync(flag('--words')!, 'utf8')) as { page: number; words: Word[] }[]).map(
        (p) => [p.page, p.words]
      )
    )
  : null

/** The layer's words, in its order, boxed in pixels of the render. */
function layerWords(page: mupdf.Page): Word[] {
  const scale = DPI / 72
  const words: Word[] = []
  let current: Word | null = null
  page.toStructuredText('preserve-whitespace').walk({
    beginLine() {
      current = null
    },
    onChar(c: string, _origin: unknown, _font: unknown, _size: unknown, quad: number[]) {
      if (/\s/u.test(c)) {
        current = null
        return
      }
      const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!].map((v) => v * scale)
      const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!].map((v) => v * scale)
      const box = {
        x0: Math.min(...xs),
        y0: Math.min(...ys),
        x1: Math.max(...xs),
        y1: Math.max(...ys)
      }
      if (!current) {
        current = { text: '', ...box }
        words.push(current)
      }
      current.text += c
      current.x0 = Math.min(current.x0, box.x0)
      current.y0 = Math.min(current.y0, box.y0)
      current.x1 = Math.max(current.x1, box.x1)
      current.y1 = Math.max(current.y1, box.y1)
    }
  })
  return words
}

/** Letters and digits, lower-cased, for matching a page against the book. */
const tokens = (text: string): string[] =>
  text
    .replace(/<[^>]*>/gu, ' ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/** For `--book`: which leaf of the book each scan page is, by shared word triples. */
const leafOf: ((words: Word[]) => number | null) | null = flag('--book')
  ? (() => {
      const book = JSON.parse(readFileSync(flag('--book')!, 'utf8'))
      const assembled = applyEdits(assembleBook(book.run.transcriptions), book.run.edits ?? [])
      const where = new Map<string, Set<number>>()
      for (const unit of [...assembled.blocks, ...assembled.footnotes]) {
        const leaves = 'sourcePages' in unit ? unit.sourcePages : [unit.pageIndex]
        const t = tokens(unit.text)
        for (let i = 0; i + 3 <= t.length; i++) {
          const key = `${t[i]} ${t[i + 1]} ${t[i + 2]}`
          const set = where.get(key) ?? new Set<number>()
          for (const l of leaves) set.add(l)
          where.set(key, set)
        }
      }
      return (words: Word[]) => {
        const t = tokens(words.map((w) => w.text).join(' '))
        const votes = new Map<number, number>()
        let triples = 0
        for (let i = 0; i + 3 <= t.length; i++) {
          triples++
          const leaves = where.get(`${t[i]} ${t[i + 1]} ${t[i + 2]}`)
          if (!leaves || leaves.size > 2) continue
          for (const l of leaves) votes.set(l, (votes.get(l) ?? 0) + 1)
        }
        const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]
        // A page is that leaf when a fifth of its triples say so: enough to
        // outvote the stray phrase two chapters share, and the floor below
        // which a page is a title, a blank or a picture.
        return best && best[1] >= Math.max(5, triples * 0.2) ? best[0] : null
      }
    })()
  : null

const letters = (text: string): number => (text.match(/\p{L}/gu) ?? []).length
const joined = (words: Word[]): string => words.map((w) => w.text).join(' ')

interface Run {
  page: number
  text: string
  before: string
  after: string
  how: string
  bbox: [number, number, number, number]
}
const runs: Run[] = []
/** Where on its page each run sits, as a share of the page's height, and the scan page. */
const placed: { band: boolean; scanPage: number }[] = []
let pagesRead = 0
let wordsMeasured = 0
let unplacedPages = 0
const unrendered: number[] = []
for (let p = first!; p <= last!; p++) {
  const page = doc.loadPage(p)
  const words = given ? (given.get(p) ?? []) : layerWords(page)
  const leaf = words.length === 0 ? null : leafOf ? leafOf(words) : p
  if (leaf === null) {
    if (words.length > 0) unplacedPages++
    page.destroy()
    continue
  }
  const scale = DPI / 72
  // One page's pixels at a time, freed before the next: the decoder lives in
  // a fixed wasm heap, and a book's worth of undestroyed pixmaps ran it out
  // of room for a JPEG 2000 leaf two hundred pages into _NLP For Dummies_.
  // A leaf that still will not render is skipped and named, never guessed.
  let pixmap: mupdf.Pixmap
  try {
    pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceGray,
      false,
      true
    )
  } catch (e) {
    unrendered.push(p)
    console.error(`page ${p}: ${(e as Error).message}`)
    page.destroy()
    continue
  }
  const width = pixmap.getWidth()
  const height = pixmap.getHeight()
  const samples = pixmap.getPixels()
  const n = pixmap.getNumberOfComponents() + (pixmap.getAlpha() ? 1 : 0)
  const data = new Uint8Array(width * height)
  for (let i = 0; i < data.length; i++) data[i] = samples[i * n]!
  pixmap.destroy()
  page.destroy()
  const image: GrayImage = { data, width, height }
  const slanted = words.map((w) => ({ letters: letters(w.text), slant: strokeSlant(image, w) }))
  wordsMeasured += slanted.filter((s) => s.slant !== null).length
  const italic = italicWords(slanted)
  const roman = pageRoman(slanted)
  pagesRead++
  for (let i = 0; i < words.length; i++) {
    if (!italic[i]) continue
    let k = i
    while (k < words.length && italic[k]) k++
    const run = words.slice(i, k)
    const top = Math.min(...run.map((w) => w.y0)) / height
    const foot = Math.max(...run.map((w) => w.y1)) / height
    placed.push({ band: top < HEAD_BAND || foot > 1 - FOOT_BAND, scanPage: p })
    runs.push({
      page: leaf,
      text: joined(run),
      before: joined(words.slice(Math.max(0, i - 4), i)).slice(-40),
      after: joined(words.slice(k, k + 4)).slice(0, 40),
      how: `slant ${run
        .map((_, j) => slanted[i + j]!.slant)
        .filter((s): s is number => s !== null)
        .map((s) => s.toFixed(0))
        .join(
          ','
        )} on a page whose roman is ${roman?.toFixed(1)}${leafOf ? ` (scan page ${p})` : ''}`,
      bbox: [
        Math.round(Math.min(...run.map((w) => w.x0))),
        Math.round(Math.min(...run.map((w) => w.y0))),
        Math.round(Math.max(...run.map((w) => w.x1))),
        Math.round(Math.max(...run.map((w) => w.y1)))
      ]
    })
    i = k - 1
  }
}
// **Running heads and folios are the book's furniture, and set in italic as
// often as not.** The book does not print them, so the comparison should
// never see them — and an edition-wide comparison sees them everywhere: on
// _The Structure of Magic_ Vol. II the head `Representational Systems`
// spells the body's `representational systems` and was placed there, on a
// dozen leaves. A run is furniture when it sits in the head or foot band of
// its page and the same words sit there on three pages or more.
const letterKey = (t: string): string => t.toLowerCase().replace(/[^\p{L}]+/gu, '')
const bandPages = new Map<string, Set<number>>()
runs.forEach((r, i) => {
  if (!placed[i]!.band) return
  const set = bandPages.get(letterKey(r.text)) ?? new Set<number>()
  set.add(placed[i]!.scanPage)
  bandPages.set(letterKey(r.text), set)
})
const kept = runs.filter(
  (r, i) => !placed[i]!.band || (bandPages.get(letterKey(r.text))?.size ?? 0) < FURNITURE_PAGES
)
writeFileSync(outPath, JSON.stringify(kept, null, 1))
console.log({
  pagesRead,
  wordsMeasured,
  runs: kept.length,
  furnitureLeftOut: runs.length - kept.length,
  ...(leafOf ? { pagesMatchingNoLeaf: unplacedPages } : {}),
  ...(unrendered.length > 0 ? { pagesThatWouldNotRender: unrendered } : {})
})
