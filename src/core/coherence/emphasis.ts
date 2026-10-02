/**
 * Italic the paper prints and this edition sets in roman.
 *
 * A conversion that drops emphasis leaves nothing for any other check to see:
 * a book title in roman is a run of right words, and a block with no `<i>` in
 * it looks exactly like a block that never had any. The only thing that can
 * say a word was italic is a witness that saw the type, so this module does
 * not look for one; it is handed one, as runs of text the witness read as
 * italic, leaf by leaf, and asks where each run sits in the book as it stands
 * and whether it is set in italic there.
 *
 * What the witness is depends on the book. On TUP's ClearScan volumes it is
 * the glyph shapes behind the text layer, sorted roman from italic by the
 * slant of their strokes (`scripts/italic-witness.mjs`); on a born-digital PDF
 * it is the face the file names; on an EPUB it is the markup. This module does
 * not care which, and that is the point of keeping it pure: whatever the
 * witness, the comparison is the same and is tested once.
 *
 * The witness's characters are usually somebody's OCR, so a run is located by
 * its letters alone and loosely: an approximate substring match allowing one
 * slip in five, within the blocks and notes of the run's own leaf. A run that
 * cannot be placed, or that matches equally well in two places, is counted
 * and never reported as a finding, because a mark put on the wrong `seven` is
 * worse than the mark missing. A run of fewer than four letters, or one that
 * matches twice, is tried again with the words the witness read either side
 * of it: `all` occurs on most leaves, `in all their properties` on one.
 *
 * Pure: no DOM, no I/O.
 */
import type { BookDocument } from '@core/assemble'
import { withMarkup } from '@core/transcribe/markup'

/** One run of text a witness read as italic, on the leaf it read it from. */
export interface EmphasisWitness {
  page: number
  text: string
  /** What the witness read just before and after the run, to place a short one. */
  before?: string
  after?: string
}

export interface DroppedEmphasis {
  /** The block or note it sits in. */
  blockId: string
  pages: number[]
  /** The run as the witness read it. */
  witness: string
  /** The same stretch in the book as it stands, markup removed. */
  found: string
  /** Where that stretch starts and ends in the unit's plain text. */
  start: number
  end: number
  /** How much of the stretch is italic here already, 0 to 1. */
  italicShare: number
  context: string
}

export interface EmphasisReport {
  dropped: DroppedEmphasis[]
  /** Runs that matched and are italic here: the witness and the book agree. */
  agreed: number
  /** Runs too short to place, or with no match on their leaf. */
  unplaced: number
  /** Runs that matched equally well in more than one place. */
  ambiguous: number
}

/** Shortest run worth placing, in letters. */
const MIN_LETTERS = 4
/** Slips allowed per letter of the run. */
const SLIP_RATE = 0.2
/** Shortest run placed with the help of its context: one letter is a folio's `p.` */
const MIN_WITH_CONTEXT = 2
/** Letters of context taken either side of a run that cannot be placed alone. */
const CONTEXT_LETTERS = 16
/** Below this share of italic letters a stretch counts as set in roman. */
const ROMAN_BELOW = 0.5

interface Unit {
  id: string
  pages: number[]
  plain: string
  /** For each character of `plain`, whether it is inside `<i>`. */
  italic: boolean[]
  /** The letters of `plain`, folded, and the index in `plain` of each. */
  letters: string
  at: number[]
}

const fold = (ch: string): string => ch.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()

function lettersOf(text: string): string {
  return [...text]
    .filter((ch) => /\p{L}/u.test(ch))
    .map(fold)
    .join('')
}

function unitOf(id: string, pages: number[], marked: string): Unit {
  let plain = ''
  const italic: boolean[] = []
  let depth = 0
  for (const piece of marked.split(/(<\/?[a-z]+>)/u)) {
    if (/^<i>$/u.test(piece)) depth++
    else if (/^<\/i>$/u.test(piece)) depth = Math.max(0, depth - 1)
    else if (/^<\/?[a-z]+>$/u.test(piece)) continue
    else {
      for (const ch of piece) {
        plain += ch
        for (let k = 0; k < ch.length; k++) italic.push(depth > 0)
      }
    }
  }
  let letters = ''
  const at: number[] = []
  for (let i = 0; i < plain.length; i++) {
    const ch = plain[i]!
    if (!/\p{L}/u.test(ch)) continue
    const f = fold(ch)
    for (let k = 0; k < f.length; k++) {
      letters += f[k]
      at.push(i)
    }
  }
  return { id, pages, plain, italic, letters, at }
}

/**
 * A stretch widened to whole words. Italic is set a word at a time, and a
 * match that slipped a letter at either end would otherwise put a tag inside
 * one.
 */
function wordsAround(plain: string, start: number, end: number): { start: number; end: number } {
  const inWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{M}'’-]/u.test(ch)
  while (start > 0 && inWord(plain[start - 1])) start--
  while (end < plain.length && inWord(plain[end])) end++
  return { start, end }
}

/**
 * Every place `pattern` occurs in `text` with the fewest slips, if that is
 * within `limit`: Sellers' approximate substring search, keeping where each
 * match began. Returns `[start, end)` pairs in `text`'s indices.
 */
function bestMatches(
  pattern: string,
  text: string,
  limit: number
): { slips: number; found: [number, number][] } {
  const m = pattern.length
  let dist = new Array<number>(m + 1)
  let from = new Array<number>(m + 1)
  for (let i = 0; i <= m; i++) {
    dist[i] = i
    from[i] = 0
  }
  let best = limit + 1
  let found: [number, number][] = []
  for (let j = 1; j <= text.length; j++) {
    const nd = new Array<number>(m + 1)
    const nf = new Array<number>(m + 1)
    nd[0] = 0
    nf[0] = j
    for (let i = 1; i <= m; i++) {
      const sub = dist[i - 1]! + (pattern[i - 1] === text[j - 1] ? 0 : 1)
      const del = dist[i]! + 1
      const ins = nd[i - 1]! + 1
      if (sub <= del && sub <= ins) {
        nd[i] = sub
        nf[i] = from[i - 1]!
      } else if (del <= ins) {
        nd[i] = del
        nf[i] = from[i]!
      } else {
        nd[i] = ins
        nf[i] = nf[i - 1]!
      }
    }
    dist = nd
    from = nf
    const d = dist[m]!
    if (d < best) {
      best = d
      found = [[from[m]!, j]]
    } else if (d === best && d <= limit) {
      const last = found[found.length - 1]
      // Neighbouring end positions of one occurrence are the same match.
      if (last && from[m]! < last[1]) {
        if (j - from[m]! <= last[1] - last[0]) found[found.length - 1] = [from[m]!, j]
      } else found.push([from[m]!, j])
    }
  }
  return { slips: best, found: best <= limit ? found : [] }
}

/**
 * Where the witness reads italic and the book sets roman.
 *
 * Matches are sought only on the run's own leaf, which is what keeps a loose
 * match honest: across a whole book a four-letter run matches somewhere with a
 * slip to spare, on one leaf it nearly never does by accident.
 */
export function checkEmphasis(
  doc: BookDocument,
  witness: readonly EmphasisWitness[]
): EmphasisReport {
  const units: Unit[] = [
    ...[...doc.blocks, ...doc.sections.flatMap((s) => s.blocks)]
      .filter((b) => b.kind !== 'table')
      .map((b) => unitOf(b.id, [...b.sourcePages], withMarkup(b.text, b.emphasis, b.strong))),
    ...doc.footnotes.map((n) =>
      unitOf(n.id, [n.pageIndex], withMarkup(n.text, n.emphasis, n.strong))
    )
  ]
  const byPage = new Map<number, Unit[]>()
  for (const u of units) {
    for (const p of u.pages) {
      const list = byPage.get(p) ?? []
      list.push(u)
      byPage.set(p, list)
    }
  }

  type Hit = { unit: Unit; start: number; end: number }
  /**
   * The best matches of `pattern` on one leaf, as letter ranges trimmed by
   * `lead` and `tail` letters: the context either side of a run is matched
   * with it and then cut off again.
   */
  const locate = (pattern: string, page: number, lead: number, tail: number): Hit[] => {
    const limit = Math.floor(pattern.length * SLIP_RATE)
    let hits: Hit[] = []
    let fewest = limit + 1
    for (const unit of byPage.get(page) ?? []) {
      const { slips, found } = bestMatches(pattern, unit.letters, limit)
      if (found.length === 0 || slips > fewest) continue
      // Keep only the best across units: `bestMatches` ranks within one.
      if (slips < fewest) {
        fewest = slips
        hits = []
      }
      for (const [s, e] of found) {
        const from = Math.min(s + lead, e - 1)
        const to = Math.max(from + 1, e - tail)
        hits.push({ unit, ...wordsAround(unit.plain, unit.at[from]!, unit.at[to - 1]! + 1) })
      }
    }
    return hits
  }
  const share = (h: Hit): number => {
    let n = 0
    let italic = 0
    for (let i = h.start; i < h.end; i++) {
      if (!/\p{L}/u.test(h.unit.plain[i]!)) continue
      n++
      if (h.unit.italic[i]) italic++
    }
    return n === 0 ? 1 : italic / n
  }

  const report: EmphasisReport = { dropped: [], agreed: 0, unplaced: 0, ambiguous: 0 }
  const reported = new Set<string>()
  for (const run of witness) {
    const pattern = lettersOf(run.text)
    if (pattern.length === 0) {
      report.unplaced++
      continue
    }
    let hits = pattern.length >= MIN_LETTERS ? locate(pattern, run.page, 0, 0) : []
    // Too short to place alone, or placed in more than one spot: the words
    // the witness read either side of it say which. The context is matched
    // loosely, so a short run must then be found letter for letter inside
    // what it placed, or `The` lands on whatever word sits where it would.
    if (
      hits.length !== 1 &&
      pattern.length >= MIN_WITH_CONTEXT &&
      (run.before !== undefined || run.after !== undefined)
    ) {
      const lead = lettersOf(run.before ?? '').slice(-CONTEXT_LETTERS)
      const tail = lettersOf(run.after ?? '').slice(0, CONTEXT_LETTERS)
      const wider = locate(lead + pattern + tail, run.page, lead.length, tail.length).filter(
        (h) =>
          pattern.length >= MIN_LETTERS ||
          lettersOf(h.unit.plain.slice(h.start, h.end)).includes(pattern)
      )
      if (wider.length === 1 || hits.length === 0) hits = wider
    }
    if (hits.length === 0) {
      report.unplaced++
      continue
    }
    if (hits.some((h) => share(h) >= ROMAN_BELOW)) {
      report.agreed++
      continue
    }
    if (hits.length > 1) {
      report.ambiguous++
      continue
    }
    const h = hits[0]!
    const key = `${h.unit.id}:${h.start}`
    if (reported.has(key)) continue
    reported.add(key)
    const a = Math.max(0, h.start - 50)
    const b = Math.min(h.unit.plain.length, h.end + 50)
    report.dropped.push({
      blockId: h.unit.id,
      pages: h.unit.pages,
      witness: run.text,
      found: h.unit.plain.slice(h.start, h.end),
      start: h.start,
      end: h.end,
      italicShare: share(h),
      context: `${a > 0 ? '…' : ''}${h.unit.plain.slice(a, b)}${b < h.unit.plain.length ? '…' : ''}`
    })
  }
  return report
}
