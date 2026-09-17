/**
 * Is this leaf one page, or two printed pages photographed side by side?
 *
 * Every book on this shelf until now has been one column of type per leaf, so
 * `toLines` could gather words onto a line by vertical overlap alone and be
 * right every time. Hand it a leaf holding *two* printed pages and that rule
 * is catastrophic rather than merely wrong: the first line of the left page
 * and the first line of the right page sit at the same height, so they are
 * gathered into one line, and the leaf comes back with every sentence of one
 * page interleaved word-for-word into the other.
 *
 * Measured on _Patterns of the Hypnotic Techniques_ Vol. I, whose every leaf
 * is two printed pages:
 *
 *     in our experience of sensory data. For example, we can fantasize a
 *     green cow, Introduction: even though we have never experienced one
 *
 * — where `Introduction:` is the display title of the *other* page. Nothing
 * downstream can recover from that, and nothing downstream reports it either,
 * because a scrambled paragraph is still a paragraph.
 *
 * ## Why this is not a reading
 *
 * Same argument as the rest of `draft`: no character here is proposed, chosen
 * or altered. Every word was read off the pixels by whoever read them, and all
 * this decides is **which words share a line**, out of the boxes OCR already
 * measured. A gutter is either there in the ink or it is not.
 *
 * ## The rule, and why it is centrality rather than width
 *
 * A two-up gutter is a band of x where *no word anywhere on the leaf* puts any
 * ink. So are a good many innocent gaps — the white after a short last line, a
 * page whose only matter is a right-hand column of verse. Width does not
 * separate them: measured across the five books with box fixtures here, real
 * gutters run 0.058–0.140 of the ink width and innocent gaps 0.011–0.093, and
 * those overlap.
 *
 * What separates them completely is **where the gap sits**. A leaf that is two
 * printed pages has its gutter in the middle, because that is what being two
 * printed pages means; an innocent gap is out near a margin. Measured, as the
 * distance from the gap's centre to the middle of the ink, over ink width:
 *
 * | leaf                          | off centre |
 * | ----------------------------- | ---------- |
 * | patterns-vol1 90              | 0.000      |
 * | patterns-vol1 118             | 0.001      |
 * | patterns-vol1 40              | 0.017      |
 * | patterns-vol1 27              | 0.063      |
 * | patterns-vol1 7               | 0.064      |
 * | aura-loose 7                  | 0.410      |
 * | tight-scramble 7              | 0.450      |
 * | isis-vol1 202                 | 0.469      |
 * | tight-clairvoyance 40         | 0.490      |
 *
 * Nothing lands between 0.064 and 0.410, so `OFF_CENTRE_MAX` is set at 0.15
 * and the nearest real leaf is more than a factor of two clear of it on either
 * side. On the nineteen leaves of the five single-column fixtures this rule
 * finds no gutter at all — which is the property that matters most, since
 * turning it on must change nothing about any book already read.
 *
 * ## And it takes the most central gap, not the widest
 *
 * The first version took the widest interior gap and it failed on
 * `patterns-vol1` leaf 118, whose right-hand printed page is a sparse list of
 * example sentences: the ragged white inside that list is wider than the
 * gutter beside it, so the widest gap was off at 0.425 and the leaf was called
 * one column. Taking the most central gap that clears the minimum width finds
 * the gutter on that leaf at 0.001, and changes none of the others.
 *
 * Pure: no DOM, no I/O, no network.
 */

import type { DraftWord } from './index'

/** A vertical band of the leaf holding one column of type. */
export interface ColumnBand {
  left: number
  right: number
}

export interface ColumnSplit {
  /** Left to right, which is reading order for the pages of a two-up leaf. */
  columns: ColumnBand[]
  /**
   * What was measured and what was decided, taken or declined, in plain
   * language with the numbers.
   *
   * Never empty. A leaf called one column because nothing was found and a leaf
   * called one column because it was too sparse to look at are different
   * claims, and silence cannot tell them apart — which is this repository's
   * standing complaint about guards that fall back quietly.
   */
  why: string[]
}

/**
 * Enough ink on the leaf that an absence of ink can mean something.
 *
 * Deliberately low, because it turned out to buy nothing. It was 20 first, on
 * the reasoning that a sparse leaf has white everywhere and a gutter nowhere —
 * and that reasoning cost a real leaf: `patterns-vol1` leaf 4 is a part title
 * set across the *spread*, ten words of 111px display type reading `PART I /
 * IDENTIFICATION OF` on the left page and `PATTERNS OF ERICKSON'S / HYPNOTIC
 * WORK` on the right, and at 20 it abstained and laid the two pages into each
 * other.
 *
 * Measured at 8 against all thirty leaves of the six fixtures: **leaf 4 is the
 * only decision that changes**, and it changes to the right answer (0.050 off
 * centre). Every leaf of the five single-column books is untouched. So the
 * centrality test below is doing the whole job and the word count was only
 * ever protecting it from a danger it does not have.
 */
const MIN_WORDS = 8

/**
 * A candidate gap must be at least this many body heights wide.
 *
 * Only to reject noise — a single pixel of white between two words is not a
 * gutter. It is deliberately not the discriminator: see the header, where
 * width is shown not to separate the two cases at all. The narrowest real
 * gutter measured is 190px against a 33px body, which is 5.8 of these.
 */
const GUTTER_MIN_HEIGHTS = 1

/**
 * How far from the middle of the ink a gutter may sit, as a share of the ink
 * width. Measured: real 0.000–0.064, innocent 0.410–0.490. See the table.
 */
const OFF_CENTRE_MAX = 0.15

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * Split a leaf into the columns of type standing on it.
 *
 * Abstains to a single column wherever the evidence is thin, which is every
 * leaf of every ordinary book. The single column it returns spans the ink, so
 * a caller can treat one and many identically.
 */
export function findColumns(words: readonly DraftWord[]): ColumnSplit {
  const usable = words.filter((w) => w.text.trim().length > 0)
  const why: string[] = []

  if (usable.length === 0) {
    return { columns: [], why: ['No words on this leaf, so no columns were looked for.'] }
  }

  const left = Math.min(...usable.map((w) => w.bbox.x0))
  const right = Math.max(...usable.map((w) => w.bbox.x1))
  const whole: ColumnBand = { left, right }
  const inkWidth = Math.max(1, right - left)

  if (usable.length < MIN_WORDS) {
    why.push(
      `${usable.length} words is under the ${MIN_WORDS} needed before a gap in the ink means ` +
        `anything, so this leaf is read as one column without looking for a gutter.`
    )
    return { columns: [whole], why }
  }

  const bodyHeight = median(usable.map((w) => w.bbox.y1 - w.bbox.y0))
  const minGutter = Math.max(1, bodyHeight * GUTTER_MIN_HEIGHTS)

  // Coverage per x: how many words put ink there. A gutter is a run of zero.
  // Counting *words* rather than testing emptiness makes no difference to
  // where the zeros are and costs nothing, and it is the profile a later pass
  // needs for the columns inside one printed page, where the signal is a
  // valley rather than a gap.
  const span = right - left
  const cover = new Int32Array(span + 1)
  for (const w of usable) {
    const from = Math.max(0, Math.floor(w.bbox.x0) - left)
    const to = Math.min(span, Math.ceil(w.bbox.x1) - left)
    for (let x = from; x < to; x++) cover[x]!++
  }

  const gaps: { left: number; right: number; width: number; offCentre: number }[] = []
  const middle = span / 2
  let run = -1
  for (let x = 0; x <= span; x++) {
    const empty = x < span && cover[x] === 0
    if (empty) {
      if (run < 0) run = x
    } else if (run >= 0) {
      const width = x - run
      if (width >= minGutter) {
        gaps.push({
          left: left + run,
          right: left + x,
          width,
          offCentre: Math.abs((run + x) / 2 - middle) / inkWidth
        })
      }
      run = -1
    }
  }

  if (gaps.length === 0) {
    why.push(
      `One column: no band of the leaf at least ${Math.round(minGutter)}px wide ` +
        `(one body height) is free of ink across every line.`
    )
    return { columns: [whole], why }
  }

  // The most central gap, never the widest. See the header: the widest is what
  // called leaf 118 one column, because the white inside a sparse list beats
  // the gutter beside it.
  const best = gaps.reduce((a, b) => (b.offCentre < a.offCentre ? b : a))

  if (best.offCentre > OFF_CENTRE_MAX) {
    why.push(
      `One column: the most central clear band (${best.left}–${best.right}, ${best.width}px) ` +
        `sits ${best.offCentre.toFixed(3)} of the ink width off centre, past the ` +
        `${OFF_CENTRE_MAX} a gutter between two printed pages may be. That is the shape of ` +
        `white space beside a margin, not of a leaf holding two pages.`
    )
    return { columns: [whole], why }
  }

  why.push(
    `Two columns: a band ${best.width}px wide (${best.left}–${best.right}) carries no ink on ` +
      `any line and sits ${best.offCentre.toFixed(3)} of the ink width off centre, within the ` +
      `${OFF_CENTRE_MAX} that says a gutter rather than a margin. This leaf is read as two ` +
      `printed pages, left then right. Check the render: if it is one page, the draft has ` +
      `cut a paragraph in half.`
  )
  if (gaps.length > 1) {
    why.push(
      `${gaps.length - 1} other clear band(s) were measured and not taken, the nearest at ` +
        `${gaps
          .filter((g) => g !== best)
          .reduce((a, b) => (b.offCentre < a.offCentre ? b : a))
          .offCentre.toFixed(3)} off centre. Columns *within* one printed page are not split ` +
        `here — a transcript set beside its commentary is a table, and pairing its rows is a ` +
        `different question from finding a gutter.`
    )
  }

  return {
    columns: [
      { left, right: best.left },
      { left: best.right, right }
    ],
    why
  }
}

/**
 * The words of one band, with x translated so every band starts at the same
 * edge.
 *
 * The translation is what makes the measure right. `measureOf` takes the
 * median line edge across the whole leaf, so two bands left where they stand
 * give a measure spanning both pages and a gutter — against which every line
 * of both pages is short, badly inset, and liable to be called centred. Moved
 * to a common origin, each band is measured as the page it is.
 *
 * Nothing downstream of `draftPage` reads a coordinate — it returns text and
 * furniture — so the translation cannot escape into a crop or an illustration
 * box.
 */
export function wordsInBand(
  words: readonly DraftWord[],
  band: ColumnBand,
  origin: number
): DraftWord[] {
  const shift = origin - band.left
  const out: DraftWord[] = []
  for (const w of words) {
    const centre = (w.bbox.x0 + w.bbox.x1) / 2
    if (centre < band.left || centre >= band.right) continue
    out.push(
      shift === 0 ? w : { ...w, bbox: { ...w.bbox, x0: w.bbox.x0 + shift, x1: w.bbox.x1 + shift } }
    )
  }
  return out
}
