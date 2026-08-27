#!/usr/bin/env node
/**
 * The readable files on the shelf, regenerated from the book they describe.
 *
 * A book file is the source. `glossary.md` and `introduction.md` are views of
 * it, and `corrections.md` and `notes.md` make counted claims about it. All
 * four are written by hand at some point and then drift, because updating a
 * derived file is a habit and habits skip: the reading directions were taken
 * out of two glossaries, both books were re-exported, and `glossary.md` kept
 * every one of them for a reader to find.
 *
 *   node scripts/book-files.mjs <book-dir>            rewrite what is derivable
 *   node scripts/book-files.mjs <book-dir> --check    report drift, write nothing
 *   node scripts/book-files.mjs <book-dir> --marks <body.json>
 *                                                     and check the glossary
 *                                                     marks against the body
 *
 * `--marks` wants what `drive.mjs body <out.json>` writes, because the marks
 * live in the *assembled* text and that only exists in the browser.
 *
 * `--check` exits non-zero when anything is out of date, so it belongs in the
 * same list as the tests rather than in somebody's memory.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

const [dir, ...flags] = process.argv.slice(2)
if (!dir) {
  console.error('usage: node scripts/book-files.mjs <book-dir> [--check]')
  process.exit(2)
}
const check = flags.includes('--check')

const book = JSON.parse(readFileSync(join(dir, 'book.json'), 'utf8'))
const edits = book.run?.edits ?? []
const sections = edits.filter((e) => e.kind === 'section')
const notes = edits.filter((e) => e.kind === 'note')
const marks = edits
  .filter((e) => e.kind === 'text')
  .reduce((n, e) => n + [...(e.text ?? '')].filter((c) => c === '°').length, 0)

/**
 * The section's own notation, in markdown.
 *
 * A paragraph that is *nothing but* a bold run is a sub-heading in the printed
 * book and is one here too. Rendering it as bold text instead would flatten
 * the shape of a long introduction into an undifferentiated wall.
 */
const md = (s) => s.replace(/<b>(.*?)<\/b>/g, '**$1**').replace(/<i>(.*?)<\/i>/g, '*$1*')

const para = (p) =>
  /^\s*<b>[^<]*<\/b>\s*$/.test(p) ? `## ${p.replace(/<\/?b>/g, '').trim()}` : md(p)

/**
 * The title and the one-line description a person wrote at the top of the file.
 *
 * Kept rather than rebuilt. "Set as back matter, and covering both books" is
 * true of one volume and not the other, and no amount of reading `book.json`
 * would recover it: it is an editor's sentence about the edition, and a
 * generator that overwrote it every run would quietly make every book's files
 * say the same bland thing.
 */
const keepHead = (path, fallbackTitle) => {
  if (!existsSync(path)) return `# ${fallbackTitle}\n`
  // The title, and the italic line under it if there is one. Not everything
  // down to the rule: the glossary's preamble lives there too, and that is
  // content, rebuilt from the book rather than kept.
  const lines = readFileSync(path, 'utf8').split('\n')
  if (!lines[0]?.startsWith('#')) return `# ${fallbackTitle}\n`
  const sub = lines.findIndex((l, i) => i > 0 && /^\*.*\*$/.test(l.trim()))
  const end = sub > 0 ? sub + 1 : 1
  return lines.slice(0, end).join('\n').trimEnd() + '\n'
}

const derived = []
const glossary = sections.find((s) => s.title === 'Glossary')
if (glossary) {
  const paras = glossary.text.split('\n').filter((p) => p.trim().length > 0)
  const entries = paras.filter((p) => /^\s*<b>/.test(p))
  const preamble = paras.filter((p) => !/^\s*<b>/.test(p))
  // The head holds the title and its description; the preamble is content and
  // is rebuilt, which is the whole point — it is what went stale.
  const head = keepHead(join(dir, 'glossary.md'), 'Glossary').trimEnd()
  derived.push({
    name: 'glossary.md',
    body: `${head}\n\n${preamble.map(md).join('\n\n')}\n\n---\n\n${entries.map(para).join('\n\n')}\n`,
    note: `${entries.length} entries`
  })
}
const intro = sections.find((s) => s.sectionId === 'intro' || s.placement === 'front')
if (intro) {
  const body = intro.text.split('\n').filter((p) => p.trim().length > 0)
  derived.push({
    name: 'introduction.md',
    body: `${keepHead(join(dir, 'introduction.md'), intro.title).trimEnd()}\n\n---\n\n${body.map(para).join('\n\n')}\n`,
    note: `${body.length} paragraphs`
  })
}

let stale = 0

// A section is split into paragraphs on *blank* lines (`paragraphsOf` in
// `@core/edits`), so prose written with one newline between paragraphs is
// joined into a single block and prints as a wall — sixteen paragraphs of
// introduction set as one unbroken page and a half, with no indent to say
// where a thought ends. Nothing downstream can tell that from a wall somebody
// meant, which is why it survived every export: the page count was right, no
// note was dropped, and the text extracted correctly. What gives it away is
// the shape of the record rather than the shape of the page — newlines, but
// never two in a row.
for (const s of sections) {
  if (!s.text.includes('\n') || /\n\s*\n/u.test(s.text)) continue
  stale += 1
  console.log(
    `  WALL    ${s.sectionId}  — ${s.text.split('\n').filter((l) => l.trim()).length} lines and no ` +
      `blank line between them, so this sets as one paragraph`
  )
}
for (const { name, body, note } of derived) {
  const path = join(dir, name)
  const had = existsSync(path) ? readFileSync(path, 'utf8') : null
  if (had === body) {
    console.log(`  ok      ${name}  (${note})`)
    continue
  }
  stale += 1
  if (check) console.log(`  STALE   ${name}  (${note}) — differs from book.json`)
  else {
    writeFileSync(path, body)
    console.log(`  written ${name}  (${note})`)
  }
}

/**
 * The two files that cannot be regenerated here, because each entry quotes the
 * assembled body and that lives in the browser. Their *counts* are checkable,
 * and a count that has gone stale is the signal that the prose has too.
 */
const claim = (file, re) => {
  const path = join(dir, file)
  if (!existsSync(path)) return null
  const m = readFileSync(path, 'utf8').match(re)
  return m ? Number(m[1]) : null
}
const claimed = [
  ['notes.md', /(\d+)\s+footnotes/, notes.length, 'footnotes'],
  ['notes.md', /(\d+)\s+words in the two books carry/, marks, 'glossary marks'],
  ['corrections.md', /A further (\d+) changes/, marks, 'glossary marks']
]
for (const [file, re, actual, what] of claimed) {
  const said = claim(file, re)
  if (said === null) continue
  if (said === actual) console.log(`  ok      ${file}  says ${said} ${what}`)
  else {
    stale += 1
    console.log(`  STALE   ${file}  says ${said} ${what}, book.json has ${actual}`)
  }
}

/**
 * The mark on a word is the only thing telling a reader an entry exists, and
 * nothing else in the program reports its absence. Needs the assembled body,
 * so it is opt-in rather than part of the default run.
 */
const bodyArg = flags[flags.indexOf('--marks') + 1]
if (flags.includes('--marks') && bodyArg && !bodyArg.startsWith('--')) {
  const { checkGlossaryMarks } = await import('../src/core/annotate/marks.ts')
  const body = JSON.parse(readFileSync(bodyArg, 'utf8'))
  const heads = (glossary?.text ?? '')
    .split('\n')
    .map((p) => /^\s*<b>(.+?)<\/b>/.exec(p)?.[1])
    .filter((h) => typeof h === 'string')
  const report = checkGlossaryMarks(heads, body.edited ?? body)
  console.log(
    `  marks   ${report.marked.length} marked, ${report.unmarked.length} unmarked, ` +
      `${report.absent.length} not used by the book`
  )
  for (const v of report.unmarked) {
    stale += 1
    console.log(`  UNMARKED  ${v.entry}  — "${v.term}" is in ${v.blockId} with no circle on it`)
  }
  for (const v of report.absent)
    console.log(`  ok        ${v.entry}  — the book never uses the word`)
}

console.log(`${basename(dir)}: ${stale === 0 ? 'in step with book.json' : `${stale} out of date`}`)
if (check && stale > 0) process.exitCode = 1
