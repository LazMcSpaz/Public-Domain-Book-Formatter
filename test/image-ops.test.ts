import { describe, it, expect } from 'vitest'
import {
  applyOps,
  brightness,
  contrast,
  crop,
  despeckle,
  grayscale,
  levels,
  rotate,
  sizeAfterOps,
  straighten,
  threshold,
  type RasterImage
} from '@core/image'
import type { ImageEditOp } from '@core/model'

/** A test image with a recognisable gradient, so a wrong op is visible. */
function image(width: number, height: number): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const v = Math.round((x / Math.max(1, width - 1)) * 255)
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

const lum = (img: RasterImage, x: number, y: number): number => img.data[(y * img.width + x) * 4]!

describe('sizeAfterOps — the size the DPI check divides by', () => {
  /**
   * The property this whole function exists for. `sizeAfterOps` is duplicated
   * logic — the core has to know how big a retouched picture is without holding
   * its pixels — so it is checked against the thing it duplicates rather than
   * trusted to have stayed in step with it.
   */
  const agrees = (w: number, h: number, ops: ImageEditOp[]): void => {
    const actual = applyOps(image(w, h), ops)
    expect(sizeAfterOps(w, h, ops)).toEqual({ width: actual.width, height: actual.height })
  }

  it('agrees with applyOps for a crop', () => {
    agrees(40, 30, [crop({ x: 5, y: 4, width: 20, height: 10 })])
  })

  it('agrees when a crop runs past the edge, which is trimmed not refused', () => {
    agrees(40, 30, [crop({ x: 30, y: 25, width: 999, height: 999 })])
    agrees(40, 30, [crop({ x: 999, y: 999, width: 10, height: 10 })])
  })

  it('agrees for quarter turns, which swap the axes', () => {
    for (const degrees of [90, 180, 270, 360, -90]) {
      agrees(40, 30, [rotate(degrees)])
    }
  })

  it('agrees for a straighten, which spins inside the same canvas', () => {
    agrees(40, 30, [straighten(2.5)])
    agrees(40, 30, [straighten(-1.25)])
  })

  it('agrees for every op that does not change the size at all', () => {
    agrees(40, 30, [brightness(20)])
    agrees(40, 30, [contrast(-15)])
    agrees(40, 30, [levels({ black: 20, white: 230, gamma: 1.2 })])
    agrees(40, 30, [grayscale()])
    agrees(40, 30, [threshold(128)])
    agrees(40, 30, [despeckle(1)])
  })

  it('agrees for a stack, which is how they are actually used', () => {
    agrees(40, 30, [
      straighten(1.5),
      crop({ x: 4, y: 3, width: 24, height: 20 }),
      rotate(90),
      levels({ black: 10, white: 245, gamma: 1 }),
      grayscale()
    ])
  })

  it('leaves an empty stack alone', () => {
    expect(sizeAfterOps(40, 30, [])).toEqual({ width: 40, height: 30 })
  })
})

describe('applyOps — non-destructive over the original', () => {
  it('never touches the image it was given', () => {
    // The whole premise of an op *stack*: edits are re-derived from the
    // original every time, so they can be undone and reordered.
    const original = image(12, 8)
    const before = Uint8ClampedArray.from(original.data)
    applyOps(original, [crop({ x: 2, y: 2, width: 4, height: 4 }), grayscale()])
    expect(original.data).toEqual(before)
    expect(original.width).toBe(12)
  })

  it('gives the same answer every time it is run', () => {
    const ops = [straighten(2), levels({ black: 10, white: 240, gamma: 1.1 })]
    expect(applyOps(image(16, 12), ops).data).toEqual(applyOps(image(16, 12), ops).data)
  })

  it('applies in order — a crop after a rotate is not a crop before one', () => {
    const box = crop({ x: 0, y: 0, width: 10, height: 4 })
    const first = applyOps(image(20, 10), [box, rotate(90)])
    const second = applyOps(image(20, 10), [rotate(90), box])
    expect([first.width, first.height]).toEqual([4, 10])
    expect([second.width, second.height]).toEqual([10, 4])
  })
})

describe('applyOps — what the tone tools do to a scan', () => {
  it('brightness lifts the whole range', () => {
    const before = image(16, 4)
    const after = applyOps(before, [brightness(20)])
    expect(lum(after, 8, 2)).toBeGreaterThan(lum(before, 8, 2))
  })

  it('levels rescue a flat scan by pulling its ends apart', () => {
    // The one that matters for foxed paper: a picture whose ink is grey and
    // whose paper is beige has no contrast until the points are moved in.
    const before = image(32, 4)
    const after = applyOps(before, [levels({ black: 80, white: 180, gamma: 1 })])
    expect(lum(after, 2, 2)).toBe(0)
    expect(lum(after, 29, 2)).toBe(255)
  })

  it('threshold leaves only black and white, as line art wants', () => {
    const after = applyOps(image(32, 4), [threshold(128)])
    for (let x = 0; x < after.width; x++) {
      expect([0, 255]).toContain(lum(after, x, 2))
    }
  })

  it('grayscale keeps the picture but drops the colour', () => {
    const colour: RasterImage = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([220, 20, 20, 255, 20, 220, 20, 255])
    }
    const after = applyOps(colour, [grayscale()])
    expect(after.data[0]).toBe(after.data[1])
    expect(after.data[1]).toBe(after.data[2])
    // The two pixels still differ — it is a conversion, not a flattening.
    expect(after.data[0]).not.toBe(after.data[4])
  })
})
