/**
 * Lines the paper prints that a shelf book lacks, or sets in another place:
 * `checkCoverage` (`@core/witness/coverage.ts`) against a second reading of
 * the same leaves, with no browser.
 *
 *   npx vite-node --config vitest.config.ts scripts/coverage-of.ts <book.json> [--second <second.json>] [--out <file.json>]
 *
 * The second reading is the scan's own OCR layer by default, read line by
 * line with mupdf — the scan `book.json` names in `scan.path`, never the PDF
 * beside it, which is the export. A book whose scan has no layer takes
 * `--second`, the `{ leaf: text }` file `drive.mjs second` writes; _The
 * Structure of Magic_ Vol. II has one on the shelf. A book read from an EPUB
 * has no leaves in common with any scan and is refused rather than compared
 * page against unrelated page.
 *
 * mupdf renders nothing here: it is used as `italic-witness.mjs` uses it, to
 * read a text layer once, outside the app.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as mupdf from 'mupdf'
import { assembleBook } from '@core/assemble'
import { applyEdits } from '@core/edits'
import { checkCoverage, type LayerLeaf } from '@core/witness'

const args = process.argv.slice(2).filter((a) => !a.includes('coverage-of'))
const flag = (name: string): string | null => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? null : (args[at + 1] ?? null)
}
const bookPath = args.find((a) => a.endsWith('book.json'))
if (!bookPath) throw new Error('coverage-of.ts <book.json> [--second <second.json>] [--out <file>]')
const book = JSON.parse(readFileSync(bookPath, 'utf8'))
const doc = applyEdits(assembleBook(book.run.transcriptions), book.run.edits ?? [])

let layer: LayerLeaf[]
const secondPath = flag('second')
if (secondPath) {
  const second = JSON.parse(readFileSync(secondPath, 'utf8')) as Record<string, string>
  layer = Object.entries(second).map(([page, text]) => ({
    page: Number(page),
    lines: text.split('\n')
  }))
} else {
  const scan: string | undefined = book.scan?.path
  if (!scan || !scan.endsWith('.pdf')) {
    throw new Error(
      'This book names no PDF scan, so it has no layer to compare. Give a second reading with --second.'
    )
  }
  const shelf = resolve(dirname(bookPath), '..', '..')
  const pdf = mupdf.Document.openDocument(readFileSync(resolve(shelf, scan)), 'application/pdf')
  layer = []
  for (let page = 0; page < pdf.countPages(); page++) {
    try {
      const p = pdf.loadPage(page)
      const text = JSON.parse(p.toStructuredText('preserve-whitespace').asJSON())
      p.destroy()
      const lines = text.blocks.flatMap((b: { lines?: { text: string }[] }) =>
        (b.lines ?? []).map((l) => l.text)
      )
      layer.push({ page, lines })
    } catch {
      // A leaf mupdf cannot read is a leaf with no second reading, not an error.
    }
  }
}

const found = checkCoverage(doc, layer)
const missing = found.filter((f) => f.kind === 'missing')
const moved = found.filter((f) => f.kind === 'moved')
console.log(
  `${layer.length} leaves compared: ${missing.length} runs missing, ${moved.length} lines moved`
)
for (const f of found) {
  console.log(
    `  ${f.kind.padEnd(7)} leaf ${f.page}${f.blockId ? ` (${f.blockId})` : ''}: ${f.lines.join(' / ').slice(0, 160)}`
  )
}
const out = flag('out')
if (out) writeFileSync(out, JSON.stringify(found, null, 1))
