/**
 * An analytical contents, kept for its entries and renumbered to this edition.
 *
 * `synopsis.ts` recovers one shape of original contents: a paragraph under each
 * chapter saying what is in it. This recovers the other, and the commoner one
 * in a nineteenth-century book — a list of the topics a chapter covers, each on
 * its own line with the page it begins on:
 *
 * ```
 *                          CHAPTER I.
 *                  OLD THINGS WITH NEW NAMES.
 *   The Oriental Kabala..........................................    1
 *   Ancient traditions supported by modern research..............    3
 *   The progress of mankind marked by cycles.....................    5
 * ```
 *
 * Vol. I of *Isis Unveiled* lists 156 of these across five leaves. They are the
 * work of whoever made the book — nobody generated them — and they are the
 * reason a reader opens such a page at all. Discarding them with their numbers
 * threw away the wrong half, exactly as it did for the descriptive kind.
 *
 * **Only the number was ever the problem**, and the number is recoverable. Each
 * entry names a place in the body by the folio the 1877 edition printed, and
 * this edition knows where that place now falls: the leaf that printed that
 * folio is in the reading, the blocks that came off that leaf are in the
 * document, and the engine reports which page each block opens on. So an entry
 * is carried through as *the topic and a block to find*, and the folio beside
 * it is measured by the same machinery that numbers the chapters.
 *
 * A restoration and not an invention: every word comes off the paper, and the
 * one thing that changes is the one thing that had to.
 *
 * Pure.
 */
import { synopsisKey, isNumberLine } from './synopsis'

/** One topic line, as the original contents sets it. */
export interface AnalyticalTopic {
  /**
   * The topic, as printed, with the leader dots and the number taken off —
   * **as notation**, so a word the original italicised is still italicised
   * when the contents is set.
   *
   * Notation rather than clean text plus a mark list, which is what every
   * other carrier of emphasis here uses, because a topic is only ever *set*:
   * nothing matches on it, nothing counts its words, and the one place it is
   * read is the line that draws it. Carrying the string the notation already
   * defines is one field that cannot drift from another, where a parallel mark
   * list re-based through `cleanTopic`'s own edits would be three chances to
   * be wrong for no reader's benefit. `layoutWithToc` parses it at the point
   * of setting.
   */
  text: string
  /**
   * The folio the original printed beside it, verbatim — `104`, `xxiii`.
   *
   * Kept as the page wrote it rather than as a number, because the two
   * numbering series a book of this period uses are told apart by their
   * *shape*, and the leaf that printed `xxiii` is found by asking which leaf
   * printed `xxiii`. Parsing it to 23 would put the front matter's entries on
   * the twenty-third leaf of the body.
   */
  originalFolio: string
}

/** The topics an analytical contents lists under one chapter. */
export interface AnalyticalGroup {
  /** The number line, where the contents prints one — `CHAPTER I.` */
  label: string
  /** The chapter's title, as the contents gives it. */
  title: string
  topics: AnalyticalTopic[]
}

/**
 * The blocks this reads. Structural only — no platform types, no pixels.
 *
 * `cells` is how a contents entry actually arrives: two columns, the topic and
 * its folio, which is what the page sets and what a reader transcribing it
 * writes. `text` is read as a fallback for a contents whose entries came back
 * as prose, where the folio is at the end of the line behind a row of dots.
 */
export interface AnalyticalBlock {
  kind: string
  text?: string
  /**
   * The row's cells **as notation** — `The French <i>savants</i>` — not as the
   * clean strings a block stores.
   *
   * A block keeps its marks against its whole flattened text, which is the
   * right coordinate for a table and the wrong one for a reader that joins two
   * cells and trims the result. So the caller writes each cell's own share back
   * as tags before handing it over (`assembleBook` does, through
   * `marksForCell`), and everything here is plain string work over one string.
   *
   * It is also what keeps this module free of `@core/transcribe`, which
   * imports `@core/pages` for the role list and cannot be imported back.
   */
  cells?: readonly (readonly string[])[]
}

/** The contents page's own title, which is not a chapter. */
const CONTENTS_TITLE = /^\s*(synopsis|contents|table of contents)\b/i

/** The column head over the folios, which is not a chapter either. */
const COLUMN_HEAD = /^\s*page\s*\.?\s*$/i

/** The folio at the end of an entry's own line, reached by a row of leader dots. */
const TRAILING_FOLIO = /^(.*?)[.…\s]{4,}\s*([0-9ivxlcIVXLC]+)\s*$/

/** Leader dots left on the end of a topic the reader cut the number off. */
const TRAILING_DOTS = /[\s.…]+$/

function cleanTopic(text: string): string {
  return text.replace(TRAILING_DOTS, '').trim()
}

/** Is this the sort of string a folio column holds? */
function looksLikeFolio(text: string): boolean {
  return /^[0-9ivxlcIVXLC]+$/.test(text.trim())
}

/**
 * Read the groups off the transcribed contents leaves.
 *
 * The leaves must arrive in reading order and all together, for the reason
 * `readSynopsis` needs the same: a chapter's entries routinely begin on one
 * leaf and finish on the next, and a parser handed them singly would start a
 * fresh group at every leaf boundary and attribute half a chapter's topics to
 * nothing.
 *
 * A run of consecutive headings is one chapter opening, named by the last and
 * numbered by the first — the same rule `deriveChapters` applies to the body,
 * because the contents sets its chapter names the same way the chapters do.
 */
export function readAnalyticalContents(blocks: readonly AnalyticalBlock[]): AnalyticalGroup[] {
  const groups: AnalyticalGroup[] = []
  let label = ''
  let title = ''
  let topics: AnalyticalTopic[] = []
  // Whether the heading now being read continues the run that opened the
  // current group, or begins a new one. Without it, `CHAPTER I.` followed by
  // `OLD THINGS WITH NEW NAMES.` would close a group with no topics in it and
  // open a second under the title alone.
  let inHeadingRun = false

  const flush = (): void => {
    if (topics.length > 0) groups.push({ label, title, topics })
    topics = []
  }

  // A volume division — `Volume First.`, `PART ONE.—SCIENCE.` — is treated as
  // an ordinary heading rather than skipped, and that is a correction. It reads
  // like page furniture and it is not: `deriveChapters` puts it in the body's
  // own chapter list, so a contents that sets entries directly under one has a
  // chapter to match them to, and skipping it would throw that match away. On
  // the page this was written for it makes no difference either way — the
  // division is followed by the first chapter's own headings, which overwrite
  // it inside the run — and a rule that changes nothing on the book in hand and
  // could lose a match on the next one is not worth having.
  for (const block of blocks) {
    const text = (block.text ?? '').trim()

    if (block.kind === 'heading' || block.kind === 'caption') {
      if (!text || CONTENTS_TITLE.test(text) || COLUMN_HEAD.test(text)) continue
      if (!inHeadingRun) {
        flush()
        label = ''
        title = ''
      }
      if (isNumberLine(text)) label = text
      else title = text
      inHeadingRun = true
      continue
    }

    inHeadingRun = false

    if (block.kind === 'table' && block.cells) {
      // The cells arrive as notation (see `AnalyticalBlock.cells`), so a word
      // the original italicised travels into the topic and is set as the
      // original set it. Without that the three entries *Isis Unveiled*
      // italicises — *savants*, *Orohippus*, *Shudâla Mâdan* — print in roman,
      // which is what this edition did until the engine could set them.
      for (const row of block.cells) {
        const cells = row.map((c) => c.trim()).filter((c) => c.length > 0)
        if (cells.length === 0) continue
        const last = cells[cells.length - 1] ?? ''
        if (cells.length >= 2 && looksLikeFolio(last)) {
          const topic = cleanTopic(cells.slice(0, -1).join(' '))
          if (topic) topics.push({ text: topic, originalFolio: last })
        }
      }
      continue
    }

    // A contents whose entries came back as prose rather than as columns. One
    // line, one entry, the folio behind the dots.
    if (text) {
      for (const line of text.split('\n')) {
        const match = TRAILING_FOLIO.exec(line.trim())
        if (!match) continue
        const topic = cleanTopic(match[1] ?? '')
        const folio = (match[2] ?? '').trim()
        if (topic && folio) topics.push({ text: topic, originalFolio: folio })
      }
    }
  }

  flush()
  return groups
}

/**
 * Whether the parse is worth offering.
 *
 * The same bargain `synopsisLooksSound` strikes, and for the same reason: a
 * ragged parse means the page was not laid out the way this reader assumes, and
 * a mangled contents printed under the author's name is worse than the plain
 * generated one it would replace.
 *
 * What is checked is what an analytical contents promises. It names chapters,
 * so there must be more than one group. Its entries point forward through the
 * book, so the folios of one numbering series must not descend — measured
 * within a series rather than across the whole list, because the front matter's
 * roman numerals and the body's arabic ones are two sequences printed one after
 * the other and comparing them says nothing.
 */
export function analyticalLooksSound(groups: readonly AnalyticalGroup[]): boolean {
  if (groups.length < 2) return false
  // Measured over the *topics*, not the groups. A contents routinely opens with
  // an entry standing above every heading on the page — `PREFACE .... v` — and
  // its group is rightly nameless, matches no chapter and is dropped. Counting
  // groups made one such line worth as much as a chapter of forty entries, and
  // refused the whole parse of a page that is laid out exactly as its kind is.
  const all = groups.reduce((n, g) => n + g.topics.length, 0)
  const named = groups.filter((g) => g.title || g.label).reduce((n, g) => n + g.topics.length, 0)
  if (all === 0 || named < all * 0.8) return false

  const arabic: number[] = []
  for (const group of groups) {
    for (const topic of group.topics) {
      const n = Number(topic.originalFolio)
      if (Number.isFinite(n)) arabic.push(n)
    }
  }
  if (arabic.length < 4) return false
  // Equal is allowed and common: several topics share a page.
  return arabic.every((n, i) => i === 0 || n >= arabic[i - 1]!)
}

/** Match an analytical group to a chapter, on letters and digits alone. */
export { synopsisKey as analyticalKey }

/** A leaf as this needs to see it: its index and the folio it printed, if any. */
export interface FolioSighting {
  pageIndex: number
  folio?: string | null
}

/**
 * Which leaf printed a given folio — and which leaf *would have*, for the
 * folios no leaf prints.
 *
 * The direct half is a lookup and needs no explanation. The other half does,
 * because it is the one place here that does arithmetic on page numbers.
 *
 * **A chapter opening prints no folio.** That is the convention in every book
 * of this kind, and it means the page an analytical contents most often names —
 * the first page of a chapter — is precisely the page no leaf claims. Measured
 * on Vol. I of *Isis Unveiled*: the first topic of every one of the fifteen
 * chapters was dropped, and so was the first entry under BEFORE THE VEIL,
 * because `1`, `39`, `74` and the rest are printed nowhere.
 *
 * So the offset between a leaf and the folio it prints is **voted** from the
 * leaves that do print one, and used only to fill the gaps. Two series are
 * voted separately — the front matter's roman numerals and the body's arabic
 * ones are two sequences and the offset between them differs — and a series
 * whose leaves disagree about the offset contributes nothing rather than a
 * majority opinion, because a book that renumbers itself partway through is
 * exactly the book a guessed leaf would send a reader wrongly into.
 *
 * Measured on that volume: 613 leaves print an arabic folio and **all 613**
 * agree on an offset of 58; the roman series agrees likewise. A fill under
 * those conditions is the book's own numbering, not an assumption about it.
 */
export function folioToLeaf(sightings: readonly FolioSighting[]): (folio: string) => number | null {
  const direct = new Map<string, number>()
  for (const leaf of sightings) {
    const folio = leaf.folio?.trim()
    // First wins. A folio printed twice is a misnumbered leaf, and the earlier
    // one is what an entry counting forward means.
    if (folio && !direct.has(folio)) direct.set(folio, leaf.pageIndex)
  }

  const offsets = { arabic: new Set<number>(), roman: new Set<number>() }
  const leaves = { arabic: [] as number[], roman: [] as number[] }
  for (const [folio, leaf] of direct) {
    const arabic = /^\d+$/.test(folio) ? Number(folio) : null
    if (arabic !== null) {
      offsets.arabic.add(leaf - arabic)
      leaves.arabic.push(leaf)
      continue
    }
    const roman = romanValue(folio)
    if (roman !== null) {
      offsets.roman.add(leaf - roman)
      leaves.roman.push(leaf)
    }
  }
  const settled = (series: 'arabic' | 'roman'): number | null =>
    offsets[series].size === 1 && leaves[series].length >= 3 ? [...offsets[series]][0]! : null
  const arabicOffset = settled('arabic')
  const romanOffset = settled('roman')
  const highest = Math.max(-1, ...sightings.map((s) => s.pageIndex))

  return (folio: string): number | null => {
    const key = folio.trim()
    const known = direct.get(key)
    if (known !== undefined) return known
    const arabic = /^\d+$/.test(key) ? Number(key) : null
    const offset = arabic !== null ? arabicOffset : romanOffset
    if (offset === null) return null
    const value = arabic ?? romanValue(key)
    if (value === null) return null
    const leaf = value + offset
    return leaf >= 0 && leaf <= highest ? leaf : null
  }
}

/** A lower-case roman numeral as a number, or null if it is not one. */
function romanValue(text: string): number | null {
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 }
  const chars = text.toLowerCase().split('')
  if (chars.length === 0 || !chars.every((c) => c in values)) return null
  let total = 0
  for (let i = 0; i < chars.length; i++) {
    const here = values[chars[i]!]!
    const next = i + 1 < chars.length ? values[chars[i + 1]!]! : 0
    total += here < next ? -here : here
  }
  return total > 0 ? total : null
}
