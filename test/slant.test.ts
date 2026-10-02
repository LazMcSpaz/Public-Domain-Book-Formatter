import { describe, it, expect } from 'vitest'
import { italicWords, otsuThreshold, strokeLean, strokeSlant, type GrayImage } from '@core/image'

/**
 * A word drawn as a scan draws it: dark stems on light paper, each stem
 * leaning `degrees` to the right, with a round letter's bowl beside them so
 * the profile is not all stems.
 */
function word(degrees: number, stems = 5, opts: { ink?: number; paper?: number } = {}): GrayImage {
  const width = 12 + stems * 14 + 30
  const height = 44
  const data = new Uint8Array(width * height).fill(opts.paper ?? 235)
  const ink = opts.ink ?? 25
  const t = Math.tan((degrees * Math.PI) / 180)
  // The baseline at row 36 and the x-height at row 18, with the first stem
  // an ascender: ink concentrated through the middle, as a boxed word's is.
  const BASE = 36
  for (let s = 0; s < stems; s++) {
    for (let y = s === 0 ? 4 : 18; y < BASE; y++) {
      const lift = BASE - 1 - y
      for (let w = 0; w < 4; w++) {
        const x = Math.round(8 + s * 14 + w + lift * t)
        if (x >= 0 && x < width) data[y * width + x] = ink
      }
    }
  }
  // A bowl: a ring at x-height, which leans with the stems but has no column.
  const cx = 8 + stems * 14 + 8
  for (let y = 18; y < BASE; y++) {
    for (let x = cx - 8; x <= cx + 8; x++) {
      const r = Math.hypot(x - cx - (BASE - 1 - y) * t, y - 27)
      if (r > 5 && r < 8 && x < width) data[y * width + x] = ink
    }
  }
  return { data, width, height }
}
const all = (img: GrayImage) => ({ x0: 0, y0: 0, x1: img.width, y1: img.height })

describe('the slant of a word’s strokes', () => {
  it('is upright for roman', () => {
    const img = word(0)
    expect(Math.abs(strokeSlant(img, all(img))!)).toBeLessThan(1)
  })

  // Within a degree and a half: a raster rounds every stem to whole pixels,
  // and the threshold this feeds is seven degrees wide.
  const near = (got: number | null, want: number) => expect(Math.abs(got! - want)).toBeLessThan(1.5)

  it('is the italic’s lean, near enough', () => {
    for (const lean of [10, 12, 16]) {
      const img = word(lean)
      near(strokeSlant(img, all(img)), lean)
    }
  })

  it('reads a backslant as negative', () => {
    const img = word(-6)
    near(strokeSlant(img, all(img)), -6)
  })

  it('measures only the box it is given', () => {
    const roman = word(0)
    const italic = word(14)
    const width = roman.width + italic.width
    const data = new Uint8Array(width * roman.height)
    for (let y = 0; y < roman.height; y++) {
      data.set(roman.data.subarray(y * roman.width, (y + 1) * roman.width), y * width)
      data.set(
        italic.data.subarray(y * italic.width, (y + 1) * italic.width),
        y * width + roman.width
      )
    }
    const page = { data, width, height: roman.height }
    expect(Math.abs(strokeSlant(page, { x0: 0, y0: 0, x1: roman.width, y1: 44 })!)).toBeLessThan(1)
    near(strokeSlant(page, { x0: roman.width, y0: 0, x1: width, y1: 44 }), 14)
  })

  it('says nothing about a blank, a speck or a box with no contrast', () => {
    const blank = { data: new Uint8Array(40 * 40).fill(240), width: 40, height: 40 }
    expect(strokeSlant(blank, all(blank))).toBeNull()
    blank.data[40 * 20 + 20] = 0
    expect(strokeSlant(blank, all(blank))).toBeNull()
    const faint = word(12, 5, { ink: 210, paper: 235 })
    expect(strokeSlant(faint, all(faint))).toBeNull()
    expect(strokeSlant(blank, { x0: 50, y0: 0, x1: 60, y1: 10 })).toBeNull()
  })

  it('says nothing of a box set between two lines, which holds the foot of one and the head of the next', () => {
    const line = word(0)
    const two = {
      width: line.width,
      height: line.height * 2,
      data: new Uint8Array(line.width * line.height * 2)
    }
    two.data.set(line.data, 0)
    two.data.set(line.data, line.data.length)
    // The box from the middle of the first line to the middle of the second.
    expect(strokeSlant(two, { x0: 0, y0: 26, x1: line.width, y1: 26 + line.height })).toBeNull()
    expect(strokeSlant(two, { x0: 0, y0: 0, x1: line.width, y1: line.height })).not.toBeNull()
  })

  it('finds a word of bowls and diagonals leaning hardly at all, however it leans', () => {
    // `were`, `owe`, `know`: no upright stem, so every shear scores alike.
    const width = 120
    const height = 44
    const data = new Uint8Array(width * height).fill(235)
    for (const cx of [16, 40, 64, 88]) {
      for (let y = 18; y < 36; y++) {
        for (let x = cx - 9; x <= cx + 9; x++) {
          const r = Math.hypot(x - cx, y - 27)
          if (r > 5 && r < 8) data[y * width + x] = 25
        }
      }
    }
    const bowls = { data, width, height }
    expect(strokeLean(bowls, all(bowls))!.sharpness).toBeLessThan(1.03)
    const stems = word(12)
    expect(strokeLean(stems, all(stems))!.sharpness).toBeGreaterThan(1.03)
  })

  it('cuts ink from paper where the two populations part', () => {
    const hist = new Array(256).fill(0)
    hist[20] = 100
    hist[230] = 900
    const t = otsuThreshold(hist)
    expect(t).toBeGreaterThanOrEqual(20)
    expect(t).toBeLessThan(230)
  })
})

describe('which of a page’s words are italic', () => {
  const w = (slant: number | null, letters = 6) => ({ slant, letters })

  it('is judged against the page’s own roman, not against upright', () => {
    // A page photographed three degrees off: roman reads +3, an italic +14.
    const page = [w(3), w(3.5), w(2.5), w(14), w(3), w(9)]
    expect(italicWords(page)).toEqual([false, false, false, true, false, false])
  })

  it('bridges a short word between two italic ones, and nowhere else', () => {
    const page = [w(0), w(0), w(12), w(2, 2), w(13), w(0), w(12, 2), w(0), w(0)]
    expect(italicWords(page)).toEqual([false, false, true, true, true, false, false, false, false])
  })

  it('draws the line at eight degrees of lean, where roman stopped and italic began', () => {
    expect(italicWords([w(-1), w(-1), w(6), w(-1), w(8), w(-1)])).toEqual([
      false,
      false,
      false,
      false,
      true,
      false
    ])
  })

  it('takes a lean past any italic for a box off its word, not for italic', () => {
    expect(italicWords([w(0), w(-1), w(23), w(0), w(12)])).toEqual([
      false,
      false,
      false,
      false,
      true
    ])
  })

  it('takes no lean from a word that leans by a hair at every angle', () => {
    const blunt = { slant: 14, letters: 4, sharpness: 1.004 }
    const sharp = { slant: 14, letters: 4, sharpness: 1.09 }
    expect(italicWords([w(0), w(0), blunt, w(0), sharp, w(0)])).toEqual([
      false,
      false,
      false,
      false,
      true,
      false
    ])
  })

  it('never calls a short word italic on its own slant', () => {
    expect(italicWords([w(0), w(0), w(15, 2), w(0)])).toEqual([false, false, false, false])
  })

  it('finds nothing on a page set wholly in italic, which is the safe error', () => {
    expect(italicWords([w(12), w(13), w(12), w(11)])).toEqual([false, false, false, false])
  })

  it('finds nothing on a page with no word it could measure', () => {
    expect(italicWords([w(null), w(null, 2)])).toEqual([false, false])
  })
})
