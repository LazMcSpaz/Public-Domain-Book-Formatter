/**
 * A shelf book's assembled body, both faces, and its own footnotes, read
 * straight out of `book.json` with no browser.
 *
 *   npx vite-node --config vitest.config.ts scripts/body-of.ts <book.json> <out.json>
 *
 * The same shape `drive.mjs body` hands back, and the same text: assembly and
 * the edit list are pure core, and on _Isis Unveiled_ Vol. II the two agree
 * block for block and note for note. What it saves is the browser: rewriting
 * `corrections.md` for a shelf of books through `drive.mjs` means loading
 * each one, and `load` reads the scan again, which is most of an hour on a
 * photographed book. `book-files.mjs <dir> --body <out.json>` then checks or
 * rewrites the sheet with it.
 *
 * Run through `vite-node` rather than plain Node, because the transcribe
 * module has a TypeScript parameter property that Node's type stripping
 * cannot read, and assembly imports it.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { assembleBook } from '@core/assemble'
import { applyEdits } from '@core/edits'
import { partsIn, withMarkup, type InlinePart } from '@core/transcribe/markup'
import { prepareFootnotes } from '@core/layout/footnotes'

const [bookPath, out] = process.argv.slice(-2)
if (!bookPath?.endsWith('.json') || !out?.endsWith('.json')) {
  throw new Error('body-of.ts <book.json> <out.json>')
}
const book = JSON.parse(readFileSync(bookPath, 'utf8'))
const bare = assembleBook(book.run.transcriptions)
const applied = applyEdits(bare, book.run.edits ?? [])

type Faced = { text: string; emphasis?: number[]; strong?: number[]; parts?: InlinePart[] }
const faces = (b: Faced): string =>
  withMarkup(b.text, b.emphasis, b.strong, undefined, partsIn(b.parts, ['italic', 'strong']))
const say = (blocks: (Faced & { id: string; kind: string })[]) =>
  blocks.map((b) => ({ id: b.id, kind: b.kind, text: faces(b) }))
// Where each note is referred from, by the engine's own claiming walk: a
// reader of the text needs a note beside the sentence its mark is on, and a
// second rule for finding it would disagree with the page somewhere.
const claimedBy = new Map<string, string>()
prepareFootnotes(applied.blocks, applied.footnotes, applied.bareMarks ?? []).blocks.forEach(
  (pb, i) => {
    for (const r of pb.references) claimedBy.set(r.noteId, applied.blocks[i]!.id)
  }
)
// The book's own notes only: the editor's are not corrections.
const notes = (
  list: (Faced & { id: string; pageIndex: number; originalMarker: string })[],
  placed = false
) =>
  list
    .filter((n) => n.originalMarker)
    .map((n) => ({
      id: n.id,
      leaf: n.pageIndex,
      text: faces(n),
      ...(placed ? { marker: n.originalMarker, block: claimedBy.get(n.id) ?? null } : {})
    }))

writeFileSync(
  out,
  JSON.stringify({
    edited: say(applied.blocks),
    pristine: say(bare.blocks),
    notes: { edited: notes(applied.footnotes, true), pristine: notes(bare.footnotes) }
  })
)
console.log(`${applied.blocks.length} blocks, ${applied.footnotes.length} notes → ${out}`)
