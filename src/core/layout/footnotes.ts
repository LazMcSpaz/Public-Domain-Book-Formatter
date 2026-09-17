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
import type { SubscriptRange } from '@core/transcribe'
import { footnoteMarkerPattern, type BareMark, type Footnote } from '@core/assemble'

/** A reference mark, resolved to the word it sits on. */
export interface NoteReference {
  /** Index of the whitespace-separated word in the *rewritten* block text. */
  wordIndex: number
  noteId: string
  /** The mark as it will be printed in this edition, e.g. "4". */
  mark: string
  /**
   * The marker the *original* printed here, and which occurrence of it this is
   * within the block, 1-based.
   *
   * The coordinate a `BareMark` is written in, and the reason it is reported:
   * without it nothing outside this module can name a particular mark, so no
   * surface could offer to declare one bare. An authored note, which has an
   * anchor rather than a printed marker, has neither.
   */
  printed?: string
  nth?: number
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
  /** Word indices set in italic. See `Footnote.emphasis`. */
  emphasis?: number[]
  /** Word indices set bold. See `Footnote.strong`. */
  strong?: number[]
  /** Word indices set in small capitals. See `Footnote.smallCaps`. */
  smallCaps?: number[]
  /** Character ranges set below the line. See `Footnote.subscript`. */
  subscript?: SubscriptRange[]
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
  /**
   * Marks declared bare that this document has no occurrence for.
   *
   * The block was dropped or merged away, or it was retyped and the marker the
   * editor was looking at is no longer in it. Either way the declaration has
   * silently stopped applying — and silence is the dangerous outcome, because
   * what it restores is the fault: the mark starts claiming a note again and
   * every note of that marker after it moves by one. Reported for the same
   * reason `notesDropped` is.
   */
  bareMarksMissed: BareMark[]
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
/**
 * Every place a marker of this kind appears, in the order it is printed.
 *
 * Global, because one block can carry several — see the note in the loop. The
 * zero-length guard is not theoretical: `footnoteMarkerPattern` builds an
 * alternation with lookarounds for a numeric marker, and a pattern that can
 * match empty would spin here for ever.
 */
function occurrences(source: string, marker: string): { start: number; end: number }[] {
  const pattern = footnoteMarkerPattern(marker)
  if (!pattern) return []
  const scan = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  )
  const out: { start: number; end: number }[] = []
  let match: RegExpExecArray | null
  while ((match = scan.exec(source)) !== null) {
    const start = match.index
    const end = start + match[0].length
    // Only a **maximal run** counts. `footnoteMarkerPattern('*')` is a bare
    // `/\*/`, so without this the two characters of a `**` are two `*`
    // occurrences as well — and the claiming walk below hands each of them a
    // note before the emit loop discards them in favour of the `**`. Those
    // notes go back to the pool and the *next* block takes them: on Isis
    // Vol. I leaf 190's paragraph carried `**` and a lone `*`, so the lone
    // `*` took the note from leaf 194 and leaf 193 took leaves 191's and
    // 193's. The tie-break at emit time is right but comes too late; the
    // occurrence must never be counted in the first place.
    const before = start > 0 ? source[start - 1]! : ''
    const after = end < source.length ? source[end]! : ''
    if (!MARKER_CHAR.test(before) && !MARKER_CHAR.test(after)) out.push({ start, end })
    if (match.index === scan.lastIndex) scan.lastIndex++
  }
  return out
}

/** Any character a printed reference mark is made of. */
const MARKER_CHAR = /[*†‡§‖¶⁂]/u

export function prepareFootnotes(
  blocks: readonly { id: string; text: string }[],
  footnotes: readonly Footnote[],
  bareMarks: readonly BareMark[] = []
): PreparedFootnotes {
  /** Bare occurrences by block and marker, as a set of 1-based positions. */
  const bareIn = new Map<string, Set<number>>()
  for (const mark of bareMarks) {
    const key = `${mark.blockId}\u0000${mark.marker}`
    const at = bareIn.get(key) ?? new Set<number>()
    at.add(mark.nth)
    bareIn.set(key, at)
  }
  /** Every bare mark this pass actually found somewhere to skip. */
  const bareHonoured = new Set<string>()
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

    const hits: {
      start: number
      end: number
      noteId: string
      printed?: string
      nth?: number
    }[] = []
    /** The remaining notes that print a marker, grouped by it, oldest first. */
    const byMarker = new Map<string, Footnote[]>()
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
      const list = byMarker.get(note.originalMarker) ?? []
      list.push(note)
      byMarker.set(note.originalMarker, list)
    }

    // **A block can carry the same marker more than once**, and each one is a
    // different note. Assembly joins a paragraph across a page seam, so a
    // paragraph running from one leaf onto the next brings both leaves' `*`
    // into one block — and the version of this loop that asked each note for
    // its *first* match gave both of them the same position, kept one and
    // dropped the other. The consequences were not local: the unclaimed note
    // waited for the next `*` anywhere in the book and took it, the note that
    // one belonged to took the one after that, and every `*` note from the
    // seam onwards was set under the wrong reference. On *Isis Unveiled* that
    // was 638 of 857 notes, with page 155 citing Cooke's "New Chemistry" where
    // Josephus belongs, and a literal asterisk left in the text at every seam
    // because the marker nobody claimed was never stripped.
    //
    // So the occurrences are walked positionally and the k-th takes the k-th
    // remaining note of that marker. Extra markers simply find no note left,
    // which is the case the report below names.
    //
    // A mark the editor has declared **bare** is stepped over rather than
    // counted out: it prints — an unclaimed marker is never stripped — and the
    // notes waiting for that marker go on to the next occurrence. That is the
    // whole of the mechanism, and it has to live inside this walk rather than
    // beside it, because "the k-th mark takes the k-th note" is exactly the
    // rule a surplus mark breaks.
    for (const [marker, waiting] of byMarker) {
      const places = occurrences(source, marker)
      const bare = bareIn.get(`${block.id}\u0000${marker}`)
      let claimed = 0
      for (let k = 0; k < places.length; k++) {
        if (bare?.has(k + 1)) {
          bareHonoured.add(`${block.id}\u0000${marker}\u0000${k + 1}`)
          continue
        }
        const note = waiting[claimed]
        if (!note) break
        claimed++
        hits.push({ ...places[k]!, noteId: note.id, printed: marker, nth: k + 1 })
      }
    }

    hits.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start
      const aWide = a.end - a.start
      const bWide = b.end - b.start
      // Ties go to the zero-width hit, so a note written at the exact spot a
      // printed marker sits refers to the word before it rather than to the
      // mark.
      if ((aWide === 0) !== (bWide === 0)) return aWide === 0 ? -1 : 1
      // Otherwise the longer run wins: `**` in the text is one marker, not a
      // `*` with another beside it, and letting `*` take the position would
      // leave a stray asterisk and send the `**` note down the book.
      return bWide - aWide
    })

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

      references.push({
        wordIndex: counter.lastWordIndex(),
        noteId: note.id,
        mark,
        ...(hit.printed !== undefined ? { printed: hit.printed, nth: hit.nth } : {})
      })
      notes.set(note.id, {
        id: note.id,
        mark,
        text: note.text,
        ...(note.emphasis?.length ? { emphasis: note.emphasis } : {}),
        ...(note.strong?.length ? { strong: note.strong } : {}),
        ...(note.smallCaps?.length ? { smallCaps: note.smallCaps } : {}),
        ...(note.subscript?.length ? { subscript: note.subscript } : {})
      })
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

  // A declaration that found nothing to apply to. See `bareMarksMissed`: this
  // is the one failure of this mechanism that puts the *original* fault back,
  // so it is named rather than counted.
  const bareMarksMissed = bareMarks.filter(
    (m) => !bareHonoured.has(`${m.blockId}\u0000${m.marker}\u0000${m.nth}`)
  )

  return { blocks: prepared, notes, orphans, bareMarksMissed }
}
