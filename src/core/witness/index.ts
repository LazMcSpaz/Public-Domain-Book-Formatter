/**
 * Two independent readings of the same page, and the places they disagree.
 *
 * OCR's whole value here has always been that it is *not* a language model, so
 * it has no shared blind spots with whatever else read the page. That argument
 * does not stop at one engine. A book scanned by archive.org carries a second
 * OCR of the same leaves, done by a different engine in a different decade —
 * and where two such readers independently produce the same words, that is
 * evidence of a kind neither could give alone.
 *
 * Measured on this book's leaf 6: 223 words from Tesseract, 217 from the
 * archive's OCR, **197 agreeing**. Of the fourteen disagreements, eight were
 * line-break hyphens, two were words run together, one was a speck — all
 * mechanical and resolvable without looking at anything. **Three needed a
 * person**, and every one of the three was later confirmed by a human-proofread
 * text: the two readers disagreed exactly where the leaf was worth reading.
 *
 * ## What this is not
 *
 * It is not a way to skip the pixels. Agreement between two OCR engines is
 * strong evidence and not proof: both read ink, and a glyph worn the same way
 * for both can be misread the same way by both. What this does is turn "check
 * every word of every leaf against the scan" into "check the places two
 * readers could not agree on" — a list an order of magnitude shorter, with the
 * hardest cases at the top of it.
 *
 * The propose/accept rule is untouched. Nothing here proposes a reading:
 * every word in both columns was read off ink by a machine, and a
 * disagreement is a *place to look*, never a text to adopt.
 *
 * Pure: no DOM, no I/O, no network.
 */

/** What kind of disagreement two readers had. */
export type DisagreementKind =
  /**
   * The same words, differently broken — a line-break hyphen one reader healed
   * and the other did not, or two words run together.
   *
   * Mechanical, and resolvable without looking at anything: the two readings
   * are the same letters. Nearly always the majority.
   */
  | 'joined'
  /** Different letters. One of them is wrong, and the paper says which. */
  | 'substantive'

export interface Disagreement {
  kind: DisagreementKind
  /** What the first reader read. Empty when it read nothing there. */
  first: string
  /** What the second read. */
  second: string
  /** Where in the first reader's word sequence this falls, for finding the pixels. */
  at: number
  /**
   * The first reader's own lowest confidence across this span, when it gave
   * one — 0–100, a real engine probability (SPEC §4).
   *
   * This is what marks the worst rows, and it replaced a heuristic that tried
   * to judge whether a token *looked* like a word. That heuristic did not
   * survive the data it was built from: on the leaf that motivated it, the
   * archive's OCR produced `acquaintaivct`, `iot` and `vfai`, and a
   * vowel-and-cluster test called all three word-shaped. It could not tell
   * garbage from `akasha`, which is the only job it had.
   *
   * Confidence can. Where two readers disagree *and* the one with pixels was
   * unsure, that is the top of the list.
   */
  confidence: number | null
}

export interface WitnessReport {
  words: number
  agreeing: number
  /** Agreement as a share of the first reader's words. */
  agreement: number
  disagreements: Disagreement[]
  /** How many actually need a person — everything that is not `joined`. */
  needEyes: number
}

/** The first reader's per-word confidences, where it kept them. */
export interface WitnessOptions {
  /** 0–100 per word of `first`, in the same order. */
  confidence?: readonly number[]
}

/**
 * Letters and digits only, lower-cased.
 *
 * Punctuation is excluded because the two engines punctuate differently as a
 * matter of course and a comma-versus-full-stop argument between them is noise
 * — that particular fault is caught by reading the leaf, not by this.
 */
function normalise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, ' ')
    .split(/\s+/u)
    .filter((w) => w.length > 0)
}

/** Whether a run of words is the same letters as another, differently spaced. */
function sameLetters(a: readonly string[], b: readonly string[]): boolean {
  return a.join('') === b.join('')
}

/**
 * The longest common subsequence of two word lists, as matching runs.
 *
 * Hand-rolled rather than pulled in, because core takes no dependencies and
 * this is the one place it needs a diff. Classic dynamic programming, quadratic
 * in the page — a leaf is a few hundred words, so that is nothing.
 */
function matchingRuns(a: readonly string[], b: readonly string[]): [number, number][] {
  const rows = a.length + 1
  const cols = b.length + 1
  const table = new Uint32Array(rows * cols)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + j + 1]! + 1
          : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!)
    }
  }
  const pairs: [number, number][] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) {
      i++
    } else {
      j++
    }
  }
  return pairs
}

/**
 * Compare two readings of one leaf.
 *
 * `first` is the reading whose word positions the report is indexed by — the
 * one with boxes behind it, so that a disagreement can be turned into a crop.
 */
export function compareWitnesses(
  first: string,
  second: string,
  options: WitnessOptions = {}
): WitnessReport {
  const a = normalise(first)
  const b = normalise(second)
  const pairs = matchingRuns(a, b)

  const disagreements: Disagreement[] = []
  let ai = 0
  let bi = 0
  const emit = (toA: number, toB: number): void => {
    const gapA = a.slice(ai, toA)
    const gapB = b.slice(bi, toB)
    if (gapA.length === 0 && gapB.length === 0) return
    const kind: DisagreementKind = sameLetters(gapA, gapB) ? 'joined' : 'substantive'
    const scores = (options.confidence ?? []).slice(ai, Math.max(toA, ai + 1))
    disagreements.push({
      kind,
      first: gapA.join(' '),
      second: gapB.join(' '),
      at: ai,
      confidence: scores.length > 0 ? Math.min(...scores) : null
    })
  }

  for (const [pa, pb] of pairs) {
    emit(pa, pb)
    ai = pa + 1
    bi = pb + 1
  }
  emit(a.length, b.length)

  return {
    words: a.length,
    agreeing: pairs.length,
    agreement: a.length === 0 ? 0 : pairs.length / a.length,
    disagreements,
    needEyes: disagreements.filter((d) => d.kind !== 'joined').length
  }
}

/**
 * Heal what the disagreement itself settles.
 *
 * A `joined` disagreement is the same letters broken two ways, so whichever
 * reader ran them together has resolved the other's line-break hyphen. Applied
 * to the first reader's text, this is free hyphen healing with a second
 * witness behind every join — better evidence than the hyphenation rules the
 * assembler has to guess with, because a reader actually looked at the ink.
 *
 * Returns the tokens to substitute, keyed by position in the first reading.
 * Deliberately not applied here: this module reports, and something else
 * decides.
 */
export function joinsSettled(report: WitnessReport): { at: number; was: string; joined: string }[] {
  return report.disagreements
    .filter((d) => d.kind === 'joined' && d.first !== d.second)
    .map((d) => ({ at: d.at, was: d.first, joined: d.second }))
}
