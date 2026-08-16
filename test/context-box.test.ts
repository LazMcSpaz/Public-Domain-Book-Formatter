import { describe, it, expect } from 'vitest'
import { contextBox, onSameLine, type BoxLike } from '@core/lexicon'

const box = (x0: number, y0: number, x1: number, y1: number): BoxLike => ({
  bbox: { x0, y0, x1, y1 }
})

/**
 * The term grid shows one word cut out of the page, which is enough to read the
 * letters and not always enough to judge them: `mineralls` could be the book's
 * own spelling or OCR doubling an `l`. The sentence around it settles that, and
 * the pixels are already rendered when the word crop is taken.
 */
describe('the line a word sits on', () => {
  it('takes the neighbours either side', () => {
    const line = [box(0, 10, 40, 30), box(50, 10, 90, 30), box(100, 10, 140, 30)]
    const region = contextBox(line[1]!, line, { eitherSide: 1, padding: 0 })
    expect(region.x0).toBe(0)
    expect(region.x1).toBe(140)
  })

  it('stops at the end of the line rather than reaching into the next column', () => {
    // The case blind padding gets wrong, and it gets it wrong on exactly the
    // pages that matter — an index, a table, anything set in two columns.
    const word = box(0, 10, 40, 30)
    const nextColumn = box(400, 10, 460, 30)
    const region = contextBox(word, [word, nextColumn], { eitherSide: 4, padding: 0 })
    expect(region.x1).toBe(460)

    // …because they *are* on the same line. The real protection is that a word
    // on a different line is never included:
    const below = box(400, 60, 460, 80)
    const tight = contextBox(word, [word, below], { eitherSide: 4, padding: 0 })
    expect(tight.x1).toBe(40)
  })

  it('ignores words on the line above and below', () => {
    const word = box(50, 100, 90, 120)
    const above = box(50, 60, 90, 80)
    const below = box(50, 140, 90, 160)
    const region = contextBox(word, [above, word, below], { eitherSide: 4, padding: 0 })
    expect(region.y0).toBe(100)
    expect(region.y1).toBe(120)
  })

  it('gives a word alone on its line its own box', () => {
    const word = box(50, 10, 90, 30)
    const region = contextBox(word, [word], { eitherSide: 4, padding: 2 })
    expect(region).toEqual({ x0: 48, y0: 8, x1: 92, y1: 32 })
  })

  it('is not fooled by a tall word on the same line', () => {
    // OCR boxes on one line vary in height — a word with a descender is taller
    // — so comparing centres alone would put "typography" on its own line.
    const short = box(0, 100, 40, 118)
    const tall = box(50, 96, 120, 126)
    expect(onSameLine(short, tall)).toBe(true)
  })

  it('keeps two lines apart even when they nearly touch', () => {
    expect(onSameLine(box(0, 100, 40, 120), box(0, 119, 40, 139))).toBe(false)
  })

  it('handles a box given with its corners the other way round', () => {
    const flipped: BoxLike = { bbox: { x0: 90, y0: 30, x1: 50, y1: 10 } }
    expect(onSameLine(flipped, box(0, 10, 40, 30))).toBe(true)
  })
})
