import { describe, it, expect } from 'vitest'
import { inflateSync } from 'node:zlib'
import { parsePpm, encodePng } from '@tooling/image/raster-io'

/** Build a binary P6 PPM (RGB, maxval 255) from width/height + RGB triples. */
function p6(width: number, height: number, rgb: number[]): Buffer {
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, 'ascii')
  return Buffer.concat([header, Buffer.from(rgb)])
}

describe('parsePpm', () => {
  it('parses a P6 (RGB) image into RGBA with opaque alpha', () => {
    // 2×1: red, green.
    const img = parsePpm(p6(2, 1, [255, 0, 0, 0, 255, 0]))
    expect(img.width).toBe(2)
    expect(img.height).toBe(1)
    expect(Array.from(img.data)).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
  })

  it('parses a P5 (grayscale) image, expanding to RGBA', () => {
    const buf = Buffer.concat([Buffer.from('P5\n2 1\n255\n', 'ascii'), Buffer.from([10, 200])])
    const img = parsePpm(buf)
    expect(Array.from(img.data)).toEqual([10, 10, 10, 255, 200, 200, 200, 255])
  })

  it('skips comment lines in the header', () => {
    const buf = Buffer.concat([
      Buffer.from('P6\n# a comment\n1 1\n255\n', 'ascii'),
      Buffer.from([1, 2, 3])
    ])
    const img = parsePpm(buf)
    expect(Array.from(img.data)).toEqual([1, 2, 3, 255])
  })

  it('rejects an unsupported magic', () => {
    expect(() => parsePpm(Buffer.from('P3\n1 1\n255\n1 2 3', 'ascii'))).toThrow()
  })
})

describe('encodePng', () => {
  it('emits a valid PNG signature and IHDR dimensions', () => {
    const png = encodePng({ width: 3, height: 2, data: new Uint8ClampedArray(3 * 2 * 4) })
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    // First chunk is IHDR (length 13, type at bytes 12..16).
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR')
    expect(png.readUInt32BE(16)).toBe(3) // width
    expect(png.readUInt32BE(20)).toBe(2) // height
    expect(png[24]).toBe(8) // bit depth
    expect(png[25]).toBe(6) // color type RGBA
  })

  it('round-trips pixels through the IDAT (filter 0)', () => {
    const data = new Uint8ClampedArray([9, 8, 7, 255, 1, 2, 3, 255]) // 2×1
    const png = encodePng({ width: 2, height: 1, data })
    // Find the IDAT chunk and inflate it: one filter byte + the RGBA row.
    const idatStart = png.indexOf(Buffer.from('IDAT', 'ascii'))
    const len = png.readUInt32BE(idatStart - 4)
    const idat = png.subarray(idatStart + 4, idatStart + 4 + len)
    const raw = inflateSync(idat)
    expect(raw[0]).toBe(0) // filter: none
    expect(Array.from(raw.subarray(1))).toEqual([9, 8, 7, 255, 1, 2, 3, 255])
  })
})
