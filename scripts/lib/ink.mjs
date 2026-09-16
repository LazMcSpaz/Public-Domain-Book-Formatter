/**
 * Read the ink off a PNG, because eyeballing a crop is not measuring it.
 *
 * CLAUDE.md's rule — propose from sense, accept from pixels — applies to
 * proportions as much as to readings, and it was broken the first time by a
 * ratio that was looked at rather than measured and then written into a
 * comment and a test as though it had been. There is no image library here
 * and none is wanted: a PNG is zlib plus five filter types and a scanline
 * loop, which is this file.
 *
 * `decode` handles 8-bit greyscale, RGB and RGBA, non-interlaced, which is
 * every render the driver writes. Anything else raises rather than guessing,
 * because a silently misread scanline produces a number that looks like a
 * measurement.
 */
import { inflateSync } from 'node:zlib'

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }

/** A decoded image: `dark(x, y)` is true where the pixel is inked. */
export function decode(bytes, threshold = 128) {
  if (bytes.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let off = 8
  let width = 0
  let height = 0
  let channels = 0
  const idat = []
  while (off < bytes.length) {
    const len = bytes.readUInt32BE(off)
    const type = bytes.subarray(off + 4, off + 8).toString('latin1')
    const data = bytes.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const depth = data[8]
      const colour = data[9]
      if (depth !== 8) throw new Error(`bit depth ${depth} is not handled`)
      if (data[12] !== 0) throw new Error('interlaced PNGs are not handled')
      channels = CHANNELS[colour]
      if (!channels) throw new Error(`colour type ${colour} is not handled`)
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[y * stride + i - channels] : 0
      const b = y > 0 ? out[(y - 1) * stride + i] : 0
      const c = i >= channels && y > 0 ? out[(y - 1) * stride + i - channels] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (filter !== 0) throw new Error(`filter ${filter} is not a filter`)
      out[y * stride + i] = v & 0xff
    }
  }
  const luma = (x, y) => {
    const i = y * stride + x * channels
    if (channels <= 2) return out[i]
    return (out[i] * 299 + out[i + 1] * 587 + out[i + 2] * 114) / 1000
  }
  return {
    width,
    height,
    luma,
    dark: (x, y) => luma(x, y) < threshold
  }
}

/** Dark pixels per row, over a column range. The ink bands read off this. */
export function rowInk(img, x0 = 0, x1 = img.width) {
  const rows = new Array(img.height).fill(0)
  for (let y = 0; y < img.height; y++) for (let x = x0; x < x1; x++) if (img.dark(x, y)) rows[y]++
  return rows
}

/** Dark pixels per column, over a row range. */
export function colInk(img, y0 = 0, y1 = img.height) {
  const cols = new Array(img.width).fill(0)
  for (let x = 0; x < img.width; x++) for (let y = y0; y < y1; y++) if (img.dark(x, y)) cols[x]++
  return cols
}

/** Runs of consecutive entries above `floor`, as `{ start, end, weight }`. */
export function bands(counts, floor = 0) {
  const out = []
  let start = -1
  let weight = 0
  for (let i = 0; i <= counts.length; i++) {
    const on = i < counts.length && counts[i] > floor
    if (on && start < 0) {
      start = i
      weight = 0
    }
    if (on) weight += counts[i]
    if (!on && start >= 0) {
      out.push({ start, end: i, weight })
      start = -1
    }
  }
  return out
}
