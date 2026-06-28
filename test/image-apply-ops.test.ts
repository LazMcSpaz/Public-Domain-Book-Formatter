import { describe, it, expect } from 'vitest'
import {
  applyOps,
  crop,
  rotate,
  straighten,
  brightness,
  contrast,
  levels,
  curves,
  grayscale,
  threshold,
  despeckle,
  removeBackground
} from '../src/renderer/components/ImageMode/engine'
import type { RasterImage } from '../src/renderer/components/ImageMode/engine'

/**
 * Make a w×h RGBA image; `fill(x,y)` returns [r,g,b,a].
 *
 * Each op is exercised via `applyOps([op])`: the pixel implementations are
 * internal to the engine (the only public entry point is `applyOps`), and the
 * `crop/rotate/...` symbols imported here are the op *constructors* from ops.ts.
 */
function make(
  w: number,
  h: number,
  fill: (x: number, y: number) => [number, number, number, number]
): RasterImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const [r, g, b, a] = fill(x, y)
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
  }
  return { width: w, height: h, data }
}

function px(img: RasterImage, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!]
}

describe('grayscale', () => {
  it('equalizes channels to the luma', () => {
    const img = make(2, 2, () => [255, 0, 0, 255])
    const out = applyOps(img, [grayscale()])
    const [r, g, b] = px(out, 0, 0)
    expect(r).toBe(g)
    expect(g).toBe(b)
    expect(r).toBe(Math.round(0.299 * 255))
  })
})

describe('threshold', () => {
  it('binarizes by luma', () => {
    const img = make(2, 1, (x) => (x === 0 ? [10, 10, 10, 255] : [240, 240, 240, 255]))
    const out = applyOps(img, [threshold(128)])
    expect(px(out, 0, 0)).toEqual([0, 0, 0, 255])
    expect(px(out, 1, 0)).toEqual([255, 255, 255, 255])
  })
})

describe('brightness', () => {
  it('shifts values up and down', () => {
    const img = make(1, 1, () => [100, 100, 100, 255])
    expect(px(applyOps(img, [brightness(50)]), 0, 0)[0]).toBeGreaterThan(100)
    expect(px(applyOps(img, [brightness(-50)]), 0, 0)[0]).toBeLessThan(100)
  })
})

describe('contrast', () => {
  it('pushes values away from mid-gray', () => {
    const img = make(2, 1, (x) => (x === 0 ? [60, 60, 60, 255] : [200, 200, 200, 255]))
    const out = applyOps(img, [contrast(60)])
    expect(px(out, 0, 0)[0]).toBeLessThan(60)
    expect(px(out, 1, 0)[0]).toBeGreaterThan(200)
  })
})

describe('crop', () => {
  it('changes dimensions and keeps the cropped pixels', () => {
    const img = make(4, 4, (x, y) => [x * 10, y * 10, 0, 255])
    const out = applyOps(img, [crop({ x: 1, y: 1, width: 2, height: 2 })])
    expect(out.width).toBe(2)
    expect(out.height).toBe(2)
    expect(px(out, 0, 0)).toEqual([10, 10, 0, 255])
  })
})

describe('rotate', () => {
  it('90° swaps dimensions', () => {
    const img = make(4, 2, (x, y) => [x, y, 0, 255])
    const out = applyOps(img, [rotate(90)])
    expect(out.width).toBe(2)
    expect(out.height).toBe(4)
  })

  it('90° clockwise moves top-left pixel to top-right', () => {
    const img = make(2, 2, (x, y) => (x === 0 && y === 0 ? [255, 0, 0, 255] : [0, 0, 0, 255]))
    const out = applyOps(img, [rotate(90)])
    expect(px(out, out.width - 1, 0)).toEqual([255, 0, 0, 255])
  })

  it('180° keeps dimensions and flips corners', () => {
    const img = make(3, 2, (x, y) => (x === 0 && y === 0 ? [9, 8, 7, 255] : [0, 0, 0, 255]))
    const out = applyOps(img, [rotate(180)])
    expect(out.width).toBe(3)
    expect(out.height).toBe(2)
    expect(px(out, 2, 1)).toEqual([9, 8, 7, 255])
  })

  it('arbitrary angle keeps canvas size', () => {
    const img = make(5, 5, () => [120, 120, 120, 255])
    const out = applyOps(img, [rotate(30)])
    expect(out.width).toBe(5)
    expect(out.height).toBe(5)
  })
})

describe('straighten', () => {
  it('is a small-angle rotate (canvas preserved)', () => {
    const img = make(5, 5, () => [50, 50, 50, 255])
    const out = applyOps(img, [straighten(2)])
    expect(out.width).toBe(5)
    expect(out.height).toBe(5)
  })
})

describe('levels', () => {
  it('maps the black point to 0 and white point to 255', () => {
    const img = make(3, 1, (x) => {
      const v = [50, 128, 200][x]!
      return [v, v, v, 255]
    })
    const out = applyOps(img, [levels({ black: 50, white: 200, gamma: 1 })])
    expect(px(out, 0, 0)[0]).toBe(0)
    expect(px(out, 2, 0)[0]).toBe(255)
    expect(px(out, 1, 0)[0]).toBeGreaterThan(0)
    expect(px(out, 1, 0)[0]).toBeLessThan(255)
  })
})

describe('curves', () => {
  it('maps via the control-point LUT (identity)', () => {
    const img = make(1, 1, () => [100, 150, 200, 255])
    const out = applyOps(img, [
      curves([
        [0, 0],
        [255, 255]
      ])
    ])
    expect(px(out, 0, 0)).toEqual([100, 150, 200, 255])
  })

  it('inverts when points invert', () => {
    const img = make(1, 1, () => [0, 0, 0, 255])
    const out = applyOps(img, [
      curves([
        [0, 255],
        [255, 0]
      ])
    ])
    expect(px(out, 0, 0)[0]).toBe(255)
  })
})

describe('despeckle', () => {
  it('removes a lone dark speck on a light field', () => {
    const img = make(5, 5, (x, y) => (x === 2 && y === 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]))
    const out = applyOps(img, [despeckle(1)])
    const [r, g, b] = px(out, 2, 2)
    expect(r).toBeGreaterThan(200)
    expect(g).toBeGreaterThan(200)
    expect(b).toBeGreaterThan(200)
  })

  it('leaves a uniform field untouched', () => {
    const img = make(4, 4, () => [128, 128, 128, 255])
    const out = applyOps(img, [despeckle(1)])
    expect(Array.from(out.data)).toEqual(Array.from(img.data))
  })
})

describe('removeBackground', () => {
  it('clears a uniform background to transparent but keeps interior content', () => {
    const img = make(6, 6, (x, y) => {
      const inside = x >= 2 && x <= 3 && y >= 2 && y <= 3
      return inside ? [0, 0, 0, 255] : [255, 255, 255, 255]
    })
    const out = applyOps(img, [removeBackground(10)])
    expect(px(out, 0, 0)[3]).toBe(0)
    expect(px(out, 5, 5)[3]).toBe(0)
    expect(px(out, 2, 2)[3]).toBe(255)
  })
})

describe('applyOps', () => {
  it('never mutates the source array', () => {
    const img = make(4, 4, () => [100, 100, 100, 255])
    const before = Array.from(img.data)
    applyOps(img, [grayscale(), brightness(20), threshold(100)])
    expect(Array.from(img.data)).toEqual(before)
  })

  it('composes ops in order', () => {
    const img = make(2, 2, () => [255, 0, 0, 255])
    const out = applyOps(img, [grayscale(), threshold(100)])
    expect(px(out, 0, 0)).toEqual([0, 0, 0, 255])
  })

  it('returns a copy for an empty op list', () => {
    const img = make(2, 2, () => [1, 2, 3, 4])
    const out = applyOps(img, [])
    expect(out).not.toBe(img)
    expect(Array.from(out.data)).toEqual(Array.from(img.data))
  })

  it('chains crop then rotate', () => {
    const img = make(4, 4, (x, y) => [x, y, 0, 255])
    const out = applyOps(img, [crop({ x: 0, y: 0, width: 4, height: 2 }), rotate(90)])
    expect(out.width).toBe(2)
    expect(out.height).toBe(4)
  })

  it('exercises levels, curves, contrast, straighten, removeBackground in a chain', () => {
    const img = make(4, 4, () => [120, 120, 120, 255])
    const out = applyOps(img, [
      levels({ black: 0, white: 255, gamma: 1 }),
      curves([
        [0, 0],
        [255, 255]
      ]),
      contrast(10),
      straighten(1),
      removeBackground(5)
    ])
    expect(out.width).toBe(4)
    expect(out.height).toBe(4)
  })
})
