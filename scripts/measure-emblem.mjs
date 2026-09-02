#!/usr/bin/env node
/**
 * Measure the geometry of the all-seeing-eye device from a scan.
 *
 * The device is a half-disc of fine radiating rays with seven stars and an eye
 * left in reserve (paper-coloured) on top of it. So the stars and the eye are
 * *holes* in the ink, which makes them findable: threshold, take the connected
 * regions of paper enclosed by the ray field, and their centroids and radii are
 * the design's real geometry rather than somebody's estimate of it.
 *
 *   node scripts/measure-emblem.mjs <emblem.png>
 */
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

function decode(path) {
  const buf = readFileSync(path)
  let at = 8,
    width = 0,
    height = 0,
    depth = 0,
    colorType = 0
  const idat = []
  while (at < buf.length) {
    const len = buf.readUInt32BE(at)
    const type = buf.toString('ascii', at + 4, at + 8)
    const body = buf.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      depth = body[8]
      colorType = body[9]
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    at += 12 + len
  }
  if (depth !== 8) throw new Error(`bit depth ${depth}`)
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const gray = new Uint8Array(width * height)
  const prev = new Uint8Array(stride),
    line = new Uint8Array(stride)
  let p = 0
  for (let y = 0; y < height; y++) {
    const f = raw[p++]
    for (let i = 0; i < stride; i++) {
      const x = raw[p + i]
      const a = i >= channels ? line[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let v
      if (f === 0) v = x
      else if (f === 1) v = x + a
      else if (f === 2) v = x + b
      else if (f === 3) v = x + ((a + b) >> 1)
      else {
        const pp = a + b - c
        const pa = Math.abs(pp - a),
          pb = Math.abs(pp - b),
          pc = Math.abs(pp - c)
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      line[i] = v & 0xff
    }
    p += stride
    for (let x = 0; x < width; x++) {
      const i = x * channels
      gray[y * width + x] =
        channels >= 3 ? (line[i] * 299 + line[i + 1] * 587 + line[i + 2] * 114) / 1000 : line[i]
    }
    prev.set(line)
  }
  return { width, height, gray }
}

const path = process.argv[2]
const { width, height, gray } = decode(path)

// Otsu threshold: the image is bimodal (cream paper, black ink)
let best = 128,
  bestVar = -1
const hist = new Array(256).fill(0)
for (const v of gray) hist[v]++
const total = gray.length
let sum = 0
for (let i = 0; i < 256; i++) sum += i * hist[i]
let sumB = 0,
  wB = 0
for (let t = 0; t < 256; t++) {
  wB += hist[t]
  if (!wB) continue
  const wF = total - wB
  if (!wF) break
  sumB += t * hist[t]
  const mB = sumB / wB,
    mF = (sum - sumB) / wF
  const between = wB * wF * (mB - mF) ** 2
  if (between > bestVar) {
    bestVar = between
    best = t
  }
}
const ink = new Uint8Array(width * height)
for (let i = 0; i < gray.length; i++) ink[i] = gray[i] < best ? 1 : 0
const inked = ink.reduce((a, b) => a + b, 0)
console.log(
  `${width} x ${height}, Otsu threshold ${best}, ${((100 * inked) / total).toFixed(1)}% ink`
)

// Flood the paper from the border: everything reachable is OUTSIDE the disc.
const outside = new Uint8Array(width * height)
const stack = []
for (let x = 0; x < width; x++) {
  stack.push([x, 0], [x, height - 1])
}
for (let y = 0; y < height; y++) {
  stack.push([0, y], [width - 1, y])
}
while (stack.length) {
  const [x, y] = stack.pop()
  if (x < 0 || y < 0 || x >= width || y >= height) continue
  const i = y * width + x
  if (outside[i] || ink[i]) continue
  outside[i] = 1
  stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
}

// Paper regions NOT reachable from the border are the reserved shapes.
const seen = new Uint8Array(width * height)
const regions = []
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const i0 = y * width + x
    if (seen[i0] || ink[i0] || outside[i0]) continue
    const px = []
    const st = [[x, y]]
    seen[i0] = 1
    while (st.length) {
      const [cx, cy] = st.pop()
      px.push([cx, cy])
      for (const [nx, ny] of [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1]
      ]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const j = ny * width + nx
        if (seen[j] || ink[j] || outside[j]) continue
        seen[j] = 1
        st.push([nx, ny])
      }
    }
    if (px.length >= 12) {
      let sx = 0,
        sy = 0,
        minx = 1e9,
        maxx = -1e9,
        miny = 1e9,
        maxy = -1e9
      for (const [ax, ay] of px) {
        sx += ax
        sy += ay
        if (ax < minx) minx = ax
        if (ax > maxx) maxx = ax
        if (ay < miny) miny = ay
        if (ay > maxy) maxy = ay
      }
      regions.push({
        area: px.length,
        cx: sx / px.length,
        cy: sy / px.length,
        w: maxx - minx + 1,
        h: maxy - miny + 1,
        minx,
        maxx,
        miny,
        maxy
      })
    }
  }
regions.sort((a, b) => b.area - a.area)
console.log(`\n${regions.length} reserved (paper) regions enclosed by the ink, largest first:`)
for (const r of regions.slice(0, 14)) {
  console.log(
    `  area ${String(r.area).padStart(5)}  centre ${r.cx.toFixed(1)},${r.cy.toFixed(1)}` +
      `  box ${r.w}x${r.h}  (as fractions ${(r.cx / width).toFixed(3)},${(r.cy / height).toFixed(3)})`
  )
}

// The disc: ink extent
let dminx = 1e9,
  dmaxx = -1e9,
  dminy = 1e9,
  dmaxy = -1e9
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    if (!ink[y * width + x]) continue
    if (x < dminx) dminx = x
    if (x > dmaxx) dmaxx = x
    if (y < dminy) dminy = y
    if (y > dmaxy) dmaxy = y
  }
console.log(
  `\ninked extent: x ${dminx}..${dmaxx} (${dmaxx - dminx + 1}px), y ${dminy}..${dmaxy} (${dmaxy - dminy + 1}px)`
)
console.log(
  `half-disc: centre x ${((dminx + dmaxx) / 2).toFixed(1)}, top y ${dminy}, radius ~${((dmaxx - dminx) / 2).toFixed(1)} wide / ${(dmaxy - dminy).toFixed(1)} deep`
)

// ---- ray count -------------------------------------------------------------
// The rays radiate from a point on the flat top edge. Sample around an arc at a
// radius clear of the stars and count ink/paper transitions: each ray crossed is
// one run of ink, so the ray count is the number of runs.
{
  const cx = (dminx + dmaxx) / 2
  const cy = dminy // the fan's origin sits on the flat top edge
  const R = Math.min((dmaxx - dminx) / 2, dmaxy - dminy)
  for (const frac of [0.8, 0.86, 0.9, 0.94, 0.97]) {
    const r = R * frac
    const steps = 4000
    let runs = 0,
      wasInk = false,
      sampled = 0
    for (let s = 0; s <= steps; s++) {
      const a = Math.PI * (s / steps) // 0..pi, sweeping the lower half
      const x = Math.round(cx - r * Math.cos(a))
      const y = Math.round(cy + r * Math.sin(a))
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      sampled++
      const isInk = ink[y * width + x] === 1
      if (isInk && !wasInk) runs++
      wasInk = isInk
    }
    console.log(
      `arc at ${(frac * 100).toFixed(0)}% of radius: ${runs} ink runs over ${sampled} samples`
    )
  }
}
