/**
 * A shelf book whose notes are gathered at the back of each chapter, set as
 * footnotes — `gatheredNotesToFootnotes` (`@core/edits/gathered-notes`) over
 * `book.json`, with no browser.
 *
 *   npx vite-node --config vitest.config.ts scripts/notes-to-footnotes.ts <book.json> <out.json>
 *       [--keep <head-leaf>:<note>,...] [--head "FOOTNOTES FOR"]
 *
 * `--keep 125:1` leaves note 1 of the section whose head is on leaf 125 as
 * printed: the note the paper sets no mark for, which the editor places.
 * The report names every head removed, every edit carried in, and every
 * mark declared bare; a note with no mark in its own chapter is named and
 * the exit is non-zero. Write to a file other than the book, check it with
 * `drive.mjs pairs` (or the notes `body-of.ts` reports with the block that
 * claims each), and only then put it in place: this rewrites leaves.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { gatheredNotesToFootnotes } from '@core/edits'

const args = process.argv.slice(2).filter((a) => !a.endsWith('notes-to-footnotes.ts'))
const flag = (name: string): string | null => {
  const at = args.indexOf(name)
  return at === -1 ? null : (args[at + 1] ?? null)
}
const flagged = new Set(
  ['--keep', '--head'].flatMap((f) => {
    const at = args.indexOf(f)
    return at === -1 ? [] : [at, at + 1]
  })
)
const [inPath, outPath] = args.filter((_, i) => !flagged.has(i))
if (!inPath?.endsWith('.json') || !outPath?.endsWith('.json')) {
  throw new Error(
    'notes-to-footnotes.ts <book.json> <out.json> [--keep <head-leaf>:<note>,...] [--head "…"]'
  )
}
const raw = readFileSync(inPath, 'utf8')
const book = JSON.parse(raw)
// Written back exactly as the app writes it, so the diff is the change.
if (JSON.stringify(book, null, 2) !== raw) {
  throw new Error(`${inPath} does not round-trip at two spaces; it would be rewritten whole`)
}
const keep = (flag('--keep') ?? '')
  .split(',')
  .filter(Boolean)
  .map((k) => {
    const [headLeaf, note] = k.split(':').map(Number)
    if (!Number.isInteger(headLeaf) || !Number.isInteger(note))
      throw new Error(`--keep ${k}: <head-leaf>:<note>`)
    return { headLeaf: headLeaf!, note: note! }
  })
const head = flag('--head')
const out = gatheredNotesToFootnotes(book.run.transcriptions, book.run.edits ?? [], {
  keep,
  ...(head ? { head: new RegExp(head) } : {})
})
book.run.transcriptions = out.transcriptions
book.run.edits = out.edits
writeFileSync(outPath, JSON.stringify(book, null, 2))
console.log(out.report.join('\n'))
if (out.missingMark) {
  console.error(
    `${out.missingMark.noteId} (${out.missingMark.marker}, notes on leaf ${out.missingMark.leaf}) has no mark in its chapter: keep it with --keep, or raise it for the editor`
  )
  process.exit(1)
}
