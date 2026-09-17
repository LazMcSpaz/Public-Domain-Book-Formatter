/**
 * Which words a page set in italic, carried onto text somebody has corrected.
 *
 * A born-digital PDF states its emphasis: every word in its text layer names
 * the face it is set in, so `DraftWord.italic` is a fact off the file rather
 * than anything recovered from pixels. What it is *not* is addressed the way
 * the rest of this app addresses emphasis — `TranscribedBlock.emphasis` is a
 * list of indices into a block's whitespace-separated words, and a block is
 * built by joining lines, healing hyphens across them and, on a leaf set as a
 * transcript beside its commentary, cutting each line into cells. By the time
 * there is a block there is no longer a word to point at.
 *
 * So the two are lined up here, once, by a walk that compares tokens rather
 * than positions. That matters for the job this was written for: seven readers
 * corrected the structure of this volume's leaves before the italics existed,
 * and their blocks are a *re-division* of the words the draft was built from —
 * joined, split, moved into cells. Positions do not survive that and the words
 * do.
 *
 * Pure: no DOM, no I/O, no network.
 *
 * ## What the walk has to tolerate
 *
 * - **A join.** `know-` / `ledge` in the source is `knowledge` in the block,
 *   because hyphen healing runs after the lines are joined. Two source words,
 *   one block word.
 * - **A split.** The reverse, where a reader divided a word the file ran
 *   together.
 * - **Words the block never had.** The running head and the folio are taken
 *   off the leaf into `furniture`, so the source stream opens with two or
 *   three words no block will ever claim.
 * - **Words the source never had.** A reader may have typed a word the file
 *   lost. It comes back roman and is *named* — never guessed at from the words
 *   either side of it.
 *
 * Nothing here repairs text. It reads a flag off a file and puts it on the
 * words that flag belongs to; where it cannot tell which those are, it says so
 * and sets them roman, which is the answer that loses least.
 */

import type { DraftWord } from './index'

/**
 * How far ahead in the source a lost token is looked for before the block word
 * is given up on.
 *
 * Wide enough for a leaf's furniture (a running head of four or five words and
 * a folio) to be stepped over in one go, and for the scrambled word order a
 * figure drawn out of type leaves behind. Narrow enough that it cannot skip a
 * line of prose to find a common word further down: on this volume the
 * commonest token is `the`, which recurs about every twelfth word, so a window
 * much past this starts finding the *wrong* `the`.
 */
const RESYNC_WINDOW = 12

/** How many source words may be run together to match one block word. */
const JOIN_MAX = 3

/** Letters and digits only, folded — the one thing both sides agree on. */
function key(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

export interface EmphasisReading {
  /** For each text handed in, the indices of its words to set in italic. */
  emphasis: number[][]
  /**
   * Block words no source word could be lined up with, as `[text, word]` with
   * the word itself.
   *
   * Reported rather than counted: a scatter of ones is a reader's typing and a
   * run of them is a block aligned against the wrong part of the leaf, and
   * only the words tell those apart.
   */
  unmatched: { text: number; word: number; is: string }[]
  /** Block words that found a source word. */
  matched: number
  /** Block words in all. */
  total: number
}

/**
 * Line a leaf's texts up against the words it was read from, and carry the
 * italic across.
 *
 * The texts are taken as one stream in the order given, because that is what
 * they are: the leaf, read down. A table's cells are handed in row by row, in
 * the same order the flattened view sets them.
 */
export function emphasisForTexts(
  texts: readonly string[],
  source: readonly DraftWord[]
): EmphasisReading {
  const emphasis: number[][] = texts.map(() => [])
  const unmatched: { text: number; word: number; is: string }[] = []
  let matched = 0
  let total = 0

  let s = 0
  texts.forEach((text, t) => {
    const words = text.split(/\s+/u).filter((w) => w.length > 0)
    total += words.length
    let w = 0
    while (w < words.length) {
      const here = key(words[w]!)
      if (here === '') {
        // Punctuation on its own — a cell holding `|`, a lone dash. It carries
        // no emphasis and claims no source word.
        w++
        continue
      }
      while (s < source.length && key(source[s]!.text) === '') s++
      if (s >= source.length) {
        unmatched.push({ text: t, word: w, is: words[w]! })
        w++
        continue
      }

      const mine = key(source[s]!.text)
      if (mine === here) {
        if (source[s]!.italic === true) emphasis[t]!.push(w)
        matched++
        s++
        w++
        continue
      }

      // A join: one block word over several source words.
      let joined = mine
      let span = 1
      let hit = false
      while (span < JOIN_MAX && s + span < source.length) {
        joined += key(source[s + span]!.text)
        span++
        if (joined === here) {
          hit = true
          break
        }
        if (joined.length > here.length) break
      }
      if (hit) {
        // Italic if any part of it was. A word broken across a line break is
        // one word and was set in one face; where the file disagrees with
        // itself about that, the emphasis is what the page shows.
        const any = Array.from({ length: span }, (_, k) => source[s + k]!).some(
          (x) => x.italic === true
        )
        if (any) emphasis[t]!.push(w)
        matched++
        s += span
        w++
        continue
      }

      // A split: several block words over one source word.
      let run = here
      let took = 1
      let cut = false
      while (took < JOIN_MAX && w + took < words.length) {
        run += key(words[w + took]!)
        took++
        if (run === mine) {
          cut = true
          break
        }
        if (run.length > mine.length) break
      }
      if (cut) {
        for (let k = 0; k < took; k++) {
          if (source[s]!.italic === true) emphasis[t]!.push(w + k)
        }
        matched += took
        s++
        w += took
        continue
      }

      // Neither. Look ahead for this block word in the source — the furniture
      // taken off the leaf lives here, and so does a word the file set twice.
      let found = -1
      for (let k = 1; k <= RESYNC_WINDOW && s + k < source.length; k++) {
        if (key(source[s + k]!.text) === here) {
          found = s + k
          break
        }
      }
      if (found >= 0) {
        s = found
        if (source[s]!.italic === true) emphasis[t]!.push(w)
        matched++
        s++
        w++
        continue
      }

      // The source has nothing for this word. Roman, and named. The source is
      // *not* advanced: a word the reader typed is a word the file never had,
      // and stepping past a source word for it would put every emphasis after
      // this one on the wrong word.
      unmatched.push({ text: t, word: w, is: words[w]! })
      w++
    }
  })

  return { emphasis, unmatched, matched, total }
}

/**
 * Tokens this source italicises that the book it reproduces cannot have.
 *
 * `Patterns of the Hypnotic Techniques of Milton H. Erickson, M.D.` reaches us
 * as a born-digital PDF that is plainly a conversion of a scan — it sets `we'`
 * where the page says `we'll`, and `Milton II.` for `Milton H.` — and the
 * conversion classified a share of its prepositions as italic. Measured over
 * the whole volume: of 5,140 italic words in 1,512 runs, **189 runs are a lone
 * `of` and 16 a lone `for`**.
 *
 * Every one of those 205 was read in context and every one is an ordinary
 * preposition mid-sentence: `a partial explanation *of* the effectiveness *of*
 * this technique`. None is a word-as-mention, which in a book about language is
 * the thing that would make a lone italic function word real — and that is why
 * this list is these two tokens and not the function words generally. The
 * volume also carries lone italic `not`, `and` and `or`, and among those the
 * mentions are genuine: `the use of the word *and* as in:`, `if I introduce the
 * negative element *not* into the sentence`. Those are kept.
 *
 * The pixels cannot settle this and it is worth being plain about why. The
 * render of a born-digital leaf is drawn *from the text layer*, so a crop shows
 * the italic `of` exactly as the flag describes it: the two witnesses are one
 * witness. What the crop does establish is that this is the file's own doing
 * rather than a fault in reading it, and the argument from there is the
 * frequency and the contexts, both of which are measurements.
 */
export const CONVERSION_DAMAGE = new Set(['of', 'for'])

export interface DamageFound {
  /** The word's index in its text. */
  word: number
  is: string
}

/**
 * Drop the emphasis on a lone damaged token, and say which.
 *
 * **A run of one**, and never at either edge of the text. A genuine italic
 * phrase clipped by a block boundary — a title whose last word is `of` with
 * `Magic` opening the next block — would otherwise look exactly like the
 * damage, and the edges are where that can happen. Inside the text a lone
 * italic preposition with roman either side of it is the fault and nothing
 * else.
 */
export function withoutConversionDamage(
  words: readonly string[],
  emphasis: readonly number[]
): { emphasis: number[]; dropped: DamageFound[] } {
  const set = new Set(emphasis)
  const dropped: DamageFound[] = []
  const kept: number[] = []
  for (const i of emphasis) {
    const alone = !set.has(i - 1) && !set.has(i + 1)
    const inside = i > 0 && i < words.length - 1
    if (alone && inside && CONVERSION_DAMAGE.has(key(words[i]!))) {
      dropped.push({ word: i, is: words[i]! })
      continue
    }
    kept.push(i)
  }
  return { emphasis: kept, dropped }
}

/**
 * A table's per-cell emphasis, addressed the way the rest of the app addresses
 * a table's words.
 *
 * `TranscribedBlock.emphasis` indexes the whitespace-separated words of `text`,
 * and for a table `text` is the flattened view — cells joined by ` | `, rows by
 * a newline. So the separator is itself a word in that tokenisation, and a
 * cell's own word 0 sits at a running offset that counts one extra per
 * separator crossed. Doing that arithmetic here rather than at each call site
 * is the same argument `tableToText` makes: one derivation, so the structure
 * and the view cannot come to disagree.
 */
export function flattenCellEmphasis(
  cells: readonly (readonly string[])[],
  perCell: readonly (readonly number[])[]
): number[] {
  const out: number[] = []
  let at = 0
  let cell = 0
  for (const row of cells) {
    row.forEach((text, c) => {
      if (c > 0) at++ // the ` | ` between this cell and the last
      for (const i of perCell[cell] ?? []) out.push(at + i)
      at += text.split(/\s+/u).filter((w) => w.length > 0).length
      cell++
    })
  }
  return out.sort((a, b) => a - b)
}
