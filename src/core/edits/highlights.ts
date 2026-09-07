/**
 * Highlights: the passages the editor marked while *reading* the book.
 *
 * The reading pass comes before the annotation pass. It is where the footnotes
 * are chosen and where the introduction finds its material, and until this
 * record existed the app had no way to hold it: the reading happened in another
 * application whose highlights could not be exported, so the book was read
 * once for real and once from memory, and the remembered reading was the one
 * the edition was built from.
 *
 * What that cost is measurable rather than felt. Of the 23 footnotes in the
 * first book published here, 22 hang on a proper name — Roentgen, Marconi,
 * Crookes, the Society for Psychical Research, Kant. Individually good; as a
 * set, a list of the things the annotator already knew. A reader scanning a
 * page for annotation opportunities finds the entities it recognises, and the
 * places a person actually stops — an argument that does not follow, a term
 * used long before it is defined, an exercise that cannot be carried out as
 * written — are not entities and were not found. Selection is the editor's,
 * and this is the channel that carries it.
 *
 * The module is a *harvest*, not a queue. A memo is an ask and is resolved one
 * at a time; a highlight asks nothing, and its whole value is that there are
 * two hundred of them in document order when the notes pass begins.
 *
 * Pure: array and string work over the edit list and an assembled document.
 */
import { withMarkup } from '@core/transcribe'
import { findQuote } from '@core/annotate'
import type { BookDocument } from '@core/assemble'
import type { BookEdit, HighlightTag } from './book-edits'
import { HIGHLIGHT_TAGS } from './book-edits'

export type HighlightEdit = BookEdit & { kind: 'highlight' }

/**
 * Whether the marked words are still where they were left.
 *
 *  - `found` — the quote is there, at the offset it was made at.
 *  - `moved` — the quote is there, somewhere else. Some later edit shifted the
 *    block, which is the ordinary case after a proofing pass and is not a
 *    fault. The stored offset is stale and the quote is what located it.
 *  - `lost` — the quote is not in the block at all. The passage was retyped or
 *    the block was dropped, and this highlight now points at nothing.
 */
export type AnchorState = 'found' | 'moved' | 'lost'

/** One highlight, with enough of its surroundings to be read and acted on. */
export interface HighlightContext {
  highlightId: string
  blockId: string
  tag: HighlightTag
  /** The words as they were marked. */
  quote: string
  /** The editor's words about it, or null for a bare highlight. */
  text: string | null
  madeAt: string
  anchor: AnchorState
  /**
   * Where the quote is *now*, in the block's plain text — null when lost.
   * Not the stored `from`/`to`, which are the hint rather than the answer.
   */
  at: { from: number; to: number } | null
  /**
   * The current text of the block it sits in, markup on — the same string
   * `body` hands back and the one an edit must be written in terms of. Null
   * when the block is gone from the book entirely.
   */
  blockText: string | null
  /** The leaves the block came from; empty for a written block or a lost one. */
  sourcePages: number[]
  /**
   * The marked words with a little either side, so the sheet reads as prose
   * rather than as a list of offsets. Falls back to the stored quote when the
   * anchor is lost, because the editor's own reading is the thing here that
   * cannot be re-derived and must not be reported as a blank.
   */
  passage: string
}

/** The highlights on an edit list, in the order they were made. */
export function highlightsOf(edits: readonly BookEdit[]): HighlightEdit[] {
  return edits.filter((e): e is HighlightEdit => e.kind === 'highlight')
}

/** How many of each tag, for a report that makes a counted claim. */
export function highlightCounts(edits: readonly BookEdit[]): Record<HighlightTag, number> {
  const counts = Object.fromEntries(HIGHLIGHT_TAGS.map((t) => [t, 0])) as Record<
    HighlightTag,
    number
  >
  for (const h of highlightsOf(edits)) counts[h.tag] += 1
  return counts
}

/** How many words either side of the quote the sheet shows. */
const CONTEXT_WORDS = 12

/**
 * The marked words with a little either side, so a highlight reads as a place.
 *
 * The context is *sliced* out of the passage rather than rebuilt from its
 * words. Splitting on whitespace and re-joining looks equivalent and is not: it
 * detaches punctuation from the word it belongs to, so a mark ending mid
 * sentence comes back as `«a candle flame» , the student` — which is not what
 * the book says, in a file whose whole purpose is to show the editor what the
 * book says.
 *
 * The ellipsis is a claim that there is more of this paragraph, so it is
 * written only where there is. One printed against the end of a passage sends
 * the reader of the sheet looking for text that is not there.
 */
function passageAround(text: string, from: number, to: number): string {
  const head = text.slice(0, from)
  const tail = text.slice(to)
  const headWords = [...head.matchAll(/\S+/gu)]
  const tailWords = [...tail.matchAll(/\S+/gu)]

  const headFrom =
    headWords.length > CONTEXT_WORDS ? headWords[headWords.length - CONTEXT_WORDS]!.index : 0
  const lastTail = tailWords[Math.min(CONTEXT_WORDS, tailWords.length) - 1]
  const tailTo = lastTail ? lastTail.index + lastTail[0].length : 0

  const before = head.slice(headFrom).trimStart()
  const after = tail.slice(0, tailTo)
  return (
    `${headWords.length > CONTEXT_WORDS ? '…' : ''}${before}` +
    `«${text.slice(from, to).trim()}»` +
    `${after}${tailWords.length > CONTEXT_WORDS ? '…' : ''}`
  )
}

/**
 * Every highlight, in document order, located against the book as it stands.
 *
 * Located rather than trusted: the stored offsets are a hint that goes stale
 * under every later correction, so each one is re-found by its words and the
 * result says which of the three states it is in. A highlight whose words are
 * gone keeps its place at the end of the sheet rather than being dropped —
 * the same rule as a lost memo, and for a stronger reason, since a reading is
 * the one thing here that cannot be re-derived by running something again.
 *
 * The document is the one `applyEdits` produced, sections included, because a
 * highlight on a glossary entry sits in a section block that exists nowhere
 * else.
 */
export function highlightSheet(doc: BookDocument, edits: readonly BookEdit[]): HighlightContext[] {
  const highlights = highlightsOf(edits)
  if (highlights.length === 0) return []

  // Reading order: divisions set before the body, the body, divisions after.
  const ordered = [
    ...doc.sections.filter((s) => s.placement === 'front').flatMap((s) => s.blocks),
    ...doc.blocks,
    ...doc.sections.filter((s) => s.placement === 'back').flatMap((s) => s.blocks)
  ]
  const position = new Map(ordered.map((b, i) => [b.id, i]))
  const blockById = new Map(ordered.map((b) => [b.id, b]))

  return highlights
    .map((h): HighlightContext => {
      const block = blockById.get(h.blockId)
      // `near: h.from` disambiguates only — it picks which occurrence was meant
      // when the words appear twice in one paragraph, and never widens the
      // search. The words are the evidence; the offset is the tie-breaker.
      const span = block ? findQuote(block.text, h.quote, h.from) : null
      const anchor: AnchorState = !span ? 'lost' : span.from === h.from ? 'found' : 'moved'
      return {
        highlightId: h.highlightId,
        blockId: h.blockId,
        tag: h.tag,
        quote: h.quote,
        text: h.text ?? null,
        madeAt: h.madeAt,
        anchor,
        at: span,
        blockText: block ? withMarkup(block.text, block.emphasis, block.strong) : null,
        sourcePages: block ? [...block.sourcePages] : [],
        passage: block && span ? passageAround(block.text, span.from, span.to) : `«${h.quote}»`
      }
    })
    .sort((a, b) => {
      const byBlock =
        (position.get(a.blockId) ?? Number.MAX_SAFE_INTEGER) -
        (position.get(b.blockId) ?? Number.MAX_SAFE_INTEGER)
      // Two highlights in one paragraph read in the order they sit on the page,
      // not the order they were made: the sheet is a reading of the book.
      return byBlock !== 0 ? byBlock : (a.at?.from ?? a.quote.length) - (b.at?.from ?? 0)
    })
}

/** Remove a highlight — the editor is done with it, or marked it by accident. */
export function clearHighlight(edits: readonly BookEdit[], highlightId: string): BookEdit[] {
  return edits.filter((e) => e.kind !== 'highlight' || e.highlightId !== highlightId)
}

/**
 * The reading as a page somebody can read.
 *
 * In core, and the only renderer, because two of them is how `glossary.md`
 * came to describe a book the shelf no longer held: the driver prints this and
 * `book-files.mjs` writes it to the shelf, from one function, so a sheet read
 * in a session and a file read on the shelf cannot disagree.
 *
 * Grouped by tag rather than by leaf, because the harvest exists to brief a
 * pass and each pass wants one tag. Within a tag it stays in document order,
 * which is the order the book was read in.
 */
export function readingMarkdown(
  book: { title: string; fileName: string },
  sheet: readonly HighlightContext[],
  headings: Readonly<Record<HighlightTag, string>> = {
    note: 'Wants a footnote',
    intro: 'For the introduction',
    glossary: 'Terms to define'
  }
): string {
  const lines: string[] = [`# The reading: ${book.title}`, '']
  if (sheet.length === 0) {
    lines.push('Nobody has read this book yet — no passages are marked.', '')
    return lines.join('\n')
  }

  const lost = sheet.filter((h) => h.anchor === 'lost')
  lines.push(
    `${sheet.length} passages marked while reading. They are the editor's, they never ` +
      'print, and they brief the annotation pass rather than seeding it.',
    ''
  )

  for (const tag of HIGHLIGHT_TAGS) {
    const rows = sheet.filter((h) => h.tag === tag)
    if (rows.length === 0) continue
    lines.push(`## ${headings[tag]} (${rows.length})`, '')
    for (const row of rows) {
      const where =
        row.sourcePages.length > 0 ? `leaf ${row.sourcePages[0]}` : 'a block the editor wrote'
      // The state is printed on every row, not only the bad ones. A report that
      // stays silent when it is happy teaches nobody to read it, and `moved` is
      // the ordinary case after a proofing pass rather than a fault.
      const state =
        row.anchor === 'lost'
          ? ' — **the words are no longer in the book**'
          : row.anchor === 'moved'
            ? ' — moved since it was marked'
            : ''
      lines.push(`- **${row.blockId}** (${where})${state}`)
      lines.push(`  > ${row.passage}`)
      if (row.text) lines.push(`  ${row.text}`)
      lines.push('')
    }
  }

  if (lost.length > 0) {
    lines.push(
      `${lost.length} of these no longer match any text in the book — the passage was ` +
        'retyped after it was marked. The words above are as they were read, and are kept ' +
        'rather than dropped: a reading is the one thing here that cannot be re-derived by ' +
        'running something again.',
      ''
    )
  }
  return lines.join('\n')
}
