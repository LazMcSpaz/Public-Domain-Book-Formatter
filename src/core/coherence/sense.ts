/**
 * Reading the book for sense, and the rule that keeps it honest.
 *
 * The deterministic checks in `consistency.ts` find places where the book
 * contradicts itself. They cannot find `a fate that could move mountains` — two
 * real words either side of one wrong one, both scanning, both what OCR saw.
 * Nothing mechanical will ever catch that. Only meaning will.
 *
 * So there is a pass that reads the assembled prose and says *"this does not
 * cohere, and I would expect X"*. That is a **finding**, and this module exists
 * to make sure it stays one.
 *
 * ## The whole safeguard, in one sentence
 *
 * `settle()` builds the correction from the **verdict** — what a reader with the
 * crop said the paper says — and never from `expected`, the hypothesis. The
 * hypothesis is carried through so a person can see what was guessed and so the
 * ledger can score the guessing; it is never the source of a single character
 * that reaches the book.
 *
 * That is CLAUDE.md's **a model may propose a reading; only pixels may accept
 * one**, expressed as code rather than as an instruction, because an
 * instruction is a thing a tired session skips.
 *
 * ## Why the adjudicator must not see the hypothesis
 *
 * Shown a crop and a proposed reading, a model confirms. Shown a crop alone, it
 * reads. The difference is invisible in the output and total in what it is
 * worth, which is why `Verdict` has no field for the hypothesis and the crop
 * manifest the driver writes does not carry one.
 *
 * Pure: no DOM, no I/O, no network.
 */
import { findAnchor } from '@core/annotate'

/**
 * What kind of incoherence was noticed.
 *
 * A closed list, and short on purpose. Every kind here is a claim that the text
 * does not work *as text* — a sentence with no verb, a pronoun with nothing to
 * refer to, a figure contradicting one elsewhere. None of them is a claim about
 * taste.
 *
 * There is deliberately no `style`, no `punctuation`, no `spelling` and no
 * `archaism`. The 1916 prose is the deliverable, not a draft to improve, and
 * the book's own spelling and pointing are promised to the reader untouched. A
 * finding that cannot be put in one of these boxes is not a finding.
 */
export type SenseKind =
  | 'nonsense'
  | 'contradiction'
  | 'broken-grammar'
  | 'lost-negation'
  | 'dangling-reference'
  | 'name-inconsistent'
  | 'figure-inconsistent'
  | 'doubled'

export const SENSE_KINDS: readonly SenseKind[] = [
  'nonsense',
  'contradiction',
  'broken-grammar',
  'lost-negation',
  'dangling-reference',
  'name-inconsistent',
  'figure-inconsistent',
  'doubled'
]

/** What a reader **without** pixels is allowed to emit. */
export interface SenseFinding {
  /** The assembled block it sits in. */
  blockId: string
  /**
   * The exact words at issue, quoted from the block.
   *
   * A quotation and not an offset, for the reason the notes pass quotes too: a
   * character offset is a number nobody can check and one that goes stale the
   * moment a correction changes the text by a letter. A quote either is in the
   * block or is not, and `findAnchor` decides which.
   */
  quote: string
  kind: SenseKind
  /** Why it does not cohere. The argument, not the fix. */
  why: string
  /**
   * What the reader would expect instead — **a hypothesis, and nothing more**.
   *
   * Never reaches the book. It exists so a person can see what was guessed, and
   * so the ledger can say how often the guessing was right, which is worth
   * knowing and is not evidence.
   */
  expected: string
}

/** A finding with its place in the block resolved, or refused. */
export interface LocatedFinding extends SenseFinding {
  /** Where the quote sits in the block, or null when it is not there at all. */
  at: number | null
}

/**
 * What a reader **with** the crop returns.
 *
 * No field for the hypothesis, because it was never shown one. No field for
 * "was the finding right" either: that is a comparison, and comparisons are
 * arithmetic rather than opinion — `settle` does it.
 */
export interface Verdict {
  blockId: string
  /** The same span, echoed back so a verdict cannot drift onto another finding. */
  quote: string
  /** What the paper says, read off the crop. */
  reads: string
  /** False when the crop cannot be read — damage, a fold, a bad render. */
  legible: boolean
}

export type Outcome =
  /** The crop could not be read; the finding stands unresolved. */
  | 'unreadable'
  /** The paper says what the book already says. No change; the finding was a false alarm or the author's own oddity. */
  | 'as-printed'
  /** The paper says something else. This is a correction, and its text is the verdict's. */
  | 'corrected'

export interface SettledFinding {
  finding: SenseFinding
  verdict: Verdict | null
  outcome: Outcome
  /**
   * The text to put in the book, or null when nothing changes.
   *
   * **Always the verdict's reading.** Never `finding.expected`. This is the one
   * line in the module that matters.
   */
  correction: string | null
  /**
   * Whether the hypothesis happened to match what the paper said.
   *
   * Recorded for the ledger and load-bearing for nothing. A pass whose guesses
   * are usually right is a pass worth keeping; a pass whose guesses are usually
   * wrong but which points at the right places is *also* worth keeping, and
   * conflating the two is how a useful check gets switched off.
   */
  hypothesisAgreed: boolean
}

/**
 * Whether two readings are the same reading.
 *
 * Whitespace is collapsed, because a quotation that crossed a line break is the
 * same quotation. Quote marks are levelled, because the book may or may not
 * have been through `withTypographicQuotes` by the time a crop is read and a
 * curly mark against a straight one is not a correction.
 *
 * **Case is not levelled.** `KNOWER` against `Knower` is a real difference on
 * the page — this book sets whole words in capitals for emphasis — and treating
 * it as no difference would swallow the correction silently, which is the one
 * outcome worse than a false alarm.
 */
function same(a: string, b: string): boolean {
  const tidy = (s: string) =>
    s.replace(/\s+/gu, ' ').replace(/[“”]/gu, '"').replace(/[‘’]/gu, "'").trim()
  return tidy(a) === tidy(b)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * Read one finding, refusing anything that is not one.
 *
 * Throws rather than returning a partial, for the same reason
 * `migrateSavedRun` throws: a half-understood finding looks like a finding and
 * would be worked through by a person who had no way to know it was junk.
 */
export function parseSenseFinding(raw: unknown, index: number): SenseFinding {
  const where = `Finding ${index + 1}`
  if (!isRecord(raw)) throw new Error(`${where}: not an object`)

  const blockId = text(raw['blockId'])
  if (!blockId) throw new Error(`${where}: no blockId`)

  const quote = text(raw['quote'])
  if (!quote) throw new Error(`${where}: no quote — a finding must say which words`)

  const kind = text(raw['kind']) as SenseKind
  if (!SENSE_KINDS.includes(kind)) {
    // Named rather than silently dropped, because the kind most likely to
    // arrive is `style`, and a reader who tried to file one should be told the
    // pass does not take them rather than left thinking it was accepted.
    throw new Error(
      `${where}: "${kind || '(none)'}" is not a kind this pass takes. ` +
        `One of ${SENSE_KINDS.join(', ')}. Style, spelling and punctuation are the book's own.`
    )
  }

  const why = text(raw['why'])
  if (!why) throw new Error(`${where}: no reason given`)

  return { blockId, quote, kind, why, expected: text(raw['expected']) }
}

/**
 * Locate every finding in the blocks it names.
 *
 * A quote that is not in its block comes back with `at: null` — unplaced rather
 * than attached at a guess, exactly as an unfindable note anchor does. That
 * happens when a reader paraphrases instead of quoting, and a paraphrase cannot
 * be cropped, so it cannot be adjudicated, so it must not be acted on.
 */
export function locateFindings(
  findings: readonly SenseFinding[],
  blocks: ReadonlyMap<string, string>
): LocatedFinding[] {
  return findings.map((finding) => ({
    ...finding,
    at: findAnchor(blocks.get(finding.blockId) ?? '', finding.quote)
  }))
}

export function parseVerdict(raw: unknown, index: number): Verdict {
  const where = `Verdict ${index + 1}`
  if (!isRecord(raw)) throw new Error(`${where}: not an object`)
  const blockId = text(raw['blockId'])
  const quote = text(raw['quote'])
  if (!blockId || !quote) throw new Error(`${where}: must name the block and the span`)
  const legible = raw['legible'] !== false
  const reads = text(raw['reads'])
  if (legible && !reads) throw new Error(`${where}: legible but says nothing`)
  return { blockId, quote, reads, legible }
}

/**
 * Put a finding together with the reading of its crop.
 *
 * The correction is the **verdict's** text. `expected` is compared to it and
 * then set aside. If this function is ever changed so that a hypothesis can
 * reach `correction`, the pass has become the thing CLAUDE.md forbids.
 */
export function settle(finding: SenseFinding, verdict: Verdict | null): SettledFinding {
  if (!verdict || !verdict.legible) {
    return { finding, verdict, outcome: 'unreadable', correction: null, hypothesisAgreed: false }
  }
  const agreed = finding.expected.length > 0 && same(verdict.reads, finding.expected)
  if (same(verdict.reads, finding.quote)) {
    return {
      finding,
      verdict,
      outcome: 'as-printed',
      correction: null,
      hypothesisAgreed: agreed
    }
  }
  return {
    finding,
    verdict,
    outcome: 'corrected',
    correction: verdict.reads,
    hypothesisAgreed: agreed
  }
}

/**
 * Match verdicts to findings and settle every one.
 *
 * Paired on the block *and* the quoted span, never on array position: a
 * verdict list that came back short or in another order would otherwise settle
 * each finding against its neighbour's reading, which is the kind of fault that
 * produces a plausible correction in the wrong place.
 */
export function settleAll(
  findings: readonly SenseFinding[],
  verdicts: readonly Verdict[]
): SettledFinding[] {
  const byKey = new Map(verdicts.map((v) => [`${v.blockId} ${v.quote.trim()}`, v]))
  return findings.map((finding) =>
    settle(finding, byKey.get(`${finding.blockId} ${finding.quote.trim()}`) ?? null)
  )
}

export interface SenseLedger {
  raised: number
  /** Findings whose quote was not in the block they named. */
  unplaced: number
  unreadable: number
  asPrinted: number
  corrected: number
  /** Of the corrections, how many the hypothesis had guessed right. */
  hypothesisAgreed: number
  /**
   * Corrections over findings raised.
   *
   * The number that decides whether this pass keeps its place. Null until
   * something has actually been adjudicated, because a rate over nothing reads
   * as a verdict and is not one.
   */
  precision: number | null
}

/**
 * Score the pass.
 *
 * A check nobody can score is worse than no check, because it manufactures
 * confidence. If sixty findings in a hundred survive the pixels this is earning
 * its place; if fifteen do it is noise and should be tightened or dropped.
 *
 * `as-printed` is **not** a failure and is counted apart. On the first book here
 * a repeated phrase was flagged, cropped, and turned out to be the author's own
 * rhetoric — a true detection with nothing to change. Folding those in with the
 * misses would argue for loosening a check that was working.
 */
export function scoreSense(settled: readonly SettledFinding[], unplaced = 0): SenseLedger {
  // `settled` must not contain the unplaced ones. They were never cropped, so
  // they were never adjudicated, and counting them here as well as in
  // `unplaced` inflates `raised` — three raised where two were written. Not the
  // same thing as `unreadable` either: that is a crop that existed and could
  // not be read, and the two want different work from a person.
  const corrected = settled.filter((s) => s.outcome === 'corrected')
  const judged = settled.filter((s) => s.outcome !== 'unreadable').length
  return {
    raised: settled.length + unplaced,
    unplaced,
    unreadable: settled.filter((s) => s.outcome === 'unreadable').length,
    asPrinted: settled.filter((s) => s.outcome === 'as-printed').length,
    corrected: corrected.length,
    hypothesisAgreed: corrected.filter((s) => s.hypothesisAgreed).length,
    precision: judged === 0 ? null : corrected.length / judged
  }
}
