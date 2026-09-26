/**
 * Which leaves lose type off an edge of the scan.
 *
 *   node scripts/reading-kit/edges.mjs <png...>
 *
 * On _Isis Unveiled_ Vol. II the photograph of leaf 52 stops two or three
 * letters short of every line's end, and neither engine says so: both simply
 * read the letters that are there. A reader noticed, on one leaf, by
 * chance. This asks the pixels of every leaf given: the width of its text
 * block against the median of them all. A page with its margin intact reads
 * at the book's measure; leaf 52 reads 58 px narrow at 400 DPI, where no other
 * leaf of its first sixty was more than 14. A narrow leaf is printed NARROW.
 * Far narrower is not a clip but a page of short lines (the Würzburg
 * register on leaves 79 and 80 reads 300 px short): that is said too.
 * Pure Node (zlib only), 8-bit PNGs as `drive.mjs leaf` writes them.
 */
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

function decode(path) {
  const buf = readFileSync(path)
  let p = 8
  let W, H, type
  const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const tag = buf.toString('ascii', p + 4, p + 8)
    const d = buf.subarray(p + 8, p + 8 + len)
    if (tag === 'IHDR') {
      W = d.readUInt32BE(0)
      H = d.readUInt32BE(4)
      if (d[8] !== 8) throw new Error(`${path}: 8-bit PNGs only`)
      type = d[9]
    } else if (tag === 'IDAT') idat.push(d)
    p += 12 + len
  }
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[type]
  const stride = W * bpp
  const raw = inflateSync(Buffer.concat(idat))
  const img = Buffer.alloc(H * stride)
  for (let y = 0; y < H; y++) {
    const f = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? img[y * stride + x - bpp] : 0
      const b = y > 0 ? img[(y - 1) * stride + x] : 0
      const c = x >= bpp && y > 0 ? img[(y - 1) * stride + x - bpp] : 0
      let v = line[x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const q = a + b - c
        const pa = Math.abs(q - a),
          pb = Math.abs(q - b),
          pc = Math.abs(q - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      img[y * stride + x] = v & 255
    }
  }
  const lum = (x, y) => img[y * stride + x * bpp]
  return { W, H, lum }
}

// The render pads the photograph with white, so a clipped edge is not at the
// image's edge: it shows as a text block narrower than the book's measure.
// For each full text row, where its ink starts and stops; the leaf's block is
// the 10th percentile of starts to the 90th of stops, and its width is
// compared with the median width over every leaf given.
const DARK = 110
const out = []
for (const path of process.argv.slice(2)) {
  const { W, H, lum } = decode(path)
  const y0 = Math.round(H * 0.08),
    y1 = Math.round(H * 0.85)
  const starts = [],
    stops = []
  for (let y = y0; y < y1; y += 3) {
    let first = -1,
      last = -1,
      ink = 0
    for (let x = Math.round(W * 0.08); x < W; x++)
      if (lum(x, y) < DARK) {
        if (first < 0) first = x
        last = x
        ink++
      }
    if (ink < 40) continue
    starts.push(first)
    stops.push(last)
  }
  const q = (a, f) => {
    const s = [...a].sort((m, n) => m - n)
    return s[Math.floor(f * (s.length - 1))] ?? 0
  }
  const leaf = (path.match(/(\d+)\.png$/) ?? [])[1] ?? path
  out.push({ leaf, left: q(starts, 0.1), right: q(stops, 0.9), rows: starts.length })
}
const widths = out.map((o) => o.right - o.left).sort((a, b) => a - b)
const median = widths[Math.floor(widths.length / 2)] ?? 0
for (const o of out) {
  const w = o.right - o.left
  const short = median - w
  console.log(
    `${o.leaf}\tleft ${o.left}\tright ${o.right}\twidth ${w}\tshort ${short}${short > 150 ? '\tSHORT LINES (a list, verse or a table: look)' : short > 25 ? '\tNARROW' : ''}`
  )
}
