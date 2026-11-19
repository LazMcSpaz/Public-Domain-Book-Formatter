/**
 * Which part of a leaf the crop beside a query takes.
 *
 * The editor rules on a query from the crop, so the crop has to hold enough to
 * judge from. The first crops held the passage and a fixed 120 pixels above and
 * below it, which at 300 DPI is about one line either side, sliced through the
 * middle of the lines at both edges. On a phone, drawn the width of the screen,
 * that was a strip of type about eight points tall. The owner's word for it
 * was "too little to judge from".
 *
 * So a crop is now planned in **printed lines**, read off the leaf's own word
 * boxes: the lines the passage is on, and `around` whole lines above and below
 * (three unless asked otherwise), as wide as those lines are set. It is cut
 * midway between lines, so no line at either edge is sliced. The passage itself
 * comes back as one box per line it is on, in the crop's own pixels, for the
 * cutter to mark and the screen to scroll to.
 *
 * Pure: boxes in, boxes out.
 */

/** A rectangle in pixels. */
export interface CropBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Anything with a box on the leaf: an OCR word. */
export interface PlacedWord {
  bbox: CropBox
}

export interface QueryCropPlan {
  /** The rectangle to cut from the leaf, in the leaf's pixels. */
  crop: CropBox
  /** The passage, one box per printed line it is on, in the crop's pixels. */
  passage: CropBox[]
  /** How many printed lines the crop holds. */
  lines: number
}

export interface QueryCropOptions {
  /** Whole printed lines kept above and below the passage. */
  around?: number
  /** Pixels of paper kept beside the lines' ink, and at most above and below. */
  pad?: number
}

/** Three lines either side: the setting a compositor's slip is judged in. */
export const CROP_LINES_AROUND = 3
/** About a sixth of an inch of paper at 300 DPI. */
export const CROP_PAD = 48

const mid = (box: CropBox): number => (box.y0 + box.y1) / 2

/** The box that holds all of these. */
export function boxAround(boxes: readonly CropBox[]): CropBox {
  return boxes.reduce(
    (all, b) => ({
      x0: Math.min(all.x0, b.x0),
      y0: Math.min(all.y0, b.y0),
      x1: Math.max(all.x1, b.x1),
      y1: Math.max(all.y1, b.y1)
    }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  )
}

/**
 * The leaf's words in printed lines, top to bottom, each line left to right.
 *
 * A word is on a line when its middle is within a little over half a word's
 * height of the line's middle: the typical (median) height, so one tall
 * capital or a drop initial does not decide it. Two columns side by side read
 * as one line across both, which is wider than wanted and never narrower.
 */
export function printedLines<W extends PlacedWord>(words: readonly W[]): W[][] {
  if (words.length === 0) return []
  const heights = words.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b)
  const typical = Math.max(1, heights[Math.floor(heights.length / 2)]!)
  const reach = typical * 0.6
  const lines: { words: W[]; middle: number }[] = []
  for (const word of [...words].sort((a, b) => mid(a.bbox) - mid(b.bbox))) {
    const line = lines.at(-1)
    if (line && Math.abs(mid(word.bbox) - line.middle) <= reach) {
      line.words.push(word)
      line.middle = line.words.reduce((sum, w) => sum + mid(w.bbox), 0) / line.words.length
    } else {
      lines.push({ words: [word], middle: mid(word.bbox) })
    }
  }
  return lines.map((line) => line.words.sort((a, b) => a.bbox.x0 - b.bbox.x0))
}

/**
 * Plan the crop for a passage found among a leaf's words.
 *
 * `matched` are the passage's words (what `locateQuote` found), `words` every
 * word on the leaf. Null when there is nothing to place: a passage that was
 * not found gets the whole leaf from the caller, never a plausible guess.
 */
export function planQueryCrop<W extends PlacedWord>(
  words: readonly W[],
  matched: readonly W[],
  leaf: { width: number; height: number },
  options: QueryCropOptions = {}
): QueryCropPlan | null {
  const around = Math.max(0, Math.floor(options.around ?? CROP_LINES_AROUND))
  const pad = Math.max(0, options.pad ?? CROP_PAD)
  if (matched.length === 0) return null
  const lines = printedLines([...new Set([...words, ...matched])])
  const lineOf = (word: W): number => lines.findIndex((line) => line.includes(word))
  const on = [...new Set(matched.map(lineOf))].filter((i) => i >= 0).sort((a, b) => a - b)
  if (on.length === 0) return null

  const first = Math.max(0, on[0]! - around)
  const last = Math.min(lines.length - 1, on.at(-1)! + around)
  const ink = boxAround(lines.slice(first, last + 1).flatMap((line) => line.map((w) => w.bbox)))
  // Above and below, halfway to the next line out and never more than `pad`,
  // so the line beyond the crop does not show as a sliver of ascenders.
  const outside = (index: number): CropBox | null =>
    index >= 0 && index < lines.length ? boxAround(lines[index]!.map((w) => w.bbox)) : null
  const before = outside(first - 1)
  const after = outside(last + 1)
  const above = before ? Math.min(pad, Math.max(0, (ink.y0 - before.y1) / 2)) : pad
  const below = after ? Math.min(pad, Math.max(0, (after.y0 - ink.y1) / 2)) : pad
  const crop: CropBox = {
    x0: Math.max(0, Math.floor(ink.x0 - pad)),
    y0: Math.max(0, Math.floor(ink.y0 - above)),
    x1: Math.min(leaf.width, Math.ceil(ink.x1 + pad)),
    y1: Math.min(leaf.height, Math.ceil(ink.y1 + below))
  }

  const passage = on.map((index) => {
    const box = boxAround(lines[index]!.filter((w) => matched.includes(w)).map((w) => w.bbox))
    return {
      x0: box.x0 - crop.x0,
      y0: box.y0 - crop.y0,
      x1: box.x1 - crop.x0,
      y1: box.y1 - crop.y0
    }
  })
  return { crop, passage, lines: last - first + 1 }
}
