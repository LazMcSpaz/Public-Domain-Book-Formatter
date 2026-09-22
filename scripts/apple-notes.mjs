#!/usr/bin/env node
/**
 * The editor's reading, back off an iPad.
 *
 * `PLAN-reading.md` says a reading is the one artefact here that cannot be
 * produced again by running something, and the reading surface exists so a
 * mark made on the tablet comes back as a `highlight` edit. This script is
 * for the case that surface does not cover: a book read in **Apple Books**,
 * on an exported PDF, and shared out as Books' own notes summary. Ninety-five
 * marks on the combined Aura/Astral volume arrived that way, and there was
 * nothing that could read them.
 *
 * Two things have to be got right, and both were measured rather than
 * guessed at.
 *
 * **The spacing is mangled, and only in the quotes.** Apple's exporter emits
 * the space glyph one character early, so `Philology takes` comes back as
 * `P hilologyt akes`: every token carries the first letter of the next word
 * on its tail. Handing each token's last character forward undoes it, and
 * the carry has to cross the line break because the export hard-wraps
 * mid-word. The editor's own typed notes are not mangled — they are told
 * apart by their **indent**, which is structural, and never by whether the
 * spelling looks wrong.
 *
 * **A highlight is truncated and cannot be matched exactly.** The tail is
 * cut, the hyphenation is the PDF's rather than the book's, and a mark is
 * often made *about* a fault — so an exact match fails hardest exactly where
 * a note is. Everything but letters is stripped from both sides and the
 * longest findable prefix is used, which is `locateQuote`'s argument. A
 * quote under `MIN_RUN` letters is never searched across the volume, only on
 * the folio its own note names: six letters match half a book.
 *
 * Usage:
 *   node scripts/apple-notes.mjs <notes.pdf> [--against <export.pdf>] [--json out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const pdfjs = await import(resolve(HERE, '../node_modules/pdfjs-dist/legacy/build/pdf.mjs'))

/** Anything left of this x is a quote or a heading; right of it, the editor's note. */
const NOTE_INDENT = 80
/** Below this many letters a quote is placed by its folio, never searched for. */
const MIN_RUN = 20

/** @param {string[]} lines */
function demangle(lines) {
  let carry = ''
  const words = []
  for (const line of lines) {
    for (const token of line.split(' ')) {
      if (token === '') continue
      const word = carry + token.slice(0, -1)
      carry = token.slice(-1)
      if (word !== '') words.push(word)
    }
  }
  // The tail carry is the last word's final letter, not a word of its own.
  if (carry !== '') {
    if (words.length > 0) words[words.length - 1] += carry
    else words.push(carry)
  }
  return words.join(' ')
}

const letters = (s) => s.toLowerCase().replace(/[^a-z]+/gu, '')

/** Every page's text, and the x and y of every line, in page order. */
async function linesOf(path) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 })
    .promise
  const lines = []
  const pageText = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pageText.push(content.items.map((it) => ('str' in it ? it.str : '')).join(''))
    const byY = new Map()
    for (const it of content.items) {
      if (!('str' in it) || it.str === '') continue
      const y = Math.round(it.transform[5])
      if (!byY.has(y)) byY.set(y, { x: Math.round(it.transform[4]), text: '' })
      byY.get(y).text += it.str
    }
    for (const y of [...byY.keys()].sort((a, b) => b - a)) lines.push({ page: i, ...byY.get(y) })
    page.cleanup()
  }
  return { lines, pageText }
}

/** Parse Books' notes summary into one record per mark. */
function parse(lines) {
  const entries = []
  let current = null
  for (const line of lines) {
    const head = /^page #\s*(\d+)\.?$/u.exec(line.text.trim())
    if (head) {
      current = { folio: Number(head[1]), quoteLines: [], noteLines: [] }
      entries.push(current)
      continue
    }
    if (!current) continue
    if (line.x < NOTE_INDENT) current.quoteLines.push(line.text)
    else current.noteLines.push(line.text)
  }
  return entries.map((e, i) => ({
    n: i + 1,
    folio: e.folio,
    quote: demangle(e.quoteLines).trim(),
    note: e.noteLines.join(' ').replace(/\s+/gu, ' ').trim()
  }))
}

/**
 * Where each mark sits in the export as it stands now.
 *
 * `on-folio` is the ordinary case and the one that says the pagination has
 * not moved. `moved` means it has. `not-in-export` means the prose the mark
 * was made on has been rewritten since — which is a fact about the reading,
 * not a failure, and is reported rather than silently dropped.
 */
function locate(entries, pageText) {
  const flat = pageText.map(letters)
  for (const e of entries) {
    const q = letters(e.quote)
    if (q.length >= MIN_RUN) {
      let hits = null
      for (let len = q.length; len >= MIN_RUN; len = Math.floor(len * 0.85)) {
        const needle = q.slice(0, len)
        const found = flat.map((p, i) => (p.includes(needle) ? i + 1 : 0)).filter(Boolean)
        if (found.length > 0) {
          hits = found
          e.matched = len
          break
        }
      }
      if (!hits) {
        e.where = 'not-in-export'
        continue
      }
      e.pdfPages = hits
      e.where = hits.includes(e.folio) ? 'on-folio' : 'moved'
      if (e.where === 'on-folio') e.around = context(pageText[e.folio - 1] ?? '', q)
      continue
    }
    // Too short to search the volume for: the note's own folio is the address.
    const around = context(pageText[e.folio - 1] ?? '', q)
    if (around === null) {
      e.where = 'unplaced'
      continue
    }
    e.where = 'on-folio'
    e.pdfPages = [e.folio]
    e.around = around
  }
  return entries
}

/** Enough of the page around the quote to recognise the place. */
function context(page, q, span = 60) {
  if (q.length < 3) return null
  const flat = letters(page)
  let at = -1
  let used = 0
  for (let len = q.length; len >= 3; len--) {
    const i = flat.indexOf(q.slice(0, len))
    if (i >= 0) {
      at = i
      used = len
      break
    }
  }
  if (at < 0) return null
  const map = []
  for (let i = 0; i < page.length; i++) if (/[a-z]/iu.test(page[i])) map.push(i)
  const from = map[Math.max(0, at - span)] ?? 0
  const to = map[Math.min(map.length - 1, at + used + span)] ?? page.length
  return page.slice(from, to).replace(/\s+/gu, ' ')
}

const [notesPath, ...rest] = process.argv.slice(2)
if (!notesPath) {
  console.error(
    'node scripts/apple-notes.mjs <notes.pdf> [--against <export.pdf>] [--json out.json]'
  )
  process.exit(2)
}
const flag = (name) => {
  const i = rest.indexOf(name)
  return i >= 0 ? rest[i + 1] : null
}

const parsed = parse((await linesOf(notesPath)).lines)
const against = flag('--against')
if (against) locate(parsed, (await linesOf(against)).pageText)

const out = flag('--json')
if (out) writeFileSync(out, JSON.stringify(parsed, null, 1))

const withNote = parsed.filter((e) => e.note !== '').length
console.log(
  `${parsed.length} marks, ${withNote} with a note, ${parsed.length - withNote} highlight only`
)
if (against) {
  const count = {}
  for (const e of parsed) count[e.where] = (count[e.where] ?? 0) + 1
  console.log(count)
  for (const e of parsed) {
    if (e.where === 'on-folio') continue
    console.log(`  ${e.where} [${e.n}] folio ${e.folio}  ${JSON.stringify(e.quote.slice(0, 60))}`)
  }
}
if (!out)
  for (const e of parsed)
    console.log(`[${e.n}] p.${e.folio}\n  ${e.quote}\n${e.note ? '  → ' + e.note + '\n' : ''}`)
