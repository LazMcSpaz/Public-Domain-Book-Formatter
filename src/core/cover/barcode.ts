/**
 * The barcode on the back cover, from the book's own ISBN.
 *
 * KDP prints one itself if the cover does not carry one, and what it prints is
 * a black rectangle on white — a sticker on a board that was designed. The
 * alternative is to draw it, which is arithmetic rather than artwork: an
 * ISBN-13 *is* an EAN-13, and EAN-13 is a fixed encoding of thirteen digits
 * into ninety-five modules. Nothing here is a judgement call.
 *
 * ## The one thing a designer may not choose
 *
 * A barcode is read by shining light at it and measuring what comes back, so
 * **the bars must be darker than the spaces** and by a wide margin. GS1 asks
 * for a Minimum Reflectance Difference of 0.70 at 670 nm, which is a red
 * laser, so what matters is the *red* channel and not how dark a colour looks
 * to the eye. Three consequences, and each has cost somebody a print run:
 *
 * - **Light bars on a dark ground do not scan.** Measured on this shelf's
 *   olive board, cream bars give an MRD of **-0.64**: to a scanner that is a
 *   blank label. Some image-based readers invert; the laser at a till does
 *   not, and a book that will not scan is a book a shop cannot sell.
 * - **Red bars do not scan**, for the same reason read the other way: red ink
 *   reflects red light, so a red bar and a white space look alike.
 * - A dark **green**, **blue** or **brown** is fine, which is what lets a
 *   cover keep its own colours instead of borrowing black and white.
 *
 * So `barcodeInk` takes the palette and returns the pair to print: the
 * lightest colour it has for the spaces, and the darkest **darkened until the
 * measured MRD clears the limit** for the bars. It reports the number it
 * reached, because a barcode that fails quietly fails at the till.
 *
 * Pure: no I/O, no DOM, no randomness. The module stream is what the composer
 * turns into rectangles.
 */

/** GS1's minimum reflectance difference, measured in the red channel. */
export const MIN_REFLECTANCE_DIFFERENCE = 0.7

/**
 * What `barcodeInk` aims at, which is above the minimum on purpose.
 *
 * The limit is a limit, and a symbol that computes to 0.702 on the screen has
 * nothing left for the press: ink spreads into the spaces, uncoated stock is
 * not the white the file says, and a scanner at a till is not a colorimeter in
 * a lab. Measured off a render of the olive board, aiming at the limit gave
 * exactly 0.702. Five points of headroom costs a slightly darker green that
 * nobody will identify as different, and buys the margin back.
 */
export const TARGET_REFLECTANCE_DIFFERENCE = 0.75

/**
 * Nominal EAN-13 dimensions at 100% magnification, in inches.
 *
 * GS1 gives these in millimetres: a module is 0.33 mm, the symbol is 95
 * modules wide, the bars are 22.85 mm tall and the guard bars run 5 modules
 * lower. KDP's area is 2 x 1.2 in, which a 100% symbol fits inside with its
 * quiet zones; the composer scales to fit rather than assuming it does.
 */
export const MODULE_IN = 0.33 / 25.4
export const SYMBOL_MODULES = 95
export const BAR_HEIGHT_IN = 22.85 / 25.4
/** Guard bars descend past the others, which is what the digits sit beside. */
export const GUARD_DROP_MODULES = 5
/** The quiet zone each side, in modules. Nothing may be drawn in it. */
export const QUIET_LEFT_MODULES = 11
export const QUIET_RIGHT_MODULES = 7

/** The left-hand digits are encoded in one of two parities; this says which. */
const PARITY: readonly string[] = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL'
]

/** Seven modules per digit, as bars (1) and spaces (0). */
const L_CODE: readonly string[] = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011'
]

/**
 * R is L complemented; G is R reversed — L complemented *and* reversed.
 * Derived, not typed.
 *
 * This line once said that and did only the reversing, so every G digit began
 * with a bar where the standard puts a space. The symbol printed, looked like
 * a barcode, carried the right digits under it, and no scanner on earth could
 * read it: KDP rejected *The Lost Keys of Masonry* with "unable to detect a
 * valid barcode", and ZXing found nothing either. The test decoder had derived
 * its G table the same wrong way, so it read the fault back as the right
 * ISBN — which is why it now carries the standard's table typed out instead.
 */
const R_CODE = L_CODE.map((bits) => [...bits].map((b) => (b === '0' ? '1' : '0')).join(''))
const G_CODE = R_CODE.map((bits) => [...bits].reverse().join(''))

/** The add-on's two digits-worth of parity, chosen by the checksum of the five. */
const ADDON_PARITY: readonly string[] = [
  'GGLLL',
  'GLGLL',
  'GLLGL',
  'GLLLG',
  'LGGLL',
  'LLGGL',
  'LLLGG',
  'LGLGL',
  'LGLLG',
  'LLGLG'
]

/** Strip anything that is not a digit — an ISBN is often written with dashes. */
export function digitsOf(raw: string): string {
  return raw.replace(/[^0-9]/g, '')
}

/**
 * The thirteenth digit, which every ISBN-13 already carries.
 *
 * Computed rather than trusted: a mistyped ISBN whose check digit is wrong
 * encodes to a symbol that scans to a number no book has, which is worse than
 * one that does not scan at all.
 */
export function ean13CheckDigit(first12: string): number {
  let sum = 0
  for (let i = 0; i < 12; i += 1) {
    sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3)
  }
  return (10 - (sum % 10)) % 10
}

export interface BarcodeModule {
  /** Where the run starts, in modules from the symbol's left edge. */
  from: number
  /** How many modules wide. */
  width: number
  /** Guard bars run lower than the rest, past the digit line. */
  guard: boolean
}

export interface EncodedBarcode {
  /** The thirteen digits, as they are printed. */
  digits: string
  /** The five-digit add-on, if one was asked for. */
  addOn: string | null
  /** Bars only; the spaces are the gaps between them. */
  bars: BarcodeModule[]
  /** Total width of the symbol in modules, add-on and its gap included. */
  widthModules: number
}

/** Bits to runs of bars, so the composer draws one rectangle per run. */
function runsOf(bits: string, offset: number, guardAt: ReadonlySet<number>): BarcodeModule[] {
  const out: BarcodeModule[] = []
  let i = 0
  while (i < bits.length) {
    if (bits[i] === '0') {
      i += 1
      continue
    }
    let j = i
    while (j < bits.length && bits[j] === '1') j += 1
    out.push({ from: offset + i, width: j - i, guard: guardAt.has(i) })
    i = j
  }
  return out
}

/**
 * Encode an ISBN-13 as EAN-13, with an optional five-digit add-on.
 *
 * Returns null rather than a wrong symbol when the digits are not an
 * ISBN-13 — the wrong number of them, or a check digit that does not agree.
 * A cover with no barcode is a cover KDP puts its own on; a cover with a
 * barcode for somebody else's book is a return.
 */
export function encodeEan13(raw: string, addOnRaw = ''): EncodedBarcode | null {
  const digits = digitsOf(raw)
  if (digits.length !== 13) return null
  if (ean13CheckDigit(digits.slice(0, 12)) !== Number(digits[12])) return null

  const addOn = digitsOf(addOnRaw)
  if (addOn.length !== 0 && addOn.length !== 5) return null

  const parity = PARITY[Number(digits[0])]!
  let bits = '101'
  // The guard patterns are where the bars run long: the start, the centre and
  // the end. Recorded by position so the composer need not count them again.
  const guardStarts = new Set<number>([0, 2])
  for (let i = 0; i < 6; i += 1) {
    const d = Number(digits[i + 1])
    bits += parity[i] === 'L' ? L_CODE[d]! : G_CODE[d]!
  }
  guardStarts.add(bits.length + 1)
  bits += '01010'
  guardStarts.add(bits.length - 2)
  for (let i = 0; i < 6; i += 1) {
    bits += R_CODE[Number(digits[i + 7])]!
  }
  guardStarts.add(bits.length)
  guardStarts.add(bits.length + 2)
  bits += '101'

  const bars = runsOf(bits, 0, guardStarts)
  let widthModules = SYMBOL_MODULES

  if (addOn.length === 5) {
    // The add-on sits a fixed gap to the right and carries its own start and
    // separator patterns. Its bars are all full height; it has no guards that
    // drop past the digits, because its digits are printed above it.
    const checksum =
      (Number(addOn[0]) * 3 +
        Number(addOn[1]) * 9 +
        Number(addOn[2]) * 3 +
        Number(addOn[3]) * 9 +
        Number(addOn[4]) * 3) %
      10
    const pattern = ADDON_PARITY[checksum]!
    const gap = 9
    let addBits = '01011'
    for (let i = 0; i < 5; i += 1) {
      const d = Number(addOn[i])
      addBits += pattern[i] === 'L' ? L_CODE[d]! : G_CODE[d]!
      if (i < 4) addBits += '01'
    }
    bars.push(...runsOf(addBits, SYMBOL_MODULES + gap, new Set()))
    widthModules = SYMBOL_MODULES + gap + addBits.length
  }

  return { digits, addOn: addOn.length === 5 ? addOn : null, bars, widthModules }
}

/** How the thirteen digits are grouped under the symbol. */
export function printedGroups(digits: string): {
  lead: string
  left: string
  right: string
} {
  return { lead: digits.slice(0, 1), left: digits.slice(1, 7), right: digits.slice(7) }
}

function channel(hex: string, index: number): number {
  const clean = hex.replace('#', '')
  const full =
    clean.length === 3 ? [...clean].map((c) => c + c).join('') : clean.padEnd(6, '0').slice(0, 6)
  return parseInt(full.slice(index * 2, index * 2 + 2), 16) / 255
}

/** Reflectance at 670 nm, which for printed ink is the red channel. */
export function redReflectance(hex: string): number {
  return channel(hex, 0)
}

function lighten(hex: string, by: number): string {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? [...clean].map((c) => c + c).join('') : clean
  const parts = [0, 1, 2].map((i) => {
    const v = parseInt(full.slice(i * 2, i * 2 + 2), 16)
    return Math.min(255, Math.round(v + (255 - v) * by))
  })
  return `#${parts.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function darken(hex: string, by: number): string {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? [...clean].map((c) => c + c).join('') : clean
  const parts = [0, 1, 2].map((i) => {
    const v = parseInt(full.slice(i * 2, i * 2 + 2), 16)
    return Math.max(0, Math.round(v * (1 - by)))
  })
  return `#${parts.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export interface BarcodeInk {
  /** The bars, dark. */
  bars: string
  /** The spaces and the quiet zone, light. */
  background: string
  /** What the pair measures, in the red channel. */
  reflectanceDifference: number
  /** Whether the bars had to be darkened past the palette's own colour. */
  darkened: boolean
  /**
   * Whether the spaces had to be lightened too.
   *
   * Only where the palette has no light colour at all: a board of mid-greys
   * cannot reach the limit however black the bars are, since the difference is
   * bounded by the lightest thing on it. The symbol then stops being made of
   * the book's own colours, which is the thing this module exists to do — so
   * it is reported rather than done quietly, and the honest answer for such a
   * cover is to give the barcode a patch of its own.
   */
  lightened: boolean
}

/**
 * The two colours to print the symbol in, taken from the cover's own palette.
 *
 * The point is to avoid the black-on-white sticker, and the constraint is that
 * the bars must still be much darker than the spaces in red light. So: the
 * palette's lightest colour carries the spaces, its darkest carries the bars,
 * and if that pair does not clear `MIN_REFLECTANCE_DIFFERENCE` the bars are
 * darkened until it does. On this shelf's olive board the ground measures 0.31
 * against a cream 0.95, which is 0.64 and a shade under; darkened it clears,
 * and the symbol still reads as the book's own colour rather than as ink
 * borrowed from somewhere else.
 */
export function barcodeInk(candidates: readonly string[]): BarcodeInk {
  const sorted = [...candidates].sort((a, b) => redReflectance(b) - redReflectance(a))
  const lightest = sorted[0] ?? '#ffffff'
  const darkest = sorted[sorted.length - 1] ?? '#000000'
  const clears = (bg: string, bars: string): boolean =>
    redReflectance(bg) - redReflectance(bars) >= TARGET_REFLECTANCE_DIFFERENCE

  // Darken the bars first, which is the step that keeps both colours the
  // book's own: a board's dark is usually nearly dark enough already.
  // Walked rather than solved, because the step is in the colour's own
  // channels and a closed form would have to assume they move together.
  let bars = darkest
  let darkened = false
  for (let by = 0; by <= 1.0001; by += 0.02) {
    bars = darken(darkest, by)
    darkened = by > 0
    if (clears(lightest, bars)) break
  }

  // Only if that could not reach it: a palette with no light colour bounds
  // the difference by its own lightest, however black the bars become.
  let background = lightest
  let lightened = false
  if (!clears(background, bars)) {
    for (let by = 0; by <= 1.0001; by += 0.02) {
      background = lighten(lightest, by)
      lightened = by > 0
      if (clears(background, bars)) break
    }
  }

  return {
    bars,
    background,
    reflectanceDifference: redReflectance(background) - redReflectance(bars),
    darkened,
    lightened
  }
}
