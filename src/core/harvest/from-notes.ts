/**
 * The notes the editor approved, banked as well as printed.
 *
 * These are the best entries in the file and they cost nothing. A note that
 * survived the review has already been read by a person, judged against the
 * passage it hangs on, and possibly rewritten — which is more scrutiny than any
 * harvested entry gets. Leaving them out of the bank while paying to harvest
 * around them would be absurd.
 *
 * They enter as `context`. A note is the *editor's* assertion about the
 * passage, not something the book says — the book supplied the words being
 * explained, not the explanation — so the anchored passage becomes the
 * quotation and the footing stays honest.
 *
 * Rejected notes are not banked, for the same reason they do not teach the
 * voice: a note the user threw out is most often one that was wrong.
 */
import type { BookBlock } from '@core/assemble'
import { canonicalTags, factId, normalizeTag, type Fact } from './fact'

/** The shape an accepted note arrives in, structurally. */
export interface ApprovedNote {
  blockId: string
  /** The words the note hangs on, which become its quotation. */
  anchorText: string
  /** What kind of thing earned the note — its category in the bank. */
  kind: string
  /** The note as approved, after any rewrite. */
  text: string
}

/**
 * Turn approved notes into bank entries.
 *
 * Short notes are skipped. A gloss of half a dozen words does its job at the
 * foot of a page and is no use at all two years later in a file with no book
 * beside it — the bank wants what was explained, not what was labelled.
 */
export function factsFromNotes(
  notes: readonly ApprovedNote[],
  blocks: readonly BookBlock[],
  sourceKey: string,
  vocabulary: readonly string[] = [],
  minWords = 12
): Fact[] {
  const byId = new Map(blocks.map((b) => [b.id, b]))

  return notes
    .filter((note) => note.text.split(/\s+/u).filter(Boolean).length >= minWords)
    .map((note) => {
      const block = byId.get(note.blockId)
      const category = normalizeTag(note.kind) || 'general'
      const entry = {
        // The passage is the title: it is what the reader was looking at, and
        // it is how someone scanning the file finds this entry again.
        title: note.anchorText,
        body: note.text,
        footing: 'context' as const,
        category,
        tags: canonicalTags([category, 'editor’s note'], vocabulary),
        blockId: note.blockId,
        quote: note.anchorText
      }
      return {
        ...entry,
        id: factId(entry, sourceKey),
        sourcePage: block?.sourcePages[0] ?? null,
        // The anchor was located in the block before the note was ever placed,
        // so this is verified by construction rather than by hope.
        quoteVerified: Boolean(block)
      }
    })
}
