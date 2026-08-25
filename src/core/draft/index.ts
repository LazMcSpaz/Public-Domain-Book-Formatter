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
 * ## Everything here is measured against real pages
 *
 * Three geometric faults shipped from this file, and none of them was caught by
 * tests built from hand-written boxes, because the faults live in the shape of
 * real OCR output. The constants below are set from `test/fixtures/boxes` —
 * twelve leaves off three scans, in two typographic regimes — and the numbers
 * that justify each one are recorded beside it. Do not tune one to make a page
 * come out nicer; measure it, and say what the new value costs.
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
   *
   * **Every furniture decision speaks here, taken or declined**, with the
   * numbers it turned on. Silence on a decline is what let twelve real running
   * heads go into the body text with nothing to point at them.
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
 * How far a word's centre may sit from its neighbour's and still be the same
 * line, as a share of the body height.
 *
 * 0.6 because a skewed scan drifts a line's centre by most of a body height
 * end to end, while the step to the *next* line is a full baseline stride —
 * on these fixtures between 42 and 107 pixels against bodies of 32 to 62. The
 * two are comfortably separated as long as the comparison is made locally.
 */
const SAME_LINE = 0.6

/**
 * A line further from its neighbour than this many times the page's own
 * baseline-to-baseline distance starts a new block.
 *
 * **Measured baseline to baseline, never top-of-line to bottom-of-the-last.**
 * The gap between one line's bottom and the next line's top is *negative* on a
 * tightly-set face — measured at −18 and −6 pixels on two leaves of the 328
 * page book, because the boxes overlap — so a threshold built from it is
 * negative too and every single line break fires. That shattered four
 * paragraphs into thirteen blocks, and worse, it destroyed the input the
 * synopsis parser needs, where a chapter's description arrived as six blocks
 * instead of one. Top-to-top is stable across every fixture leaf: 106/105/107
 * on one book, 50/50/50 on another, 80/80/80/81 on a third.
 *
 * 1.5 rather than something tighter because these books mark a new paragraph
 * with an indent and no extra leading, so this rule should fire rarely — on a
 * real blank line, a display heading, the space over a folio.
 */
const PARAGRAPH_GAP = 1.5

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
 * the two can match to the pixel.
 */
const CENTRED_SLACK_TOTAL = 0.15

/** A first line indented by this much of the measure starts a paragraph. */
const INDENT = 0.015

/**
 * Short enough, and set apart enough, to be a running head or a folio.
 *
 * `FURNITURE_WIDTH` applies to the head *after the folio has been taken off
 * it* — see `splitFurnitureLine`. Applied to the whole line it captured
 * nothing at all: both books here set the head and the folio on one line, head
 * centred and folio at the outer margin, so the line spans 72–95% of the
 * measure. Against a 60% ceiling that is 0 of 6 real running heads taken, and
 * the original edition's folio going into the body text on every leaf — which
 * is precisely what the front-matter rule exists to prevent.
 */
const FURNITURE_WIDTH = 0.6
const FURNITURE_GAP = 1.8

/**
 * White space before a bare number, as a share of the measure, for it to be a
 * folio rather than a figure at the end of a sentence.
 *
 * The decisive piece of evidence for furniture, and the one that needs no
 * threshold on the head at all.
 *
 * **Measured across every real running head in the fixtures:** 24.4, 25.9,
 * 25.1, 21.0, 20.8, 19.9 and 13.1 per cent, plus two long-headed outliers at
 * 4.3 and 4.0 — `TELEPATHY vs. CLAIRVOYANCE 37` and
 * `PSYCHIC, MAGNETIC HEALING 319`, whose heads nearly fill the measure and
 * leave the folio little room. A word space on these pages is about 1 per
 * cent. So 3 clears every real head with margin and still sits three times a
 * word space.
 *
 * Set from that distribution rather than from taste, and it was 6 until the
 * two outliers were measured — which is the difference between tuning a
 * number until a page looks right and reading it off the pages.
 */
const FOLIO_GAP = 0.03

/**
 * Taller than the body by this much, and the line is display type.
 *
 * The rule that stops a contents page losing its own title. A running head and
 * a chapter's display heading sit in the same place — alone at the top, short,
 * with white space under them — so position cannot tell them apart. Size can.
 *
 * Measured on the line's *tallest* word rather than its median, because the
 * line this most matters for is often the one OCR read worst: a letterspaced
 * display title comes back as a couple of real words and a row of dashes, and
 * a dash has almost no height at all.
 *
 * 1.35 rather than 1.2, which was set from nothing and rejected a real running
 * head measured at 75 pixels against a 60-pixel body — a ratio of 1.25, well
 * inside the noise a tall capital and a descender put on a single line. This
 * test now only has to catch display type that carries **no folio at the
 * margin**, since a folio outranks it entirely, so it can afford to be
 * generous. The case it still exists for is a leaf's own title set alone at
 * the top, which is set far larger than 1.35.
 */
const DISPLAY_HEIGHT = 1.35

/**
 * A word taller than this many times the body is not body text.
 *
 * A drop capital, a mis-segmented box spanning two lines, a speck of dirt read
 * as a letter. Such a word may not *recruit* others onto its line — see
 * `toLines` — and it is reported, because on a real leaf a three-line drop
 * capital read as a stray `=` split one paragraph into three and took the
 * initial letter off the page.
 */
const OVERSIZE = 1.8

/** At least this many letters or digits before a line can be furniture. */
const FURNITURE_MIN_ALNUM = 2

/** And at least this share of its characters, or it is a printer's rule. */
const FURNITURE_ALNUM_SHARE = 0.5

const BARE_NUMBER = /^[\s.[\]()]*([0-9]{1,4}|[ivxlcdm]{1,7})[\s.[\]()]*$/i

/**
 * A folio printed beside a running head. **Digits only.**
 *
 * `BARE_NUMBER` accepts roman numerals case-insensitively, which is right for a
 * folio standing alone on a line but disastrous beside a head: `civil.`,
 * `mild.`, `did.` and `vivid.` are all ordinary words spelled from
 * `i v x l c d m`, and taking one for a folio lifts a line of prose off the
 * leaf. A roman folio does occur in front matter, where it stands alone and is
 * still matched by `BARE_NUMBER`.
 */
const FOLIO_NUMBER = /^[\s.[\]()]*[0-9]{1,4}[\s.[\]()]*$/
const CONTENTS_TITLE = /^\s*(synopsis|contents|table of contents)\b/i
const NUMBER_LINE = /^\s*(lesson|chapter|part|book|section)\b[\s.]*[0-9ivxlcdm]*\s*\.?\s*$/i

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const half = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[half]! : (sorted[half - 1]! + sorted[half]!) / 2
}

const centreOf = (word: DraftWord): number => (word.bbox.y0 + word.bbox.y1) / 2

const heightOf = (word: DraftWord): number => Math.max(1, word.bbox.y1 - word.bbox.y0)

/** Letters and digits only — what a line has to have some of to be furniture. */
function alnum(text: string): string {
  return text.replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * Gather words onto the lines they were printed on.
 *
 * A word's candidate lines are every open band it overlaps by at least
 * `SHARED_BAND` of its own height; among those it joins the one whose **centre
 * is nearest**, not the one it overlaps most.
 *
 * Both halves of that are load-bearing, and each fixes a shipped bug.
 *
 * *Every open band, not the most recent.* Words arrive sorted by top edge, so a
 * word whose box sits a few pixels low — a quotation mark, a descender, a
 * letter the scan thickened — used to fall outside the tolerance of the
 * current line and open a band of its own, which the next line's words then
 * joined. The symptom was the last word of every line appearing at the end of
 * the line below it.
 *
 * *Nearest centre, not greatest overlap.* Overlap is measured against the
 * word's own height, so a **short word lying entirely inside a tall band scores
 * a perfect 1.0** — and a tall band is exactly what a mis-segmented box makes.
 * On leaf 7 of the 328-page book, Tesseract split `beyond` into `beyon` and a
 * fragment it read as `:` whose box spans two lines; every small word inside
 * that band preferred it to its own line. Centre distance is not fooled: the
 * fragment's band is centred between two lines and therefore near neither.
 *
 * **Single-column matter only.** Two columns come back interleaved, because
 * nothing here knows a column from a wide line.
 */
export function toLines(words: readonly DraftWord[], bodyHeight: number): DraftLine[] {
  interface Band {
    centre: number
    top: number
    bottom: number
    words: DraftWord[]
  }
  const body = Math.max(1, bodyHeight)
  const usable = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0)

  // Two passes, and the split is the whole of the fix.
  //
  // An oversize box — a drop capital, or one OCR ran across two lines — must
  // neither recruit other words onto its line nor open a line of its own. The
  // first would gather two real lines into one; the second is subtler and is
  // what shipped: the box's centre falls *between* two lines, so its band
  // sorts between them and its text surfaces mid-sentence. That is exactly
  // `…prove beyon : doubt…`, where the `:` is the `d` of `beyond` in a box
  // twice the body height.
  //
  // So the lines are built from body-sized words alone, and the oversize ones
  // are then dropped onto whichever line they physically cover most.
  const oversize = usable.filter((w) => heightOf(w) > body * OVERSIZE)
  const ordinary = usable.filter((w) => heightOf(w) <= body * OVERSIZE)
  const bands: Band[] = []

  const midX = (w: DraftWord): number => (w.bbox.x0 + w.bbox.x1) / 2

  for (const word of ordinary) {
    const centre = centreOf(word)
    const x = midX(word)
    let best: Band | null = null
    let nearest = Infinity
    for (const band of bands) {
      // Compared against the band's word **nearest in x**, not against the
      // band's average height on the page.
      //
      // Scans are skewed. Measured on leaf 6 of the 328-page book, one line's
      // word centres drift from 902 to 934 across the measure — 32 pixels,
      // against a 35-pixel body — so a line's last word sits nearer the *next*
      // line's first word than its own line's first word. Any rule built on a
      // whole-line average tears such a page apart and reassembles it wrong,
      // which is what put a second "The" in front of "skeptical".
      //
      // Neighbouring words on a skewed line have near-identical centres
      // whatever the slope, so a local comparison needs no angle estimated and
      // no line fitted.
      let closestInX: DraftWord | null = null
      let closestGap = Infinity
      for (const other of band.words) {
        const gap = Math.abs(midX(other) - x)
        if (gap < closestGap) {
          closestGap = gap
          closestInX = other
        }
      }
      if (!closestInX) continue
      const drop = Math.abs(centreOf(closestInX) - centre)
      if (drop > body * SAME_LINE) continue
      if (drop < nearest) {
        nearest = drop
        best = band
      }
    }
    if (best) {
      best.words.push(word)
      best.top = Math.min(best.top, word.bbox.y0)
      best.bottom = Math.max(best.bottom, word.bbox.y1)
      best.centre = best.words.reduce((sum, w) => sum + centreOf(w), 0) / best.words.length
    } else {
      bands.push({ centre, top: word.bbox.y0, bottom: word.bbox.y1, words: [word] })
    }
  }

  // One line split in two — a word set high enough that it matched nothing.
  // Merged only when the two bands overlap in x *and* their nearest words
  // agree in height, for the same reason the matching above is local: on a
  // skewed page two bands can differ by a whole body height end to end and
  // still be one line.
  const merged: Band[] = []
  for (const band of [...bands].sort((a, b) => a.centre - b.centre)) {
    const previous = merged[merged.length - 1]
    if (previous) {
      const near = previous.words.reduce(
        (best, w) =>
          Math.abs(midX(w) - midX(band.words[0]!)) < Math.abs(midX(best) - midX(band.words[0]!))
            ? w
            : best,
        previous.words[0]!
      )
      if (Math.abs(centreOf(near) - centreOf(band.words[0]!)) < body * SAME_LINE) {
        previous.words.push(...band.words)
        previous.top = Math.min(previous.top, band.top)
        previous.bottom = Math.max(previous.bottom, band.bottom)
        previous.centre =
          previous.words.reduce((s2, w) => s2 + centreOf(w), 0) / previous.words.length
        continue
      }
    }
    merged.push(band)
  }

  // Now the oversize ones, onto the line each covers most. Absolute shared
  // extent rather than a ratio: the question is which line the box is sitting
  // on, and a tall box overlaps a short line completely either way.
  for (const word of oversize) {
    let best: Band | null = null
    let most = 0
    for (const band of merged) {
      const shared = Math.min(band.bottom, word.bbox.y1) - Math.max(band.top, word.bbox.y0)
      if (shared > most) {
        most = shared
        best = band
      }
    }
    if (best) best.words.push(word)
    else
      merged.push({
        centre: centreOf(word),
        top: word.bbox.y0,
        bottom: word.bbox.y1,
        words: [word]
      })
  }

  return merged
    .sort((a, b) => a.centre - b.centre)
    .map((band) => {
      const ordered = [...band.words].sort((a, b) => a.bbox.x0 - b.bbox.x0)
      return {
        text: ordered.map((w) => w.text).join(' '),
        words: ordered,
        // `top` and `bottom` come from the band, which was built from
        // body-sized words alone — **not** from `ordered`, which includes any
        // oversize word dropped on afterwards.
        //
        // Recomputing them over every word let a drop capital become the
        // line's top: on a real chapter opening the `E` of `EVERY` is 244
        // pixels against a 62-pixel body, which turned strides of 107 and 105
        // into 3 and 209 and broke the opening paragraph in two at a
        // line-wrap hyphen — `ad-` / `vanced`, which nothing downstream heals
        // because hyphen healing only runs at page seams.
        top: band.top,
        bottom: band.bottom,
        // Left and right *do* take the oversize word in, because a drop
        // capital really is where the line begins and the measure should say
        // so.
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
 * Pull a folio off the end of a running-head line.
 *
 * Older books set the head and the folio on one line — the head centred, the
 * number out at the outer margin — so the *line* spans most of the measure
 * while the head itself is short. Judging the whole line's width took none of
 * them.
 *
 * Returns the head and the folio separately, or null when the line does not
 * come apart that way.
 */
/**
 * Whether the head itself — not the line it came off — is short enough.
 *
 * Measured, never inferred from the fact that something was peeled off the
 * end. The first version returned true the moment `splitFurnitureLine` took a
 * token, so a full-measure line of prose ending in a year, or in one of the
 * ordinary words spelled from roman numerals (`civil.`, `mild.`, `did.`),
 * left the text flow as a running head.
 */
function shortHead(headWidth: number, measure: Measure): boolean {
  return headWidth <= measure.width * FURNITURE_WIDTH
}

function splitFurnitureLine(
  line: DraftLine
): { head: string; folio: string | null; folioGap: number; headWidth: number } | null {
  const words = line.words
  if (words.length === 0) return null

  const widthOf = (from: number, to: number): number => {
    const span = words.slice(from, to)
    if (span.length === 0) return Infinity
    return Math.max(...span.map((w) => w.bbox.x1)) - Math.min(...span.map((w) => w.bbox.x0))
  }

  // The folio sits at one end or the other — verso books put it left, recto
  // right, and a book alternates. Try both ends before giving up.
  const first = words[0]!
  const last = words[words.length - 1]!
  // The white space between the folio and the head is the evidence that this
  // is furniture at all — a running head is set with its folio out at the
  // margin, while a line of prose that happens to end in a number does not
  // leave a quarter of an inch before it.
  if (words.length > 1 && FOLIO_NUMBER.test(last.text)) {
    return {
      head: words
        .slice(0, -1)
        .map((w) => w.text)
        .join(' '),
      folio: last.text.trim(),
      folioGap: last.bbox.x0 - words[words.length - 2]!.bbox.x1,
      headWidth: widthOf(0, words.length - 1)
    }
  }
  if (words.length > 1 && FOLIO_NUMBER.test(first.text)) {
    return {
      head: words
        .slice(1)
        .map((w) => w.text)
        .join(' '),
      folio: first.text.trim(),
      folioGap: words[1]!.bbox.x0 - first.bbox.x1,
      headWidth: widthOf(1, words.length)
    }
  }
  // No folio on the line at all.
  return { head: line.text, folio: null, folioGap: 0, headWidth: widthOf(0, words.length) }
}

/**
 * Where the running head and the folio are, if the page prints them.
 *
 * Four tests, and a candidate must pass all of them. Each one is here because
 * leaving it out took something off a leaf that belonged on it, measured
 * across twelve real leaves where the first version of this took four lines
 * and every one was wrong.
 *
 * - **Set apart** from the text block. A line snug against the body is body.
 * - **Short**, after any folio is taken off it (see `splitFurnitureLine`).
 * - **No taller than the body.** A display heading sits exactly where a running
 *   head sits; only size separates them.
 * - **Made of words.** `ON — —— ———` is a printer's rule that OCR mangled, and
 *   `-_` is a speck on a back cover. Neither is a running head.
 *
 * Two more rules apply to what a candidate *says* rather than where it sits.
 * A line reading `LESSON XIII.` is a chapter's number, not a running head —
 * taking it strips the number off a "number over a name" chapter opening
 * before `deriveChapters` ever sees it. And at the **foot** of a leaf only a
 * folio is taken: `FINIS.` is the book's colophon and belongs in the text.
 */
function takeFurniture(
  lines: DraftLine[],
  measure: Measure,
  gap: number,
  bodyHeight: number,
  said: string[]
): { runningHead?: string; folio?: string } {
  const furniture: { runningHead?: string; folio?: string } = {}

  const consider = (at: 'first' | 'last'): void => {
    if (lines.length < 3) return
    const where = at === 'first' ? 'top' : 'foot'
    const line = at === 'first' ? lines[0]! : lines[lines.length - 1]!
    const neighbour = at === 'first' ? lines[1]! : lines[lines.length - 2]!
    const text = line.text.trim()
    const say = (why: string): void => {
      said.push(`"${text}" sits at the ${where} of the leaf but was kept as text: ${why}`)
    }

    const between = at === 'first' ? neighbour.top - line.bottom : line.top - neighbour.bottom
    if (between < gap * FURNITURE_GAP) return

    const letters = alnum(text)
    if (
      letters.length < FURNITURE_MIN_ALNUM ||
      letters.length < text.length * FURNITURE_ALNUM_SHARE
    ) {
      say(
        `it is mostly not letters or digits (${letters.length} of ${text.length}), so it reads as a printer's rule or a speck rather than a running head`
      )
      return
    }

    const split = splitFurnitureLine(line)
    // A bare number set off at the margin is what a folio *is*, and no line of
    // prose does it. Where that is present the head beside it is a running
    // head whatever its width or its size — which is what rescued
    // "TELEPATHY vs. CLAIRVOYANCE 37" (91% of the measure) and
    // "PSYCHIC, MAGNETIC HEALING 319" (75 pixels against a 60-pixel body),
    // both real running heads that the width and display tests threw away.
    const folioAtMargin =
      split !== null && split.folio !== null && split.folioGap > measure.width * FOLIO_GAP

    const tallest = Math.max(...line.words.map((w) => w.bbox.y1 - w.bbox.y0))
    if (!folioAtMargin && tallest > bodyHeight * DISPLAY_HEIGHT) {
      say(
        `it is set larger than the body (${Math.round(tallest)} against ${Math.round(bodyHeight)}), so it is display type`
      )
      return
    }

    if (NUMBER_LINE.test(text)) {
      say(
        'it is a chapter number line, and taking it would strip the number off the chapter opening'
      )
      return
    }

    if (!split) return
    if (!folioAtMargin && !shortHead(split.headWidth, measure)) {
      say(
        `its head is ${Math.round((split.headWidth / measure.width) * 100)}% of the measure` +
          ' and no folio is set off at the margin beside it'
      )
      return
    }

    if (at === 'last') {
      // Only a folio comes off the foot. A colophon, a catchword or a
      // signature mark is text, and filing it as `runningHead` — which is what
      // happened to `FINIS.` — both loses it and mislabels it.
      if (BARE_NUMBER.test(text)) {
        furniture.folio = text
        lines.pop()
        said.push(`"${text}" was taken off the foot as a folio.`)
      } else {
        say('only a folio is taken off the foot of a leaf; anything else there is text')
      }
      return
    }

    lines.shift()
    if (split.folio) furniture.folio = split.folio
    if (BARE_NUMBER.test(split.head)) {
      furniture.folio = split.head.trim()
      said.push(`"${text}" was taken off the top as a folio.`)
    } else {
      furniture.runningHead = split.head.trim()
      said.push(
        `"${text}" was taken off the top as a running head` +
          (split.folio ? ` with the folio "${split.folio}"` : '') +
          '. Check it is not the first line of the text.'
      )
    }
  }

  consider('first')
  consider('last')
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
 * Three things break a block: a baseline-to-baseline distance wider than the
 * page's own, a first-line indent, and a line changing between centred and
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
    return {
      role: 'blank',
      blocks: [],
      uncertain: [],
      furniture: {},
      // Never an empty `structural`. A leaf with no words is either genuinely
      // blank or a leaf nothing read — a cache with no entry for it, an OCR
      // pass that failed, a page handed here by mistake — and the two are
      // indistinguishable from the outside. Returning silence made this the
      // one shape of draft that could not say it was a guess, which is the
      // property every other draft here is built to have.
      structural: [
        'No words reached this leaf, so it is called blank. That is also what a ' +
          'leaf looks like when nothing read it — check the render before believing it.'
      ]
    }
  }

  const bodyHeight = median(usable.map(heightOf))
  const lines = toLines(usable, bodyHeight)

  // Baseline to baseline, never bottom-to-top. See PARAGRAPH_GAP.
  const strides: number[] = []
  for (let i = 1; i < lines.length; i++) strides.push(lines[i]!.top - lines[i - 1]!.top)
  const stride = Math.max(1, median(strides))

  // The set-apart test still wants the white space between two lines, which is
  // the stride less the body. Derived rather than measured, because measuring
  // it directly is what went negative.
  const white = Math.max(1, stride - bodyHeight)

  const measure = measureOf(lines)
  const furniture = takeFurniture(lines, measure, white, bodyHeight, structural)

  const oversize = usable.filter((w) => heightOf(w) > bodyHeight * OVERSIZE)
  if (oversize.length > 0) {
    structural.push(
      `${oversize.length} word(s) are far taller than the body — ` +
        `${oversize
          .slice(0, 4)
          .map((w) => `"${w.text}"`)
          .join(', ')}. A drop capital, or a box OCR ran across two lines. ` +
        'The letters under one are usually wrong and are worth reading off the render.'
    )
  }

  const body = measureOf(lines)

  // The lines a drop capital pushes to the right.
  //
  // A three-line initial holds the next two or three lines off the margin, and
  // an inset is exactly what the indent rule looks for — so a chapter opening
  // broke into a fresh block at every line beside its own initial, splitting
  // the first paragraph at a line-wrap hyphen (`ad-` / `vanced`) that nothing
  // downstream heals, because hyphen healing only runs at page seams.
  //
  // Measured rather than assumed: a capital counts only if it is oversize *and*
  // sits at the left margin, and only the lines its box actually spans are
  // exempted.
  const initials = usable.filter(
    (w) => heightOf(w) > bodyHeight * OVERSIZE && w.bbox.x0 <= body.left + body.width * 0.05
  )
  const besideInitial = (line: DraftLine): boolean =>
    initials.some((c) => line.top < c.bbox.y1 && line.bottom > c.bbox.y0)
  if (initials.length > 0) {
    structural.push(
      `${initials.length} drop capital(s) at the left margin. The lines beside one are inset by ` +
        'it, so they are not read as new paragraphs — and the letter under one is often ' +
        'mis-read, so check the word it begins against the render.'
    )
  }

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
      const wide = line.top - previous.top > stride * PARAGRAPH_GAP
      const indented = !besideInitial(line) && isIndented(line, body)
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
  // Said out loud because nothing downstream will do anything about it, and it
  // is invisible until a page is rendered. Lines are joined with a space, so a
  // hyphen the compositor set at a line break survives as `ad- vanced` and
  // *prints that way*: assembly's hyphen healing runs at page seams only. On
  // the first real book through here that was 301 of them, past every check —
  // both OCR engines break the lines in the same places, so no second reader
  // disagrees, and a leaf read by eye looks right because the paper breaks
  // there too.
  //
  // Not healed here, because the page cannot settle it: `counter-part` joins
  // and `thought-transference` must keep its hyphen. Counting them is the most
  // this can honestly do.
  const wrapped = blocks.reduce((n, b) => n + [...b.text.matchAll(/\w+-\s+\w+/gu)].length, 0)
  if (wrapped > 0) {
    structural.push(
      `${wrapped} line-break hyphen(s) are left as \`ad- vanced\`, and nothing downstream heals ` +
        'them — hyphen healing runs at page seams only, so they print mid-line. Join the ones ' +
        'that are one word and keep the hyphen on the ones that are two.'
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
