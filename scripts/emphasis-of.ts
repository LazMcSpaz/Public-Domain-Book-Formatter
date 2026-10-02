/**
 * Italic a witness saw and the book sets in roman, read straight out of
 * `book.json` with no browser, and the batch that puts it back.
 *
 *   npx vite-node --config vitest.config.ts scripts/emphasis-of.ts <book.json> <witness.json> <out.json> [--restore] [--no-headings]
 *
 * Without `--restore`, `out.json` is the findings `checkEmphasis` returns.
 * With it, `out.json` is the batch `drive.mjs correct --batch` lands: each
 * block or note that gains italic, its whole text rewritten with the new
 * `<i>` merged into what it already carries. The plain text of every entry is
 * checked identical to the block's before it is written, so the batch can
 * add tags and nothing else. The witness is whatever saw the type: for a
 * ClearScan PDF, `scripts/italic-witness.mjs`; for a photographed scan,
 * `scripts/slant-witness.ts`. `--no-headings` leaves headings to the design.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { assembleBook } from '@core/assemble'
import { applyEdits } from '@core/edits'
import { checkEmphasis } from '@core/coherence'
import { withMarkup } from '@core/transcribe/markup'

const args = process.argv.filter((a) => a !== '--restore' && a !== '--no-headings')
const restore = process.argv.includes('--restore')
const noHeadings = process.argv.includes('--no-headings')
const [bookPath, witnessPath, out] = args.slice(-3)
if (!bookPath?.endsWith('.json') || !witnessPath || !out) {
  throw new Error(
    'emphasis-of.ts <book.json> <witness.json> <out.json> [--restore] [--no-headings]'
  )
}
const book = JSON.parse(readFileSync(bookPath, 'utf8'))
const doc = applyEdits(assembleBook(book.run.transcriptions), book.run.edits ?? [])
const report = checkEmphasis(doc, JSON.parse(readFileSync(witnessPath, 'utf8')))
const { agreed, unplaced, ambiguous } = report
// `--no-headings` leaves a heading's italic to the design, which is where
// `headingStyle` decides it: a book that sets every section head in an
// italic display face has that in its design, not in its words.
const headings = new Set(doc.blocks.filter((b) => b.kind === 'heading').map((b) => b.id))
const dropped = noHeadings ? report.dropped.filter((f) => !headings.has(f.blockId)) : report.dropped
console.log({
  dropped: dropped.length,
  ...(noHeadings ? { inHeadingsLeft: report.dropped.length - dropped.length } : {}),
  agreed,
  unplaced,
  ambiguous
})
if (!restore) {
  writeFileSync(out, JSON.stringify(dropped, null, 1))
  process.exit(0)
}

/** A unit's marked text rebuilt with `add` set in italic as well. */
function rebuild(marked: string, add: [number, number][]): string {
  let plain = ''
  const style: { i: boolean; b: boolean }[] = []
  let i = 0
  let b = 0
  for (const piece of marked.split(/(<\/?(?:i|b|em|strong)>)/u)) {
    if (piece === '<i>' || piece === '<em>') i++
    else if (piece === '</i>' || piece === '</em>') i = Math.max(0, i - 1)
    else if (piece === '<b>' || piece === '<strong>') b++
    else if (piece === '</b>' || piece === '</strong>') b = Math.max(0, b - 1)
    else {
      for (let k = 0; k < piece.length; k++) {
        plain += piece[k]
        style.push({ i: i > 0, b: b > 0 })
      }
    }
  }
  for (const [s, e] of add) for (let k = s; k < e; k++) style[k]!.i = true
  let text = ''
  let cur = { i: false, b: false }
  for (let k = 0; k <= plain.length; k++) {
    const next = k < plain.length ? style[k]! : { i: false, b: false }
    if (next.i !== cur.i || next.b !== cur.b) {
      if (cur.i) text += '</i>'
      if (cur.b) text += '</b>'
      if (next.b) text += '<b>'
      if (next.i) text += '<i>'
      cur = next
    }
    if (k < plain.length) text += plain[k]
  }
  return text
}

const marked = new Map<string, string>()
for (const b of doc.blocks) marked.set(b.id, withMarkup(b.text, b.emphasis, b.strong))
for (const n of doc.footnotes) marked.set(n.id, withMarkup(n.text, n.emphasis, n.strong))
const ranges = new Map<string, [number, number][]>()
for (const f of dropped) {
  const list = ranges.get(f.blockId) ?? []
  list.push([f.start, f.end])
  ranges.set(f.blockId, list)
}
const bare = (t: string) => t.replace(/<[^>]+>/gu, '')
const entries: { id: string; text: string }[] = []
for (const [id, add] of ranges) {
  const before = marked.get(id)
  if (before === undefined) continue
  const text = rebuild(before, add)
  if (bare(text) !== bare(before)) throw new Error(`${id}: the text changed, not only its tags`)
  entries.push({ id, text })
}
writeFileSync(out, JSON.stringify(entries))
console.log(`${entries.length} blocks and notes to retag → ${out}`)
