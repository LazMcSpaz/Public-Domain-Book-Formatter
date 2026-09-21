#!/usr/bin/env node
/**
 * Look a term up in Blavatsky's own words.
 *
 * The glossaries this shelf prints define occult vocabulary, and which
 * authority stands behind a definition is an editorial decision the editor
 * has made: **Blavatsky, not Leadbeater or Besant.** That decision is only
 * usable if her words can be found, and until now they could not be — the
 * material sat on the shelf as page images.
 *
 * ## Why the search is on letters alone
 *
 * Four of the six sources are somebody's OCR, and each breaks words its own
 * way. The Secret Doctrine's Acrobat layer sets `M anas`, `t h e`, `Atm a`;
 * the Google scan of the 1892 Glossary reads `Linga Shariva` for *Sharira*
 * and `Kama-ritpa` for *Kama-rupa*. An exact search for "Linga Sharira"
 * returns **nothing** across 800,000 words that plainly contain it. So both
 * sides are reduced to letters — the same argument `locateQuote` makes about
 * a query raised on a word OCR got wrong, and the same reduction the Apple
 * notes locator uses.
 *
 * What that cannot fix is a word OCR broke *inside*: `Shariva` will never
 * match `sharira` however it is reduced. That is the reason for keeping six
 * sources rather than one, and the reason a nil result is reported as "not
 * found in these files" rather than "not in Blavatsky".
 *
 * ## What the sources are, and what they are worth
 *
 * `isis-vol1` is the only one that is **not** OCR: 628 leaves read through
 * this pipeline, corrected and ruled on. Everything else is a text layer or
 * a Tesseract pass, which makes it a source to write *from* and never one to
 * quote without checking the pixels. `reference/SOURCES.md` on the shelf says
 * which is which, and this prints it beside every hit.
 *
 * Usage:
 *   node scripts/blavatsky.mjs <term> [--source <name>] [--limit <n>] [--chars <n>]
 *   node scripts/blavatsky.mjs --headword <term>      # the 1892 Glossary's own entry
 *   node scripts/blavatsky.mjs --list
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SHELF = process.env.SHELF ?? '/home/user/Public-Domain-Books-Storage'
const DIR = join(SHELF, 'reference', 'blavatsky')

/** Letters only, both sides. See the note above. */
const letters = (s) => s.toLowerCase().replace(/[^a-z]+/gu, '')

/** A file, reduced once, with a map back to where each letter came from. */
function load(name) {
  const raw = readFileSync(join(DIR, name), 'utf8')
  const at = []
  let flat = ''
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c >= 'a' && c <= 'z') {
      flat += c
      at.push(i)
    } else if (c >= 'A' && c <= 'Z') {
      flat += c.toLowerCase()
      at.push(i)
    }
  }
  return { name: name.replace(/\.txt$/, ''), raw, flat, at }
}

/** The page marker in force at a raw offset — the citation for a hit. */
function whereIn(raw, offset) {
  const before = raw.lastIndexOf('\f[', offset)
  if (before < 0) return null
  const end = raw.indexOf(']', before)
  return end < 0 ? null : raw.slice(before + 2, end)
}

function search(source, term, { limit, chars }) {
  const needle = letters(term)
  if (needle.length < 3) throw new Error('a term needs at least three letters')
  const hits = []
  let i = source.flat.indexOf(needle)
  while (i >= 0) {
    const start = source.at[i]
    const stop = source.at[Math.min(i + needle.length - 1, source.at.length - 1)]
    hits.push({
      where: whereIn(source.raw, start),
      quote: source.raw
        .slice(Math.max(0, start - Math.floor(chars / 3)), stop + Math.floor((chars * 2) / 3))
        .replace(/\f\[[^\]]*\]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
    })
    if (hits.length >= limit) break
    i = source.flat.indexOf(needle, i + 1)
  }
  return hits
}

/**
 * The 1892 Glossary's own entry for a term.
 *
 * That book is a dictionary, and the obvious implementation — entries open a
 * line, so match at a line start — is wrong here and passed nothing. The OCR
 * hands back **one line per leaf**, so every entry on a page is run together
 * in a single string and no entry begins a line at all.
 *
 * What does distinguish a definition was read off the file rather than
 * guessed at. Every real entry is **preceded by a full stop and a space**
 * and **begins with a capital**, because it follows the end of the entry
 * before it: `…the constellation Virgo. Astral Body, or Astral "Double". The
 * ethereal counterpart…`, `…[w. w. w.]. Akasa (Sk.). The subtle…`. A passing
 * mention has neither — `…after its separation from Kama Rupa, and the
 * disintegration…` is mid-sentence, and `…the astral body. Theurgic is…` is
 * lower case. Two earlier rules failed against this data and both were
 * discarded: matching at a line start finds nothing, because the OCR hands
 * back one line per leaf and every entry on a page runs together; and
 * "punctuation then a capital after the term" scores the sentence boundary
 * in that last example as a headword.
 */
function headword(term, { chars }) {
  const file = join(DIR, 'theosophical-glossary.txt')
  if (!existsSync(file)) throw new Error('the 1892 Glossary is not in reference/blavatsky')
  const source = load('theosophical-glossary.txt')
  const needle = letters(term)
  const found = []
  let i = source.flat.indexOf(needle)
  while (i >= 0) {
    const from = source.at[i]
    const to = source.at[Math.min(i + needle.length - 1, source.at.length - 1)] + 1
    const before = source.raw.slice(Math.max(0, from - 3), from)
    const defines = /\.\s$/u.test(before) && /^[A-Z]/u.test(source.raw.slice(from, from + 1))
    found.push({
      defines,
      where: whereIn(source.raw, from),
      entry: source.raw
        .slice(from, from + chars)
        .replace(/\f\[[^\]]*\]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
    })
    i = source.flat.indexOf(needle, i + 1)
  }
  return found.sort((a, b) => Number(b.defines) - Number(a.defines))
}

const args = process.argv.slice(2)
/** The flags that take a value. `--headword` and `--list` are not among them. */
const TAKES_A_VALUE = new Set(['--source', '--limit', '--chars'])
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
// Anything not a flag, and not the value of one. Distinguishing the two by
// "the previous argument began with --" swallowed the term after every
// boolean flag, so `--headword "astral body"` listed the sources instead.
const terms = args.filter((a, i) => !a.startsWith('--') && !TAKES_A_VALUE.has(args[i - 1]))

if (!existsSync(DIR)) {
  console.error(`no reference corpus at ${DIR}`)
  process.exit(2)
}
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.txt'))
  .sort()

if (args.includes('--list') || terms.length === 0) {
  const notes = existsSync(join(SHELF, 'reference', 'SOURCES.md'))
    ? readFileSync(join(SHELF, 'reference', 'SOURCES.md'), 'utf8')
    : ''
  for (const f of files) {
    const size = readFileSync(join(DIR, f), 'utf8').length
    const tag = new RegExp(`\`${f.replace(/\.txt$/, '')}\`[^|]*\\|([^|]*)\\|`, 'u').exec(notes)
    console.log(
      `  ${f.replace(/\.txt$/, '').padEnd(26)} ${(size / 1e6).toFixed(2)}M chars${tag ? '  ' + tag[1].trim() : ''}`
    )
  }
  if (terms.length === 0) console.log('\n  node scripts/blavatsky.mjs "linga sharira"')
  process.exit(0)
}

const term = terms.join(' ')
const chars = Number(flag('--chars', 320))
const limit = Number(flag('--limit', 6))
const only = flag('--source', null)

if (args.includes('--headword')) {
  const found = headword(term, { chars })
  if (found.length === 0) {
    console.log(`No headword in the 1892 Glossary starts with “${term}”.`)
    console.log('That is a statement about these files, not about Blavatsky: OCR breaks words.')
    process.exit(0)
  }
  const defining = found.filter((f) => f.defines)
  const shown = defining.length > 0 ? defining : found
  if (defining.length === 0) console.log(`No entry opens on “${term}”. Mentions, best first:\n`)
  for (const f of shown.slice(0, limit)) console.log(`■ [${f.where ?? '?'}] ${f.entry}\n`)
  process.exit(0)
}

let total = 0
for (const f of files) {
  if (only && !f.startsWith(only)) continue
  const source = load(f)
  const hits = search(source, term, { limit, chars })
  if (hits.length === 0) continue
  total += hits.length
  console.log(
    `\n■ ${source.name}${hits.length >= limit ? `  (first ${limit})` : `  (${hits.length})`}`
  )
  for (const h of hits) console.log(`   [${h.where ?? '?'}] ${h.quote}`)
}
if (total === 0) {
  console.log(`“${term}” is not in these files.`)
  console.log('Four of the six are OCR and break words their own way, so this is a')
  console.log('statement about the files rather than about Blavatsky.')
}
