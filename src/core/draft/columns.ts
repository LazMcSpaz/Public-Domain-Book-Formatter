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
 * Width does not tell a gutter from an innocent gap beside a margin — see the
 * header, where the two overlap as shares of the ink width — but it does tell
 * a gutter from the **division between two columns of one page**, which the
 * centrality test cannot when that division happens to fall near the middle.
 * A gutter is two inner margins photographed side by side; a column division
 * is one gap. Measured: the gutters of *Patterns* Vol. I run **4.8 to 13.8**
 * body heights (the 4.8 is leaf 4, a part title in 111px display type), and
 * every column division on the 110 transcript leaves of Vol. II is under
 * **3.6**. Leaf 135 of that volume is the case: its division sits 0.093 off
 * centre and 50px wide against a 34px body, and at one body height it was
 * read as two printed pages.
 */
const GUTTER_MIN_HEIGHTS = 4

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
  //
  // **Every index here is an integer, deliberately.** A real box is
  // fractional — the harvested fixtures are rounded for readability, but the
  // recon cache holds what the renderer measured — and a fractional index into
  // a typed array is not a slot. It reads `undefined`, so `cover[x]++` stores
  // `NaN`, which a typed array then drops: the profile stays empty and the
  // whole leaf reads as one enormous gutter. Worse, a fractional `span` makes
  // `new Int32Array(span + 1)` throw outright. Neither shows up against a
  // fixture of whole numbers, which is exactly why this comment is here.
  const origin = Math.floor(left)
  const span = Math.ceil(right) - origin
  const cover = new Int32Array(span + 1)
  for (const w of usable) {
    const from = Math.max(0, Math.floor(w.bbox.x0) - origin)
    const to = Math.min(span, Math.ceil(w.bbox.x1) - origin)
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
          left: origin + run,
          right: origin + x,
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
 * A band of white between two columns *within* one printed page: where it
 * is, and the rows either side of it that make it a division.
 */
export interface PairedDivision {
  left: number
  right: number
  /** Rows of type with ink on the narrower side of the band. */
  rows: number
  /** Of those, rows with ink on both sides. */
  both: number
  /** The narrower side's width as a share of the page's ink width. */
  narrowShare: number
}

export interface PairedBands {
  /** Left to right. One band when the page is one column. */
  columns: ColumnBand[]
  divisions: PairedDivision[]
  /**
   * Clear bands with enough rows either side to be weighed at all, taken or
   * not. Zero on a page of prose, so a caller can tell a page that was never
   * in question from one that was looked at and left.
   */
  considered: number
  why: string[]
}

/**
 * The narrower side of a division must hold ink on this many rows.
 *
 * Low, because the third column of *Patterns* Vol. II is a note against a
 * few utterances and stands on three rows of leaf 135. Its only job is the
 * one- and two-row innocents: a speck at the margin of Isis leaf 200 and two
 * short lines of `tight-scramble` 7 each leave a clear band with a row or
 * two beside it. The width test is what keeps out a label margin, not this.
 */
export const PAIRED_MIN_ROWS = 3

/**
 * Of the rows with ink on the narrower side, the share that must have ink on
 * the wider side too.
 *
 * White beside a margin has ink on one side only, so it scores **0.00**
 * exactly — a single line reaching across would have broken the band — and
 * `aura-loose` 7 is the fixture that shows it. Two columns that pair score
 * 0.70–1.00 on most transcript leaves of *Patterns* Vol. II, but not all:
 * leaf 135 scores **0.50**, because where Erickson and the client trade
 * short lines the transcript column runs on with nothing beside it. A
 * column whose rows are half unanswered is still a column, so the bar sits
 * under it with room, and well clear of nothing.
 */
export const PAIRED_ROW_SHARE = 0.35

/**
 * The narrower side of a division must be at least this share of the page's
 * ink width.
 *
 * This is the test that tells a column from a margin of labels. Measured:
 * every transcript division of *Patterns* Vol. II has its narrower side at
 * **0.30–0.47** of the ink width, the third column included; the contents
 * leaf of the same volume (folios beside leaders), its "Hypnotist:/Client:"
 * margin on leaf 90, and the "W:"/"E:" speaker labels of Vol. I leaf 28 sit
 * at **0.06–0.16**. Nothing lands between 0.16 and 0.30, so 0.22 has a factor
 * of about 1.4 clear on either side.
 */
export const PAIRED_NARROW_SHARE = 0.22

/** A band must be at least this many body heights wide to be a division. */
const PAIRED_BAND_MIN_HEIGHTS = 0.5

/**
 * Rows are buckets this many body heights tall, by a word's vertical centre.
 *
 * Coarse on purpose: the two columns of a paired page are set in different
 * faces at different leadings, so gathering rows by box overlap chains lines
 * of one column into lines of the other. A bucket only has to say whether
 * some ink stands beside some other ink at about the same height.
 */
const PAIRED_ROW_HEIGHTS = 0.8

/**
 * The columns of type within one printed page, where they pair row by row.
 *
 * `findColumns` finds the gutter of a two-up leaf and abstains on everything
 * else, and one of the things it abstains on is the page this exists for:
 * *Patterns of the Hypnotic Techniques* Vol. II sets a hundred and ten leaves
 * with Erickson's words down a narrow left column and the authors' analysis
 * down a wider right one, so the white between them stands 0.17 of the ink
 * width off centre, past what a gutter may be. `./paired` cannot take it
 * either: that finder judges the gap *inside* a line against the page's own
 * word space, and here the commentary's spaced dots are words, so the median
 * space is 24px against a division of 55 — under the three spaces it asks
 * for. Both were written from Vol. I and both are right about Vol. I.
 *
 * What this page has that neither rule reads is a **clear band with ink on
 * both sides of it on most rows**. A gutter has that too, but a gutter is
 * central and is taken first; a margin of white beside short lines has ink on
 * one side only; and a margin of speaker labels has ink on both sides but no
 * width to it. Three measurements, each set from the leaves (see the
 * constants), and a page clears all three or is left as one column.
 *
 * Nothing here is a reading: every character came off the pixels, and what
 * is decided is which words share a column. The caller gathers lines per
 * column, because the columns of such a page are set in different faces at
 * different leadings and a line gathered across both is two lines shuffled.
 *
 * Pure: no DOM, no I/O, no network.
 */
export function findPairedBands(words: readonly DraftWord[]): PairedBands {
  const usable = words.filter((w) => w.text.trim().length > 0)
  const why: string[] = []
  let considered = 0
  const one = (band: ColumnBand): PairedBands => ({
    columns: [band],
    divisions: [],
    considered,
    why
  })

  if (usable.length < MIN_WORDS) {
    const left = usable.length ? Math.min(...usable.map((w) => w.bbox.x0)) : 0
    const right = usable.length ? Math.max(...usable.map((w) => w.bbox.x1)) : 0
    return one({ left, right })
  }

  const bodyHeight = median(usable.map((w) => w.bbox.y1 - w.bbox.y0))
  const rowHeight = Math.max(1, bodyHeight * PAIRED_ROW_HEIGHTS)
  const rowOf = (w: DraftWord): number => Math.floor((w.bbox.y0 + w.bbox.y1) / 2 / rowHeight)

  // The running head is measured with the rest. A head set flush right widens
  // the ink and leaves a clear band beside the commentary, and that band is
  // declined on its own: the head is the one row with ink beyond it. Leaving
  // the head out was tried and no leaf could tell the difference.
  const measured = usable
  const left = Math.min(...measured.map((w) => w.bbox.x0))
  const right = Math.max(...measured.map((w) => w.bbox.x1))
  const whole: ColumnBand = { left, right }
  const inkWidth = Math.max(1, right - left)
  const minBand = Math.max(1, bodyHeight * PAIRED_BAND_MIN_HEIGHTS)

  // Coverage per x, integer-indexed for the reason `findColumns` gives.
  const origin = Math.floor(left)
  const span = Math.ceil(right) - origin
  const cover = new Int32Array(span + 1)
  for (const w of measured) {
    const from = Math.max(0, Math.floor(w.bbox.x0) - origin)
    const to = Math.min(span, Math.ceil(w.bbox.x1) - origin)
    for (let x = from; x < to; x++) cover[x]!++
  }
  const bands: ColumnBand[] = []
  let run = -1
  for (let x = 0; x <= span; x++) {
    const empty = x < span && cover[x] === 0
    if (empty) {
      if (run < 0) run = x
    } else if (run >= 0) {
      if (x - run >= minBand) bands.push({ left: origin + run, right: origin + x })
      run = -1
    }
  }
  if (bands.length === 0) return one(whole)

  const rows = new Map<number, DraftWord[]>()
  for (const w of measured) {
    const key = rowOf(w)
    rows.set(key, [...(rows.get(key) ?? []), w])
  }

  const divisions: PairedDivision[] = []
  const declined: string[] = []
  for (const band of bands) {
    let leftRows = 0
    let rightRows = 0
    let both = 0
    for (const row of rows.values()) {
      const l = row.some((w) => w.bbox.x1 <= band.left)
      const r = row.some((w) => w.bbox.x0 >= band.right)
      if (l) leftRows++
      if (r) rightRows++
      if (l && r) both++
    }
    const narrower = Math.min(leftRows, rightRows)
    const narrowShare = Math.min(band.left - left, right - band.right) / inkWidth
    const where = `${Math.round(band.left)}–${Math.round(band.right)}`
    if (narrower < PAIRED_MIN_ROWS) {
      declined.push(`${where} has ink on only ${narrower} row(s) of its narrower side`)
      continue
    }
    considered++
    const share = both / narrower
    if (share < PAIRED_ROW_SHARE) {
      declined.push(
        `${where} has ink on both sides on ${both} of the ${narrower} rows its narrower side ` +
          `reaches (${share.toFixed(2)}, under ${PAIRED_ROW_SHARE}) — white beside a margin`
      )
      continue
    }
    if (narrowShare < PAIRED_NARROW_SHARE) {
      declined.push(
        `${where} leaves its narrower side ${narrowShare.toFixed(2)} of the ink width (under ` +
          `${PAIRED_NARROW_SHARE}) — a margin of labels, not a column`
      )
      continue
    }
    divisions.push({ ...band, rows: narrower, both, narrowShare })
  }

  if (divisions.length === 0) {
    why.push(
      `One column within the page: ${bands.length} clear band(s) measured and none taken — ` +
        declined.join('; ') +
        '.'
    )
    return one(whole)
  }

  divisions.sort((a, b) => a.left - b.left)
  const columns: ColumnBand[] = []
  let from = whole.left
  for (const d of divisions) {
    columns.push({ left: from, right: d.left })
    from = d.right
  }
  columns.push({ left: from, right: whole.right })
  why.push(
    `${columns.length} columns within the page that pair: ` +
      divisions
        .map(
          (d) =>
            `a clear band ${Math.round(d.right - d.left)}px wide at ${Math.round(d.left)}–` +
            `${Math.round(d.right)} with ink on both sides on ${d.both} of the ${d.rows} rows its ` +
            `narrower side reaches, that side being ${d.narrowShare.toFixed(2)} of the ink width`
        )
        .join('; ') +
      (declined.length > 0 ? `. Not taken: ${declined.join('; ')}` : '') +
      '. Lines are gathered per column and the columns are read row by row, as a transcript ' +
      'beside its commentary is. **That is a guess about what the columns mean**: geometry ' +
      'cannot tell columns that pair from columns that run one after the other like a ' +
      'newspaper. Check the render.'
  )
  return { columns, divisions, considered, why }
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
