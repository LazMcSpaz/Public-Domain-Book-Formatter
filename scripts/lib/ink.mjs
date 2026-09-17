/**
 * Where the ink is on a rendered leaf, measured rather than eyeballed.
 *
 * Cutting a figure means naming a box, and a box named by looking at a picture
 * is a guess that reads like a measurement. CLAUDE.md records what that cost
 * once already: three different answers about the same ratio, one of which went
 * into a comment and a test as though it had been measured.
 *
 * There is no image library here and there does not need to be one. A PNG is
 * `zlib` plus five filter types and a scanline loop, so this decodes the render
 * and sums the dark pixels per row and per column. The ink bands then fall out
 * of the numbers: a figure is a run of rows carrying ink with clear rows above
 * and below it, and its left and right edges are the first and last columns
 * carrying ink inside that run.
 *
 * This matters more than usual on a book whose figures are *drawn*: a syntactic
 * tree's branches are vector rules with no word box under them, so a crop taken
 * from the OCR boxes alone clips every branch it has. Only the pixels know
 * where the strokes end.
 *
 * Node only — it is a script helper, not core.
 */
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

/** Undo one scanline's PNG filter, in place, against the row above it. */
function unfilter(type, line, prior, bpp) {
  const n = line.length
  if (type === 0) return
  if (type === 1) {
    for (let i = bpp; i < n; i++) line[i] = (line[i] + line[i - bpp]) & 0xff
    return
  }
  if (type === 2) {
    for (let i = 0; i < n; i++) line[i] = (line[i] + prior[i]) & 0xff
    return
  }
  if (type === 3) {
    for (let i = 0; i < n; i++) {
      const a = i >= bpp ? line[i - bpp] : 0
      line[i] = (line[i] + ((a + prior[i]) >> 1)) & 0xff
    }
    return
  }
  if (type === 4) {
    for (let i = 0; i < n; i++) {
      const a = i >= bpp ? line[i - bpp] : 0
      const b = prior[i]
      const c = i >= bpp ? prior[i - bpp] : 0
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      line[i] = (line[i] + pred) & 0xff
    }
    return
  }
  throw new Error(`unknown PNG filter ${type}`)
}

/**
 * Decode a PNG to `{ width, height, dark }`, where `dark` is one byte per
 * pixel: 1 where the pixel is darker than `threshold`, 0 where it is not.
 *
 * Handles the 8-bit truecolour and truecolour-with-alpha images Chromium
 * writes, and 8-bit greyscale. Anything else raises rather than guessing.
 */
export function darkMap(path, threshold = 160) {
  const buf = readFileSync(path)
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path} is not a PNG`)

  let width = 0
  let height = 0
  let depth = 0
  let colour = 0
  const idat = []
  let at = 8
  while (at < buf.length) {
    const len = buf.readUInt32BE(at)
    const tag = buf.toString('latin1', at + 4, at + 8)
    const data = buf.subarray(at + 8, at + 8 + len)
    if (tag === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      depth = data[8]
      colour = data[9]
      if (data[12] !== 0) throw new Error('interlaced PNG')
    } else if (tag === 'IDAT') idat.push(data)
    else if (tag === 'IEND') break
    at += 12 + len
  }
  if (depth !== 8) throw new Error(`PNG bit depth ${depth}`)
  const channels = colour === 2 ? 3 : colour === 6 ? 4 : colour === 0 ? 1 : 0
  if (channels === 0) throw new Error(`PNG colour type ${colour}`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const dark = new Uint8Array(width * height)
  let prior = new Uint8Array(stride)
  let line = new Uint8Array(stride)
  let p = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[p++]
    line.set(raw.subarray(p, p + stride))
    p += stride
    unfilter(filter, line, prior, channels)
    for (let x = 0; x < width; x++) {
      const i = x * channels
      // Luminance is overkill for black type on white paper; the minimum
      // channel catches coloured rules too and costs nothing.
      const v = channels === 1 ? line[i] : Math.min(line[i], line[i + 1], line[i + 2])
      if (v < threshold) dark[y * width + x] = 1
    }
    const swap = prior
    prior = line
    line = swap
  }
  return { width, height, dark }
}

/**
 * Dark pixels per row, optionally within a window of columns.
 *
 * The window is not a convenience. On a leaf photographed as two printed pages
 * there is no row clear of ink across the *whole* leaf — the other page is
 * always setting something — so banding without one returns the single band
 * "all of it", which is what it did first. A figure is found inside one printed
 * page or not at all.
 */
export function rowInk({ width, height, dark }, x0 = 0, x1 = width) {
  const rows = new Int32Array(height)
  for (let y = 0; y < height; y++) {
    let n = 0
    const base = y * width
    for (let x = x0; x < x1; x++) n += dark[base + x]
    rows[y] = n
  }
  return rows
}

/** Dark pixels per column, within a row range. */
export function colInk({ width, dark }, from, to, x0 = 0, x1 = width) {
  const cols = new Int32Array(width)
  for (let y = from; y < to; y++) {
    const base = y * width
    for (let x = x0; x < x1; x++) cols[x] += dark[base + x]
  }
  return cols
}

/**
 * The tight box round the ink in a region, as fractions of the whole leaf.
 *
 * Given a row range, finds the first and last row and column carrying any ink
 * and returns `x,y,w,h` in the 0–1 coordinates `drive.mjs figure cut` takes.
 * `pad` adds a margin in pixels, because a rule that ends in a single faint
 * pixel is still a rule and clipping it is what looking would have done.
 */
export function boxOf(map, fromRow, toRow, pad = 0, wx0 = 0, wx1 = map.width) {
  const rows = rowInk(map, wx0, wx1)
  let top = -1
  let bottom = -1
  for (let y = fromRow; y < toRow; y++) {
    if (rows[y] > 0) {
      if (top === -1) top = y
      bottom = y
    }
  }
  if (top === -1) return null
  const cols = colInk(map, top, bottom + 1, wx0, wx1)
  let left = -1
  let right = -1
  for (let x = wx0; x < wx1; x++) {
    if (cols[x] > 0) {
      if (left === -1) left = x
      right = x
    }
  }
  const x0 = Math.max(0, left - pad)
  const y0 = Math.max(0, top - pad)
  const x1 = Math.min(map.width, right + 1 + pad)
  const y1 = Math.min(map.height, bottom + 1 + pad)
  return {
    x: x0 / map.width,
    y: y0 / map.height,
    w: (x1 - x0) / map.width,
    h: (y1 - y0) / map.height,
    px: { x0, y0, x1, y1 }
  }
}

/**
 * Runs of rows carrying ink, separated by at least `gap` clear rows.
 *
 * This is how a figure is found on a page of otherwise even type: the bands of
 * a text column are one leading apart, and a figure stands clear of the text
 * above and below it by more than that.
 */
export function bands(map, gap = 12, minRows = 4, x0 = 0, x1 = map.width) {
  const rows = rowInk(map, x0, x1)
  const out = []
  let start = -1
  let clear = 0
  for (let y = 0; y < map.height; y++) {
    if (rows[y] > 0) {
      if (start === -1) start = y
      clear = 0
    } else if (start !== -1) {
      clear++
      if (clear >= gap) {
        const end = y - clear + 1
        if (end - start >= minRows) out.push({ from: start, to: end })
        start = -1
        clear = 0
      }
    }
  }
  if (start !== -1 && map.height - start >= minRows) out.push({ from: start, to: map.height })
  return out
}
