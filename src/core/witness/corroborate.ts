/**
 * What a second reader makes of a flag the first one raised.
 *
 * The uncertainty gate flags every place the transcription and OCR disagree,
 * and on a real book that is forty leaves of decisions. Most are OCR seeing
 * something that is not there — it is the rougher of the two readers, which
 * is why nothing at that gate is pre-selected. What it has never had is a way
 * to tell those from the flags that are real.
 *
 * A second OCR engine can, and the margin is not small. Measured over the 42
 * proofed leaves of `docs/ledger-data/second-reader`, taking every word of
 * the first reader's reading:
 *
 *   | the two engines | words | right on it |
 *   | --------------- | ----: | ----------: |
 *   | agree           | 9,841 |       98.5% |
 *   | disagree        |   155 |       58.7% |
 *
 * **A word the two engines disagree about is 27 times likelier to be wrong.**
 *
 * So a flag both readers raise is worth looking at first, and one the second
 * reader does not share is worth looking at last. That is all this claims:
 * it is an *ordering*, and it removes nothing. The gate still shows every
 * flag, because the rule this repository runs on is that only pixels accept a
 * reading and two machines agreeing is not pixels — 150 of the errors on that
 * set survived both engines agreeing, most of them columns read across, and a
 * pass that hid those would be the check manufacturing confidence.
 *
 * **Not to be confused with the second *reading*.** That is the paid pass
 * that looks at flagged spots again with the scan (`@core/adjudicate`), and
 * it is a different thing with a nearly identical name. This is another OCR
 * engine with no pixels of its own opinion; it grades a flag, it never
 * settles one.
 *
 * Pure: no DOM, no I/O.
 */
import { compareWitnesses, type Disagreement } from '@core/witness/index'

export type Corroboration =
  /** Both readers read the same thing, and it is not what the transcription says. */
  | 'corroborated'
  /** The readers disagree with the transcription and with each other. */
  | 'contested'
  /** The second reader reads what the transcription says. The first is the odd one out. */
  | 'dismissed'

export interface GradedFlag {
  /** Where in the transcription's word sequence this falls. */
  at: number
  /** What the book as transcribed says there. */
  transcription: string
  /** What the first reader read instead. */
  first: string
  /** What the second read, or `null` where it read what the transcription says. */
  second: string | null
  verdict: Corroboration
}

/** Letters and digits only — the same reduction `compareWitnesses` makes. */
function key(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/gu, '')
}

/**
 * Grade each of the first reader's flags by what the second reader saw there.
 *
 * All three readings are compared **against the transcription**, never against
 * each other: `Disagreement.at` indexes the *first argument's* word sequence,
 * so passing the transcription first both times is what makes the two sets of
 * places comparable. Compare the readers to each other instead and you get two
 * indices into two different sequences, which align nothing.
 *
 * The same fact decides the field names, and got them wrong first: in
 * `compareWitnesses(transcription, reader)` it is `first` that holds the
 * *transcription's* word and `second` that holds the reader's. Named from the
 * arguments rather than checked against them, `first` reads as "the first
 * reader" and is the opposite.
 *
 * **No confidence travels through here, deliberately.** `WitnessOptions`
 * carries a score per word of the first argument, and the scores that exist
 * belong to the OCR reader — a different sequence from the transcription that
 * `at` counts in. Putting one against the other would be a confident assertion
 * about the wrong number. The gate reads OCR confidence where the words are.
 */
export function gradeFlags(
  transcription: string,
  firstReader: string,
  secondReader: string | null
): GradedFlag[] {
  const flags = compareWitnesses(transcription, firstReader).disagreements.filter(
    (d) => d.kind === 'substantive'
  )
  if (secondReader === null || secondReader.trim() === '') {
    // No second reader: every flag keeps its place and none is graded. A
    // `contested` here would be a verdict invented out of an absence.
    return flags.map((d: Disagreement) => ({
      at: d.at,
      transcription: d.first,
      first: d.second,
      second: null,
      verdict: 'contested' as const
    }))
  }
  const secondAt = new Map<number, string>()
  for (const d of compareWitnesses(transcription, secondReader).disagreements) {
    if (d.kind === 'substantive') secondAt.set(d.at, d.second)
  }
  return flags.map((d: Disagreement) => {
    const other = secondAt.get(d.at)
    if (other === undefined) {
      // The second reader has no quarrel here, so it reads what the
      // transcription reads and the first reader is alone.
      return {
        at: d.at,
        transcription: d.first,
        first: d.second,
        second: null,
        verdict: 'dismissed' as const
      }
    }
    return {
      at: d.at,
      transcription: d.first,
      first: d.second,
      second: other,
      verdict: key(other) === key(d.second) ? ('corroborated' as const) : ('contested' as const)
    }
  })
}

/** Worst first: corroborated, then contested, then dismissed. */
const RANK: Record<Corroboration, number> = { corroborated: 0, contested: 1, dismissed: 2 }

/**
 * A leaf's flags in the order a person should meet them.
 *
 * Ordering only — nothing is dropped, and a `dismissed` flag is still on the
 * screen. What it buys is that the leaf's first row is the one most likely to
 * be a real fault rather than whichever the aligner happened to find first.
 */
export function worstFirst(flags: readonly GradedFlag[]): GradedFlag[] {
  return [...flags].sort((a, b) => RANK[a.verdict] - RANK[b.verdict] || a.at - b.at)
}

/** How a leaf's flags came out, for the line the gate puts above them. */
export function summarize(flags: readonly GradedFlag[]): Record<Corroboration, number> {
  const counts: Record<Corroboration, number> = { corroborated: 0, contested: 0, dismissed: 0 }
  for (const f of flags) counts[f.verdict] += 1
  return counts
}
