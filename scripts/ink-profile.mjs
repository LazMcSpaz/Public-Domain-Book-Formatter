#!/usr/bin/env node
/**
 * Column ink profile of a PNG crop, for counting typewriter cells.
 *
 * A typewriter sets on a fixed pitch, so "is this word five cells or six?" is a
 * measurement and not a judgement — but eyeballing a crop gave three different
 * answers about the same word, exactly as CLAUDE.md warns. This decodes the
 * crop and prints the ink per column, so the gaps between glyph cells can be
 * read off the numbers.
 *
 *   node scripts/ink-profile.mjs <crop.png> [--cells <n>]
 *
 * With --cells it also divides the inked span into n equal cells and prints
 * what falls in each, which is how a five-cell reading is told from a six.
 */
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

function decode(path) {
  const buf = readFileSync(path)
  let at = 8
  let width = 0,
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
  if (depth !== 8) throw new Error(`bit depth ${depth} not supported`)
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  if (!channels) throw new Error(`color type ${colorType} not supported`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = new Uint8Array(width * height)
  const prevLine = new Uint8Array(stride)
  const line = new Uint8Array(stride)
  let p = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[p++]
    for (let i = 0; i < stride; i++) {
      const x = raw[p + i]
      const a = i >= channels ? line[i - channels] : 0
      const b = prevLine[i]
      const c = i >= channels ? prevLine[i - channels] : 0
      let v
      switch (filter) {
        case 0:
          v = x
          break
        case 1:
          v = x + a
          break
        case 2:
          v = x + b
          break
        case 3:
          v = x + ((a + b) >> 1)
          break
        case 4: {
          const pp = a + b - c
          const pa = Math.abs(pp - a),
            pb = Math.abs(pp - b),
            pc = Math.abs(pp - c)
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default:
          throw new Error(`filter ${filter}`)
      }
      line[i] = v & 0xff
    }
    p += stride
    for (let x = 0; x < width; x++) {
      const i = x * channels
      // luminance; alpha over white where present
      let l =
        channels >= 3 ? (line[i] * 299 + line[i + 1] * 587 + line[i + 2] * 114) / 1000 : line[i]
      if (colorType === 4) l = line[i]
      out[y * width + x] = l
    }
    prevLine.set(line)
  }
  return { width, height, gray: out }
}

const [, , path, ...rest] = process.argv
if (!path) {
  console.error('usage: ink-profile.mjs <crop.png> [--cells n]')
  process.exit(1)
}
const cellsAt = rest.indexOf('--cells')
const cells = cellsAt >= 0 ? Number(rest[cellsAt + 1]) : 0

const { width, height, gray } = decode(path)
// Otsu-ish: ink is anything darker than midway between the darkest and lightest
let lo = 255,
  hi = 0
for (const v of gray) {
  if (v < lo) lo = v
  if (v > hi) hi = v
}
const threshold = lo + (hi - lo) * 0.45

const cols = new Array(width).fill(0)
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) if (gray[y * width + x] < threshold) cols[x]++

let first = cols.findIndex((c) => c > 0)
let last = cols.length - 1 - [...cols].reverse().findIndex((c) => c > 0)
console.log(
  `${width}x${height}, ink threshold ${threshold.toFixed(0)}, inked span ${first}..${last} (${last - first + 1}px)`
)

// gaps: runs of empty columns inside the span
const gaps = []
let run = 0
for (let x = first; x <= last; x++) {
  if (cols[x] === 0) run++
  else {
    if (run > 0) gaps.push([x - run, run])
    run = 0
  }
}
console.log(
  'empty runs inside the span (start,width):',
  gaps.map(([s, w]) => `${s},${w}`).join('  ') || 'none'
)

const bar = (n, max) => '#'.repeat(Math.round((n / max) * 40))
const max = Math.max(...cols)
for (let x = first; x <= last; x++)
  console.log(String(x).padStart(4), String(cols[x]).padStart(3), bar(cols[x], max))

if (cells > 0) {
  const span = last - first + 1
  const cell = span / cells
  console.log(`\nif this span is ${cells} cells, each is ${cell.toFixed(1)}px:`)
  for (let i = 0; i < cells; i++) {
    const a = Math.round(first + i * cell),
      b = Math.round(first + (i + 1) * cell) - 1
    let ink = 0
    for (let x = a; x <= b; x++) ink += cols[x]
    console.log(`  cell ${i + 1}: x ${a}..${b}  ink ${ink}`)
  }
}
