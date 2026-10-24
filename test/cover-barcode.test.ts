/**
 * The barcode, which is arithmetic rather than artwork.
 *
 * An ISBN-13 is an EAN-13 and EAN-13 is a fixed encoding, so every assertion
 * here is against the standard rather than against taste. The two that matter
 * most are the ones a wrong answer would hide: a symbol that scans to the
 * wrong book, and a pair of colours that will not scan at all.
 */
import { describe, expect, it } from 'vitest'
import { fixedWidthMeasurer } from '@core/layout'
import type { CoverDocument } from '@core/cover'
import {
  BARCODE_ID,
  composeCover,
  defaultCover,
  validateCover,
  BAR_HEIGHT_IN,
  MIN_REFLECTANCE_DIFFERENCE,
  MODULE_IN,
  SYMBOL_MODULES,
  barcodeInk,
  digitsOf,
  ean13CheckDigit,
  encodeEan13,
  printedGroups,
  redReflectance
} from '@core/cover'

/** The two Hall volumes, as KDP assigned them. */
const LECTURES_PB = '9798164602758'
const LECTURES_HC = '9798164630898'
const LOST_KEYS_PB = '9798164619374'

describe('the check digit', () => {
  it('agrees with every ISBN this shelf has been given', () => {
    for (const isbn of [LECTURES_PB, LECTURES_HC, LOST_KEYS_PB, '9798170124800']) {
      expect(ean13CheckDigit(isbn.slice(0, 12)), isbn).toBe(Number(isbn[12]))
    }
  })

  it('is computed, so a mistyped ISBN is refused rather than encoded', () => {
    // A symbol that scans to a number no book has is worse than no symbol:
    // the first is a return, the second is KDP printing its own.
    const wrong = LECTURES_PB.slice(0, 12) + String((Number(LECTURES_PB[12]) + 1) % 10)
    expect(encodeEan13(wrong)).toBeNull()
  })

  it('refuses anything that is not thirteen digits', () => {
    expect(encodeEan13('97981646027')).toBeNull()
    expect(encodeEan13('97981646027589')).toBeNull()
    expect(encodeEan13('')).toBeNull()
  })

  it('reads an ISBN written with dashes', () => {
    expect(digitsOf('979-8-16460-275-8')).toBe(LECTURES_PB)
    expect(encodeEan13('979-8-16460-275-8')).not.toBeNull()
  })
})

describe('the symbol', () => {
  const encoded = encodeEan13(LECTURES_PB)!

  it('is ninety-five modules wide with no add-on', () => {
    expect(encoded.widthModules).toBe(SYMBOL_MODULES)
  })

  it('starts and ends with a guard bar and has one in the middle', () => {
    const guards = encoded.bars.filter((b) => b.guard)
    // Three guard patterns, two bars each.
    expect(guards).toHaveLength(6)
    expect(guards[0]!.from).toBe(0)
    expect(guards[guards.length - 1]!.from + guards[guards.length - 1]!.width).toBe(SYMBOL_MODULES)
  })

  it('never runs two bars together, which would be one wider bar', () => {
    const sorted = [...encoded.bars].sort((a, b) => a.from - b.from)
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]!.from).toBeGreaterThan(sorted[i - 1]!.from + sorted[i - 1]!.width - 1)
    }
  })

  it('encodes a different ISBN to a different pattern', () => {
    // The fault this catches is a symbol that ignores its input, which looks
    // perfectly like a barcode and scans to one wrong number for every book.
    const other = encodeEan13(LOST_KEYS_PB)!
    const key = (e: typeof encoded) => e.bars.map((b) => `${b.from}:${b.width}`).join(',')
    expect(key(encoded)).not.toBe(key(other))
  })

  it('distinguishes the paperback from the hardcover of one book', () => {
    const pb = encodeEan13(LECTURES_PB)!
    const hc = encodeEan13(LECTURES_HC)!
    const key = (e: typeof pb) => e.bars.map((b) => `${b.from}:${b.width}`).join(',')
    expect(key(pb)).not.toBe(key(hc))
  })

  it('groups the printed digits the way EAN-13 prints them', () => {
    const g = printedGroups(LECTURES_PB)
    expect(g.lead).toBe('9')
    expect(g.left).toBe('798164')
    expect(g.right).toBe('602758')
    expect(g.lead + g.left + g.right).toBe(LECTURES_PB)
  })

  it('takes a five-digit add-on and grows by it', () => {
    const withAddOn = encodeEan13(LECTURES_PB, '90000')!
    expect(withAddOn.addOn).toBe('90000')
    expect(withAddOn.widthModules).toBeGreaterThan(SYMBOL_MODULES)
    expect(withAddOn.bars.length).toBeGreaterThan(encoded.bars.length)
  })

  it('refuses an add-on that is not five digits', () => {
    expect(encodeEan13(LECTURES_PB, '900')).toBeNull()
  })

  it('is about an inch and a half wide at full size', () => {
    // 95 modules at 0.33 mm is 31.35 mm, and KDP's area is 2 in across.
    expect(SYMBOL_MODULES * MODULE_IN).toBeCloseTo(1.234, 3)
    expect(BAR_HEIGHT_IN).toBeCloseTo(0.9, 2)
  })
})

describe('the colours a scanner can actually read', () => {
  /** This shelf's olive board and its cream. */
  const OLIVE = '#4f5738'
  const CREAM = '#f1efe2'

  it('takes the light colour for the spaces and the dark for the bars', () => {
    const ink = barcodeInk([OLIVE, CREAM, '#d8d2b2'])
    expect(ink.background).toBe(CREAM)
    expect(redReflectance(ink.bars)).toBeLessThan(redReflectance(ink.background))
  })

  it('never hands back a pair under the standard’s limit', () => {
    // Asserted against the standard, while  aims above it: a
    // symbol computed exactly to the limit has nothing left for ink spread,
    // and a render of the olive board measured 0.702 when it aimed at 0.70.
    // The whole point of the module. A cover that prints a symbol nobody can
    // scan has the fault KDP's own barcode exists to prevent, and has it
    // invisibly: it looks right in every render.
    for (const palette of [
      [OLIVE, CREAM],
      ['#1d2a44', '#ece4d2'],
      ['#5a2027', '#f2e9d8'],
      // A pair with almost no difference at all, which must still come back legal.
      ['#888888', '#8a8a8a']
    ]) {
      const ink = barcodeInk(palette)
      expect(ink.reflectanceDifference, palette.join('/')).toBeGreaterThanOrEqual(
        MIN_REFLECTANCE_DIFFERENCE
      )
    }
  })

  it('darkens the palette’s own colour rather than reaching for black', () => {
    const ink = barcodeInk([OLIVE, CREAM])
    expect(ink.darkened).toBe(true)
    // Still recognisably the board's colour: green above red, as olive is.
    const g = parseInt(ink.bars.slice(3, 5), 16)
    const r = parseInt(ink.bars.slice(1, 3), 16)
    expect(g).toBeGreaterThan(r)
    expect(ink.bars).not.toBe('#000000')
  })

  it('leaves a pair that already clears the limit alone', () => {
    const ink = barcodeInk(['#000000', '#ffffff'])
    expect(ink.darkened).toBe(false)
    expect(ink.bars).toBe('#000000')
    expect(ink.reflectanceDifference).toBeCloseTo(1, 6)
  })
})

describe('a palette with no light colour in it', () => {
  it('lightens the spaces rather than shipping a symbol nobody can scan', () => {
    // Found by the test above rather than by reasoning: darkening the bars
    // cannot reach the limit when the difference is bounded by the lightest
    // colour on the board. A cover of mid-greys has no legal pair in it.
    const ink = barcodeInk(['#888888', '#8a8a8a'])
    expect(ink.reflectanceDifference).toBeGreaterThanOrEqual(MIN_REFLECTANCE_DIFFERENCE)
    expect(ink.lightened).toBe(true)
  })

  it('leaves the spaces alone where the palette has a light colour', () => {
    // The ordinary case, and the one the module is for: the book's own cream
    // carries the spaces untouched.
    const ink = barcodeInk(['#4f5738', '#f1efe2'])
    expect(ink.lightened).toBe(false)
    expect(ink.background).toBe('#f1efe2')
  })
})

describe('the barcode on a composed cover', () => {
  const measurer = fixedWidthMeasurer(0.5)
  const withIsbn = (isbn: string, addOn = '90000'): CoverDocument => {
    const d = defaultCover('7x10', 489)
    d.content = { ...d.content, title: 'Keys', author: 'M. P. Hall', isbn, isbnAddOn: addOn }
    d.look = { ...d.look, palette: { ...d.look.palette, ground: '#4f5738', ink: '#f1efe2' } }
    return d
  }
  const compose = (d: CoverDocument) => composeCover(d, { measurer })
  const barcodeItems = (d: CoverDocument) =>
    compose(d).items.filter((i) => 'id' in i && i.id === BARCODE_ID)

  it('draws nothing at all when there is no ISBN', () => {
    expect(barcodeItems(withIsbn(''))).toHaveLength(0)
  })

  it('draws bars and a background when there is one', () => {
    const items = barcodeItems(withIsbn(LECTURES_PB))
    expect(items.length).toBeGreaterThan(20)
  })

  it('refuses an ISBN whose check digit is wrong, and says so', () => {
    const bad = LECTURES_PB.slice(0, 12) + String((Number(LECTURES_PB[12]) + 1) % 10)
    const composed = compose(withIsbn(bad))
    expect(composed.items.filter((i) => 'id' in i && i.id === BARCODE_ID)).toHaveLength(0)
    expect(composed.warnings.join(' ')).toMatch(/not a valid ISBN-13/)
  })

  it('keeps the whole symbol inside the area KDP reserves', () => {
    // Outside it and KDP prints its own barcode over the top, which is both
    // the ugly rectangle this avoids and a symbol with another through it.
    const d = withIsbn(LECTURES_PB)
    const { geometry } = compose(d)
    for (const item of barcodeItems(d)) {
      const x = item.xPt / 72
      const y = item.yPt / 72
      const w = 'widthPt' in item ? item.widthPt / 72 : 0
      const h = 'heightPt' in item ? item.heightPt / 72 : 0
      expect(x).toBeGreaterThanOrEqual(geometry.barcode.x - 1e-6)
      expect(y).toBeGreaterThanOrEqual(geometry.barcode.y - 1e-6)
      expect(x + w).toBeLessThanOrEqual(geometry.barcode.x + geometry.barcode.width + 1e-6)
      expect(y + h).toBeLessThanOrEqual(geometry.barcode.y + geometry.barcode.height + 1e-6)
    }
  })

  it('keeps every bar and every digit inside its own patch', () => {
    // Found by cropping a render: the five-digit add-on prints its digits
    // *above* its bars, and with no headroom reserved they set above the
    // patch, on the board. Nothing on a barcode may sit on the cover's own
    // colour — the quiet zone is part of the symbol.
    for (const addOn of ['90000', '']) {
      const d = withIsbn(LECTURES_PB, addOn)
      const items = barcodeItems(d)
      const patch = items.find((i) => i.kind === 'fill' && i.widthPt > 20)
      expect(patch, `add-on ${addOn || 'none'}`).toBeDefined()
      const px = patch!.xPt
      const py = patch!.yPt
      const pw = 'widthPt' in patch! ? patch!.widthPt : 0
      const ph = 'heightPt' in patch! ? patch!.heightPt : 0
      for (const item of items) {
        if (item === patch) continue
        const w = item.kind === 'text' ? item.widthPt : 'widthPt' in item ? item.widthPt : 0
        const h = item.kind === 'text' ? item.sizePt : 'heightPt' in item ? item.heightPt : 0
        const top = item.kind === 'text' ? item.yPt - item.sizePt : item.yPt
        expect(item.xPt, `${addOn}: left`).toBeGreaterThanOrEqual(px - 0.5)
        expect(item.xPt + w, `${addOn}: right`).toBeLessThanOrEqual(px + pw + 0.5)
        expect(top, `${addOn}: top`).toBeGreaterThanOrEqual(py - 0.5)
        expect(top + h, `${addOn}: bottom`).toBeLessThanOrEqual(py + ph + 0.5)
      }
    }
  })

  it('prints the bars darker than the background it sits on', () => {
    const items = barcodeItems(withIsbn(LECTURES_PB)).filter((i) => i.kind === 'fill')
    const colours = new Set(items.map((i) => (i.kind === 'fill' ? i.color : '')))
    expect(colours.size).toBe(2)
    const [a, b] = [...colours]
    const diff = Math.abs(redReflectance(a!) - redReflectance(b!))
    expect(diff).toBeGreaterThanOrEqual(MIN_REFLECTANCE_DIFFERENCE)
  })

  it('does not make the barcode check complain about itself', () => {
    // The `isGround` lesson in the rectangle that lesson is about: a check
    // that fires on every cover which got it right is one nobody reads.
    const d = withIsbn(LECTURES_PB)
    const report = validateCover({
      doc: d,
      composed: compose(d),
      fileBytes: 1000,
      fontsEmbedded: true,
      pageCountMeasured: true
    })
    const check = report.checks.find((c) => c.id === 'barcode')
    expect(check?.level).toBe('ok')
    expect(check?.detail).toMatch(/carries its own barcode/)
    expect(report.checks.find((c) => c.id === 'safe-margin')?.level).toBe('ok')
  })

  it('still says the area is clear on a cover with no ISBN', () => {
    const d = withIsbn('')
    const report = validateCover({
      doc: d,
      composed: compose(d),
      fileBytes: 1000,
      fontsEmbedded: true,
      pageCountMeasured: true
    })
    expect(report.checks.find((c) => c.id === 'barcode')?.detail).toMatch(/KDP will print its own/)
  })
})

/**
 * Read the symbol back, which is the only test that checks the encoding.
 *
 * Everything above compares one pattern with another, and two wrong patterns
 * differ just as happily as two right ones. Deleting the parity lookup — so
 * every left-hand digit encodes with the L table and the lead digit vanishes
 * from the symbol altogether — passed all of it. A barcode that scans to the
 * wrong book is the worst outcome available here, worse than one that does
 * not scan, and only an inverse catches it.
 *
 * The decoder below is written from the standard rather than from the
 * encoder's own tables: bar runs back to bits, bits back to digits.
 */
describe('decoding the symbol back to the ISBN', () => {
  /** Bar runs to the 95-module bit string, spaces included. */
  function bitsOf(encoded: NonNullable<ReturnType<typeof encodeEan13>>): string {
    const bits = new Array<string>(SYMBOL_MODULES).fill('0')
    for (const bar of encoded.bars) {
      if (bar.from >= SYMBOL_MODULES) continue
      for (let i = 0; i < bar.width; i += 1) bits[bar.from + i] = '1'
    }
    return bits.join('')
  }

  // The L table, written out again here on purpose: a decoder that imports the
  // encoder's tables cannot catch a wrong table, only a wrong lookup.
  const L = [
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
  // G and R typed out from the standard's own tables too. G was derived here
  // once — by the same mistake the encoder made, reversing L without
  // complementing it — so this decoder read an unscannable symbol back as the
  // right ISBN and KDP was the first thing to notice.
  const G = [
    '0100111',
    '0110011',
    '0011011',
    '0100001',
    '0011101',
    '0111001',
    '0000101',
    '0010001',
    '0001001',
    '0010111'
  ]
  const R = [
    '1110010',
    '1100110',
    '1101100',
    '1000010',
    '1011100',
    '1001110',
    '1010000',
    '1000100',
    '1001000',
    '1110100'
  ]
  const PARITY = [
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

  function decode(bits: string): string | null {
    if (bits.slice(0, 3) !== '101') return null
    if (bits.slice(45, 50) !== '01010') return null
    if (bits.slice(92) !== '101') return null
    let parity = ''
    const left: number[] = []
    for (let i = 0; i < 6; i += 1) {
      const chunk = bits.slice(3 + i * 7, 10 + i * 7)
      const l = L.indexOf(chunk)
      const g = G.indexOf(chunk)
      if (l >= 0) {
        parity += 'L'
        left.push(l)
      } else if (g >= 0) {
        parity += 'G'
        left.push(g)
      } else return null
    }
    const lead = PARITY.indexOf(parity)
    if (lead < 0) return null
    const right: number[] = []
    for (let i = 0; i < 6; i += 1) {
      const chunk = bits.slice(50 + i * 7, 57 + i * 7)
      const r = R.indexOf(chunk)
      if (r < 0) return null
      right.push(r)
    }
    return `${lead}${left.join('')}${right.join('')}`
  }

  it('starts every digit with a space and ends it with a bar on the left, the reverse on the right', () => {
    // The structural rule a scanner leans on to find the digits at all, and
    // the one an inverted table breaks whatever its decoder says.
    for (const isbn of [LECTURES_PB, LOST_KEYS_PB, '9780306406157']) {
      const bits = bitsOf(encodeEan13(isbn)!)
      for (let i = 0; i < 6; i += 1) {
        const left = bits.slice(3 + i * 7, 10 + i * 7)
        const right = bits.slice(50 + i * 7, 57 + i * 7)
        expect(left[0] + left[6], `${isbn} left digit ${i + 1}`).toBe('01')
        expect(right[0] + right[6], `${isbn} right digit ${i + 1}`).toBe('10')
      }
    }
  })

  it('reads every ISBN on this shelf back out of its own bars', () => {
    for (const isbn of [LECTURES_PB, LECTURES_HC, LOST_KEYS_PB, '9798170124800']) {
      const encoded = encodeEan13(isbn)!
      expect(decode(bitsOf(encoded)), isbn).toBe(isbn)
    }
  })

  it('reads it back the same with an add-on beside it', () => {
    const encoded = encodeEan13(LECTURES_PB, '90000')!
    expect(decode(bitsOf(encoded))).toBe(LECTURES_PB)
  })

  it('carries the lead digit in the parity, where EAN-13 puts it', () => {
    // The lead digit has no bars of its own — it is the pattern of L and G
    // across the left six. An encoder that ignores parity loses it silently.
    const a = encodeEan13('9780306406157')!
    const b = encodeEan13('4006381333931')!
    expect(decode(bitsOf(a))).toBe('9780306406157')
    expect(decode(bitsOf(b))).toBe('4006381333931')
  })
})
