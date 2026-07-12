/**
 * Minimal raster I/O for the export process (SPEC §6).
 *
 * The image op engine (`@core/image`) works on plain RGBA `RasterImage` buffers,
 * so to apply a book's saved edits at export time we need to get pixels in and
 * out without a canvas. We crop each region with pdftoppm as **PPM** (its native
 * uncompressed format — trivial to parse, no PNG-decode/filters needed), run the
 * op stack, then encode the result as a **PNG** (which XeLaTeX's graphicx reads
 * reliably). Only Node's built-in `zlib` is used — no external deps.
 */
import { deflateSync } from 'node:zlib'
import type { RasterImage } from '@core/image'

/**
 * Parse a binary PPM (`P6`, RGB) or PGM (`P5`, grayscale) buffer into RGBA. This
 * is exactly what `pdftoppm` writes by default (P6) or with `-gray` (P5), at
 * maxval 255. Throws on an unsupported header.
 */
export function parsePpm(buf: Buffer): RasterImage {
  if (buf.length < 2 || buf[0] !== 0x50 /* 'P' */) {
    throw new Error('Not a PPM/PGM: bad magic')
  }
  const magic = buf[1]
  const channels = magic === 0x36 ? 3 : magic === 0x35 ? 1 : 0 // '6' | '5'
  if (channels === 0) throw new Error(`Unsupported PNM type P${String.fromCharCode(magic ?? 0)}`)

  // Read three header integers (width, height, maxval), skipping whitespace and
  // '#' comment lines. Data begins right after a single whitespace past maxval.
  let pos = 2
  const nums: number[] = []
  while (nums.length < 3) {
    // skip whitespace
    while (pos < buf.length && isWs(buf[pos]!)) pos++
    // skip a comment line
    if (buf[pos] === 0x23 /* '#' */) {
      while (pos < buf.length && buf[pos] !== 0x0a) pos++
      continue
    }
    let n = 0
    let sawDigit = false
    while (pos < buf.length && buf[pos]! >= 0x30 && buf[pos]! <= 0x39) {
      n = n * 10 + (buf[pos]! - 0x30)
      pos++
      sawDigit = true
    }
    if (!sawDigit) throw new Error('Malformed PPM header')
    nums.push(n)
  }
  const [width, height, maxval] = nums as [number, number, number]
  if (maxval !== 255) throw new Error(`Unsupported PPM maxval ${maxval}`)
  pos++ // consume the single whitespace separating header from binary data

  const expected = width * height * channels
  if (buf.length - pos < expected) throw new Error('PPM data truncated')

  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const di = i * 4
    if (channels === 3) {
      const si = pos + i * 3
      data[di] = buf[si]!
      data[di + 1] = buf[si + 1]!
      data[di + 2] = buf[si + 2]!
    } else {
      const v = buf[pos + i]!
      data[di] = v
      data[di + 1] = v
      data[di + 2] = v
    }
    data[di + 3] = 255
  }
  return { width, height, data }
}

function isWs(b: number): boolean {
  return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d
}

// --- PNG encoding (8-bit RGBA, no interlace, filter 0) ---------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

/** Encode an RGBA `RasterImage` as a PNG buffer. */
export function encodePng(img: RasterImage): Buffer {
  const { width, height, data } = img
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  // Raw = per scanline: filter byte 0 + RGBA row bytes.
  const stride = width * 4
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1)
    raw[o] = 0 // filter: none
    for (let x = 0; x < stride; x++) raw[o + 1 + x] = data[y * stride + x]!
  }
  const idat = deflateSync(raw)

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}
