/**
 * A circle for every glossary entry the book uses and nothing points at.
 *
 *   npx vite-node --config vitest.config.ts scripts/glossary-circles.ts <book.json> <batch.json>
 *
 * Reads the book's glossary and its body straight out of `book.json`, places
 * a circle on the first prose use of each entry that has none
 * (`placeMissingMarks`), and writes the changed blocks as a batch for
 * `drive.mjs correct --batch <batch.json>`, which lands them through the same
 * tag guard as any correction. Nothing is written to the book here.
 *
 * Prints what it placed and where, so a person can read each circle in its
 * sentence before the batch lands; the entries it could not place; and the
 * entries for words the book never uses, which belong on the cut list rather
 * than in a glossary. Run it after every change to the entry list: a step
 * done for one glossary is not done for the next (CLAUDE.md, _The apparatus,
 * book by book_), and an entry nothing points at is one no reader opens.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { assembleBook } from '@core/assemble'
import { applyEdits } from '@core/edits'
import { partsIn, withMarkup, type InlinePart } from '@core/transcribe/markup'
import { glossaryHeadwords, placeMissingMarks } from '@core/annotate'

const [bookPath, out] = process.argv.slice(-2)
if (!bookPath?.endsWith('.json') || !out?.endsWith('.json') || bookPath === out) {
  throw new Error('glossary-circles.ts <book.json> <batch.json>')
}
const run = JSON.parse(readFileSync(bookPath, 'utf8')).run
const doc = applyEdits(assembleBook(run.transcriptions), run.edits ?? [])
const section = [...(run.edits ?? [])]
  .reverse()
  .find(
    (e: { kind?: string; sectionId?: string }) => e.kind === 'section' && e.sectionId === 'glossary'
  ) as { text: string } | undefined
if (!section) throw new Error('The book has no glossary section.')

type Faced = { text: string; emphasis?: number[]; strong?: number[]; parts?: InlinePart[] }
const faces = (b: Faced): string =>
  withMarkup(b.text, b.emphasis, b.strong, undefined, partsIn(b.parts, ['italic', 'strong']))
const blocks = doc.blocks.map((b) => ({ id: b.id, kind: b.kind, text: faces(b) }))

const result = placeMissingMarks(glossaryHeadwords(section.text), blocks)
writeFileSync(out, JSON.stringify(result.blocks, null, 1) + '\n')

// Each circle shown in its sentence: the circles a block gained are found by
// walking it against what it was, and each is paired with the entry whose
// word stands in front of it.
const before = new Map(blocks.map((b) => [b.id, b.text]))
const strip = (t: string) => t.replace(/<\/?[a-z]+>/gi, '')
const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
for (const p of result.placed) {
  const was = strip(before.get(p.blockId)!)
  const now = strip(result.blocks.find((b) => b.id === p.blockId)!.text)
  const added: number[] = []
  for (let i = 0, j = 0; i < now.length; i++) {
    if (now[i] === was[j]) j++
    else added.push(i)
  }
  const word = new RegExp(
    `${p.term
      .split(/[\s-]+/)
      .map(escape)
      .join('[\\s-]+')}(?:s|es)?["\u201D\u2019']?$`,
    'iu'
  )
  const at = added.find((i) => word.test(now.slice(0, i))) ?? added[0] ?? 0
  const from = Math.max(0, at - 70)
  console.log(`  placed   ${p.entry}  ${p.blockId}  …${now.slice(from, at + 30)}…`)
}
for (const v of result.unplaced) console.log(`  UNPLACED ${v.entry}  (${v.term} in ${v.blockId})`)
for (const v of result.absent) {
  console.log(`  absent   ${v.entry}  (not in the body: named only in front matter, or one to cut)`)
}
console.log(
  `${result.placed.length} placed in ${result.blocks.length} block(s), ` +
    `${result.unplaced.length} unplaced, ${result.absent.length} absent → ${out}`
)
if (result.blocks.length > 0) {
  console.log(
    'Read every placed line before landing: a word with two senses takes the circle on ' +
      'whichever comes first ("a fair medium° sample" for the spiritualist Medium). ' +
      'Take a wrong one out of the batch and place it by hand.'
  )
  console.log(`next: node scripts/drive.mjs correct --batch ${out}`)
}
