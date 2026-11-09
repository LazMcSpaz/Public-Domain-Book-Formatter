/**
 * Paragraphs a shelf book breaks at a page turn where the paper runs on.
 *
 *   npx vite-node --config vitest.config.ts scripts/page-turns-of.ts <book.json> [--recon <recon.json.gz>] [--out <file.json>] [--check]
 *
 * The text half needs only the book file. The paper half reads the first line
 * of every leaf off the OCR boxes in the book's own recon reading, which sits
 * beside it as `recon.json.gz` on every scanned book of the shelf; name another
 * with `--recon`, or leave it to the text alone when there is none. See
 * `checkPageTurns` (`@core/coherence/page-turns`) for what each signal means.
 *
 * A finding is a place to look, and the leaf decides: crop the turn before
 * joining anything. Measured on _The Mahatma Letters_, a finding the paper
 * alone makes was right 20 times in 22. `--check` exits non-zero on any
 * finding the paper did not contradict.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { assembleBook } from '@core/assemble'
import { applyEdits } from '@core/edits'
import { checkPageTurns } from '@core/coherence'
import type { DraftWord } from '@core/draft'

const args = process.argv.slice(2).filter((a) => !a.includes('page-turns-of'))
const flag = (name: string): string | null => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? null : (args[i + 1] ?? null)
}
const bookPath = args.find((a) => a.endsWith('.json') && !a.startsWith('--'))
if (!bookPath) {
  console.error(
    'page-turns-of.ts <book.json> [--recon <recon.json.gz>] [--out <file.json>] [--check]'
  )
  process.exit(2)
}

const file = JSON.parse(readFileSync(bookPath, 'utf8'))
const doc = applyEdits(assembleBook(file.run.transcriptions), file.run.edits ?? [])

const reconPath = flag('recon') ?? join(dirname(bookPath), 'recon.json.gz')
const byLeaf = new Map<number, DraftWord[]>()
if (existsSync(reconPath)) {
  const raw = readFileSync(reconPath)
  const recon = JSON.parse((reconPath.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8'))
  for (const w of recon.words ?? []) {
    const list = byLeaf.get(w.pageIndex) ?? []
    list.push({ text: w.text, confidence: w.confidence, bbox: w.bbox })
    byLeaf.set(w.pageIndex, list)
  }
}
const paper = byLeaf.size > 0

const findings = checkPageTurns(doc.blocks, paper ? (leaf) => byLeaf.get(leaf) : undefined)
const splits = findings
// What `--check` holds a book to: the text and the paper agreeing, or the text
// alone where the paper could not say. A text signal the paper contradicts
// (an indented first line under a sentence that stops) is listed, not failed.
const owed = splits.filter((f) => f.paper !== 'indented')

const line = (f: (typeof findings)[number]): string =>
  `  ${f.kind.padEnd(6)} ${f.before} → ${f.after}  leaf ${f.leaf}  [${f.signals.join(', ')}; paper ${f.paper}]\n         ${f.context}`

console.log(
  `${bookPath}\n  ${splits.length} split; ${owed.length} owed` +
    (paper ? `; paper read from ${byLeaf.size} leaves` : '; no recon reading, text only')
)
for (const f of findings) console.log(line(f))

const out = flag('out')
if (out) writeFileSync(out, JSON.stringify({ book: bookPath, paper, findings }, null, 2))
if (args.includes('--check') && owed.length > 0) process.exit(1)
