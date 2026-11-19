/**
 * The word boxes the slant witness reads, and the verdict when it read none.
 *
 * `scripts/slant-witness.ts` measures each word's lean off a 300-DPI render
 * of the scan. It takes the words from the scan's own text layer, or for a
 * scan with no layer from `--words`: `[{ page, words: [{ text, x0, y0, x1,
 * y1 }] }]`, boxes in pixels of that render. Recon already boxes every word
 * it reads, so the boxes come from there (`drive.mjs words --out`), through
 * `witnessPages`.
 *
 * The two agree because both renders frame the page the same way: recon
 * renders with pdf.js and the witness with mupdf, each from the page's own
 * box with its rotation applied and the origin at the top left, so a box is
 * a box in either. `page` is the scan's leaf counted from 0 in both, which is
 * recon's `pageIndex` and the witness's `loadPage` index. Cleaning before OCR
 * never resizes a leaf (`cleanedForOcr` refuses one that would), so a box
 * read off cleaned pixels is a box on the render. Only the resolution can
 * differ, and it is scaled here, rounding outwards so no ink is cut off.
 *
 * And a witness that measured nothing must say so: an empty list reads
 * exactly like "this scan prints no italic", which is how italic went
 * unchecked on a whole book while the witness reported success.
 *
 * Pure: words in, boxes or a sentence out.
 */

/** The resolution the slant witness renders at, and every box it reads is in. */
export const WITNESS_DPI = 300

export interface WitnessWord {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface WitnessPage {
  /** The scan's leaf, counted from 0. */
  page: number
  words: WitnessWord[]
}

/** One word as recon boxed it (the shape of `OcrWord` the witness needs). */
export interface BoxedWord {
  text: string
  pageIndex: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

/**
 * Recon's words as the witness's `--words` file: grouped by leaf in leaf
 * order, each leaf's words in the order they were read, boxes moved from
 * `dpi` to {@link WITNESS_DPI}. With `leaves`, only those. A leaf with no
 * words is left out; the witness reads a missing leaf as one with none.
 */
export function witnessPages(
  words: readonly BoxedWord[],
  dpi: number,
  leaves?: readonly number[]
): WitnessPage[] {
  if (!(dpi > 0)) throw new Error(`A reading at ${dpi} DPI has no boxes to scale.`)
  const k = WITNESS_DPI / dpi
  const only = leaves && leaves.length > 0 ? new Set(leaves) : null
  const byPage = new Map<number, WitnessWord[]>()
  for (const w of words) {
    if (only && !only.has(w.pageIndex)) continue
    if (!w.text.trim()) continue
    const list = byPage.get(w.pageIndex) ?? []
    list.push({
      text: w.text,
      x0: Math.floor(w.bbox.x0 * k),
      y0: Math.floor(w.bbox.y0 * k),
      x1: Math.ceil(w.bbox.x1 * k),
      y1: Math.ceil(w.bbox.y1 * k)
    })
    byPage.set(w.pageIndex, list)
  }
  return [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, ws]) => ({ page, words: ws }))
}

export interface WitnessCount {
  /** Where the words came from: the scan's own text layer, or `--words`. */
  from: 'layer' | 'words'
  first: number
  last: number
  /** Pages in the range that had any words to measure. */
  pagesWithWords: number
  /** Of those, pages `--book` matched to no leaf (and so never measured). */
  pagesUnplaced: number
  wordsMeasured: number
}

/**
 * Why the witness must fail, or null when it measured something. A witness
 * that measured words and found no italic is an answer; one that measured no
 * words is not, and is never written as one.
 */
export function noWordsMeasured(c: WitnessCount): string | null {
  if (c.wordsMeasured > 0) return null
  const where = `pages ${c.first} to ${c.last}`
  const end = ' Nothing was written.'
  if (c.pagesWithWords === 0 && c.from === 'layer') {
    return (
      `The witness measured no words on ${where}: the scan has no text layer to take word ` +
      'boxes from. Give it the boxes recon read: with the book loaded, ' +
      '`node scripts/drive.mjs words --out` writes them and names the file; run this again ' +
      'with `--words <that file>`.' +
      end
    )
  }
  if (c.pagesWithWords === 0) {
    return (
      `The witness measured no words on ${where}: the --words file has none for those pages. ` +
      'Check it is the boxes file for this scan (pages count from 0).' +
      end
    )
  }
  if (c.pagesUnplaced === c.pagesWithWords) {
    return (
      `Words were found on ${c.pagesWithWords} page(s), but none matched a leaf of the --book ` +
      'file, so nothing was measured. Is it the book read from this scan?' +
      end
    )
  }
  return (
    `Words were found on ${c.pagesWithWords} page(s), but not one could be measured: their ` +
    `boxes hold no ink the measure can read. Check the boxes are in pixels of the ` +
    `${WITNESS_DPI}-DPI render.` +
    end
  )
}
