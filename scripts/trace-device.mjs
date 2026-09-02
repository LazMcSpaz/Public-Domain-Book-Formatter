#!/usr/bin/env node
/**
 * Trace a printed device from a scan into SVG paths.
 *
 * The same job `src/core/ornament/ink-bottle.ts` was made for, done by
 * measurement rather than by hand. Marching squares walks the boundary between
 * ink and paper, so what comes out is the contour the press actually left —
 * every ray of the sunburst included — rather than a redrawing of it. Nothing
 * is smoothed into the shape somebody expects it to have.
 *
 *   node scripts/trace-device.mjs <in.png> <out.svg> [--epsilon 0.6]
 *
 * `--epsilon` is the Douglas-Peucker tolerance in source pixels. It only drops
 * vertices that lie within that distance of the line they sit on, so at 0.6 the
 * path stays inside a pixel of the traced edge.
 */
import { readFileSync, writeFileSync } from 'node:fs'
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
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * ch
  const gray = new Uint8Array(width * height)
  const prev = new Uint8Array(stride),
    line = new Uint8Array(stride)
  let p = 0
  for (let y = 0; y < height; y++) {
    const f = raw[p++]
    for (let i = 0; i < stride; i++) {
      const x = raw[p + i]
      const a = i >= ch ? line[i - ch] : 0,
        b = prev[i],
        c = i >= ch ? prev[i - ch] : 0
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
      const i = x * ch
      gray[y * width + x] =
        ch >= 3 ? (line[i] * 299 + line[i + 1] * 587 + line[i + 2] * 114) / 1000 : line[i]
    }
    prev.set(line)
  }
  return { width, height, gray }
}

function otsu(gray) {
  const hist = new Array(256).fill(0)
  for (const v of gray) hist[v]++
  const total = gray.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0,
    wB = 0,
    best = 128,
    bestVar = -1
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2
    if (between > bestVar) {
      bestVar = between
      best = t
    }
  }
  return best
}

/**
 * Douglas-Peucker, for a CLOSED ring.
 *
 * The textbook form anchors on the first and last point, which for a ring are
 * the same point: the anchor line has zero length, every vertex measures zero
 * distance from it, and the whole contour collapses to nothing. So the ring is
 * cut at the vertex farthest from the start and each half simplified against a
 * real chord.
 */
function simplifyRing(pts, eps) {
  if (pts.length < 5) return pts
  const dp = (a, b, keep) => {
    const stack = [[a, b]]
    while (stack.length) {
      const [i, j] = stack.pop()
      if (j <= i + 1) continue
      const [ax, ay] = pts[i],
        [bx, by] = pts[j]
      const dx = bx - ax,
        dy = by - ay
      const len = Math.hypot(dx, dy) || 1
      let far = -1,
        best = eps
      for (let k = i + 1; k < j; k++) {
        const [px, py] = pts[k]
        const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len
        if (d > best) {
          best = d
          far = k
        }
      }
      if (far > 0) {
        keep[far] = 1
        stack.push([i, far], [far, j])
      }
    }
  }
  let m = 0,
    md = -1
  const [x0, y0] = pts[0]
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - x0) ** 2 + (pts[i][1] - y0) ** 2
    if (d > md) {
      md = d
      m = i
    }
  }
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[m] = keep[pts.length - 1] = 1
  dp(0, m, keep)
  dp(m, pts.length - 1, keep)
  return pts.filter((_, i) => keep[i])
}

const [, , inPath, outPath, ...rest] = process.argv
const epsAt = rest.indexOf('--epsilon')
const EPS = epsAt >= 0 ? Number(rest[epsAt + 1]) : 0.6

const { width, height, gray } = decode(inPath)
const t = otsu(gray)
const W = width + 2,
  H = height + 2 // pad so shapes touching the edge still close
const ink = new Uint8Array(W * H)
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) ink[(y + 1) * W + (x + 1)] = gray[y * width + x] < t ? 1 : 0

// Marching squares, emitting segments rather than walking edges. Each cell
// contributes at most two segments between edge midpoints; linking them by
// shared endpoints afterwards is O(n) and cannot loop forever, which the
// walking version could and did.
const segs = []
for (let y = 0; y < H - 1; y++) {
  for (let x = 0; x < W - 1; x++) {
    const tl = ink[y * W + x],
      tr = ink[y * W + x + 1]
    const br = ink[(y + 1) * W + x + 1],
      bl = ink[(y + 1) * W + x]
    const code = (tl << 3) | (tr << 2) | (br << 1) | bl
    if (code === 0 || code === 15) continue
    const T = [x + 0.5, y],
      R = [x + 1, y + 0.5]
    const B = [x + 0.5, y + 1],
      L = [x, y + 0.5]
    const push = (a, b) => segs.push([a, b])
    switch (code) {
      case 1:
        push(L, B)
        break
      case 2:
        push(B, R)
        break
      case 3:
        push(L, R)
        break
      case 4:
        push(T, R)
        break
      case 5:
        push(L, T)
        push(B, R)
        break
      case 6:
        push(T, B)
        break
      case 7:
        push(L, T)
        break
      case 8:
        push(T, L)
        break
      case 9:
        push(T, B)
        break
      case 10:
        push(T, R)
        push(B, L)
        break
      case 11:
        push(T, R)
        break
      case 12:
        push(L, R)
        break
      case 13:
        push(B, R)
        break
      case 14:
        push(L, B)
        break
    }
  }
}

// Link segments into loops as an UNDIRECTED graph. Marching-squares segments
// have no reliable orientation across the saddle cases, and linking them by
// start-point only silently drops every segment that happens to point the other
// way — which is what fragmented the first two attempts.
const key = (p) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`
const incident = new Map()
segs.forEach((s, i) => {
  for (const end of [0, 1]) {
    const k = key(s[end])
    if (!incident.has(k)) incident.set(k, [])
    incident.get(k).push(i)
  }
})
const used = new Uint8Array(segs.length)
const loops = []
for (let start = 0; start < segs.length; start++) {
  if (used[start]) continue
  used[start] = 1
  const pts = [segs[start][0], segs[start][1]]
  let head = segs[start][1]
  let guard = 0
  while (guard++ < 2e6) {
    const cands = incident.get(key(head)) || []
    const nextIdx = cands.find((i) => !used[i])
    if (nextIdx === undefined) break
    used[nextIdx] = 1
    const s = segs[nextIdx]
    // continue from whichever end is NOT the one we arrived at
    head = key(s[0]) === key(head) ? s[1] : s[0]
    pts.push(head)
  }
  if (pts.length >= 5) loops.push(pts)
}

const paths = loops
  .map((l) => simplifyRing(l, EPS))
  .filter((l) => l.length >= 4)
  .map(
    (l) => 'M' + l.map(([x, y]) => `${(x - 1).toFixed(1)} ${(y - 1).toFixed(1)}`).join('L') + 'Z'
  )

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n` +
  `<path fill="#141414" fill-rule="evenodd" d="${paths.join('')}"/>\n</svg>\n`
writeFileSync(outPath, svg)

const verts = loops.reduce((a, l) => a + l.length, 0)
console.log(`${width} x ${height}, Otsu ${t}, ${segs.length} boundary segments`)
console.log(
  `${loops.length} closed contours, ${verts} vertices traced, ${paths.length} kept at epsilon ${EPS}`
)
console.log(`written ${outPath} (${(svg.length / 1024).toFixed(0)} KB)`)
