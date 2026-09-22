/**
 * Passages a book prints twice, and what they are worth where there are no
 * pixels.
 *
 * ## Why this exists
 *
 * The sense pass ends at `crops` — a finding becomes an edit only after a
 * reader **with the leaf** has said what the paper says, shown the crop before
 * the hypothesis. On a photographed book that works, because the leaf is a
 * second witness that never read the transcription.
 *
 * On a born-digital PDF it is theatre. Rendering such a leaf draws the **text
 * layer again**, so the adjudicator is handed back the exact characters the
 * finding was raised on and asked whether they are what the page says. It will
 * say yes, every time, and the pass will report a book adjudicated against
 * itself. That is worse than no adjudication: it manufactures confidence.
 *
 * What a book of that kind does have is **the places where it prints the same
 * words twice**. _Patterns_ Vol. I is a training manual and sets its example
 * sentences out repeatedly; measured over the finished volume, 1,535 blocks
 * gave **22 near-duplicate passages**, of which **6 point the same words two
 * different ways**. One of those pairs is p7b8 against p100b12, and it is the
 * argument for the whole module:
 *
 * | | `Structure` | `representation` |
 * | --- | --- | --- |
 * | p7b8 | clean | `representation'` — damaged |
 * | p100b12 | `Structure'` — damaged | clean |
 *
 * Each copy is the other's witness, and neither needed a photograph. That is a
 * real second reading: the two passages were converted independently, a
 * hundred leaves apart, and they disagree.
 *
 * ## The other witness, and why this is not it
 *
 * `@core/witness` is the neighbouring idea and the stronger one: a book
 * digitised **twice by different people** — archive.org's OCR, a Gutenberg
 * volunteer — carries readings that share no blind spots at all. Where such a
 * second digitisation exists it beats this, and on a born-digital PDF it is
 * the nearest thing to a crop that will ever be available. This module is what
 * a volume can say about *itself* when no second digitisation is to be had,
 * which for a 1975 typescript is the usual case.
 *
 * The two are siblings and neither replaces the other: one compares the book
 * with somebody else's reading of it, and one compares the book with itself.
 * They are named apart on purpose — two things called `witness` is how a tool
 * stops being one tool.
 *
 * ## What a parallel is and is not
 *
 * **A repeated passage is not a fault.** This book repeats its examples on
 * purpose, and a check that reported all 22 would be reporting the book's own
 * method. What is a fault is a **pointing difference** — the same word set two
 * ways — because a compositor setting the same sentence twice does not move a
 * comma into an apostrophe. Words present in one copy and not the other are
 * reported separately and are usually the author's own revision.
 *
 * **And a parallel raises a finding's authority; it never lowers it.** A
 * stray apostrophe found by `checkDamage` is `shape` on its own evidence. With
 * a parallel passage printing the same sentence pointed correctly, the book
 * has settled it and it is `attested` — the same promotion `draft/hyphens.ts`
 * makes when the volume sets a word whole elsewhere. A finding with no
 * parallel keeps exactly the standing it had.
 *
 * Pure: no DOM, no I/O, no network.
 */
import type { BookBlock, BookDocument } from '@core/assemble'

export interface PointingDifference {
  /** The word as this copy sets it. */
  here: string
  /** The same word as the other copy sets it. */
  there: string
}

export interface ParallelPair {
  /** The earlier block. */
  here: string
  /** The later one. */
  there: string
  /** Word-level agreement, 1 when the two copies use the same words. */
  similarity: number
  /**
   * The same word pointed two ways. **This is the finding.**
   *
   * A compositor setting one sentence twice does not turn a comma into an
   * apostrophe; a conversion does.
   */
  pointing: PointingDifference[]
  /** Words in one copy and not the other. Usually the author revising. */
  wording: PointingDifference[]
}

/**
 * Words in a shingle.
 *
 * Eight. Long enough that ordinary English does not repeat one by chance —
 * measured over a finished volume, 66,562 shingles across 1,535 blocks gave
 * 180 candidate pairs, which is a list a person could read — and short enough
 * that a passage revised in two places still shares several.
 */
const SHINGLE = 8

/**
 * How many blocks may share one shingle before it is boilerplate.
 *
 * A running formula the book repeats twenty times ("the Deep Structure can be
 * represented as") is not evidence that any two of those blocks are the same
 * passage. Past this, the shingle says nothing and pairing on it would make
 * every occurrence a candidate against every other — quadratic, and noise.
 */
const SHINGLE_SPREAD = 4

/** How many shingles two blocks must share before they are worth diffing. */
const SHARED_SHINGLES = 3

/** Below this, two blocks are different passages that happen to overlap. */
const MIN_SIMILARITY = 0.85

/** Too short for a repeat to mean anything. */
const MIN_WORDS = 12

/** A block's text with markup out of the way. */
function plain(block: BookBlock): string {
  return block.text.replace(/<[^>]*>/gu, '')
}

/** The words, stripped to letters and digits — what "the same passage" means. */
function bareWords(text: string): string[] {
  return text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

/** The words as the book sets them, punctuation and all — what a fault moves. */
function setWords(text: string): string[] {
  return text.split(/\s+/u).filter((w) => w.length > 0)
}

/** The same word, however it is pointed. */
function samePointing(a: string, b: string): boolean {
  const bare = (s: string) => s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  return bare(a) === bare(b) && bare(a).length > 0
}

/**
 * The longest common subsequence of two word lists, as aligned runs.
 *
 * Plain dynamic programming. The blocks that reach here are a hundred and
 * fifty words at the outside and there are a couple of hundred pairs, so the
 * table is small and the clarity is worth more than the cleverness.
 */
function align(a: readonly string[], b: readonly string[]): boolean[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  const kept: boolean[][] = [[], []]
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      kept[0]![i] = true
      kept[1]![j] = true
      i++
      j++
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++
    else j++
  }
  return kept
}

/** How much of the two word lists the alignment kept. */
function ratio(a: readonly string[], b: readonly string[]): number {
  const kept = align(a, b)
  const matched = kept[0]!.filter(Boolean).length
  return (2 * matched) / (a.length + b.length)
}

/**
 * The runs the alignment did not keep, paired off in order.
 *
 * Two unmatched runs facing each other are the same stretch set two ways; an
 * unmatched run facing nothing is text one copy has and the other does not.
 */
function differences(
  a: readonly string[],
  b: readonly string[]
): { here: string; there: string }[] {
  const kept = align(a, b)
  const out: { here: string; there: string }[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && kept[0]![i] && j < b.length && kept[1]![j]) {
      i++
      j++
      continue
    }
    const fromI = i
    const fromJ = j
    while (i < a.length && !kept[0]![i]) i++
    while (j < b.length && !kept[1]![j]) j++
    if (i === fromI && j === fromJ) {
      // Neither side advanced: one is exhausted or out of step. Step the one
      // that can move, or the loop never ends.
      if (i < a.length) i++
      else j++
      continue
    }
    out.push({ here: a.slice(fromI, i).join(' '), there: b.slice(fromJ, j).join(' ') })
  }
  return out
}

/**
 * Every passage the book prints twice, and where the two copies disagree.
 *
 * Free and deterministic. Candidates are found by shingling rather than by
 * comparing every block with every other, which on a real volume is 180 pairs
 * out of 1,177,345 and runs in a fifth of a second.
 *
 * **The diff that matters is on the words as the book sets them, not on the
 * words.** Measured: a diff over letters and digits reports p7b8 and p100b12
 * as differing in four places, none of them the fault — `representation'`
 * against `representation,` is the *same word* once the punctuation is
 * stripped, and the punctuation is the whole of what went wrong.
 */
export function findParallels(doc: BookDocument): ParallelPair[] {
  const blocks = [...doc.blocks, ...doc.sections.flatMap((s) => s.blocks)]
  const order = new Map(blocks.map((b, i) => [b.id, i]))
  const bare = new Map<string, string[]>()
  const set = new Map<string, string[]>()
  const buckets = new Map<string, string[]>()

  for (const block of blocks) {
    const text = plain(block)
    const words = bareWords(text)
    bare.set(block.id, words)
    set.set(block.id, setWords(text))
    for (let i = 0; i + SHINGLE <= words.length; i++) {
      const key = words.slice(i, i + SHINGLE).join(' ')
      const seen = buckets.get(key)
      if (seen === undefined) buckets.set(key, [block.id])
      else if (!seen.includes(block.id)) seen.push(block.id)
    }
  }

  const shared = new Map<string, number>()
  for (const ids of buckets.values()) {
    if (ids.length < 2 || ids.length > SHINGLE_SPREAD) continue
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const pair = [ids[i]!, ids[j]!].sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0))
        const key = `${pair[0]}\u0000${pair[1]}`
        shared.set(key, (shared.get(key) ?? 0) + 1)
      }
    }
  }

  const found: ParallelPair[] = []
  for (const [key, count] of shared) {
    if (count < SHARED_SHINGLES) continue
    const [here, there] = key.split('\u0000') as [string, string]
    const a = bare.get(here)!
    const b = bare.get(there)!
    if (a.length < MIN_WORDS || b.length < MIN_WORDS) continue
    const similarity = ratio(a, b)
    if (similarity < MIN_SIMILARITY) continue

    const pointing: PointingDifference[] = []
    const wording: PointingDifference[] = []
    for (const d of differences(set.get(here)!, set.get(there)!)) {
      if (d.here.length === 0 || d.there.length === 0) wording.push(d)
      else if (samePointing(d.here, d.there)) pointing.push(d)
      else wording.push(d)
    }
    if (pointing.length === 0 && wording.length === 0) continue
    found.push({ here, there, similarity, pointing, wording })
  }
  return found.sort(
    (x, y) => (order.get(x.here) ?? 0) - (order.get(y.here) ?? 0) || x.there.localeCompare(y.there)
  )
}

/**
 * What a reader is handed in place of a crop, on a book that has no pixels.
 *
 * A **concordance** in the old sense: every other place the book says this.
 * Named that way because the two nearer words were both taken — `Evidence` is
 * what the wizard shows beside a question, and `witness` is somebody else's
 * digitisation — and a name reused is a tool that has stopped being one tool.
 *
 * Three things, and **not the hypothesis** — the strip `crops` performs is the
 * point of that verb and is the point of this one. Shown a proposed reading a
 * model confirms; shown the evidence it reads.
 *
 * - **The block, and the ones either side.** CLAUDE.md's own measurement: four
 *   findings on one chapter of _Uncommon Therapy_ went to the editor as
 *   undeterminable and three answered themselves once the paragraph was in
 *   view.
 * - **Every passage the book prints in nearly the same words**, with the
 *   differences named. This is the only thing here that is genuinely a second
 *   witness, because the two copies were converted independently.
 * - **Nothing else.** No `why`, no `expected`.
 */
export interface Concordance {
  blockId: string
  quote: string
  /** The block the quote sits in, and its neighbours in reading order. */
  before: string | null
  block: string
  after: string | null
  /** Passages elsewhere in the book that print nearly these words. */
  parallels: { blockId: string; text: string; differences: PointingDifference[] }[]
}

/**
 * Build the evidence for a list of places, from the book alone.
 *
 * `places` carries only a block id and the words at issue, which is all a
 * finding may contribute here: passing the whole finding would invite the
 * hypothesis into the manifest, and that is the one thing that must not
 * travel.
 */
export function concordanceFor(
  places: readonly { blockId: string; quote: string }[],
  doc: BookDocument,
  parallels: readonly ParallelPair[] = findParallels(doc)
): Concordance[] {
  const blocks = [...doc.blocks, ...doc.sections.flatMap((s) => s.blocks)]
  const at = new Map(blocks.map((b, i) => [b.id, i]))
  const text = new Map(blocks.map((b) => [b.id, plain(b)]))

  const beside = new Map<string, { blockId: string; differences: PointingDifference[] }[]>()
  for (const p of parallels) {
    const both = [...p.pointing, ...p.wording]
    const forHere = beside.get(p.here) ?? []
    forHere.push({ blockId: p.there, differences: both })
    beside.set(p.here, forHere)
    const forThere = beside.get(p.there) ?? []
    forThere.push({
      blockId: p.here,
      differences: both.map((d) => ({ here: d.there, there: d.here }))
    })
    beside.set(p.there, forThere)
  }

  return places.map((place) => {
    const index = at.get(place.blockId)
    return {
      blockId: place.blockId,
      quote: place.quote,
      before: index === undefined || index === 0 ? null : plain(blocks[index - 1]!),
      block: text.get(place.blockId) ?? '',
      after: index === undefined || index + 1 >= blocks.length ? null : plain(blocks[index + 1]!),
      parallels: (beside.get(place.blockId) ?? []).map((p) => ({
        blockId: p.blockId,
        text: text.get(p.blockId) ?? '',
        differences: p.differences
      }))
    }
  })
}
