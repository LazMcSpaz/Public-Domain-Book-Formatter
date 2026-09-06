/**
 * Put a glossary into a book file, and put its circles on the words.
 *
 * Two jobs that have to happen together, and the second is the one that gets
 * skipped: one volume on this shelf shipped a 74-entry glossary and not a
 * single mark on a word in the body, with the book file, the export report and
 * every KDP check perfectly happy about it. So this does both, from one
 * command, and neither can be done without the other.
 *
 *   npx vite-node scripts/apply-glossary.ts <book.json> <glossary.md>
 *
 * ## Why this is TypeScript run by vite-node
 *
 * Because the rules it needs are in `@core/annotate` and there must be exactly
 * one of each. `glossaryHeadwords` decides what an entry is, `checkGlossaryMarks`
 * decides whether a word carries its circle, and `withGlossaryMark` decides
 * where the circle goes inside a run of markup. The galley uses those three,
 * `book-files.mjs` checks the shelf with the first, and a second copy of any of
 * them in a build script would drift and then disagree with the app about what
 * the book holds.
 *
 * ## What it writes
 *
 * A `section` edit carrying the glossary as back matter, and one `text` edit per
 * block that gains a circle. Both are ordinary edits: undoable in the galley,
 * swept like anything else, and applied by the same `applyEdits` the app runs.
 *
 * Marks are accumulated **per block** before any edit is written. Two entries
 * whose first use falls in the same paragraph is not a rare case in a book of
 * this size, and writing an edit each would have the second overwrite the first
 * and quietly take its circle away again.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { assembleBook } from '@core/assemble'
import { applyEdits, type BookEdit } from '@core/edits'
import { checkGlossaryMarks, glossaryHeadwords, withGlossaryMark } from '@core/annotate'
import { withMarkup } from '@core/transcribe'

const [bookPath, glossaryPath] = process.argv.slice(2)
if (!bookPath || !glossaryPath) {
  console.error('usage: vite-node scripts/apply-glossary.ts <book.json> <glossary.md>')
  process.exit(2)
}

const book = JSON.parse(readFileSync(bookPath, 'utf8'))
const raw = readFileSync(glossaryPath, 'utf8')

/**
 * The readable file carries a title and a preamble a person wrote; the section
 * carries the preamble and the entries. The title is the section's own, and the
 * `#` line is how a Markdown file says it rather than something to set twice.
 */
const lines = raw.split('\n')
const titleLine = lines.findIndex((l) => /^#\s/.test(l))
const body = lines
  .slice(titleLine + 1)
  .join('\n')
  .replace(/^\s*\*[^\n]*\*\s*$/m, '') // the italic count line, which is derived
  .replace(/^\s*---\s*$/m, '')
  .trim()

const title = titleLine >= 0 ? lines[titleLine]!.replace(/^#\s*/, '').trim() : 'Glossary'
const heads = glossaryHeadwords(body)
if (heads.length === 0) {
  console.error(`${glossaryPath}: no entries found. An entry is a line opening <b>Headword.</b>`)
  process.exit(1)
}

const edits: BookEdit[] = (book.run.edits ?? []).filter(
  (e: BookEdit) => !(e.kind === 'section' && e.sectionId === 'glossary')
)
edits.push({ kind: 'section', sectionId: 'glossary', placement: 'back', title, text: body })

// The book as the reader will hold it, with the glossary already in, because a
// mark belongs on a word in the body and never on one inside the glossary.
const doc = applyEdits(assembleBook(book.run.transcriptions), edits)

/**
 * Which occurrence gets the circle.
 *
 * `checkGlossaryMarks` reports the first use it finds, and on these books the
 * first use is often a run-in heading the reading recorded as a short
 * paragraph: `The Undines`, `The Gnomes`, `Part Two`. A footnote-sized circle
 * on a line that reads as a section title is wrong, and `marks.ts` says so.
 *
 * So the search runs twice over the same rule rather than a second rule being
 * written here: once over blocks long enough to be running prose, and once over
 * everything for the entries the first pass could not place. Narrowing the
 * corpus is the only difference between the two.
 */
const PROSE_WORDS = 8
const prose = doc.blocks.filter((b) => b.text.trim().split(/\s+/).length >= PROSE_WORDS)
const inProse = checkGlossaryMarks(heads, prose)
const everywhere = checkGlossaryMarks(heads, doc.blocks)
const placeable = new Map(
  [...everywhere.marked, ...everywhere.unmarked].map((v) => [v.entry, v] as const)
)
for (const v of [...inProse.marked, ...inProse.unmarked]) placeable.set(v.entry, v)
const report = {
  marked: [...placeable.values()].filter((v) => v.marked),
  unmarked: [...placeable.values()].filter((v) => !v.marked),
  absent: everywhere.absent
}

const byId = new Map(doc.blocks.map((b) => [b.id, b]))
const pending = new Map<string, string>()
let placed = 0
const stubborn: string[] = []
for (const verdict of report.unmarked) {
  const block = verdict.blockId ? byId.get(verdict.blockId) : undefined
  if (!block) continue
  const current = pending.get(block.id) ?? withMarkup(block.text, block.emphasis, block.strong)
  const marked = withGlossaryMark(current, verdict.term)
  if (marked === null) {
    stubborn.push(verdict.entry)
    continue
  }
  pending.set(block.id, marked)
  placed += 1
}
for (const [blockId, text] of pending) edits.push({ kind: 'text', blockId, text })

book.run.edits = edits
writeFileSync(bookPath, JSON.stringify(book, null, 1) + '\n')

console.log(`${heads.length} entries, set as back matter titled ${JSON.stringify(title)}`)
console.log(`${report.marked.length} already carried a circle; ${placed} placed here`)
console.log(
  `${report.absent.length} entries name a word the book never uses in prose ` +
    `(a heading-only use counts as absent, and that is deliberate)`
)
for (const entry of report.absent) console.log(`   unused  ${entry.entry}`)
for (const entry of stubborn) console.log(`   COULD NOT MARK  ${entry}`)
