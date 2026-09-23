/**
 * Cut a rectangle out of a leaf render, for a reader who needs to look
 * closer at one word. Pure Node (zlib only): the desktop has no PIL and no
 * ImageMagick, and every reader of the first desktop stretch wrote its own
 * cropper to get round that — six of them, one of which scrambled its output
 * at any scale below 1.
 *
 *   node scripts/reading-kit/crop.mjs <in.png> <out.png> <x> <y> <w> <h> [scale=1]
 *
 * Coordinates are pixels of the input. `scale` resamples by box average when
 * shrinking and by nearest pixel when enlarging, so a 2 shows a worn accent
 * at twice its size without inventing a smoother one. 8-bit PNGs only (grey,
 * grey+alpha, RGB, RGBA), which is what `drive.mjs leaf` writes.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync, deflateSync } from 'node:zlib'

const [, , src, out, xs, ys, ws, hs, ss = '1'] = process.argv
if (!src || !out || hs === undefined) {
  console.error('usage: crop.mjs <in.png> <out.png> <x> <y> <w> <h> [scale]')
  process.exit(2)
}
const buf = readFileSync(src)
let p = 8
let W, H, depth, type
const idat = []
while (p < buf.length) {
  const len = buf.readUInt32BE(p)
  const tag = buf.toString('ascii', p + 4, p + 8)
  const d = buf.subarray(p + 8, p + 8 + len)
  if (tag === 'IHDR') {
    W = d.readUInt32BE(0)
    H = d.readUInt32BE(4)
    depth = d[8]
    type = d[9]
    if (d[12] !== 0) throw new Error('interlaced PNGs are not handled')
  } else if (tag === 'IDAT') idat.push(d)
  p += 12 + len
}
const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[type]
if (depth !== 8 || !bpp) throw new Error(`unhandled PNG: depth ${depth}, colour type ${type}`)
const stride = W * bpp
const raw = inflateSync(Buffer.concat(idat))
const img = Buffer.alloc(H * stride)
let prev = Buffer.alloc(stride)
for (let y = 0; y < H; y++) {
  const f = raw[y * (stride + 1)]
  const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
  const cur = img.subarray(y * stride, (y + 1) * stride)
  for (let i = 0; i < stride; i++) {
    const a = i >= bpp ? cur[i - bpp] : 0
    const b = prev[i]
    const c = i >= bpp ? prev[i - bpp] : 0
    let v = line[i]
    if (f === 1) v += a
    else if (f === 2) v += b
    else if (f === 3) v += (a + b) >> 1
    else if (f === 4) {
      const q = a + b - c
      const pa = Math.abs(q - a)
      const pb = Math.abs(q - b)
      const pc = Math.abs(q - c)
      v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
    }
    cur[i] = v & 255
  }
  prev = cur
}

const x0 = Math.max(0, Math.floor(+xs))
const y0 = Math.max(0, Math.floor(+ys))
const w = Math.min(Math.floor(+ws), W - x0)
const h = Math.min(Math.floor(+hs), H - y0)
const scale = Number(ss)
if (!(w > 0 && h > 0 && scale > 0)) throw new Error('empty crop')
const ow = Math.max(1, Math.round(w * scale))
const oh = Math.max(1, Math.round(h * scale))
const rowLen = ow * bpp + 1
const o = Buffer.alloc(oh * rowLen)
for (let oy = 0; oy < oh; oy++) {
  // Source span for this output pixel: a box when shrinking, one pixel when not.
  const sy0 = y0 + Math.floor((oy * h) / oh)
  const sy1 = Math.max(sy0 + 1, y0 + Math.floor(((oy + 1) * h) / oh))
  for (let ox = 0; ox < ow; ox++) {
    const sx0 = x0 + Math.floor((ox * w) / ow)
    const sx1 = Math.max(sx0 + 1, x0 + Math.floor(((ox + 1) * w) / ow))
    for (let k = 0; k < bpp; k++) {
      let sum = 0
      for (let sy = sy0; sy < sy1; sy++)
        for (let sx = sx0; sx < sx1; sx++) sum += img[sy * stride + sx * bpp + k]
      o[oy * rowLen + 1 + ox * bpp + k] = Math.round(sum / ((sy1 - sy0) * (sx1 - sx0)))
    }
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (b) => {
  let c = ~0
  for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8)
  return ~c >>> 0
}
const chunk = (tag, d) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(d.length)
  const body = Buffer.concat([Buffer.from(tag, 'ascii'), d])
  const sum = Buffer.alloc(4)
  sum.writeUInt32BE(crc(body))
  return Buffer.concat([len, body, sum])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(ow, 0)
ihdr.writeUInt32BE(oh, 4)
ihdr[8] = 8
ihdr[9] = type
writeFileSync(
  out,
  Buffer.concat([
    buf.subarray(0, 8),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(o)),
    chunk('IEND', Buffer.alloc(0))
  ])
)
console.log(`${W}x${H} → ${ow}x${oh}`)
