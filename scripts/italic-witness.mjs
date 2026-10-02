#!/usr/bin/env node
/**
 * Which words a ClearScan PDF prints in italic, read off the shapes of its
 * glyphs: the witness `checkEmphasis` (`@core/coherence/emphasis.ts`) is
 * handed.
 *
 *   node scripts/italic-witness.mjs <scan.pdf> <out.json>
 *
 * TUP's *Secret Doctrine* volumes lost nearly all their italics in the text
 * layer (Vol. II carried 8 italic runs; the paper prints thousands) but kept
 * the type. Acrobat's ClearScan builds a font per cluster of glyph shapes, and
 * italic glyphs cluster apart from roman, so the words in one font are nearly
 * always one style. The fonts are anonymous (`Fd274040`, no flags, no angle),
 * so the style is measured: each line is rendered and sheared until its
 * vertical strokes are sharpest. Roman settles near -2 degrees, italic at 10
 * to 16, with almost nothing between.
 *
 * Two passes. The first takes a font's median over up to 25 of its lines.
 * The second decides each line: by its own slant where that is decisive
 * (10 or more, 2 or less), by its font's median where the line is too short
 * or too mixed to say. The line wins because a font can lean one way and
 * hold lines of the other: "(Man's" on leaf 165 sits in a 12-degree font and
 * measures -2 itself, and is roman on the paper.
 *
 * Measured on Vol. II before anything was restored from it: 30 runs picked at
 * random from those the book set in roman, each cropped at its own line, were
 * all italic on the paper.
 *
 * Output: `[{ page, text, before, after, how, bbox }]`, one per run of
 * consecutive italic lines, with what the page reads either side so a short
 * run can be placed. Needs `mupdf`, which renders here and nowhere in the
 * app: this is a measurement taken once, not a second renderer.
 */
import * as mupdf from 'mupdf'
import fs from 'node:fs'

const [pdf, out] = process.argv.slice(2)
if (!pdf || !out) {
  console.error('italic-witness.mjs <scan.pdf> <out.json>')
  process.exit(1)
}
const SC = 3
const ROMAN_AT_MOST = 2
const ITALIC_AT_LEAST = 10
const FONT_SAMPLE = 25

const doc = mupdf.Document.openDocument(fs.readFileSync(pdf), 'application/pdf')

/** The shear, in degrees, that makes a line's strokes sharpest. */
function slant(px, w, h, bb) {
  const x0 = Math.max(0, Math.floor(bb.x * SC))
  const y0 = Math.max(0, Math.floor(bb.y * SC))
  const x1 = Math.min(w, Math.ceil((bb.x + bb.w) * SC))
  const y1 = Math.min(h, Math.ceil((bb.y + bb.h) * SC))
  if (x1 - x0 < 10 || y1 - y0 < 6) return null
  let best = 0
  let bestScore = -1
  for (let a = -6; a <= 24; a += 2) {
    const t = Math.tan((a * Math.PI) / 180)
    const ym = (y0 + y1) / 2
    const cols = new Map()
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const v = 255 - px[y * w + x]
        if (v < 60) continue
        const c = Math.round(x + (y - ym) * t)
        cols.set(c, (cols.get(c) || 0) + v)
      }
    }
    let s = 0
    for (const v of cols.values()) s += v * v
    if (s > bestScore) {
      bestScore = s
      best = a
    }
  }
  return best
}

function linesOf(page) {
  try {
    const st = JSON.parse(page.toStructuredText('preserve-spans').asJSON())
    return st.blocks.flatMap((b) => b.lines ?? [])
  } catch {
    return []
  }
}

const lettered = (text) => text.replace(/[^A-Za-z]/g, '').length >= 3

// Pass 1: each font's median slant.
const samples = {}
const failed = new Set()
/** One leaf's pixels, or null when mupdf cannot render it: counted, never fatal. */
function render(p) {
  try {
    const page = doc.loadPage(p)
    const pm = page.toPixmap(mupdf.Matrix.scale(SC, SC), mupdf.ColorSpace.DeviceGray, false, true)
    // Copied out and freed at once: mupdf's objects live in a wasm heap the
    // garbage collector cannot see, and holding them filled it by leaf 193.
    const out = { page, w: pm.getWidth(), h: pm.getHeight(), px: Uint8Array.from(pm.getPixels()) }
    pm.destroy()
    return out
  } catch {
    failed.add(p)
    return null
  }
}
for (let p = 0; p < doc.countPages(); p++) {
  let page
  try {
    page = doc.loadPage(p)
  } catch {
    failed.add(p)
    continue
  }
  const want = linesOf(page).filter((l) => {
    const s = (samples[l.font.name] ??= [])
    return s.length < FONT_SAMPLE && lettered(l.text)
  })
  if (want.length === 0) {
    page.destroy()
    continue
  }
  const r = render(p)
  if (!r) continue
  const { w, h, px } = r
  for (const l of want) {
    const s = samples[l.font.name]
    if (s.length >= FONT_SAMPLE) continue
    const a = slant(px, w, h, l.bbox)
    if (a !== null) s.push(a)
  }
  r.page.destroy()
  page.destroy()
}
const fontSlant = {}
for (const [name, s] of Object.entries(samples)) {
  if (s.length === 0) continue
  const sorted = [...s].sort((x, y) => x - y)
  fontSlant[name] = sorted[sorted.length >> 1]
}

// Pass 2: each line, and the runs of italic lines.
const runs = []
const join = (xs) =>
  xs
    .map((x) => x.text)
    .join(' ')
    .replace(/\s+/g, ' ')
for (let p = 0; p < doc.countPages(); p++) {
  const r = render(p)
  if (!r) continue
  const { page, w, h, px } = r
  const lines = linesOf(page).filter((l) => l.font.name !== 'JansonTUP')
  page.destroy()
  if (lines.length === 0) continue
  const spans = lines.map((l) => {
    const own = lettered(l.text) ? slant(px, w, h, l.bbox) : null
    const font = fontSlant[l.font.name]
    let italic = null
    let how = 'none'
    if (own !== null && own >= ITALIC_AT_LEAST) [italic, how] = [true, 'line']
    else if (own !== null && own <= ROMAN_AT_MOST) [italic, how] = [false, 'line']
    else if (font !== undefined && font >= ITALIC_AT_LEAST) [italic, how] = [true, 'font']
    else if (font !== undefined && font <= 0) [italic, how] = [false, 'font']
    return { text: l.text, italic, how, bbox: l.bbox }
  })
  let from = -1
  for (let k = 0; k <= spans.length; k++) {
    const it = k < spans.length && spans[k].italic === true
    if (it && from < 0) from = k
    if (!it && from >= 0) {
      const run = spans.slice(from, k)
      runs.push({
        page: p,
        text: join(run).trim(),
        before: join(spans.slice(Math.max(0, from - 4), from)).slice(-40),
        after: join(spans.slice(k, k + 4)).slice(0, 40),
        how: run.every((x) => x.how === 'line') ? 'line' : 'font',
        bbox: run[0].bbox
      })
      from = -1
    }
  }
}
fs.writeFileSync(out, JSON.stringify(runs))
console.log(`${runs.length} italic runs over ${doc.countPages()} leaves → ${out}`)
if (failed.size)
  console.log(`mupdf could not read ${failed.size} leaves: ${[...failed].join(', ')}`)
