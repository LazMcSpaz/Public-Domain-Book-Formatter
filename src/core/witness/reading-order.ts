/**
 * Boxes into reading order — the second reader's lines, as leaf text.
 *
 * A detection-and-recognition engine returns one box per line of type, in
 * whatever order its detector found them, and `compareWitnesses` wants a
 * text. Putting the lines in order is geometry, and the geometry is one this
 * repository already owns: `findColumns` cuts a two-page leaf at its gutter
 * and `findPairedBands` finds the columns within a page, both measured on
 * the leaves in `test/fixtures/boxes`. This reuses them rather than forming a
 * second opinion about where a column is, because two opinions about the
 * same gutter is how the two readers stop being comparable.
 *
 * Within a column the order is rows top to bottom and boxes left to right
 * within a row, where a row is a set of boxes whose vertical centres fall
 * within each other's height. That is the rule for a line of words as much
 * as for a column of lines, which is why the fixtures — Tesseract's words in
 * Tesseract's emission order — can test it: shuffle them, order them, and
 * the emission order should come back.
 *
 * Pure: no DOM, no I/O, no network.
 */
import { findColumns, findPairedBands, wordsInBand } from '../draft/columns'
import type { DraftWord } from '../draft/index'

/** A box of text as a detector returns it: top-left corner, size, what it read. */
export interface TextBox {
  text: string
  x: number
  y: number
  width: number
  height: number
  /** 0–1 or 0–100, whichever the engine gives; carried, never interpreted here. */
  confidence?: number
}

/** A box, placed: its column and row in reading order. */
export interface OrderedBox extends TextBox {
  column: number
  row: number
}

/**
 * The share of a box's height two centres may differ by and still share a
 * row. Half: two lines of type are a full height apart, and a word's box
 * wanders by a descender.
 */
const ROW_TOLERANCE = 0.5

function asWord(b: TextBox): DraftWord {
  return {
    text: b.text,
    confidence: typeof b.confidence === 'number' ? b.confidence : 100,
    bbox: { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height }
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}

/** Rows of a column, top to bottom, each left to right. */
function rowsOf(boxes: readonly TextBox[]): TextBox[][] {
  const sorted = [...boxes].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2))
  const rows: { centre: number; height: number; boxes: TextBox[] }[] = []
  for (const b of sorted) {
    const centre = b.y + b.height / 2
    const last = rows[rows.length - 1]
    // Against the row's running centre and the smaller of the two heights,
    // so a tall mis-segmented box neither joins a row it straddles nor
    // recruits the row after it.
    if (last && Math.abs(centre - last.centre) <= ROW_TOLERANCE * Math.min(last.height, b.height)) {
      last.boxes.push(b)
      const n = last.boxes.length
      last.centre = (last.centre * (n - 1) + centre) / n
      last.height = median(last.boxes.map((x) => x.height))
    } else {
      rows.push({ centre, height: b.height, boxes: [b] })
    }
  }
  return rows.map((r) => r.boxes.sort((a, b) => a.x - b.x))
}

/**
 * Every box, with the column and row it reads in.
 *
 * Columns are numbered across the leaf in reading order: the pages of a
 * two-up leaf left to right, and within each page its columns left to
 * right. Rows restart at zero in each column.
 */
export function orderBoxes(boxes: readonly TextBox[]): OrderedBox[] {
  if (boxes.length === 0) return []
  const words = boxes.map(asWord)
  const byWord = new Map<DraftWord, TextBox>()
  words.forEach((w, i) => byWord.set(w, boxes[i]!))

  const out: OrderedBox[] = []
  let column = 0
  for (const page of findColumns(words).columns) {
    const inPage: { word: DraftWord; box: TextBox }[] = []
    for (const w of words) {
      const c = (w.bbox.x0 + w.bbox.x1) / 2
      if (c >= page.left && c < page.right) inPage.push({ word: w, box: byWord.get(w)! })
    }
    // The page's words moved to a common origin, as `draftPage` moves them,
    // so a right-hand page is measured as the page it is. The copies are
    // matched back to the originals by index, never by coordinate, and the
    // shift never reaches the caller.
    const shifted = wordsInBand(
      inPage.map((p) => p.word),
      page,
      page.left
    )
    for (const band of findPairedBands(shifted).columns) {
      const originals: TextBox[] = []
      shifted.forEach((w, i) => {
        const c = (w.bbox.x0 + w.bbox.x1) / 2
        if (c >= band.left && c < band.right) originals.push(inPage[i]!.box)
      })
      rowsOf(originals).forEach((row, r) => {
        for (const b of row) out.push({ ...b, column, row: r })
      })
      column += 1
    }
  }
  return out
}

/** The leaf's text in reading order: rows on lines, columns one after another. */
export function readingOrder(boxes: readonly TextBox[]): string {
  const ordered = orderBoxes(boxes)
  const lines: string[] = []
  let key = ''
  let current: string[] = []
  for (const b of ordered) {
    const k = `${b.column}:${b.row}`
    if (k !== key) {
      if (current.length > 0) lines.push(current.join(' '))
      current = []
      key = k
    }
    current.push(b.text)
  }
  if (current.length > 0) lines.push(current.join(' '))
  return lines.join('\n')
}
