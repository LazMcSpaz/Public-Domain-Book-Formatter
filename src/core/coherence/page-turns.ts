/**
 * Paragraphs broken where the paper turns a page.
 *
 * Assembly joins a paragraph across a page seam when the next leaf plainly
 * continues it, and leaves the two apart otherwise. "Plainly" was a lower-case
 * opening, so a leaf that went on in the middle of a sentence with a capital —
 * a proper noun, an "I", "H.P.B." — opened a paragraph of its own, and the
 * edition printed a paragraph break mid-sentence: `…interests of The
 * Theosophical` on one line, then an indented `Society demanded the full
 * publication…`. _The Mahatma Letters_ went to "ready to upload" with thirty
 * of them, and _The Lost Keys of Masonry_ with one (`…a Spiritual Earth.
 * That` / `Only One Thing is the father…`), and nothing reported either:
 * every check reads within a block, and a block boundary at a page turn looks
 * exactly like a paragraph boundary.
 *
 * Two witnesses, and the second is the stronger.
 *
 * - **The text.** A paragraph that ends without a stop, or one that opens in
 *   lower case, at a page turn. Cheap, and blind to a sentence that happens to
 *   end at the foot of the page while its paragraph runs on.
 * - **The paper.** Whether the first line of the next leaf is indented, read
 *   off the boxes OCR measured round every word (the recon reading every book
 *   on the shelf already carries). A first line set flush with the lines under
 *   it is a paragraph running on, whatever the text says. The margin it is
 *   measured against is the lines *just below it*, not the page's, because a
 *   skewed scan drifts by a good part of an indent from top to bottom.
 *
 * The opposite fault, two paragraphs made one across a turn, was looked for
 * too and is not: on _The Mahatma Letters_ the OCR boxes called 22 such turns
 * indented, and the five a reader cropped all ran on, as the pixels said. A
 * box can start right of the ink (a quotation mark OCR did not box, a word
 * fragment), and that reads as an indent; it never reads as a flush line that
 * is not one, which is the direction this check needs.
 *
 * Scored on the same book before any of it was trusted: of the turns the text
 * gave no reason to doubt and the paper read as flush, readers cropping the
 * scan found 20 of 22 running on. The two that did not were a short closing
 * line and a bold "You say :", where the lines under the first were too short
 * to give a margin. So a paper-only finding is a place to crop, never a join.
 *
 * Pure: blocks in, findings out, and the leaf's words handed in by whoever has
 * them. A finding is a place to look; the leaf decides.
 */

import {
  bodyHeightOf,
  draftPage,
  isCentred,
  isIndented,
  measureOf,
  toLines,
  type DraftLine,
  type DraftWord
} from '@core/draft'

/** The parts of an assembled block this check reads. */
export interface PageTurnBlock {
  id: string
  kind: string
  text: string
  sourcePages: number[]
}

export type PageTurnSignal = 'no-stop' | 'lower-start' | 'paper-flush'

/** What the paper's first line of body text does on a leaf. */
export type PaperOpening = 'flush' | 'indented' | 'unknown'

export interface PageTurnFinding {
  /** The book opens a paragraph at the turn where the page may go on. */
  kind: 'split'
  /** The block on the leaf before the turn. */
  before: string
  /** The block that opens the leaf. */
  after: string
  /** The leaf the page turns onto. */
  leaf: number
  signals: PageTurnSignal[]
  /** What the paper does there; `not-read` when no words were handed in. */
  paper: PaperOpening | 'not-read'
  /** The end of the one and the start of the other, ‖ between. */
  context: string
}

/** Blocks a paragraph can be broken between. A verse line opens in lower case by nature. */
const BEFORE_KINDS = new Set(['paragraph', 'blockquote', 'verse'])
const AFTER_KINDS = new Set(['paragraph', 'blockquote'])

/** Superscript marks, reference marks, a glossary circle, closing quotes and brackets. */
const TRAILING = /[\s¹²³⁰-⁹*†‡§‖¶°”’"'»)\]]+$/u
const LEADING = /^[\s“‘"'«([.…]+/u
/** What a paragraph may end on. A dash counts: the letters end paragraphs on one. */
const STOP = /[.!?:;—–-]$|…$/u

const plain = (text: string): string => text.replace(/<\/?[a-z]+>/gu, '').trim()

/** True where a paragraph ends without anything a paragraph ends on. */
export function endsWithoutStop(text: string): boolean {
  const end = plain(text).replace(TRAILING, '')
  return end.length > 0 && !STOP.test(end)
}

/** True where a paragraph opens in lower case, past any quotation mark, bracket or ellipsis. */
export function opensLowerCase(text: string): boolean {
  const start = plain(text).replace(LEADING, '')
  return /^\p{Ll}/u.test(start)
}

/**
 * A salutation and its letter, or a close and its signature: "My dear
 * Friend," then the letter, "Yours ever," then "K. H.". Both end on a comma
 * and neither is a sentence running on.
 */
function salutation(before: string, after: string): boolean {
  const a = plain(before)
  return a.endsWith(',') && (a.length < 60 || plain(after).length < 50)
}

/** Letters and digits only, for comparing a line against the furniture the draft found. */
const alnum = (text: string): string => text.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()

/** A page number as a running head carries it: arabic or roman, perhaps with a stop. */
const FOLIO = /^(\d{1,4}|[ivxlcdm]{1,8})\.?$/iu

/**
 * The draft's furniture rules are measured against the page, and on a leaning
 * scan, or under a head set close above the text, they can decline a running
 * head that is plainly one: _The Mahatma Letters_' "28 THE MAHATMA LETTERS"
 * sits a line above its text with its folio flush left, and taken for the
 * first line it reads as a flush opening on every verso. So a top line is the
 * head here when it carries a page number at either end and the rest of it is
 * in capitals; or when the page sets it apart by a gap well over a line and it
 * has either. A first line of text, mixed case and numberless, is never taken.
 */
function looksLikeHead(lines: readonly DraftLine[]): boolean {
  const tokens = lines[0]!.text.trim().split(/\s+/u)
  const numbered = FOLIO.test(tokens[0] ?? '') || FOLIO.test(tokens[tokens.length - 1] ?? '')
  const letters = lines[0]!.text.replace(/[^\p{L}]/gu, '')
  const capitals = letters.length > 0 && letters === letters.toUpperCase()
  if (numbered && (capitals || letters.length === 0)) return true
  const pitches = lines.slice(1, -1).map((l, k) => lines[k + 2]!.top - l.top)
  const pitch = [...pitches].sort((a, b) => a - b)[Math.floor(pitches.length / 2)] ?? 0
  const apart = pitch > 0 && lines[1]!.top - lines[0]!.top > pitch * 1.6
  return apart && (numbered || capitals)
}

/** Lines this close to each other below the first are its neighbours. */
const NEIGHBOURS = 4

/**
 * Whether a leaf's first line of body text is indented.
 *
 * The draft's own machinery decides the parts that are not this check's to
 * decide: `draftPage` finds the running head and folio, `toLines` gathers the
 * words, `measureOf` the measure and `isIndented` the first-line rule. What is
 * this check's own is the margin: the left edge of the next few lines, not the
 * page's, so a skewed scan cannot turn a flush line into an indent.
 *
 * `unknown` where the leaf is too thin to say, where the first line is centred
 * (a heading, a signature) or set in by much more than an indent (a quotation
 * or a verse), and where nothing follows it to measure against.
 */
export function paperOpening(words: readonly DraftWord[]): PaperOpening {
  if (words.length < 20) return 'unknown'
  const draft = draftPage(words, { columns: 'single' })
  const furniture = [draft.furniture.runningHead, draft.furniture.folio]
    .filter((t): t is string => Boolean(t))
    .map(alnum)
  const isFurniture = (line: DraftLine): boolean => {
    const text = alnum(line.text)
    if (text.length < 3) return true
    if (furniture.length === 0) return false
    const joined = [furniture.join(''), [...furniture].reverse().join('')]
    return furniture.includes(text) || joined.includes(text)
  }
  const lines = toLines(words, bodyHeightOf(words))
    .filter((l) => !isFurniture(l))
    .sort((a, b) => a.top - b.top)
  if (lines.length > 2 && looksLikeHead(lines)) lines.shift()
  if (lines.length < NEIGHBOURS + 1) return 'unknown'
  const measure = measureOf(lines)
  const first = lines[0]!
  if (isCentred(first, measure)) return 'unknown'
  const margin = Math.min(...lines.slice(1, 1 + NEIGHBOURS).map((l) => l.left))
  const inset = first.left - margin
  // An inset of several indents is a quotation or a verse set in, not a
  // paragraph opening, and says nothing about the turn.
  if (inset > measure.width * 0.12) return 'unknown'
  const local = { ...measure, left: margin }
  return isIndented(first, local) ? 'indented' : 'flush'
}

/**
 * Every page turn where the book and the paper may disagree about a paragraph.
 *
 * `wordsOf` hands over a leaf's OCR words; leave it out and only the text is
 * read, which misses a sentence ending at the foot of a page.
 */
export function checkPageTurns(
  blocks: readonly PageTurnBlock[],
  wordsOf?: (leaf: number) => readonly DraftWord[] | undefined
): PageTurnFinding[] {
  const findings: PageTurnFinding[] = []
  const opening = new Map<number, PaperOpening | 'not-read'>()
  const paperAt = (leaf: number): PaperOpening | 'not-read' => {
    if (!wordsOf) return 'not-read'
    let known = opening.get(leaf)
    if (known === undefined) {
      known = paperOpening(wordsOf(leaf) ?? [])
      opening.set(leaf, known)
    }
    return known
  }
  const context = (a: string, b: string): string =>
    `…${plain(a).slice(-60)} ‖ ${plain(b).slice(0, 60)}…`.replace(/\s+/gu, ' ')

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    const pages = block.sourcePages
    if (pages.length === 0) continue

    // A block that opens a leaf: did the paragraph before it really end?
    const prior = blocks[i - 1]
    if (!prior || prior.sourcePages.length === 0) continue
    const end = Math.max(...prior.sourcePages)
    const start = Math.min(...pages)
    if (end >= start) continue
    if (!BEFORE_KINDS.has(prior.kind) || !AFTER_KINDS.has(block.kind)) continue
    const signals: PageTurnSignal[] = []
    if (endsWithoutStop(prior.text) && !salutation(prior.text, block.text)) signals.push('no-stop')
    if (opensLowerCase(block.text)) signals.push('lower-start')
    const paper = paperAt(start)
    if (paper === 'flush') signals.push('paper-flush')
    if (signals.length === 0) continue
    findings.push({
      kind: 'split',
      before: prior.id,
      after: block.id,
      leaf: start,
      signals,
      paper,
      context: context(prior.text, block.text)
    })
  }
  return findings
}
