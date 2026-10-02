/**
 * Lines the paper prints that the book does not, and lines it prints in a
 * different place.
 *
 * Every check in `@core/coherence` reads the book against itself, and a book
 * read against itself cannot notice what is not there. A reader who drops two
 * lines at the foot of a leaf, or sets the leaf's last line at the end of its
 * first paragraph, leaves a text that is internally sound: every sentence is
 * the book's, every word is spelled as the book spells it. Only a second
 * reading of the same paper can show it, and a scan with an OCR layer carries
 * one for nothing — somebody else's reading, by a different engine, of every
 * line on the leaf.
 *
 * So this walks that layer **a printed line at a time** and asks two things:
 *
 * - **missing**: does the book carry this line at all? A line is looked for
 *   as three-word shingles among the blocks of its own leaf and the leaves
 *   either side — a paragraph joined across a seam belongs to both — and a
 *   run of lines almost none of whose shingles appear is a run the book
 *   lacks.
 * - **moved**: does the book carry it where the paper does? Each line found
 *   is placed at the median position of its shingles, and a line placed far
 *   *behind* the line before it was set somewhere earlier than the paper
 *   prints it. _Persuasion Engineering_ leaf 15 is the case it was measured
 *   on: the leaf's last line ("to triple your income. Which means you need
 *   to prospect 300") had been set at the end of the leaf's first paragraph,
 *   265 words back, and every other check was content. _The Structure of
 *   Magic_ Vol. I leaf 123 had two runs of lines swapped inside a paragraph.
 *
 * ## Why lines, and why these thresholds
 *
 * The layer is somebody's OCR, so most of what it disagrees with the book
 * about is its own damage. Measured on five NLP books before any number was
 * set, a word-level alignment of the whole leaf reported hundreds of "missing"
 * runs and found nothing real: the layer's garbage, diagram labels, columns
 * read across, and furniture. A printed line is the unit the layer keeps
 * coherent even across columns, and three filters took the five books to a
 * handful of findings, each a real fault or plainly furniture:
 *
 * - a line is judged only when **85%** of its words are words the book sets
 *   somewhere, which is what tells a line of text from a line of junk — the
 *   layer's garbling (`vou`, `matena`, `trrunlng`) is set nowhere at all;
 * - a line set on **three or more leaves** is a running head and is skipped;
 * - a leaf with no block in the book was left out of it on purpose (a cover,
 *   an old contents page, an advertisement) and is skipped whole.
 *
 * A line is missing when fewer than a quarter of its shingles are found, and
 * a run is reported at two lines, or one of twelve words or more. A line is
 * moved when it lands more than **80 words** behind the line before it.
 *
 * Nothing here proposes text. A finding names the leaf and the paper's line;
 * the leaf decides, and the book is corrected from the pixels, not from the
 * layer.
 *
 * Pure: no DOM, no I/O.
 */
import type { BookDocument } from '@core/assemble'

/** One leaf of a second reading, as the lines it prints, in its order. */
export interface LayerLeaf {
  page: number
  lines: string[]
}

export type CoverageKind = 'missing' | 'moved'

export interface CoverageFinding {
  kind: CoverageKind
  page: number
  /** The paper's lines, as the layer read them. */
  lines: string[]
  /** The block the book sets the line in, for a moved line. */
  blockId?: string
  against: string
}

/** Share of a line's words the book must set somewhere for the line to be judged. */
const KNOWN_SHARE = 0.85
/** Below this share of shingles found, a line is not in the book. */
const FOUND_BELOW = 0.25
/** Shortest line judged, in words. */
const MIN_WORDS = 5
/** A single missing line is reported only at this length. */
const LONE_LINE_WORDS = 12
/** A line found this many words behind the one before it was set elsewhere. */
const MOVED_BACK = 80
/** A line set on this many leaves is furniture. */
const FURNITURE_LEAVES = 3

const words = (text: string): string[] =>
  text
    .replace(/<[^>]*>/gu, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean)

/** A line-end hyphen joins its word onto the first word of the next line. */
function joinHyphens(lines: readonly string[]): string[] {
  const out = [...lines]
  for (let i = 0; i + 1 < out.length; i++) {
    if (!/\p{L}-\s*$/u.test(out[i]!)) continue
    const next = /^\s*(\S+)/u.exec(out[i + 1]!)
    if (!next) continue
    out[i] = out[i]!.replace(/-\s*$/u, '') + next[1]
    out[i + 1] = out[i + 1]!.replace(/^\s*\S+/u, '')
  }
  return out
}

/** Letters and digits only, spaces and all else gone: `i n t h e` and `inthe` read alike. */
const letters = (text: string): string => words(text).join('')

/** Letters per shingle: long enough to be one place, short enough to survive a slip. */
const LETTER_SHINGLE = 12

/** A running head carries the page's folio, so it is compared without its figures. */
const furnitureKey = (line: string): string =>
  words(line)
    .filter((w) => !/^\d+$/u.test(w))
    .join(' ')

/** An index entry: words and then the pages, `circle of excellence exercise, 27, 160-161`. */
const INDEX_LINE = /[\p{L})],\s*\d+(?:[-–]\d+)?(?:,\s*\d+(?:[-–]\d+)?)*\.?\s*$/u

/** Shingles of a sequence, each with where it starts; two positions are enough to know it repeats. */
function shingled<T>(items: readonly T[], size: number, key: (from: number) => string) {
  const at = new Map<string, number[]>()
  for (let i = 0; i + size <= items.length; i++) {
    const k = key(i)
    const list = at.get(k)
    if (!list) at.set(k, [i])
    else if (list.length < 2) list.push(i)
  }
  return at
}

export function checkCoverage(doc: BookDocument, layer: readonly LayerLeaf[]): CoverageFinding[] {
  const vocabulary = new Map<string, number>()
  for (const block of doc.blocks) {
    for (const w of words(block.text)) vocabulary.set(w, (vocabulary.get(w) ?? 0) + 1)
  }
  const onLeaves = new Map<string, Set<number>>()
  for (const leaf of layer) {
    for (const line of leaf.lines) {
      const key = furnitureKey(line)
      if (!key) continue
      const set = onLeaves.get(key) ?? new Set<number>()
      set.add(leaf.page)
      onLeaves.set(key, set)
    }
  }
  const inBook = new Set(doc.blocks.flatMap((b) => b.sourcePages))

  const findings: CoverageFinding[] = []
  for (const leaf of layer) {
    if (!inBook.has(leaf.page)) continue
    const near = doc.blocks.filter((b) => b.sourcePages.some((p) => Math.abs(p - leaf.page) <= 1))
    const notes = doc.footnotes.filter((n) => Math.abs(n.pageIndex - leaf.page) <= 1)
    // The window twice over: as words, remembering which block each is from,
    // and as one run of letters. Words survive a letter misread; letters
    // survive a word the layer spaced out (`i n t h e`). A line is lost only
    // when neither can find it.
    const ours: string[] = []
    const owner: string[] = []
    let ourLetters = ''
    for (const unit of [...near, ...notes]) {
      for (const w of words(unit.text)) {
        ours.push(w)
        owner.push(unit.id)
      }
      ourLetters += letters(unit.text)
    }
    const wordShingles = shingled(ours, 3, (i) => `${ours[i]} ${ours[i + 1]} ${ours[i + 2]}`)
    const letterShingles = new Set<string>()
    for (let i = 0; i + LETTER_SHINGLE <= ourLetters.length; i++) {
      letterShingles.add(ourLetters.slice(i, i + LETTER_SHINGLE))
    }
    // A table's cells are read across by an OCR layer, so its lines come back
    // in an order no shingle of the book's can match. Their words are the
    // cells' own, which is how they are told from a line the book has lost.
    const rows = near.filter((b) => b.kind === 'table' || / \| /u.test(b.text))
    const cellWords = new Set(rows.flatMap((b) => words(b.text)))
    const rowish = new Set(rows.map((b) => b.id))

    let run: string[] = []
    let runWords = 0
    const flush = (): void => {
      if (run.length >= 2 || (run.length === 1 && runWords >= LONE_LINE_WORDS)) {
        findings.push({
          kind: 'missing',
          page: leaf.page,
          lines: run,
          against: `${run.length === 1 ? 'a line' : `${run.length} lines`} the paper prints that the book does not carry on this leaf or either side of it`
        })
      }
      run = []
      runWords = 0
    }
    let last: number | null = null
    for (const raw of joinHyphens(leaf.lines)) {
      const line = raw.trim()
      const w = words(line)
      if (w.length < MIN_WORDS) continue
      if ((onLeaves.get(furnitureKey(line))?.size ?? 0) >= FURNITURE_LEAVES) continue
      let found = 0
      const placed: number[] = []
      for (let i = 0; i + 3 <= w.length; i++) {
        const at = wordShingles.get(`${w[i]} ${w[i + 1]} ${w[i + 2]}`)
        if (!at) continue
        found++
        if (at.length === 1) placed.push(at[0]! - i)
      }
      const l = letters(line)
      let lettersFound = 0
      const letterPositions = Math.max(1, l.length - LETTER_SHINGLE + 1)
      for (let i = 0; i + LETTER_SHINGLE <= l.length; i++) {
        if (letterShingles.has(l.slice(i, i + LETTER_SHINGLE))) lettersFound++
      }
      const known = w.filter((x) => (vocabulary.get(x) ?? 0) >= 1).length / w.length
      const inCells =
        cellWords.size > 0 && w.filter((x) => cellWords.has(x)).length / w.length >= 0.6
      if (
        known >= KNOWN_SHARE &&
        !inCells &&
        found / (w.length - 2) < FOUND_BELOW &&
        lettersFound / letterPositions < FOUND_BELOW
      ) {
        run.push(line)
        runWords += w.length
        continue
      }
      flush()
      if (placed.length < 3 || INDEX_LINE.test(line)) continue
      placed.sort((a, b) => a - b)
      const here = placed[placed.length >> 1]!
      // A row of cells, as a table or as the `a | b` paragraph a study reading
      // sets one as, holds columns the paper prints side by side: their lines
      // alternate on the leaf, so any order the book sets them in reads as moved.
      const inRow = rowish.has(owner[here]!)
      if (!inRow && last !== null && here < last - MOVED_BACK && w.length >= MIN_WORDS + 1) {
        findings.push({
          kind: 'moved',
          page: leaf.page,
          lines: [line],
          blockId: owner[here],
          against: `the book sets this line ${last - here} words before the line the paper prints ahead of it`
        })
      }
      last = here + w.length
    }
    flush()
  }
  return findings
}
