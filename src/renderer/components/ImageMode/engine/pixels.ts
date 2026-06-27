/**
 * Shared low-level pixel helpers for the image engine (SPEC §6).
 *
 * Everything here operates on the plain `RasterImage` byte array (RGBA) so it is
 * Node-testable — no DOM, no canvas. Helpers never mutate their input; they
 * return new buffers (callers compose op-by-op over fresh images).
 */
import type { RasterImage } from './types'

/** Allocate a blank (transparent-black) RasterImage of the given size. */
export function blank(width: number, height: number): RasterImage {
  return {
    width: Math.max(0, Math.floor(width)),
    height: Math.max(0, Math.floor(height)),
    data: new Uint8ClampedArray(Math.max(0, Math.floor(width)) * Math.max(0, Math.floor(height)) * 4),
  }
}

/** Deep copy. */
export function clone(img: RasterImage): RasterImage {
  return {
    width: img.width,
    height: img.height,
    data: new Uint8ClampedArray(img.data),
  }
}

/** Byte index of pixel (x,y) in an RGBA buffer of the given width. */
export function idx(x: number, y: number, width: number): number {
  return (y * width + x) * 4
}

/** ITU-R BT.601 luma from r,g,b. */
export function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * Apply a per-channel lookup table to R,G,B (alpha untouched). The LUT must have
 * 256 entries. Returns a new image.
 */
export function applyLut(img: RasterImage, lut: Uint8ClampedArray): RasterImage {
  const out = clone(img)
  const d = out.data
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]!]!
    d[i + 1] = lut[d[i + 1]!]!
    d[i + 2] = lut[d[i + 2]!]!
  }
  return out
}

/** Nearest-neighbor sample; returns transparent black for out-of-bounds. */
export function sampleNearest(
  img: RasterImage,
  x: number,
  y: number,
  out: [number, number, number, number],
): void {
  const xi = Math.round(x)
  const yi = Math.round(y)
  if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) {
    out[0] = 0
    out[1] = 0
    out[2] = 0
    out[3] = 0
    return
  }
  const i = idx(xi, yi, img.width)
  out[0] = img.data[i]!
  out[1] = img.data[i + 1]!
  out[2] = img.data[i + 2]!
  out[3] = img.data[i + 3]!
}
