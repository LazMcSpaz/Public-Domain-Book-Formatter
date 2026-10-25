/**
 * The barcode on the back cover, from the book's own ISBN.
 *
 * KDP prints one itself if the cover does not carry one, and what it prints is
 * a black rectangle on white — a sticker on a board that was designed. The
 * alternative is to draw it, which is arithmetic rather than artwork: an
 * ISBN-13 *is* an EAN-13, and EAN-13 is a fixed encoding of thirteen digits
 * into ninety-five modules. Nothing here is a judgement call.
 *
 * ## Black on white, because KDP says so
 *
 * This module once drew the symbol in the cover's own colours — the board's
 * dark darkened until GS1's reflectance limit cleared, on the board's cream —
 * so the back of a designed book would not carry a sticker. Every symbol it
 * drew in colour was refused. KDP's Barcodes page
 * (kdp.amazon.com/en_US/help/topic/G5HDYGP4BXLX4RUW) is not a recommendation
 * on this: a barcode the cover supplies must be "100% black (not RGB/CMYK
 * color or registration black)" on a "solid white background". The
 * *Manuscript Lectures* and *Lost Keys* covers decoded cleanly in ZXing and
 * were still turned away with "unable to detect a valid barcode", because the
 * check is of the inks and not only of whether the symbol reads.
 *
 * So the colours are constants rather than a function of the palette, and the
 * writer prints them as process black alone — `BARCODE_BARS` maps to C0 M0 Y0
 * K100, never to an RGB black that a press would separate into four inks.
 *
 * Pure: no I/O, no DOM, no randomness. The module stream is what the composer
 * turns into rectangles.
 */

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

/** The bars and the digits: printed as 100% K, see the module comment. */
export const BARCODE_BARS = '#000000'
/** The patch the symbol sits on, quiet zones included: solid white. */
export const BARCODE_SPACE = '#ffffff'
