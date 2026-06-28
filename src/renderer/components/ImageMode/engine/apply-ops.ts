/**
 * applyOps — re-derive an edited image from the original by applying an ordered
 * op list (SPEC §6 non-destructive editing).
 *
 * Every op is a small pure function `RasterImage -> RasterImage`; `applyOps`
 * threads the image through them in order, always starting from a *copy* of the
 * source so the original buffer is never mutated. All math operates on the byte
 * array (no DOM/canvas) so the engine is unit-testable in Node.
 *
 * Implemented kinds: crop, rotate, straighten, brightness, contrast, levels,
 * curves, grayscale, threshold, despeckle, removeBackground.
 */
import type { ImageEditOp } from '@core/model'
import type { RasterImage } from './types'
import { applyLut, blank, clone, idx, luma, sampleNearest } from './pixels'

function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

// --- geometry -------------------------------------------------------------

/** Crop to [x, x+width) × [y, y+height), clamped to the image bounds. */
function crop(img: RasterImage, params: Record<string, unknown>): RasterImage {
  const x = Math.max(0, Math.min(img.width, Math.round(num(params, 'x', 0))))
  const y = Math.max(0, Math.min(img.height, Math.round(num(params, 'y', 0))))
  const w = Math.max(0, Math.min(img.width - x, Math.round(num(params, 'width', img.width))))
  const h = Math.max(0, Math.min(img.height - y, Math.round(num(params, 'height', img.height))))
  const out = blank(w, h)
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const si = idx(x + col, y + row, img.width)
      const di = idx(col, row, w)
      out.data[di] = img.data[si]!
      out.data[di + 1] = img.data[si + 1]!
      out.data[di + 2] = img.data[si + 2]!
      out.data[di + 3] = img.data[si + 3]!
    }
  }
  return out
}

/** Exact quarter-turn rotation (degrees normalized to 0/90/180/270, clockwise). */
function rotateQuarter(img: RasterImage, turns: number): RasterImage {
  const t = ((turns % 4) + 4) % 4
  if (t === 0) return clone(img)
  const { width: w, height: h } = img
  const swapped = t === 1 || t === 3
  const ow = swapped ? h : w
  const oh = swapped ? w : h
  const out = blank(ow, oh)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ox: number
      let oy: number
      if (t === 1) {
        // 90° clockwise
        ox = h - 1 - y
        oy = x
      } else if (t === 2) {
        ox = w - 1 - x
        oy = h - 1 - y
      } else {
        // 270° clockwise
        ox = y
        oy = w - 1 - x
      }
      const si = idx(x, y, w)
      const di = idx(ox, oy, ow)
      out.data[di] = img.data[si]!
      out.data[di + 1] = img.data[si + 1]!
      out.data[di + 2] = img.data[si + 2]!
      out.data[di + 3] = img.data[si + 3]!
    }
  }
  return out
}

/**
 * Rotate by an arbitrary angle (degrees, clockwise) about the image center,
 * keeping the same canvas size, using nearest-neighbor sampling. Exact multiples
 * of 90° are routed to the lossless quarter-turn path.
 */
function rotate(img: RasterImage, params: Record<string, unknown>): RasterImage {
  const degrees = num(params, 'degrees', 0)
  const norm = ((degrees % 360) + 360) % 360
  if (norm % 90 === 0) return rotateQuarter(img, norm / 90)

  const rad = (norm * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const { width: w, height: h } = img
  const cx = (w - 1) / 2
  const cy = (h - 1) / 2
  const out = blank(w, h)
  const px: [number, number, number, number] = [0, 0, 0, 0]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Inverse-map the output pixel back into the source (rotate by -angle).
      const dx = x - cx
      const dy = y - cy
      const sx = cos * dx + sin * dy + cx
      const sy = -sin * dx + cos * dy + cy
      sampleNearest(img, sx, sy, px)
      const di = idx(x, y, w)
      out.data[di] = px[0]
      out.data[di + 1] = px[1]
      out.data[di + 2] = px[2]
      out.data[di + 3] = px[3]
    }
  }
  return out
}

/** Straighten: a small-angle rotation to de-skew a crooked scan. */
function straighten(img: RasterImage, params: Record<string, unknown>): RasterImage {
  return rotate(img, { degrees: num(params, 'degrees', 0) })
}

// --- tone -----------------------------------------------------------------

/** Brightness delta -100..100, mapped to ±255 of additive offset. */
function brightness(img: RasterImage, params: Record<string, unknown>): RasterImage {
  const amount = num(params, 'amount', 0)
  const offset = (amount / 100) * 255
  const lut = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) lut[i] = i + offset
  return applyLut(img, lut)
}

/** Contrast delta -100..100 about mid-gray (128). */
function contrast(img: RasterImage, params: Record<string, unknown>): RasterImage {
  const amount = num(params, 'amount', 0)
  // Standard contrast factor; amount=100 → strong stretch, -100 → flat.
  const a = Math.max(-100, Math.min(100, amount))
  const factor = (259 * (a + 255)) / (255 * (259 - a))
  const lut = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) lut[i] = factor * (i - 128) + 128
  return applyLut(img, lut)
}

/** Levels: remap [black,white] input with gamma, to full [0,255] output. */
function levels(img: RasterImage, params: Record<string, unknown>): RasterImage {
  const black = Math.max(0, Math.min(255, num(params, 'black', 0)))
  const white = Math.max(0, Math.min(255, num(params, 'white', 255)))
  const gamma = Math.max(0.01, num(params, 'gamma', 1))
  const span = white - black || 1
  const lut = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) {
    const normalized = Math.max(0, Math.min(1, (i - black) / span))
    lut[i] = Math.pow(normalized, 1 / gamma) * 255
  }
  return applyLut(img, lut)
}

/**
 * Curves: build a LUT from control points `[input,output]` (0..255), sorted by
 * input, with linear interpolation between points and flat extrapolation at the
 * ends. `params.points` is a JSON-stringified array of pairs.
 */
function curves(img: RasterImage, params: Record<string, unknown>): RasterImage {
  let points: [number, number][] = []
  const raw = params['points']
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        points = parsed
          .filter(
            (p): p is [number, number] =>
              Array.isArray(p) &&
              p.length >= 2 &&
              typeof p[0] === 'number' &&
              typeof p[1] === 'number'
          )
          .map((p) => [p[0], p[1]])
      }
    } catch {
      points = []
    }
  }
  if (points.length === 0)
    points = [
      [0, 0],
      [255, 255]
    ]
  points.sort((a, b) => a[0] - b[0])

  const lut = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) {
    if (i <= points[0]![0]) {
      lut[i] = points[0]![1]
      continue
    }
    if (i >= points[points.length - 1]![0]) {
      lut[i] = points[points.length - 1]![1]
      continue
    }
    let j = 0
    while (j < points.length - 1 && points[j + 1]![0] < i) j++
    const [x0, y0] = points[j]!
    const [x1, y1] = points[j + 1]!
    const span = x1 - x0 || 1
    lut[i] = y0 + ((y1 - y0) * (i - x0)) / span
  }
  return applyLut(img, lut)
}

/** Grayscale: set R=G=B to the luma; alpha untouched. */
function grayscale(img: RasterImage): RasterImage {
  const out = clone(img)
  const d = out.data
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(luma(d[i]!, d[i + 1]!, d[i + 2]!))
    d[i] = g
    d[i + 1] = g
    d[i + 2] = g
  }
  return out
}

/** Threshold: binarize each pixel by luma against `level` (0..255). */
function threshold(img: RasterImage, params: Record<string, unknown>): RasterImage {
  const level = num(params, 'level', 128)
  const out = clone(img)
  const d = out.data
  for (let i = 0; i < d.length; i += 4) {
    const v = luma(d[i]!, d[i + 1]!, d[i + 2]!) >= level ? 255 : 0
    d[i] = v
    d[i + 1] = v
    d[i + 2] = v
  }
  return out
}

/**
 * Despeckle: remove isolated specks. For each pixel, look at the neighbors
 * within `radius`; if the pixel's luma differs sharply from the median of its
 * neighborhood, replace it with the neighborhood median (a median filter that
 * leaves uniform areas untouched and erases lone specks). RGB only.
 */
function despeckle(img: RasterImage, params: Record<string, unknown>): RasterImage {
  const radius = Math.max(1, Math.round(num(params, 'radius', 1)))
  const { width: w, height: h } = img
  const out = clone(img)
  const lumaAt = (x: number, y: number): number => {
    const i = idx(x, y, w)
    return luma(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!)
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const neighbors: number[] = []
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          neighbors.push(lumaAt(nx, ny))
        }
      }
      if (neighbors.length === 0) continue
      neighbors.sort((a, b) => a - b)
      const med = neighbors[Math.floor(neighbors.length / 2)]!
      const self = lumaAt(x, y)
      // Speck: the pixel disagrees with essentially all neighbors.
      const agreeing = neighbors.filter((n) => Math.abs(n - self) <= 32).length
      if (agreeing <= neighbors.length * 0.2 && Math.abs(self - med) > 64) {
        // Pull this pixel toward the neighborhood median (grayscale replacement).
        const di = idx(x, y, w)
        out.data[di] = med
        out.data[di + 1] = med
        out.data[di + 2] = med
      }
    }
  }
  return out
}

/**
 * removeBackground (best-effort, SPEC §6): flood-fill from each of the four
 * corners, clearing connected pixels whose color is within `tolerance` of that
 * corner's sampled color (alpha → 0). Reliable on clean, uniform backgrounds
 * (e.g. black line art on cream paper); unreliable on busy or unevenly-lit
 * scans — the UI always offers manual touch-up. 4-connected flood fill.
 */
function removeBackground(img: RasterImage, params: Record<string, unknown>): RasterImage {
  const tolerance = Math.max(0, num(params, 'tolerance', 16))
  const { width: w, height: h } = img
  const out = clone(img)
  if (w === 0 || h === 0) return out
  const visited = new Uint8Array(w * h)

  const within = (i: number, r: number, g: number, b: number): boolean => {
    return (
      Math.abs(img.data[i]! - r) <= tolerance &&
      Math.abs(img.data[i + 1]! - g) <= tolerance &&
      Math.abs(img.data[i + 2]! - b) <= tolerance
    )
  }

  const corners: [number, number][] = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1]
  ]

  for (const [cxRaw, cyRaw] of corners) {
    const cx = cxRaw
    const cy = cyRaw
    const ci = idx(cx, cy, w)
    const r = img.data[ci]!
    const g = img.data[ci + 1]!
    const b = img.data[ci + 2]!
    const stack: number[] = [cy * w + cx]
    while (stack.length > 0) {
      const p = stack.pop()!
      if (visited[p]) continue
      visited[p] = 1
      const px = p % w
      const py = (p - px) / w
      const pi = p * 4
      if (!within(pi, r, g, b)) continue
      out.data[pi + 3] = 0 // clear to transparent
      if (px > 0) stack.push(p - 1)
      if (px < w - 1) stack.push(p + 1)
      if (py > 0) stack.push(p - w)
      if (py < h - 1) stack.push(p + w)
    }
  }
  return out
}

// --- dispatch -------------------------------------------------------------

function applyOne(img: RasterImage, op: ImageEditOp): RasterImage {
  switch (op.op) {
    case 'crop':
      return crop(img, op.params)
    case 'rotate':
      return rotate(img, op.params)
    case 'straighten':
      return straighten(img, op.params)
    case 'brightness':
      return brightness(img, op.params)
    case 'contrast':
      return contrast(img, op.params)
    case 'levels':
      return levels(img, op.params)
    case 'curves':
      return curves(img, op.params)
    case 'grayscale':
      return grayscale(img)
    case 'threshold':
      return threshold(img, op.params)
    case 'despeckle':
      return despeckle(img, op.params)
    case 'removeBackground':
      return removeBackground(img, op.params)
    default: {
      // Exhaustiveness guard: unknown ops pass through untouched.
      const _exhaustive: never = op.op
      void _exhaustive
      return clone(img)
    }
  }
}

export function applyOps(source: RasterImage, ops: readonly ImageEditOp[]): RasterImage {
  // Always start from a fresh copy so `source` is never mutated.
  let img = clone(source)
  for (const op of ops) {
    img = applyOne(img, op)
  }
  return img
}
