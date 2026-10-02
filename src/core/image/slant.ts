/**
 * Which words a scan prints in italic, read off the slant of their strokes.
 *
 * Eleven books on the shelf came through with almost no italic, and for most
 * of them something could say which words had been italic: the faces a file
 * names (`Times-Italic`), or the glyph clusters a ClearScan layer keeps
 * apart (`scripts/italic-witness.mjs`). Four could not — a photographed scan
 * under an OCR layer drawn in one invisible face, or no layer at all — and
 * for those the only witness left is the pixels.
 *
 * An italic face leans. Roman stems stand upright and italic ones sit ten to
 * sixteen degrees off it, and shearing a word's ink back by the angle it
 * leans at stacks every stem into one column of the projection. So the slant
 * of a word is the shear that makes its column profile sharpest: the sum of
 * squared column counts, which rewards ink concentrated in few columns,
 * tried at every degree and refined between the best three. Measured on a
 * page of _NLP For Dummies_ before anything here was written down: roman
 * words at −1 degree almost to a word, the one italic term on the page at
 * 12, and nothing in between.
 *
 * What a single word's slant cannot say is relative to what. A scan is
 * rarely square to the type, and a whole page of upright stems photographed
 * a degree off reads a degree off. So a word is judged against its own page:
 * the median slant of the page's words is the roman there, since roman is
 * most of any page, and a word is italic when it leans {@link ITALIC_LEAN}
 * further than that. A page set wholly in italic therefore finds nothing,
 * which is the safe error — a mark missing rather than a mark on roman.
 *
 * Short words are where the measure is weakest: a two-letter word has one or
 * two stems and a round letter's profile has no sharp column at all. So a
 * word of fewer than {@link MIN_LETTERS} letters is never italic on its own
 * evidence; it takes the verdict of its neighbours when both are italic —
 * `the <i>art of</i> listening` — and is roman otherwise.
 *
 * Pure: no DOM, no I/O.
 */

/** A page rendered to one byte of luminance per pixel, 0 black to 255 white. */
export interface GrayImage {
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
}

/** A box on the image, in its pixels: `x0, y0` inclusive, `x1, y1` exclusive. */
export interface PixelBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Degrees a word must lean beyond its page's roman to count as italic.
 * Roman words measured within two or three degrees of their page; every
 * italic seen leaned nine or more; and the roman words that crept in at
 * seven — `few`, `more`, `taxes` — are why the line is at eight.
 */
export const ITALIC_LEAN = 8
/**
 * Degrees beyond which a lean is not italic but a box off its word. No face
 * on the shelf leans past sixteen; every word measured past nineteen on
 * _Persuasion Engineering_ was a roman word whose box straddled two lines.
 */
export const ITALIC_MOST = 19
/** Fewest letters a word needs to be judged on its own slant. */
export const MIN_LETTERS = 3
/** Fewest ink pixels worth measuring: below it a box is a speck or a blank. */
const MIN_INK = 30
/** The shears tried, in degrees: a backslant to well past any italic. */
const LEAST = -15
const MOST = 35
/** Below this spread between paper and ink a box has no type in it. */
const MIN_CONTRAST = 40

/**
 * Otsu's threshold over a 256-bin luminance histogram: the cut that best
 * separates the two populations, which on a word box is ink and paper.
 */
export function otsuThreshold(hist: ArrayLike<number>): number {
  let total = 0
  let sum = 0
  for (let i = 0; i < 256; i++) {
    total += hist[i]!
    sum += i * hist[i]!
  }
  let below = 0
  let belowSum = 0
  let best = -1
  let threshold = 127
  for (let i = 0; i < 256; i++) {
    below += hist[i]!
    if (below === 0) continue
    const above = total - below
    if (above === 0) break
    belowSum += i * hist[i]!
    const spread = below * above * (belowSum / below - (sum - belowSum) / above) ** 2
    if (spread > best) {
      best = spread
      threshold = i
    }
  }
  return threshold
}

/**
 * The angle a box's strokes lean at, in degrees, positive leaning right as an
 * italic does; or null when the box holds too little ink to say.
 */
export function strokeSlant(image: GrayImage, box: PixelBox): number | null {
  const x0 = Math.max(0, Math.floor(box.x0))
  const y0 = Math.max(0, Math.floor(box.y0))
  const x1 = Math.min(image.width, Math.ceil(box.x1))
  const y1 = Math.min(image.height, Math.ceil(box.y1))
  if (x1 <= x0 || y1 <= y0) return null
  const hist = new Array<number>(256).fill(0)
  let darkest = 255
  let lightest = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = image.data[y * image.width + x]!
      hist[v]!++
      if (v < darkest) darkest = v
      if (v > lightest) lightest = v
    }
  }
  if (lightest - darkest < MIN_CONTRAST) return null
  const threshold = otsuThreshold(hist)
  const xs: number[] = []
  const ys: number[] = []
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (image.data[y * image.width + x]! <= threshold) {
        xs.push(x - x0)
        ys.push(y1 - 1 - y)
      }
    }
  }
  if (xs.length < MIN_INK) return null

  // Each row is pushed left by its height times the tangent, so a stem that
  // leans by exactly that angle lands in one column. Rows are measured up
  // from the box's foot, which keeps every shifted column non-negative for
  // a forward lean and bounded for a back one.
  const height = y1 - y0
  const width = x1 - x0
  const pad = Math.ceil(height * Math.tan((Math.max(-LEAST, MOST) * Math.PI) / 180)) + 1
  const columns = new Float64Array(width + 2 * pad)
  const score = (degrees: number): number => {
    const t = Math.tan((degrees * Math.PI) / 180)
    columns.fill(0)
    for (let i = 0; i < xs.length; i++) columns[Math.round(xs[i]! - ys[i]! * t) + pad]! += 1
    let s = 0
    for (let i = 0; i < columns.length; i++) s += columns[i]! * columns[i]!
    return s
  }
  let bestAt = 0
  let bestScore = -1
  const scores = new Map<number, number>()
  for (let d = LEAST; d <= MOST; d++) {
    const s = score(d)
    scores.set(d, s)
    if (s > bestScore) {
      bestScore = s
      bestAt = d
    }
  }
  // A parabola through the best degree and its neighbours puts the peak
  // between whole degrees, which matters only near the threshold.
  const left = scores.get(bestAt - 1)
  const right = scores.get(bestAt + 1)
  if (left === undefined || right === undefined) return bestAt
  const bend = left - 2 * bestScore + right
  return bend < 0 ? bestAt + (left - right) / (2 * bend) : bestAt
}

/** A word as the witness needs it: how many letters, and how it leans. */
export interface SlantedWord {
  letters: number
  slant: number | null
}

/** The middle of a list of numbers, or null for an empty one. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** A page's roman: the median slant of its words long enough to judge. */
export function pageRoman(words: readonly SlantedWord[]): number | null {
  return median(
    words.filter((w) => w.letters >= MIN_LETTERS && w.slant !== null).map((w) => w.slant!)
  )
}

/**
 * Which of a page's words, in reading order, are italic.
 *
 * The page's roman is the median slant of its words long enough to judge; a
 * word is italic when it leans {@link ITALIC_LEAN} beyond that, and not past
 * {@link ITALIC_MOST}. A short word between two italic ones is italic with
 * them, and roman anywhere else.
 */
export function italicWords(words: readonly SlantedWord[]): boolean[] {
  const roman = pageRoman(words)
  if (roman === null) return words.map(() => false)
  const judged = words.map((w) => w.letters >= MIN_LETTERS && w.slant !== null)
  const lean = words.map((w) => (w.slant === null ? null : w.slant - roman))
  const own = words.map((_, i) => judged[i]! && lean[i]! >= ITALIC_LEAN && lean[i]! <= ITALIC_MOST)
  return own.map((italic, i) => {
    if (italic || judged[i]) return italic
    let before = i - 1
    while (before >= 0 && !judged[before]) before--
    let after = i + 1
    while (after < words.length && !judged[after]) after++
    return before >= 0 && after < words.length && own[before]! && own[after]!
  })
}
