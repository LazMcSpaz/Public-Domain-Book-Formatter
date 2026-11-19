import { describe, it, expect } from 'vitest'
import {
  CROP_LINES_AROUND,
  planQueryCrop,
  printedLines,
  readCropNote,
  withCropNote,
  type CropBox
} from '@core/queries'

/**
 * The crop beside a query, planned in printed lines (`crop-plan.ts`), and the
 * passage's place carried inside it (`crop-note.ts`).
 *
 * A made-up leaf at 300 DPI: 14 lines of 8 words, each word 40 pixels tall,
 * the lines 54 pixels apart, set from x = 200 to about x = 1900. Nothing here
 * is a real page.
 */
interface Word {
  id: string
  bbox: CropBox
}

const LINE = 54
const TOP = 300
function leaf(lines = 14): Word[] {
  const words: Word[] = []
  for (let l = 0; l < lines; l++) {
    for (let w = 0; w < 8; w++) {
      const x0 = 200 + w * 215
      const y0 = TOP + l * LINE + (w % 3) // a little ragged, as OCR boxes are
      words.push({ id: `${l}.${w}`, bbox: { x0, y0, x1: x0 + 180, y1: y0 + 40 } })
    }
  }
  return words
}
const page = { width: 2100, height: 3200 }
const on = (words: Word[], ...ids: string[]): Word[] =>
  ids.map((id) => words.find((w) => w.id === id)!)

/** The lines a crop holds: those whose every word lies inside it, top and bottom. */
const linesInside = (words: Word[], crop: CropBox): number[] =>
  [...new Set(words.map((w) => Number(w.id.split('.')[0])))].filter((l) =>
    words
      .filter((w) => w.id.startsWith(`${l}.`))
      .every((w) => w.bbox.y0 >= crop.y0 && w.bbox.y1 <= crop.y1)
  )

describe('a query’s crop', () => {
  it('holds the passage’s line and three whole lines above and below', () => {
    const words = leaf()
    const plan = planQueryCrop(words, on(words, '6.3', '6.4'), page)!
    expect(CROP_LINES_AROUND).toBe(3)
    expect(plan.lines).toBe(7)
    expect(linesInside(words, plan.crop)).toEqual([3, 4, 5, 6, 7, 8, 9])
  })

  it('slices no line at either edge', () => {
    const words = leaf()
    const plan = planQueryCrop(words, on(words, '6.3'), page)!
    // No word of the lines just outside reaches into the crop.
    for (const w of words.filter((w) => /^(2|10)\./.test(w.id))) {
      expect(w.bbox.y1 <= plan.crop.y0 || w.bbox.y0 >= plan.crop.y1).toBe(true)
    }
  })

  it('is as wide as the lines are set, with paper beside them', () => {
    const words = leaf()
    const plan = planQueryCrop(words, on(words, '6.0'), page)!
    expect(plan.crop.x0).toBeLessThan(200)
    expect(plan.crop.x1).toBeGreaterThan(200 + 7 * 215 + 180)
  })

  it('names the passage in the crop’s own pixels, one box per line it is on', () => {
    const words = leaf()
    const plan = planQueryCrop(words, on(words, '6.6', '6.7', '7.0'), page)!
    expect(plan.passage).toHaveLength(2)
    const [first, second] = plan.passage
    expect(first!.x0).toBe(200 + 6 * 215 - plan.crop.x0)
    expect(first!.y0).toBe(TOP + 6 * LINE - plan.crop.y0)
    expect(second!.x1).toBe(200 + 180 - plan.crop.x0)
    expect(linesInside(words, plan.crop)).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('stops at the top of the leaf rather than inventing lines', () => {
    const words = leaf()
    const plan = planQueryCrop(words, on(words, '1.2'), page)!
    expect(linesInside(words, plan.crop)).toEqual([0, 1, 2, 3, 4])
    expect(plan.crop.y0).toBeGreaterThanOrEqual(0)
  })

  it('takes as many lines around as it is asked for', () => {
    const words = leaf()
    expect(planQueryCrop(words, on(words, '6.3'), page, { around: 1 })!.lines).toBe(3)
    expect(planQueryCrop(words, on(words, '6.3'), page, { around: 8 })!.lines).toBe(14)
  })

  it('plans nothing for a passage that was not found', () => {
    expect(planQueryCrop(leaf(), [], page)).toBeNull()
  })

  it('keeps a raised reference mark on its line', () => {
    const words = leaf()
    const mark = {
      id: '6.9',
      bbox: { x0: 1950, y0: TOP + 6 * LINE - 8, x1: 1966, y1: TOP + 6 * LINE + 14 }
    }
    const lines = printedLines([...words, mark])
    expect(lines).toHaveLength(14)
    expect(lines[6]).toContain(mark)
  })
})

describe('the passage’s place, inside the crop', () => {
  // The smallest JPEG shape the reader cares about: start, one segment, end.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 1, 2, 0xff, 0xd9])
  const note = { dpi: 300, passage: [{ x0: 10, y0: 160, x1: 400, y1: 200 }] }

  it('comes back as it went in', () => {
    const marked = withCropNote(jpeg, note)
    expect(readCropNote(marked)).toEqual(note)
    // Still a JPEG, with the original segments after the note.
    expect([...marked.subarray(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xfe])
    expect([...marked.subarray(-6)]).toEqual([0xff, 0xdb, 0x00, 0x04, 1, 2, 0xff, 0xd9].slice(2))
  })

  it('is absent from a crop cut before there were notes', () => {
    expect(readCropNote(jpeg)).toBeNull()
  })

  it('is never read off another program’s comment', () => {
    const comment = [...'made by a camera'].map((c) => c.charCodeAt(0))
    const other = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xfe,
      0,
      comment.length + 2,
      ...comment,
      ...jpeg.subarray(2)
    ])
    expect(readCropNote(other)).toBeNull()
    expect(readCropNote(withCropNote(other, note))).toEqual(note)
  })

  it('leaves bytes that are not a JPEG alone', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    expect(withCropNote(png, note)).toBe(png)
    expect(readCropNote(png)).toBeNull()
  })
})
