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

import { namesFolio, asFolio, looksLikeSignature } from './folios'
import { healWrappedHyphens, tally, type HyphenVerdict, type Vocabulary } from './hyphens'

export interface DraftBlock {
  kind: 'paragraph' | 'heading' | 'caption' | 'footnote'
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
  furniture: { runningHead?: string; folio?: string; stamp?: string[]; signature?: string }
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
  /**
   * Every line-break hyphen on the leaf and what the book made of it.
   *
   * Empty when no vocabulary was supplied, which is not the same as "there were
   * none" — `structural` says which of the two it is. The `unsettled` ones are
   * the list worth a person's eyes and the only part of this that needs any.
   */
  hyphens: HyphenVerdict[]
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
  /**
   * The book's own words, for settling a line-break hyphen.
   *
   * Optional, and the behaviour without one is exactly what it was: count the
   * breaks and say they are left alone, because the page genuinely cannot
   * settle them. With one — recon has OCR'd every leaf whether or not it has
   * been read, so the whole volume's vocabulary is free — `ad- vanced` and
   * `thought- transference` stop being the same two marks. See `./hyphens`.
   */
  vocabulary?: Vocabulary
  /**
   * The folio this leaf should carry, from the volume's own numbering.
   *
   * Optional, and everything below behaves exactly as it did without one. With
   * it, a line at the top that *names* this number is furniture whatever the
   * geometry says — which is what rescues a head standing 35 off the line below
   * where the rule wants 36 — and a folio that comes off disagreeing with it is
   * reported. See `./folios`: the offset is voted by the leaves the draft took
   * confidently, never assumed.
   */
  expectedFolio?: number
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
/**
 * A line's type size, which is **not** the height of its boxes.
 *
 * A word's box is as tall as its tallest letter and as deep as its lowest, so
 * `Godfrey` and `archaeologist` measure 29–30 where `with`, `and` and `Max`
 * measure 21–23 — on the same line, in the same size. Taking the median of a
 * line's word heights therefore measures its *word mix*, and on leaf 300 of
 * Isis Vol. I it called a footnote 106% of the body and would have kept it in
 * the text.
 *
 * The lower quartile is close to the x-height, because most words in running
 * prose have neither an ascender nor a descender. Words of one character are
 * left out: a lone `*`, `1` or `.` is a reference mark or a leader, not type
 * to measure.
 *
 * Returns null on a line with too few words to measure, which is a real
 * answer and not a zero — `'+ ¢ Timeeus,” p. 22.'` is four boxes and the
 * statistic means nothing on it.
 */
function typeSize(line: DraftLine): number | null {
  const heights = line.words
    .filter((w) => w.text.trim().length >= 2)
    .map(heightOf)
    .sort((a, b) => a - b)
  if (heights.length === 0) return null
  return heights[Math.floor(heights.length / 4)]!
}

/**
 * The page's own body type size.
 *
 * An **upper quartile** rather than a median, because the body is the largest
 * text a page sets, not the commonest. A median is the commonest, and on a
 * note-heavy leaf the notes are the commonest: leaf 91 of Isis Vol. I carries
 * one footnote long enough to fill half the page, so 17 of its lines measure
 * 22 against 11 at 26, and the median called the *footnote* size the body.
 * Everything measured against it then moved with it — the stamp on that leaf
 * came out at 86% of "body" instead of 73% and was left on the leaf.
 *
 * Measured on the other seventeen fixture leaves, all of them body-dominated,
 * the two differ by 0 to 2 pixels. So this costs nothing where the median was
 * right and fixes the case where it was not.
 */
function bodyTypeSize(lines: readonly DraftLine[]): number {
  const sizes = lines
    .map(typeSize)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b)
  if (sizes.length === 0) return 1
  return sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * 0.75))]!
}

/**
 * The most trailing lines a scanner's stamp is looked for over.
 *
 * The HathiTrust footer is two lines — `Digitized by` / `Original from` above
 * `CORNELL UNIVERSITY CORNELL UNIVERSITY` — and OCR merges them into one on
 * about a third of leaves. Three is that plus room, and the cap is what keeps
 * the walk from eating a page: on leaf 7 of `tight-scramble` the biggest gap
 * on the leaf is 7.3 strides and sits under a chapter opening, so an unbounded
 * walk up from the foot would have taken the whole leaf as a stamp.
 */
/**
 * How near a miss has to be before a declined furniture line is worth naming.
 *
 * The set-apart test is the first one a candidate meets and the one nearly
 * every leaf fails, because the top line of a page of running prose sits a
 * normal line's distance from the next. Saying so on every leaf would bury the
 * declines that matter. Two-thirds of the threshold is close enough to be
 * worth a look and far enough that ordinary body text does not reach it.
 */
const FURNITURE_NEAR = 0.66

const STAMP_MAX_LINES = 3

/**
 * How far a stamp stands off the text above it, in paragraph strides.
 *
 * Measured over eighteen leaves of five books: the stamp on Isis Vol. I sits
 * **5.8 to 7.0** strides below the last line of the page, and the largest gap
 * above a *last* line anywhere else is **1.8** — on a leaf whose footnotes are
 * set in two ragged columns. Three sits clear of both.
 */
const STAMP_GAP = 3

/**
 * How much smaller than the body a stamp is set.
 *
 * The Cornell footer measures 50–73% of the body's type size, and the smallest
 * real footnote measures 77%. 0.80 separates them, and the gap test above has
 * to agree before anything is taken, so this only has to be roughly right.
 */
const STAMP_SIZE = 0.8

/**
 * How much smaller than the body a footnote is set.
 *
 * Measured across the six Isis leaves: body lines come out at 96–100% of the
 * page's type size and footnotes at 77–88%, with nothing in between. 0.92 sits
 * in that gap. A footnote is *not* required to carry a reference mark, because
 * a note running onto a second line has none — leaf 650 has two such lines —
 * and requiring one would put half a note back in the body text.
 */
/**
 * What a footnote's reference mark looks like at the head of a line.
 *
 * The marks this book actually sets are `*`, a dagger, a double dagger and
 * `§`, and OCR has no reliable glyph for the middle two: across six leaves it
 * read them as `t`, `+`, `1` and `|`. So the class is wide, and it is only
 * ever used to decide where one note *ends and another begins* — never whether
 * a line is a note at all, which the type size decides. A line of body text
 * beginning `1` is common; a line of body text set at 85% of the body is not.
 */
const FOOTNOTE_MARK = /^\s*[*†‡§¶|+t1-9]\s*[^\s]/u

const FOOTNOTE_SIZE = 0.92

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
/**
 * Take the scanner's own stamp off the foot of the leaf.
 *
 * A digitized book carries matter that was never printed on the paper: the
 * library's footer, a rights notice, a handle URL. On Isis Vol. I every one of
 * 693 leaves ends `Digitized by … CORNELL UNIVERSITY`, which OCR reads as text
 * and which would otherwise become a block on every leaf and print in the
 * book.
 *
 * It is not identified by what it *says*. OCR reads the same footer as
 * `Digitized by`, `Diaitieed by`, `— Oriainal from` and `CORMELL UNIVERSITY`
 * across six sampled leaves, so a phrase list would catch some leaves and miss
 * others — and a rule that half-works here is worse than none, because the
 * leaves it misses are the ones nobody checks.
 *
 * It is identified by **where it sits**: a short run of lines at the very foot,
 * set smaller than the body, standing several strides clear of the last line of
 * text. All three tests must pass. Each one alone has a real counter-example in
 * the fixtures — `FINIS.` is a last line set apart, a chapter opening leaves a
 * seven-stride gap under its number, and a leaf's final short line is often
 * small — and together they take the stamp on all six Isis leaves and nothing
 * at all on the twelve leaves of the four books that have no stamp.
 *
 * Removed from the lines, and **named in `structural`**, because a draft that
 * quietly drops matter off a leaf is the one shape of draft nobody can check.
 */
function takeStamp(lines: DraftLine[], stride: number, bodySize: number, said: string[]): string[] {
  if (lines.length < STAMP_MAX_LINES + 2) return []
  const run: number[] = []
  for (let i = lines.length - 1; i >= 1 && run.length < STAMP_MAX_LINES; i--) {
    const size = typeSize(lines[i]!)
    if (size === null || size > bodySize * STAMP_SIZE) break
    run.unshift(i)
    if ((lines[i]!.top - lines[i - 1]!.bottom) / stride >= STAMP_GAP) break
  }
  if (run.length === 0) return []
  const top = run[0]!
  const standoff = (lines[top]!.top - lines[top - 1]!.bottom) / stride
  if (standoff < STAMP_GAP) return []
  const taken = run.map((i) => lines[i]!.text.trim())
  // Measured before the splice: after it, `lines[top]` is gone and
  // `lines[top - 1]` is the last line of the *body*, so reporting its size
  // would describe the text this rule just decided to keep.
  const biggest = Math.max(...run.map((i) => typeSize(lines[i]!) ?? 0))
  lines.splice(top, run.length)
  said.push(
    `${taken.length} line(s) were taken off the foot as the scanner's own stamp rather than ` +
      `the book's text — ${taken.map((t) => `"${t}"`).join(', ')}. They stand ` +
      `${standoff.toFixed(1)} strides clear of the text above and are set at ` +
      `${Math.round((biggest / bodySize) * 100)}% of the body. Check the render if the book ` +
      'really does print something down there.'
  )
  return taken
}

function takeFurniture(
  lines: DraftLine[],
  measure: Measure,
  gap: number,
  bodyHeight: number,
  said: string[],
  expectedFolio?: number,
  claimedByNotes?: (line: DraftLine) => boolean
): { runningHead?: string; folio?: string; signature?: string } {
  const furniture: { runningHead?: string; folio?: string; signature?: string } = {}

  const consider = (at: 'first' | 'last'): void => {
    if (lines.length < 3) return
    const where = at === 'first' ? 'top' : 'foot'
    const line = at === 'first' ? lines[0]! : lines[lines.length - 1]!
    const neighbour = at === 'first' ? lines[1]! : lines[lines.length - 2]!
    const text = line.text.trim()
    const say = (why: string): void => {
      said.push(`"${text}" sits at the ${where} of the leaf but was kept as text: ${why}`)
    }

    // A footnote at the foot is neither furniture nor "kept as text": the note
    // pass runs after this and lifts it into a `footnote` block. Every decline
    // below would say otherwise, and on six leaves of one chapter of *Isis
    // Unveiled* that put a reader's eye on a line that was already right —
    // which is the failure mode this file exists to avoid, a report that is
    // not true. Asked before anything can speak, because the head-width and
    // display tests reach a footnote before the foot branch does.
    if (at === 'last' && claimedByNotes?.(line)) return

    // The printer's signature mark, which is neither the book's text nor its
    // folio: a lone figure at the foot of the first leaf of a gathering, put
    // there for the binder. It arrived as a block of body text and then as a
    // query on every sixteenth leaf until this existed — three identical
    // questions to the editor across two chapters, about a figure that is not
    // part of the book.
    //
    // Asked before the standoff test, because a signature is identified by
    // its arithmetic and not by where it sits: on leaves 155 and 171 of this
    // volume the figure stands too close to the last line to pass, and the
    // gap test declined it in silence. The arithmetic checks itself; see
    // `signatureSheet`.
    if (at === 'last' && expectedFolio !== undefined) {
      const sheet = looksLikeSignature(text, expectedFolio)
      if (sheet !== null && asFolio(text) !== String(expectedFolio)) {
        furniture.signature = text
        lines.pop()
        said.push(
          `"${text}" was taken off the foot as the printer's signature mark. Folio ` +
            `${expectedFolio} is the first leaf of gathering ${text} in a book gathered in ` +
            `${sheet}s, so the figure and the folio agree — and a signature is the binder's, ` +
            "not the book's. Check the render if the book really does print a figure there."
        )
        return
      }
    }

    // The volume corroborating this line. A head that carries the number the
    // numbering predicts is furniture however narrowly it misses a geometric
    // test — and the geometric tests are the ones that were letting real heads
    // through into the prose, seven of them in one chapter.
    //
    // Only at the top: at the foot a line naming this leaf's number *is* the
    // folio and is already handled, and a body line that happens to end in the
    // right figure is exactly the false positive to avoid.
    const corroborated =
      at === 'first' && expectedFolio !== undefined && namesFolio(text, expectedFolio)
    const rescue = (missed: string): void => {
      said.push(
        `"${text}" failed the running-head test (${missed}) and was taken anyway: it carries ` +
          `"${expectedFolio}", which is the folio this leaf should have on the volume's own ` +
          'numbering. Check the render — a body line that happens to carry that number would ' +
          'look the same to this.'
      )
    }

    const between = at === 'first' ? neighbour.top - line.bottom : line.top - neighbour.bottom
    if (between < gap * FURNITURE_GAP) {
      // Said, not returned in silence. This is the first test and the one most
      // declines fail, so it was the one decline in this function that spoke
      // nowhere — and a running head it turned down went into the body text
      // with nothing in `structural` pointing at it, which is exactly what the
      // contract above promises cannot happen. Reported only when the line
      // came close: every leaf of running prose fails this by a mile at the
      // top, and a note on every leaf is a note nobody reads.
      if (corroborated) {
        rescue(
          `it stands ${Math.round(between)} off the line below where ${Math.round(gap * FURNITURE_GAP)} is wanted`
        )
      } else if (between >= gap * FURNITURE_GAP * FURNITURE_NEAR) {
        say(
          `it stands ${Math.round(between)} off the ${at === 'first' ? 'line below' : 'line above'}` +
            ` and a running head needs ${Math.round(gap * FURNITURE_GAP)} — close, so check the` +
            ' render: if it is furniture, it has gone into the text.'
        )
      }
      if (!corroborated) return
    }

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
      if (!corroborated) {
        say(
          `its head is ${Math.round((split.headWidth / measure.width) * 100)}% of the measure` +
            ' and no folio is set off at the margin beside it'
        )
        return
      }
      rescue(`its head is ${Math.round((split.headWidth / measure.width) * 100)}% of the measure`)
    }

    if (at === 'last') {
      // Only a folio comes off the foot. A colophon, a catchword or a
      // signature mark is text, and filing it as `runningHead` — which is what
      // happened to `FINIS.` — both loses it and mislabels it.
      if (BARE_NUMBER.test(text)) {
        furniture.folio = text
        lines.pop()
        said.push(`"${text}" was taken off the foot as a folio.`)
        reconcile(text)
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
    reconcile(text)
  }

  /**
   * The folio that came off, against the one the volume predicts.
   *
   * Three outcomes and they are deliberately not the same. Where the line
   * *carries* the expected number and what came off is not it, the split was
   * wrong and the number is right there on the line — `62 THE VEIL OF ISIS. 4`
   * gave up `4`. That is corrected, and said.
   *
   * Where the line does not carry it at all, the number was misread or **the
   * book misnumbers its own leaf**, and those are not distinguishable from
   * here. A reprint does not renumber its original, so nothing is changed: it
   * is reported, with both numbers, for somebody with the render.
   */
  const reconcile = (text: string): void => {
    if (expectedFolio === undefined) return
    const wanted = String(expectedFolio)
    const got = asFolio(furniture.folio ?? '')
    if (got === wanted) return
    if (namesFolio(text, expectedFolio)) {
      said.push(
        (got === ''
          ? `No folio came off "${text}", though it carries "${wanted}"`
          : `The folio came off "${text}" as "${furniture.folio}", but the line carries "${wanted}"`) +
          ", which is what the volume's numbering predicts. Taken as the folio."
      )
      furniture.folio = wanted
      // Taken *out* of the head as well. `splitFurnitureLine` leaves the
      // number in when it cannot see it set off at the margin, so the head
      // would otherwise read "THE ALKAHEST NO FICTION. 5I" — a folio recorded
      // twice, once right and once as OCR read it.
      if (furniture.runningHead !== undefined) {
        const kept = furniture.runningHead
          .split(/\s+/u)
          .filter((token) => asFolio(token) !== wanted)
          .join(' ')
          .trim()
        if (kept !== '') furniture.runningHead = kept
      }
      return
    }
    said.push(
      `The folio here reads "${furniture.folio ?? '(none)'}" where the volume's numbering ` +
        `predicts "${wanted}". Nothing was changed — OCR may have misread it, or the book may ` +
        'misnumber this leaf, and a reprint does not renumber its original. Check the render.'
    )
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
      hyphens: [],
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

  // Before the running head, so the two rules cannot contradict each other in
  // `structural`. Both look at the last line of the leaf: with the head taken
  // first, a stamp produced "kept as text: its head is 89% of the measure"
  // from one rule and "taken off the foot as the scanner's own stamp" from the
  // next, about the same line, two entries apart. Taking the stamp first
  // leaves the furniture rule looking at the book's own last line, which is
  // the line it was written to judge.
  const bodySize = bodyTypeSize(lines)
  const stamp = takeStamp(lines, stride, bodySize, structural)

  const furniture: DraftPage['furniture'] = takeFurniture(
    lines,
    measure,
    white,
    bodyHeight,
    structural,
    options.expectedFolio,
    // The note pass's own two tests, asked here rather than restated: set at
    // or under the footnote size, and made of letters. It runs later, so at
    // this point the line is still at the foot and looks like furniture.
    (line) => {
      const text = line.text.trim()
      const size = typeSize(line)
      return (
        size !== null &&
        size <= bodySize * FOOTNOTE_SIZE &&
        alnum(text).length >= FURNITURE_MIN_ALNUM &&
        // A folio is never a note, and `FOOTNOTE_MARK` would take one: it
        // reads a digit followed by anything, so the bare folio "12" matches
        // as marker `1` and text `2`. Excluded by name, because a folio
        // swallowed here is a folio the leaf loses in silence.
        !BARE_NUMBER.test(text) &&
        FOOTNOTE_MARK.test(text)
      )
    }
  )
  // Recorded, not discarded. `checkableText` counts a leaf's furniture as
  // transcribed, so a stamp that vanished here would read downstream as words
  // OCR found and the transcription lost — on every leaf of the book.
  if (stamp.length > 0) furniture.stamp = stamp

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

  // Where the notes begin, if the leaf sets any.
  //
  // A footnote is set smaller than the text it hangs off, and on this book that
  // is the only thing that reliably separates the two: the marks OCR reads are
  // `*`, `t`, `1`, `+`, `|` and `§` — a dagger and a double dagger it has no
  // glyph for — and a note that runs to a second line carries no mark at all.
  // So the size decides, and the mark is only reported.
  //
  // Walked from the foot and stopped at the first body-sized line, rather than
  // filtering the whole leaf, because a short line anywhere in the text can
  // measure small and only the ones *below the last full line* are notes.
  let notesFrom = lines.length
  for (let i = lines.length - 1; i >= 0; i--) {
    const size = typeSize(lines[i]!)
    if (size === null || size > bodySize * FOOTNOTE_SIZE) break
    // Made of words, the same test furniture has to pass. `-_` on leaf 7 of
    // `aura-loose` is a speck on a back cover: small, at the foot, and set
    // apart — a footnote by every other measure here, and not type at all.
    const letters = alnum(lines[i]!.text)
    if (letters.length < FURNITURE_MIN_ALNUM) break
    notesFrom = i
  }
  // A run of small lines is only a note if something in it carries a reference
  // mark. Size alone does not transfer between books: on leaf 40 of
  // `tight-clairvoyance` the last two lines of ordinary body text measure
  // under 92% of that page's type size and were called footnotes, which is
  // the same overfitting this file warns about in its own header. A note is
  // marked; the tail of a paragraph is not.
  //
  // The mark is wanted *somewhere in the run*, not on every line, because a
  // note running to a second line carries none and a note continued from the
  // leaf before opens with none — leaf 650 of Isis has both.
  let marked = lines.slice(notesFrom).filter((l) => FOOTNOTE_MARK.test(l.text.trim())).length
  if (notesFrom < lines.length && marked === 0) {
    structural.push(
      `${lines.length - notesFrom} line(s) at the foot are set smaller than the body but not ` +
        'one of them opens with a reference mark, so they are left as text. If they are notes ' +
        'continued from the leaf before, they need retyping as such.'
    )
    notesFrom = lines.length
    marked = 0
  }
  if (notesFrom < lines.length) {
    structural.push(
      `${lines.length - notesFrom} line(s) at the foot are set at or under ` +
        `${Math.round(FOOTNOTE_SIZE * 100)}% of the body and are called footnotes; ` +
        `${marked} of them open with a reference mark. Where one note runs on from another ` +
        'the split between them is a guess — the mark is what divides them, and OCR reads a ' +
        'dagger as `t` or `+` about as often as not.'
    )
  }

  const blocks: DraftBlock[] = []
  let run: DraftLine[] = []
  let runIsNote = false

  const flush = (): void => {
    if (run.length === 0) return
    const centred = !runIsNote && run.every((l) => isCentred(l, body))
    const right = !runIsNote && run.length === 1 && isRightAligned(run[0]!, body)
    const text = run
      .map((l) => l.text.trim())
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim()
    if (text.length > 0) {
      blocks.push({
        kind: runIsNote ? 'footnote' : centred ? 'heading' : right ? 'caption' : 'paragraph',
        text
      })
    }
    run = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const previous = lines[i - 1]
    const isNote = i >= notesFrom
    if (previous) {
      const wide = line.top - previous.top > stride * PARAGRAPH_GAP
      const indented = !besideInitial(line) && isIndented(line, body)
      const switched = isCentred(line, body) !== isCentred(previous, body)
      // A note opens at its mark, and the first note opens where the notes do.
      // Without the first of those, several notes on one leaf join into one
      // block and print as a single note; without the second, the last
      // paragraph of the page and the first note become one.
      const opensNote = isNote && (!runIsNote || FOOTNOTE_MARK.test(line.text.trim()))
      if (wide || indented || switched || opensNote) flush()
    }
    runIsNote = isNote
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
  //
  // With a vocabulary the book settles most of them and this speaks for each
  // outcome; without one the count is still said out loud, because a break left
  // alone *prints* as `ad- vanced` and is invisible until a page is rendered.
  const hyphens: HyphenVerdict[] = []
  if (options.vocabulary) {
    for (const block of blocks) {
      const { text, verdicts } = healWrappedHyphens(block.text, options.vocabulary)
      block.text = text
      hyphens.push(...verdicts)
    }
    const counted = tally(hyphens)
    if (hyphens.length > 0) {
      structural.push(
        `${hyphens.length} line-break hyphen(s): ${counted.join} joined and ${counted.keep} kept ` +
          "on the book's own vocabulary, " +
          (counted.unsettled === 0
            ? 'none left over.'
            : `${counted.unsettled} left as \`ad- vanced\` because the book attests both forms or ` +
              'neither. Those are the ones to look at; the rest are a lookup, not a guess.')
      )
    }
  } else {
    const wrapped = blocks.reduce((n, b) => n + [...b.text.matchAll(/\w+-\s+\w+/gu)].length, 0)
    if (wrapped > 0) {
      structural.push(
        `${wrapped} line-break hyphen(s) are left as \`ad- vanced\`, and nothing downstream heals ` +
          'them — hyphen healing runs at page seams only, so they print mid-line. Join the ones ' +
          'that are one word and keep the hyphen on the ones that are two. Hand `draft` the ' +
          "book's vocabulary and most of them settle themselves."
      )
    }
  }

  structural.push('The role, and every block kind, is a guess. The words are what OCR read.')

  return {
    role: guessRole(lines),
    blocks,
    hyphens,
    uncertain: uncertainSpans(lines, uncertainBelow),
    furniture,
    structural
  }
}

export * from './folios'
export * from './hyphens'
