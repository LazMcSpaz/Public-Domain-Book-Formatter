/**
 * Finding footnote references in the body, and renumbering them.
 *
 * Assembly pulled every note out of the page flow, but it left the *reference
 * mark* where the printer put it — inside the body text, as a bare "1" or a
 * superscript "¹" or a dagger. To set the note at the foot of the right page,
 * two things have to be established here:
 *
 *   1. **Which page it belongs to**, which means which *word* the mark rides
 *      on, because the word decides the line and the line decides the page.
 *   2. **What the mark should say now.** The original numbering restarted on
 *      every page, or used a rotating †‡§, or repeated "1" in three different
 *      chapters. A new edition renumbers straight through, in the order the
 *      references are actually read.
 *
 * Marker location is shared with orphan detection and with the LaTeX emitter
 * (`footnoteMarkerPattern`). That is not tidiness: if two of them disagreed, a
 * note could be reported to the user as unplaceable and then quietly placed
 * anyway, or the reverse.
 *
 * Pure: text in, text and positions out.
 */
import { footnoteMarkerPattern, type Footnote } from '@core/assemble'

/** A reference mark, resolved to the word it sits on. */
export interface NoteReference {
  /** Index of the whitespace-separated word in the *rewritten* block text. */
  wordIndex: number
  noteId: string
  /** The mark as it will be printed in this edition, e.g. "4". */
  mark: string
}

/** One body block with its printed markers removed, and where they were. */
export interface PreparedBlock {
  /**
   * The block's text with each original marker **deleted**.
   *
   * The mark is not substituted in place, because the new one is set smaller
   * and lifted off the baseline and so cannot share a run with the text around
   * it. It is re-attached during layout as an `Attachment`, which is measured
   * and therefore accounted for when the line is broken.
   */
  text: string
  references: NoteReference[]
}

/** A note ready to be set at the foot of a page. */
export interface PreparedNote {
  id: string
  /** The mark as printed, matching the one left in the body. */
  mark: string
  text: string
}

export interface PreparedFootnotes {
  /** One entry per body block, in the same order. */
  blocks: PreparedBlock[]
  /** Notes that found a reference, keyed by id, in reference order. */
  notes: Map<string, PreparedNote>
  /**
   * Notes whose marker was never found in the body, and which therefore cannot
   * be placed. Reported, never silently discarded.
   */
  orphans: Footnote[]
}

/**
 * Count whitespace-separated words as text is appended.
 *
 * The word index has to match the one `itemsFromText` derives from
 * `text.split(/\s+/)`, so it is counted the same way rather than by a second
 * split of a string that is still being built.
 */
class WordCounter {
  private count = 0
  private inWord = false

  /** Feed text that has already been appended to the output. */
  feed(text: string): void {
    for (const ch of text) {
      if (/\s/u.test(ch)) {
        this.inWord = false
      } else if (!this.inWord) {
        this.count += 1
        this.inWord = true
      }
    }
  }

  /**
   * The word a mark at this position belongs to — always the one before it.
   *
   * A marker is usually glued to the word it follows ("grosse.¹"), in which
   * case that word is the last one counted. When the printer set it off with a
   * space it still refers backwards, so the answer is the same either way.
   */
  lastWordIndex(): number {
    return Math.max(0, this.count - 1)
  }
}

/**
 * Strip every block's printed markers and record where they were.
 *
 * Blocks are walked in order and each note is claimed by the first block whose
 * text contains its marker — the same rule the LaTeX emitter follows, and the
 * reason a note is renumbered by *reference* order rather than by the order
 * assembly happened to collect it in.
 */
export function prepareFootnotes(
  blocks: readonly { id: string; text: string }[],
  footnotes: readonly Footnote[]
): PreparedFootnotes {
  // Every note is searched for, including the ones assembly already flagged as
  // orphaned. Filtering them out here would leave nothing to report, and a note
  // that disappears without a word is the failure this module exists to avoid —
  // the reader only discovers it once the book is printed.
  const remaining = new Map(footnotes.map((note) => [note.id, note]))
  const notes = new Map<string, PreparedNote>()
  const prepared: PreparedBlock[] = []
  let nextNumber = 1

  for (const block of blocks) {
    const source = block.text

    // Every remaining note's first occurrence in this block, in the order they
    // appear on the page rather than the order the notes were collected.
    const hits: { start: number; end: number; noteId: string }[] = []
    for (const note of remaining.values()) {
      // A note the editor wrote carries its position instead of a printed
      // marker. Its hit is zero-width: there is nothing in the text to strip,
      // only a place in it to refer from. That is the whole of the difference,
      // which is why the rest of this loop needs no idea which kind it has.
      if (note.anchor) {
        if (note.anchor.blockId !== block.id) continue
        const at = Math.max(0, Math.min(source.length, note.anchor.at))
        hits.push({ start: at, end: at, noteId: note.id })
        continue
      }

      const pattern = footnoteMarkerPattern(note.originalMarker)
      if (!pattern) continue
      const match = pattern.exec(source)
      if (match)
        hits.push({ start: match.index, end: match.index + match[0].length, noteId: note.id })
    }
    // Ties go to the zero-width hit, so a note written at the exact spot a
    // printed marker sits refers to the word before it rather than to the mark.
    hits.sort((a, b) => a.start - b.start || a.end - a.start - (b.end - b.start))

    if (hits.length === 0) {
      prepared.push({ text: source, references: [] })
      continue
    }

    const counter = new WordCounter()
    const references: NoteReference[] = []
    let out = ''
    let cursor = 0

    for (const hit of hits) {
      // Two markers can only overlap if the patterns did, which would mean the
      // same characters serving as two references. Skip the second rather than
      // corrupting the text around it.
      if (hit.start < cursor) continue

      const before = source.slice(cursor, hit.start)
      out += before
      counter.feed(before)

      const note = remaining.get(hit.noteId)
      if (!note) continue
      const mark = String(nextNumber++)

      references.push({ wordIndex: counter.lastWordIndex(), noteId: note.id, mark })
      notes.set(note.id, { id: note.id, mark, text: note.text })
      remaining.delete(note.id)

      // The printed marker is dropped here and redrawn during layout. Leaving
      // it in would print both — the original digit and the new mark beside it.
      cursor = hit.end
    }

    out += source.slice(cursor)
    prepared.push({ text: out, references })
  }

  // Anything still unclaimed had a marker that never turned up in the body.
  // It cannot be set at the foot of a page, because there is no page to
  // attach it to — but the caller is told, and tells the user.
  const orphans = [...remaining.values()]

  return { blocks: prepared, notes, orphans }
}
