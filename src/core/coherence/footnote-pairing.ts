/**
 * Do the reference marks in the body and the notes at the foot balance?
 *
 * A footnote is printed at the foot of the leaf its mark is on, so for each
 * leaf and each marker the two counts are equal. When they are not, one of two
 * things is true and both are the editor's: the reading found a mark the page
 * has no note for, or a note whose mark it did not transcribe.
 *
 * It matters far more than one leaf. The engine pairs positionally — the k-th
 * occurrence of a marker takes the k-th waiting note — so a single surplus mark
 * does not misprint one note, it takes the *next* one, whose note takes the one
 * after, and every note of that marker to the end of the book is set under the
 * wrong reference. That is not a hypothesis: on *Isis Unveiled* Vol. I, page
 * 155 cited Cooke's "New Chemistry" where Josephus belonged, and the cause was
 * eight unbalanced leaves in six hundred.
 *
 * Nothing here is an opinion about the book. It counts two things that the
 * printed page makes equal, which is why it can be run on every book and
 * believed — the precision rule `consistency.ts` states, applied again.
 *
 * What it deliberately does **not** do is guess which side is wrong. A surplus
 * mark may be a compositor's, a scanner's speck read as an asterisk, or a note
 * the reading dropped; only the leaf can say, and saying costs a crop.
 *
 * Pure: no DOM, no I/O.
 */
import type { PageTranscription } from '@core/transcribe'

/** Every marker a footnote can print, as a run: `*`, `††`, `‡‡`. */
const MARKER_RUN = /[*†‡§‖¶⁂]+/gu
/** A note's own marker, repeated at the head of its text on the printed page. */
const LEADING_MARKER = /^\s*([*†‡§‖¶⁂]+)/u

export interface PairingFinding {
  pageIndex: number
  /** The marker whose counts disagree. */
  marker: string
  /** How many times it appears in the leaf's body text. */
  inBody: number
  /** How many notes on that leaf print it. */
  notes: number
  /**
   * Running total across the book *after* this leaf, per marker.
   *
   * The number that says how far the pairing has drifted from here on, and the
   * reason a list of leaves is not enough: the first non-zero entry is where a
   * reader first meets the wrong note.
   */
  driftAfter: number
  context: string
}

/**
 * Where the marks and the notes stop balancing, leaf by leaf.
 *
 * Takes the **transcriptions** rather than the assembled document, and that is
 * deliberate: assembly joins paragraphs across seams, so an assembled block
 * belongs to two leaves at once and the question "does *this leaf* balance?"
 * stops having an answer. The transcription is the last place the leaf is still
 * a leaf.
 */
export function checkFootnotePairing(
  transcriptions: readonly PageTranscription[]
): PairingFinding[] {
  const drift = new Map<string, number>()
  const out: PairingFinding[] = []

  for (const page of [...transcriptions].sort((a, b) => a.pageIndex - b.pageIndex)) {
    const inBody = new Map<string, number>()
    const notes = new Map<string, number>()
    const where = new Map<string, string>()

    for (const block of page.blocks) {
      if (block.kind === 'footnote') {
        // A continuation carries no marker of its own — it is the rest of a
        // note that began on the leaf before, and counting it as a second note
        // would report every long footnote in the book.
        const marker =
          block.marker?.trim() || LEADING_MARKER.exec(block.text ?? '')?.[1]?.trim() || ''
        if (marker) notes.set(marker, (notes.get(marker) ?? 0) + 1)
        continue
      }
      for (const match of (block.text ?? '').matchAll(MARKER_RUN)) {
        const marker = match[0]
        inBody.set(marker, (inBody.get(marker) ?? 0) + 1)
        if (!where.has(marker)) {
          const at = match.index ?? 0
          where.set(marker, (block.text ?? '').slice(Math.max(0, at - 45), at + 20).trim())
        }
      }
    }

    for (const marker of new Set([...inBody.keys(), ...notes.keys()])) {
      const body = inBody.get(marker) ?? 0
      const under = notes.get(marker) ?? 0
      if (body === under) continue
      const after = (drift.get(marker) ?? 0) + (under - body)
      drift.set(marker, after)
      out.push({
        pageIndex: page.pageIndex,
        marker,
        inBody: body,
        notes: under,
        driftAfter: after,
        context: where.get(marker) ?? '(no mark in the body)'
      })
    }
  }
  return out
}

/** A footnote block recorded as a fresh note that reads like the tail of one. */
export interface ContinuationFinding {
  pageIndex: number
  marker: string
  /** How the block's text opens, after its own repeated marker is stripped. */
  opening: string
}

/**
 * Footnote blocks that carry a marker but open mid-sentence.
 *
 * A long note runs off the foot of one leaf and finishes at the foot of the
 * next, where the printed page sets it with **no marker** — it is the rest of
 * the note above, and assembly joins it as such. A reader who gives that
 * runover the previous note's marker has created a note with no mark in the
 * body, and the pairing is positional: the phantom waits, takes the next mark
 * of its marker anywhere in the book, and every note of that marker to the end
 * of the volume is set one reference early. On *Isis Unveiled* Vol. I one
 * such block — leaf 330, "expanding his idea, or dispelling the gloom.”" under
 * a `†` — displaced 239 `†` references and left the last of them an orphan.
 *
 * The shape is mechanical: a marker on text whose first letter is lower case,
 * or which opens on a closing quote or a comma. That is what a runover looks
 * like and what a fresh note never does. Reported, never repaired — the leaf
 * decides — and swept over every footnote in the volume the moment a
 * transcription lands, because a check that has to be run by hand is the
 * check that is not run.
 *
 * Pure: no DOM, no I/O.
 */
export function checkNoteContinuations(
  transcriptions: readonly PageTranscription[]
): ContinuationFinding[] {
  const out: ContinuationFinding[] = []
  for (const page of [...transcriptions].sort((a, b) => a.pageIndex - b.pageIndex)) {
    for (const block of page.blocks) {
      if (block.kind !== 'footnote') continue
      const marker = block.marker?.trim()
      if (!marker) continue
      // The page repeats the marker at the head of the note; take it off so the
      // first *word* is what gets judged.
      const text = (block.text ?? '').replace(/^[\s*†‡§‖¶⁂]+/u, '')
      const first = text[0]
      if (!first) continue
      const opensMidSentence = /[\p{Ll}]/u.test(first) || /[,;:)”’]/u.test(first)
      if (opensMidSentence)
        out.push({ pageIndex: page.pageIndex, marker, opening: text.slice(0, 60) })
    }
  }
  return out
}
