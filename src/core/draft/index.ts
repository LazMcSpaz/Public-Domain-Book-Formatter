/**
 * The free reading, shaped like a page.
 *
 * OCR hands back a bag of words with boxes round them. A transcription is a
 * page with *structure* — paragraphs, headings, a running head, a folio — and
 * the gap between the two used to be closed by a model reading the image.
 * There is no API any more, so it is closed here instead, out of the geometry
 * the OCR already measured and gave away for nothing.
 *
 * ## Why this is not the thing CLAUDE.md forbids
 *
 * Nothing here proposes a reading. Every character it emits was read off the
 * pixels by Tesseract; what it adds is *where the lines sit relative to one
 * another*, which is a measurement rather than a judgement. That makes it the
 * first step of the pipeline and not a substitute for the rest of it: a draft
 * is what a person or a session then **corrects against the render**, which is
 * a far smaller job than transcribing a leaf from nothing and — this is the
 * part that matters — a job whose input is a text and an image rather than an
 * image alone. A reader that never writes unprompted cannot confabulate a
 * paragraph.
 *
 * So a draft is explicitly *not* a transcription. It is the left-hand column of
 * one, and `structural` says out loud everywhere it guessed.
 *
 * Pure: no DOM, no I/O, no network.
 */

/** One word as OCR read it. The browser's `OcrWord` satisfies this. */
export interface DraftWord {
  text: string
  /** 0–100, a real engine probability (SPEC §4). */
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

/** A run of words OCR set on one baseline. */
export interface DraftLine {
  text: string
  words: DraftWord[]
  top: number
  bottom: number
  left: number
  right: number
}

export interface DraftBlock {
  kind: 'paragraph' | 'heading' | 'caption'
  text: string
}

export interface DraftSpan {
  text: string
  alternatives: string[]
  reason: string
}

export interface DraftPage {
  /**
   * A guess, and the field most likely to be wrong.
   *
   * Read off the words alone — this cannot see that a leaf is a plate, or that
   * the page it is looking at is the second of a three-leaf contents. Always
   * worth checking; `structural` says so.
   */
  role: string
  blocks: DraftBlock[]
  /** Runs of words OCR itself was unsure of, as spans to look at. */
  uncertain: DraftSpan[]
  furniture: { runningHead?: string; folio?: string }
  /**
   * What the draft guessed rather than measured, in plain language.
   *
   * Not a warning list to be cleared: it is the reading order for whoever
   * checks the draft against the render, so the checking starts where the
   * draft is weakest instead of at the top of the page.
   */
  structural: string[]
}

export interface DraftOptions {
  /**
   * Below this confidence a word becomes part of an uncertain span.
   *
   * 60 rather than something higher because Tesseract scores a correctly-read
   * word in a worn face down into the seventies routinely, and a list that
   * flags a third of the page is a list nobody reads.
   */
  uncertainBelow?: number
}

const DEFAULTS = { uncertainBelow: 60 }

/**
 * How much of a word's height must sit inside a line's band to join it.
 *
 * Low on purpose. A capital and a comma on the same baseline share far less
 * vertical extent than two lower-case letters do, and the cost of setting this
 * too high is a page torn into one-word lines.
 */
const SHARED_BAND = 0.35

/** A line separated from its neighbour by more than this is a new block. */
const PARAGRAPH_GAP = 1.6

/** Inset from the measure, both sides, before a line counts as centred. */
const CENTRED_INSET = 0.05

/** How unequal the two insets may be and still read as centred. */
const CENTRED_SLACK = 0.07

/**
 * How much shorter than the measure a centred line must be.
 *
 * Equal insets are not enough on their own, and the case that proves it is
 * ordinary: a paragraph's indented first line that happens to break a word
 * early is inset on the left by the indent and on the right by the break, and
 * the two can match to the pixel. Requiring real slack as well separates a
 * centred display line — which is nearly always far short of the measure —
 * from a full line that merely starts and ends in the wrong places.
 */
const CENTRED_SLACK_TOTAL = 0.15

/** A first line indented by this much of the measure starts a paragraph. */
const INDENT = 0.015

/** Short enough, and set apart enough, to be a running head or a folio. */
const FURNITURE_WIDTH = 0.6
const FURNITURE_GAP = 2

/**
 * Taller than the body by this much, and the line is display type.
 *
 * The rule that stops a contents page losing its own title. A running head and
 * a chapter's display heading sit in the same place — alone at the top, short,
 * with white space under them — so position cannot tell them apart and the
 * first version of this swallowed "SYNOPSIS OF THE LESSONS" into
 * `furniture.runningHead`, taking the leaf's title off the page. What does
 * separate them is size: a running head is set at the body size or under it,
 * and a display line is set over it.
 *
 * Measured on the line's *tallest* word rather than its median, because the
 * line this most matters for is often the one OCR read worst — a letterspaced
 * display title comes back as a couple of real words and a row of dashes, and
 * a dash has almost no height at all.
 */
const DISPLAY_HEIGHT = 1.2

const BARE_NUMBER = /^[\s.[\]()]*([0-9]{1,4}|[ivxlcdm]{1,7})[\s.[\]()]*$/i
const CONTENTS_TITLE = /^\s*(synopsis|contents|table of contents)\b/i
const NUMBER_LINE = /^\s*(lesson|chapter|part|book|section)\b[\s.]*[0-9ivxlcdm]*\s*\.?\s*$/i

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const half = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[half]! : (sorted[half - 1]! + sorted[half]!) / 2
}

/**
 * Gather words onto the lines they were printed on.
 *
 * Each word joins the line whose vertical band it **overlaps most**, and only
 * where that overlap covers a fair part of the word's own height. Overlap
 * rather than distance, and every open line rather than just the last one,
 * because the first version of this did the opposite and scrambled the page:
 * words are fed in by their top edge, a word whose box sits a few pixels low —
 * a quotation mark, a descender, a letter the scan thickened — sorted after
 * its neighbours, fell outside the tolerance, and opened a line of its own,
 * which the *next* line's words then joined. The visible symptom was the last
 * word of every line appearing at the end of the line below it, and the
 * knock-on was worse: a line robbed of its final word looks inset on the
 * right, so it reads as centred, so it was called a heading.
 *
 * **Single-column matter only.** Two columns come back interleaved, because
 * nothing here knows a column from a wide line.
 */
export function toLines(words: readonly DraftWord[], tolerance: number): DraftLine[] {
  interface Band {
    top: number
    bottom: number
    words: DraftWord[]
  }
  const bands: Band[] = []
  const byTop = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0)

  for (const word of byTop) {
    const height = Math.max(1, word.bbox.y1 - word.bbox.y0)
    let best: Band | null = null
    let bestShare = 0
    for (const band of bands) {
      const shared = Math.min(band.bottom, word.bbox.y1) - Math.max(band.top, word.bbox.y0)
      const share = shared / height
      if (share > bestShare) {
        bestShare = share
        best = band
      }
    }
    if (best && bestShare >= SHARED_BAND) {
      best.words.push(word)
      // The band is the running *mean* of its words, not their union: taking
      // the union lets one tall word widen a line until it swallows the next.
      best.top = best.words.reduce((sum, w) => sum + w.bbox.y0, 0) / best.words.length
      best.bottom = best.words.reduce((sum, w) => sum + w.bbox.y1, 0) / best.words.length
    } else {
      bands.push({ top: word.bbox.y0, bottom: word.bbox.y1, words: [word] })
    }
  }

  // `tolerance` survives as the last resort for a page whose boxes overlap
  // nothing — a face set so loosely that consecutive lines share no pixels.
  // Bands closer together than this are the same line after all.
  const merged: Band[] = []
  for (const band of bands.sort((a, b) => (a.top + a.bottom) / 2 - (b.top + b.bottom) / 2)) {
    const previous = merged[merged.length - 1]
    const centre = (band.top + band.bottom) / 2
    if (previous && Math.abs((previous.top + previous.bottom) / 2 - centre) < tolerance * 0.4) {
      previous.words.push(...band.words)
      previous.top = previous.words.reduce((s, w) => s + w.bbox.y0, 0) / previous.words.length
      previous.bottom = previous.words.reduce((s, w) => s + w.bbox.y1, 0) / previous.words.length
    } else {
      merged.push(band)
    }
  }

  return merged.map((band) => {
    const ordered = [...band.words].sort((a, b) => a.bbox.x0 - b.bbox.x0)
    return {
      text: ordered.map((w) => w.text).join(' '),
      words: ordered,
      top: Math.min(...ordered.map((w) => w.bbox.y0)),
      bottom: Math.max(...ordered.map((w) => w.bbox.y1)),
      left: Math.min(...ordered.map((w) => w.bbox.x0)),
      right: Math.max(...ordered.map((w) => w.bbox.x1))
    }
  })
}

interface Measure {
  left: number
  right: number
  width: number
}

/**
 * The measure the page was set to.
 *
 * The *median* edge rather than the extreme one, because a single line running
 * into the gutter or a stray mark in the margin would otherwise widen the
 * measure and stop every real indent from registering.
 */
function measureOf(lines: readonly DraftLine[]): Measure {
  const left = median(lines.map((l) => l.left))
  const right = median(lines.map((l) => l.right))
  return { left, right, width: Math.max(1, right - left) }
}

function isCentred(line: DraftLine, measure: Measure): boolean {
  const before = line.left - measure.left
  const after = measure.right - line.right
  if (before < measure.width * CENTRED_INSET) return false
  if (after < measure.width * CENTRED_INSET) return false
  if (before + after < measure.width * CENTRED_SLACK_TOTAL) return false
  return Math.abs(before - after) < measure.width * CENTRED_SLACK
}

/** Set hard against the right margin and nowhere near the left — a folio line. */
function isRightAligned(line: DraftLine, measure: Measure): boolean {
  const before = line.left - measure.left
  const after = measure.right - line.right
  return before > measure.width * 0.4 && after < measure.width * CENTRED_INSET
}

function isIndented(line: DraftLine, measure: Measure): boolean {
  return line.left - measure.left > measure.width * INDENT
}

/**
 * Where the running head and the folio are, if the page prints them.
 *
 * A short line at the very top or bottom, set apart from the text block by a
 * clear gap, and **not set larger than the body**. All three tests are
 * required: a last line of a paragraph is set apart, a chapter's title is
 * short, and a page's display heading is both — so any two of them together
 * still take something off the leaf that belongs on it.
 */
function takeFurniture(
  lines: DraftLine[],
  measure: Measure,
  gap: number,
  bodyHeight: number,
  said: string[]
): { runningHead?: string; folio?: string } {
  const furniture: { runningHead?: string; folio?: string } = {}
  const detach = (at: 'first' | 'last'): DraftLine | null => {
    if (lines.length < 3) return null
    const line = at === 'first' ? lines[0]! : lines[lines.length - 1]!
    const neighbour = at === 'first' ? lines[1]! : lines[lines.length - 2]!
    const between = at === 'first' ? neighbour.top - line.bottom : line.top - neighbour.bottom
    if (between < gap * FURNITURE_GAP) return null
    if (line.right - line.left > measure.width * FURNITURE_WIDTH) return null
    const tallest = Math.max(...line.words.map((w) => w.bbox.y1 - w.bbox.y0))
    if (tallest > bodyHeight * DISPLAY_HEIGHT) {
      said.push(
        `"${line.text.trim()}" sits where a running head sits but is set larger than the body ` +
          `(${Math.round(tallest)} against ${Math.round(bodyHeight)}), so it was kept as text.`
      )
      return null
    }
    if (at === 'first') lines.shift()
    else lines.pop()
    return line
  }

  for (const at of ['first', 'last'] as const) {
    const line = detach(at)
    if (!line) continue
    const tallest = Math.max(...line.words.map((w) => w.bbox.y1 - w.bbox.y0))
    if (BARE_NUMBER.test(line.text)) furniture.folio = line.text.trim()
    else furniture.runningHead = line.text.trim()
    said.push(
      `"${line.text.trim()}" was taken off the ${at === 'first' ? 'top' : 'foot'} of the leaf as ` +
        `${BARE_NUMBER.test(line.text) ? 'a folio' : 'a running head'}: it is short, set apart, ` +
        `and no taller than the body (${Math.round(tallest)} against ${Math.round(bodyHeight)}). ` +
        'Check it is not part of the text.'
    )
  }
  return furniture
}

/**
 * Guess what kind of leaf this is.
 *
 * Deliberately shallow. Only the cases a single leaf can actually evidence get
 * a guess; everything else is `body`, which is what most leaves are and which
 * is the cheapest guess to correct.
 */
function guessRole(lines: readonly DraftLine[]): string {
  if (lines.length === 0) return 'blank'
  const opening = lines
    .slice(0, 3)
    .map((l) => l.text)
    .join(' ')
  if (CONTENTS_TITLE.test(opening)) return 'table-of-contents'
  if (NUMBER_LINE.test(lines[0]!.text.trim())) return 'chapter-opening'
  return 'body'
}

/** Consecutive words OCR scored low, gathered into spans worth looking at. */
function uncertainSpans(lines: readonly DraftLine[], below: number): DraftSpan[] {
  const spans: DraftSpan[] = []
  let run: DraftWord[] = []
  const flush = (): void => {
    if (run.length === 0) return
    const scores = run.map((w) => Math.round(w.confidence))
    const low = Math.min(...scores)
    const high = Math.max(...scores)
    spans.push({
      text: run.map((w) => w.text).join(' '),
      alternatives: [],
      reason: low === high ? `OCR confidence ${low}` : `OCR confidence ${low}–${high}`
    })
    run = []
  }
  for (const line of lines) {
    for (const word of line.words) {
      if (word.confidence < below) run.push(word)
      else flush()
    }
    flush()
  }
  return spans
}

/**
 * A page of OCR words, drafted as a page of blocks.
 *
 * Three things break a block: a vertical gap wider than the page's own
 * leading, a first-line indent, and a line changing between centred and
 * ranged left. Deliberately no "the previous line ended short" rule — it is
 * right about most paragraph ends and wrong about every sentence that happens
 * to finish near the margin, and a wrongly split paragraph is harder to see in
 * a diff than a wrongly joined one.
 */
export function draftPage(words: readonly DraftWord[], options: DraftOptions = {}): DraftPage {
  const uncertainBelow = options.uncertainBelow ?? DEFAULTS.uncertainBelow
  const structural: string[] = []

  const usable = words.filter((w) => w.text.trim().length > 0)
  if (usable.length === 0) {
    return { role: 'blank', blocks: [], uncertain: [], furniture: {}, structural: [] }
  }

  const heights = usable.map((w) => w.bbox.y1 - w.bbox.y0)
  const bodyHeight = median(heights)
  const lines = toLines(usable, Math.max(1, bodyHeight * 0.5))
  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i]!.top - lines[i - 1]!.bottom)
  const gap = Math.max(1, median(gaps))

  const measure = measureOf(lines)
  const furniture = takeFurniture(lines, measure, gap, bodyHeight, structural)

  const body = measureOf(lines)
  const blocks: DraftBlock[] = []
  let run: DraftLine[] = []

  const flush = (): void => {
    if (run.length === 0) return
    const centred = run.every((l) => isCentred(l, body))
    const right = run.length === 1 && isRightAligned(run[0]!, body)
    const text = run
      .map((l) => l.text.trim())
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim()
    if (text.length > 0) {
      blocks.push({ kind: centred ? 'heading' : right ? 'caption' : 'paragraph', text })
    }
    run = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const previous = lines[i - 1]
    if (previous) {
      const between = line.top - previous.bottom
      const wide = between > gap * PARAGRAPH_GAP
      const indented = isIndented(line, body)
      const switched = isCentred(line, body) !== isCentred(previous, body)
      if (wide || indented || switched) flush()
    }
    run.push(line)
  }
  flush()

  const headings = blocks.filter((b) => b.kind === 'heading').length
  if (headings > 0) {
    structural.push(
      `${headings} block(s) were called headings because their lines are inset equally on both ` +
        'sides. Verse, an epigraph and a centred caption look the same to this and are not headings.'
    )
  }
  structural.push('The role, and every block kind, is a guess. The words are what OCR read.')

  return {
    role: guessRole(lines),
    blocks,
    uncertain: uncertainSpans(lines, uncertainBelow),
    furniture,
    structural
  }
}
