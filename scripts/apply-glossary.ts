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
const markdownBody = lines
  .slice(titleLine + 1)
  .join('\n')
  .replace(/^\s*\*[^\n]*\*\s*$/m, '') // the italic count line, which is derived
  .replace(/^\s*---\s*$/m, '')
  .trim()

const title = titleLine >= 0 ? lines[titleLine]!.replace(/^#\s*/, '').trim() : 'Glossary'

/**
 * The readable file is Markdown and the section is the app's own notation, so
 * the emphasis has to cross over. `book-files.mjs` writes `**Headword.**` and
 * `*title*` out of `<b>` and `<i>`; this reads them back.
 *
 * That direction matters more than it looks. `glossary.md` is a **view** of
 * `book.json`, regenerated from it, and if this only understood `<b>` then the
 * first regeneration would leave a file the next build could not read: the
 * glossary would vanish out of the book on a rebuild and the report would say
 * zero entries. Reading both notations makes the file a round trip, and
 * `book-files.mjs --check` is then a real check on the pair rather than on one
 * of them.
 *
 * Bold before italic, since `**` would otherwise be eaten as two `*`.
 */
const body = markdownBody
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<i>$2</i>')

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
 * Where a circle belongs, which is not simply the first place the word occurs.
 *
 * Two things go wrong if you take the first use, and both were in the finished
 * book before anybody looked at the pages.
 *
 * **The first use is usually the one the author glosses.** A writer introduces
 * a term and explains it in the same breath, so marking the first use sends the
 * reader to the back of a six-hundred-page book from the exact sentence that
 * has just told them what the word means. `The Arhat° is one of the higher
 * grades of the Eastern path`. `seven creative rays called Dhyan Chohans°. The
 * sum of these radio-active forces is Fohat°`. `he is called Gob° which is the
 * basis for the word goblin`. The reader who needs the entry is the one who
 * meets the word bare, two hundred pages later.
 *
 * **And circles bunch.** `The steps are: solution, filtration, evaporation,
 * distillation, separation, rectification°, calcination°, commixation°,
 * putrefaction°, inhibition°, fermentation, fixation°, multiplication, and
 * projection°` is seven circles in one line, which reads as a rash rather than
 * as a pointer.
 *
 * So the candidates for one entry are gathered in order, and the first that is
 * neither glossed nor crowded takes the circle. Gathering is done by asking
 * `checkGlossaryMarks` the same question over a shrinking corpus rather than by
 * writing a second search here: the block it names is removed and the question
 * is put again.
 */
const PROSE_WORDS = 8
const prose = doc.blocks.filter((b) => b.text.trim().split(/\s+/).length >= PROSE_WORDS)
const short = doc.blocks.filter((b) => b.text.trim().split(/\s+/).length < PROSE_WORDS)

interface Candidate {
  id: string
  term: string
  tier: 'prose' | 'short'
}

/** Every block carrying a term, prose first, in the order they occur. */
function blocksFor(entry: string): Candidate[] {
  const found: Candidate[] = []
  for (const [tier, corpus] of [
    ['prose', prose],
    ['short', short]
  ] as const) {
    let left = corpus
    for (let i = 0; i < 8; i++) {
      const r = checkGlossaryMarks([entry], left)
      const v = [...r.marked, ...r.unmarked][0]
      if (!v?.blockId) break
      found.push({ id: v.blockId, term: v.term, tier })
      left = left.filter((b) => b.id !== v.blockId)
    }
  }
  return found
}

/**
 * Is the word explained where it stands?
 *
 * A lexical test, and it is allowed to be wrong: a false positive moves the
 * circle to another use of the same word, which costs nothing. What it must not
 * do is miss the shapes an author actually glosses in, so it looks both ways.
 * Before the word: `called`, `known as`, `referred to as`. After it: an
 * apposition (`, the Divine Man`), a copula (`is one of the higher grades`), or
 * a translation (`translated means`).
 */
const GLOSS_BEFORE =
  /\b(called|named|termed|known as|referred to as|we call|the word)\s+(?:a|an|the)?\s*[“"']?$/i
const GLOSS_AFTER =
  /^[”"']?\s*(?:[,:]?\s*(?:the|a|an|or|is|are|was|were|which is|which are|meaning)\b|\((?!\d)|(?:means|meant|translated)\b)/i
function glossedAt(text: string, at: number, term: string): boolean {
  // Two offsets, and both were wrong first time round.
  //
  // `at` is the index of the circle itself, so the text that FOLLOWS the word
  // starts one character later; reading from `at` put the circle at the head of
  // every candidate string and no pattern ever matched.
  //
  // And the text that PRECEDES the word ends where the word begins, not where
  // the circle does. `are called Chelas°` was tested against a string ending in
  // "Chelas", so the `called` pattern could not see itself, and the commonest
  // gloss shape in this book went undetected. The word is stripped off the end
  // by its own token count, which handles `astral body` as well as `Chela`.
  const words = term.trim().split(/[\s-]+/).length
  const before = text.slice(0, at).replace(new RegExp(`(?:[A-Za-z'’]+[\\s-]*){0,${words}}$`), '')
  return GLOSS_BEFORE.test(before) || GLOSS_AFTER.test(text.slice(at + 1))
}

/**
 * Two circles closer together than this read as one blot rather than two marks.
 *
 * Half a line, not a line and a half. The fault being fixed is a rash of seven
 * circles inside one row of a list, where they stand fifteen characters apart;
 * two glossed words in the same flowing sentence are not that, and pushing the
 * second of them onto some worse occurrence elsewhere costs more than it saves.
 */
const MIN_GAP = 60

const byId = new Map(doc.blocks.map((b) => [b.id, b]))
const pending = new Map<string, string>()
let placed = 0
let moved = 0
const crowded: string[] = []
const stubborn: string[] = []

const already = checkGlossaryMarks(heads, doc.blocks)
const wanted = heads.filter((h) => !already.marked.some((v) => v.entry === h))

for (const entry of wanted) {
  const candidates = blocksFor(entry)
  if (candidates.length === 0) continue
  let done = false
  // Four tiers, in this order, and the order is the whole of the rule: a use in
  // running prose that is not glossed; a glossed one in prose; a short line that
  // is not glossed; a short line that is. A word the book uses once and explains
  // on the spot still deserves its circle, because a pointer beside a definition
  // beats no pointer at all. What must not happen is the third tier beating the
  // second, which is what happened when this was two rounds: the Arhat's circle
  // left the sentence that defines it and landed on the run-in heading `The
  // Arhat.` two lines above, which is the one place `marks.ts` says a circle
  // must never go.
  for (const [tier, allowGlossed] of [
    ['prose', false],
    ['prose', true],
    ['short', false],
    ['short', true]
  ] as const) {
    for (const cand of candidates.filter((c) => c.tier === tier)) {
      const block = byId.get(cand.id)
      if (!block) continue
      const before = pending.get(cand.id) ?? withMarkup(block.text, block.emphasis, block.strong)
      const after = withGlossaryMark(before, cand.term)
      if (after === null) continue
      // Where core put it, read off the two strings rather than guessed.
      let at = 0
      while (at < before.length && before[at] === after[at]) at += 1
      const plain = after.replace(/<[^>]+>/g, '')
      const plainAt = after.slice(0, at).replace(/<[^>]+>/g, '').length
      const others = [...plain.matchAll(/°/g)].map((m) => m.index ?? 0).filter((i) => i !== plainAt)
      if (others.some((i) => Math.abs(i - plainAt) < MIN_GAP)) continue
      if (!allowGlossed && glossedAt(plain, plainAt, cand.term)) continue
      pending.set(cand.id, after)
      placed += 1
      if (cand.id !== candidates[0]!.id) moved += 1
      done = true
      break
    }
    if (done) break
  }
  if (!done) {
    // Every use of it sits within a line and a half of another circle.
    if (candidates.length > 0) crowded.push(entry)
    else stubborn.push(entry)
  }
}
for (const [blockId, text] of pending) edits.push({ kind: 'text', blockId, text })

book.run.edits = edits
writeFileSync(bookPath, JSON.stringify(book, null, 1) + '\n')

console.log(`${heads.length} entries, set as back matter titled ${JSON.stringify(title)}`)
console.log(
  `${already.marked.length} already carried a circle; ${placed} placed here, ` +
    `${moved} of them moved off the passage that explains the word`
)
console.log(
  `${already.absent.length} entries name a word the book never uses in prose ` +
    `(a heading-only use counts as absent, and that is deliberate)`
)
for (const entry of already.absent) console.log(`   unused  ${entry.entry}`)
for (const entry of crowded) {
  console.log(`   crowded  ${entry} — every use of it sits beside another circle`)
}
for (const entry of stubborn) console.log(`   COULD NOT MARK  ${entry}`)
