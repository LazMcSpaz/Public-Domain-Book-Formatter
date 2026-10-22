#!/usr/bin/env node
/**
 * The book's own text, set as a ground.
 *
 * A dense field of the volume's words across the whole wrap, printed faint
 * under the type. It is a *pattern* and not a figure, in this app's own sense
 * (`src/core/cover/patterns.ts`): allover, with no centre and no subject, so
 * there is nothing for a fold that creeps by an eighth of an inch to move. That
 * is what lets it run across the back, the spine and the front as one field
 * without the single-picture argument a ground figure needs.
 *
 * ## Why the glyphs come out as paths
 *
 * The artwork is rasterised by the browser from an `<img>`, and an SVG loaded
 * that way does **not** inherit the page's fonts — so a `<text>` element would
 * render in whatever the renderer felt like, or in nothing. The outlines are
 * therefore taken from the same font files pdf-lib embeds, through the same
 * fontkit call the measurer uses, and written as path data. No font dependency
 * at render time and no second idea of what the face is.
 *
 * Each distinct glyph is defined once and placed with `<use>`, which is the
 * difference between a 600 KB file and a 6 MB one. The `<g>` holding each
 * definition carries its own `scale(k, -k)`: `<use x y>` is a translate applied
 * *outside* the referenced element's transform, so the positions stay in points
 * while the outlines stay in font units, and the flip (font space is y-up, SVG
 * is y-down) is written once per glyph rather than once per occurrence.
 *
 * ## What is thrown away on purpose
 *
 * The book's paragraphing. Entries are joined into one river, because a ground
 * is a texture and a column of separated entries reads as a page that failed to
 * print. What is **kept** is the emphasis and the bold: the headwords and the
 * language tags are what make this field recognisably a glossary rather than
 * grey noise, and they arrive as word indices from the reading, so no second
 * reader decides what is marked.
 *
 * Usage:
 *   node scripts/textground.mjs <book.json> <out.svg> [options]
 *     --width <in>    the sheet's full width, bleed included   (default 15.151)
 *     --height <in>   the sheet's full height, bleed included  (default 10.25)
 *     --size <pt>     the type size                            (default 10)
 *     --leading <k>   baseline to baseline, as a share of the size (default 1.15)
 *     --angle <deg>   the field's rotation                      (default 15)
 *     --face <name>   cardo | eb-garamond | crimson-pro | libre-baskerville
 *     --from <leaf>   the first leaf to lift from               (default 0)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const fontkit = require('@pdf-lib/fontkit')

const FACES = {
  cardo: {
    regular: '@expo-google-fonts/cardo/400Regular/Cardo_400Regular.ttf',
    italic: '@expo-google-fonts/cardo/400Regular_Italic/Cardo_400Regular_Italic.ttf',
    bold: '@expo-google-fonts/cardo/700Bold/Cardo_700Bold.ttf'
  },
  'eb-garamond': {
    regular: '@expo-google-fonts/eb-garamond/400Regular/EBGaramond_400Regular.ttf',
    italic: '@expo-google-fonts/eb-garamond/400Regular_Italic/EBGaramond_400Regular_Italic.ttf',
    bold: '@expo-google-fonts/eb-garamond/700Bold/EBGaramond_700Bold.ttf'
  },
  'crimson-pro': {
    regular: '@expo-google-fonts/crimson-pro/400Regular/CrimsonPro_400Regular.ttf',
    italic: '@expo-google-fonts/crimson-pro/400Regular_Italic/CrimsonPro_400Regular_Italic.ttf',
    bold: '@expo-google-fonts/crimson-pro/700Bold/CrimsonPro_700Bold.ttf'
  },
  'libre-baskerville': {
    regular: '@expo-google-fonts/libre-baskerville/400Regular/LibreBaskerville_400Regular.ttf',
    italic:
      '@expo-google-fonts/libre-baskerville/400Regular_Italic/LibreBaskerville_400Regular_Italic.ttf',
    bold: '@expo-google-fonts/libre-baskerville/700Bold/LibreBaskerville_700Bold.ttf'
  }
}

const STYLES = ['regular', 'italic', 'bold']
/** The prefix each style's glyph definitions are named with. */
const TAG = { regular: 'r', italic: 'i', bold: 'b' }

function flag(name, fallback) {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : process.argv[at + 1]
}

const [, , bookPath, outPath] = process.argv
if (!bookPath || !outPath || bookPath.startsWith('--')) {
  console.error('usage: node scripts/textground.mjs <book.json> <out.svg> [options]')
  process.exit(2)
}

const widthIn = Number(flag('width', '15.151'))
const heightIn = Number(flag('height', '10.25'))
const sizePt = Number(flag('size', '10'))
const leadingRatio = Number(flag('leading', '1.15'))
const angleDeg = Number(flag('angle', '15'))
const faceName = flag('face', 'cardo')
const fromLeaf = Number(flag('from', '0'))

const face = FACES[faceName]
if (!face) {
  console.error(`unknown face "${faceName}"; one of ${Object.keys(FACES).join(', ')}`)
  process.exit(2)
}

// ---------------------------------------------------------------- the material

/**
 * The volume's words, each with the face it is set in.
 *
 * Taken off the transcription rather than the assembled body: a ground is
 * decorative, the seam joins and the corrections change which words sit beside
 * which and nothing else, and assembly needs a browser. Said here rather than
 * left to be noticed.
 */
function wordsOf(book, firstLeaf) {
  const run = book.run ?? book
  const out = []
  for (const leaf of run.transcriptions ?? []) {
    if ((leaf.pageIndex ?? 0) < firstLeaf) continue
    for (const block of leaf.blocks ?? []) {
      if (block.kind === 'table') continue
      const text = (block.text ?? '').trim()
      if (!text) continue
      const italic = new Set(block.emphasis ?? [])
      const strong = new Set(block.strong ?? [])
      const words = text.split(/\s+/u)
      for (let i = 0; i < words.length; i += 1) {
        // Strong first: there is no bold italic in the engine, and this is the
        // same substitution `spansFor` makes on the page.
        const style = strong.has(i) ? 'bold' : italic.has(i) ? 'italic' : 'regular'
        out.push({ text: words[i], style })
      }
    }
  }
  return out
}

const book = JSON.parse(readFileSync(bookPath, 'utf8'))
const material = wordsOf(book, fromLeaf)
if (material.length === 0) {
  console.error('no words lifted — is this a book file with a reading in it?')
  process.exit(1)
}

// -------------------------------------------------------------------- the faces

const fonts = {}
let unitsPerEm = 0
for (const style of STYLES) {
  const bytes = readFileSync(require.resolve(face[style]))
  const font = fontkit.create(bytes)
  if (unitsPerEm === 0) unitsPerEm = font.unitsPerEm
  else if (font.unitsPerEm !== unitsPerEm) {
    // Every position below is written in points and every outline in font
    // units, which is only one grid if the three faces agree about the em.
    console.error(`the ${style} face has ${font.unitsPerEm} units to the em, not ${unitsPerEm}`)
    process.exit(1)
  }
  fonts[style] = font
}

const perUnit = sizePt / unitsPerEm
/** A word, laid out once: its glyphs and its advance in points. */
const shaped = new Map()
function shape(text, style) {
  const key = `${style}\u0000${text}`
  const had = shaped.get(key)
  if (had) return had
  const run = fonts[style].layout(text)
  const glyphs = []
  let x = 0
  for (let i = 0; i < run.glyphs.length; i += 1) {
    const glyph = run.glyphs[i]
    // A glyph the face has no outline for is left out rather than printed as a
    // box: this is a texture, and a row of .notdef squares is the one thing in
    // it a reader would notice.
    if (glyph.id !== 0) glyphs.push({ id: glyph.id, dx: x * perUnit })
    x += run.positions[i].xAdvance
  }
  const laid = { glyphs, widthPt: x * perUnit, missing: run.glyphs.length - glyphs.length }
  shaped.set(key, laid)
  return laid
}

const spacePt = shape(' ', 'regular').widthPt

// ------------------------------------------------------------------- the field
//
// The block has to cover the sheet once it is turned, so it is the rotated
// sheet's bounding box — which is why a field at an angle costs about a third
// more words than one set square.

const rad = (angleDeg * Math.PI) / 180
const sheetWPt = widthIn * 72
const sheetHPt = heightIn * 72
const blockWPt = sheetWPt * Math.abs(Math.cos(rad)) + sheetHPt * Math.abs(Math.sin(rad))
const blockHPt = sheetWPt * Math.abs(Math.sin(rad)) + sheetHPt * Math.abs(Math.cos(rad))
const leadingPt = sizePt * leadingRatio
const lineCount = Math.ceil(blockHPt / leadingPt) + 1

const lines = []
let line = []
let natural = 0
let missing = 0
let used = 0
for (const word of material) {
  if (lines.length >= lineCount) break
  const laid = shape(word.text, word.style)
  missing += laid.missing
  const withIt = line.length === 0 ? laid.widthPt : natural + spacePt + laid.widthPt
  if (line.length > 0 && withIt > blockWPt) {
    lines.push({ words: line, natural })
    line = [{ word, laid }]
    natural = laid.widthPt
  } else {
    line.push({ word, laid })
    natural = withIt
  }
  used += 1
}
if (line.length > 0 && lines.length < lineCount) lines.push({ words: line, natural })

if (lines.length < lineCount) {
  console.error(
    `the book has ${material.length} words and the field wants ${lineCount} lines; it filled ${lines.length}.`
  )
  process.exit(1)
}

// ---------------------------------------------------------------------- the SVG
//
// Justified, because a ragged edge every nine points reads as a column of text
// that went wrong rather than as a field. The last line is left natural: it is
// the only one that could not be filled, and stretching it would be the one
// place in the field a reader's eye catches.

const defs = new Map()
const uses = []
for (let n = 0; n < lines.length; n += 1) {
  const { words, natural } = lines[n]
  const gaps = words.length - 1
  const last = n === lines.length - 1
  const gap = last || gaps === 0 ? spacePt : spacePt + (blockWPt - natural) / gaps
  const y = (n + 1) * leadingPt
  let x = 0
  for (const { word, laid } of words) {
    for (const glyph of laid.glyphs) {
      const id = `${TAG[word.style]}${glyph.id}`
      if (!defs.has(id)) {
        defs.set(id, fonts[word.style].getGlyph(glyph.id).path.toSVG() ?? '')
      }
      uses.push(`<use href="#${id}" x="${(x + glyph.dx).toFixed(1)}" y="${y.toFixed(1)}"/>`)
    }
    x += laid.widthPt + gap
  }
}

const k = perUnit.toPrecision(10)
const parts = []
parts.push(
  `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ${sheetWPt.toFixed(2)} ${sheetHPt.toFixed(2)}" width="${sheetWPt.toFixed(0)}" height="${sheetHPt.toFixed(0)}">`
)
parts.push('<defs>')
for (const [id, d] of defs) {
  parts.push(`<g id="${id}" transform="scale(${k},-${k})"><path d="${d}"/></g>`)
}
parts.push('</defs>')
// Centred on the sheet and turned: the block is its own bounding box, so
// turning it about the sheet's centre leaves no corner uncovered.
parts.push(
  `<g fill="#000000" transform="translate(${(sheetWPt / 2).toFixed(2)},${(sheetHPt / 2).toFixed(2)}) rotate(${angleDeg}) translate(${(-blockWPt / 2).toFixed(2)},${(-blockHPt / 2).toFixed(2)})">`
)
parts.push(uses.join(''))
parts.push('</g></svg>')

const svg = parts.join('\n')
writeFileSync(outPath, svg)

const kb = (svg.length / 1024).toFixed(0)
console.log(
  `${outPath}: ${lines.length} lines of ${faceName} at ${sizePt}pt, ${used} words, ` +
    `${uses.length} glyphs from ${defs.size} outlines, ${kb} KB` +
    (missing > 0 ? ` (${missing} glyphs the face has no outline for, left out)` : '')
)
