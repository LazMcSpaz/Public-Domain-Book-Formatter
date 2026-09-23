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
 *   node scripts/book-files.mjs <book-dir> --finish   every condition for "done",
 *                                                     named, with a non-zero exit
 *   node scripts/book-files.mjs --shelf <books-dir>   one row per book: what each
 *                                                     has and what it is missing
 *
 * `--marks` wants what `drive.mjs body <out.json>` writes, because the marks
 * live in the *assembled* text and that only exists in the browser.
 *
 * `--check` exits non-zero when anything is out of date, so it belongs in the
 * same list as the tests rather than in somebody's memory.
 */
import { register } from 'node:module'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

// Core modules import each other, and Node resolves neither the `@core`
// alias nor an extensionless path; this hook does. See `resolve-ts.mjs`.
register('./resolve-ts.mjs', import.meta.url)

const [dir, ...flags] = process.argv.slice(2)
if (!dir) {
  console.error('usage: node scripts/book-files.mjs <book-dir> [--check|--finish]')
  console.error('       node scripts/book-files.mjs --shelf <books-dir>')
  process.exit(2)
}

/**
 * One row per book on the shelf, so "has this book got the apparatus the last
 * one got?" is a question something answers.
 *
 * CLAUDE.md asks it in those words and calls it an unchecked habit, and the
 * habit duly skipped: _Clairvoyance_ carried 85 glossary marks and the
 * combined volume carried a 74-entry glossary with not one mark, and nothing
 * anywhere said so. The check that catches it cannot live inside one book,
 * because the fault is a *difference between* books — so it lives here, and
 * its whole job is to put the shelf in one table where a gap is a hole in a
 * column.
 *
 * It judges nothing. Not every book wants a glossary, and a row of dashes is
 * a fact rather than a fault; what it stops is the gap being invisible.
 */
if (dir === '--shelf') {
  const root = flags[0]
  if (!root) {
    console.error('usage: node scripts/book-files.mjs --shelf <books-dir>')
    process.exit(2)
  }
  const { readdirSync } = await import('node:fs')
  const { ledgerNumbers } = await import('../src/core/project/ledger.ts')
  const books = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
  const rows = []
  for (const name of books) {
    const bookPath = join(root, name, 'book.json')
    if (!existsSync(bookPath)) {
      rows.push({ name, missing: 'no book.json' })
      continue
    }
    const n = ledgerNumbers(JSON.parse(readFileSync(bookPath, 'utf8')))
    const has = (f) => (existsSync(join(root, name, f)) ? '·' : ' ')
    rows.push({
      name,
      done: n.complete ? '·' : ' ',
      ledger: has('ledger.md'),
      corrections: has('corrections.md'),
      rulings: has('rulings.md'),
      notes: n.footnotes + n.editorNotes > 0 ? '·' : ' ',
      glossary: n.sections.some((t) => /glossar/iu.test(t)) ? '·' : ' ',
      front: n.front ? '·' : ' ',
      marked: n.marked > 0 ? '·' : ' ',
      facts: n.facts > 0 ? '·' : ' ',
      // The route, or a question mark: a book whose shape nobody recorded
      // cannot say which checks applied to it.
      route: n.route ?? '?'
    })
  }
  const width = Math.max(...rows.map((r) => r.name.length))
  const cols = [
    'done',
    'ledger',
    'corrections',
    'rulings',
    'notes',
    'glossary',
    'front',
    'marked',
    'facts',
    'route'
  ]
  console.log(`${'book'.padEnd(width)}  ${cols.join('  ')}`)
  for (const r of rows) {
    if (r.missing) {
      console.log(`${r.name.padEnd(width)}  ${r.missing}`)
      continue
    }
    console.log(`${r.name.padEnd(width)}  ${cols.map((c) => r[c].padEnd(c.length)).join('  ')}`)
  }
  const readable = rows.filter((r) => !r.missing)
  const noLedger = readable.filter((r) => r.ledger !== '·')
  const unreadable = rows.length - readable.length
  console.log(
    `\n${readable.length} books · ${readable.length - noLedger.length} with a ledger` +
      (noLedger.length === 0 ? '' : ` · ${noLedger.length} without`) +
      (unreadable === 0 ? '' : ` · ${unreadable} directory without a book.json`)
  )
  process.exit(0)
}

const finish = flags.includes('--finish')
const check = flags.includes('--check') || finish

const book = JSON.parse(readFileSync(join(dir, 'book.json'), 'utf8'))
const edits = book.run?.edits ?? []
const sections = edits.filter((e) => e.kind === 'section')
const notes = edits.filter((e) => e.kind === 'note')
const highlights = edits.filter((e) => e.kind === 'highlight')
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

// `notes.md` is written by hand and holds each note's prose verbatim, so it
// drifts the moment a note is revised in the book file — and it drifts
// silently, because the count at the top stays right while the words under it
// go stale. That is the same failure the reading directions had: a file that
// still says the true number of a thing it now describes wrongly. Assembling
// the book to rebuild the file whole needs a browser-free vite load and is a
// bigger job; checking that every note's own words are in there needs neither.
const notesPath = join(dir, 'notes.md')
if (notes.length > 0 && existsSync(notesPath)) {
  const written = readFileSync(notesPath, 'utf8')
  for (const n of notes) {
    if (written.includes(md(n.text))) continue
    stale += 1
    console.log(`  DRIFTED notes.md  is missing the note on ${n.blockId} as the book now words it`)
  }
}

// `reading.md` is the same case as `notes.md`, and for the same reason: each
// row quotes the *assembled* body with a dozen words either side, and that only
// exists in the browser — `drive.mjs reading reading.md` is what writes it,
// from the one renderer in `@core/edits`. What is checkable without a browser
// is that every passage the editor marked is still named in the file, and that
// the count at the top is true. Both go stale the moment a reading session
// happens and the file is not rewritten, which is the ordinary way this drifts.
const readingPath = join(dir, 'reading.md')
if (highlights.length > 0 && existsSync(readingPath)) {
  const written = readFileSync(readingPath, 'utf8')
  for (const h of highlights) {
    if (written.includes(md(h.quote))) continue
    stale += 1
    console.log(`  DRIFTED reading.md  is missing the passage marked on ${h.blockId}`)
  }
} else if (highlights.length > 0) {
  stale += 1
  console.log(
    `  MISSING reading.md  — ${highlights.length} passages are marked in book.json and ` +
      'nothing on the shelf says so. `drive.mjs reading reading.md` writes it.'
  )
}

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
  ['corrections.md', /A further (\d+) changes/, marks, 'glossary marks'],
  // Written unfiltered, so this is the whole reading rather than one tag's
  // brief — `reading --tag intro` is for handing to a writer, not for the shelf.
  ['reading.md', /(\d+)\s+passages marked/, highlights.length, 'marked passages']
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
  const { checkGlossaryMarks, glossaryHeadwords } = await import('../src/core/annotate/marks.ts')
  const body = JSON.parse(readFileSync(bodyArg, 'utf8'))
  // Through the same extractor the galley's coverage panel uses — one rule,
  // or the shelf report and the editor would drift into disagreeing.
  const heads = glossaryHeadwords(glossary?.text ?? '')
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

/**
 * The entries of `corrections.md`, against the body. Every entry quotes the
 * assembled text, so this too needs a body handed in (`drive.mjs body`);
 * given one, the same derivation `drive.mjs corrections` writes with is run
 * here and the file compared to it, prose kept, counts included. Without
 * `--check` the file is rewritten.
 */
const corrArg = flags[flags.indexOf('--body') + 1]
if (flags.includes('--body') && corrArg && !corrArg.startsWith('--')) {
  const { correctionRows, correctionsHeader, correctionsMarkdown } =
    await import('../src/core/edits/corrections-sheet.ts')
  const body = JSON.parse(readFileSync(corrArg, 'utf8'))
  const path = join(dir, 'corrections.md')
  const had = existsSync(path) ? readFileSync(path, 'utf8') : null
  const exp = book.answers?.export ?? {}
  const title = exp.title
    ? exp.seriesLine
      ? `${exp.title}*, *${exp.seriesLine}`
      : exp.title
    : basename(dir)
  const rows = correctionRows(body.pristine, body.edited)
  const text = correctionsMarkdown(correctionsHeader(had, title), rows)
  const note = `${rows.words.length} corrections, ${rows.marks.length} reference marks`
  if (had === text) console.log(`  ok      corrections.md  (${note})`)
  else {
    stale += 1
    if (check) console.log(`  STALE   corrections.md  (${note}) — entries differ from the body`)
    else {
      writeFileSync(path, text)
      console.log(`  written corrections.md  (${note})`)
    }
  }
}

/**
 * `reading-notes.md`, where the editor has read the book in another app.
 *
 * Derived from `reading/marks.json` the way every other file here is derived
 * from `book.json`, and checked for the same reason: a sheet nobody can
 * regenerate starts drifting from the book the moment it is written. Silent
 * where there is no reading, since most books have none.
 */
if (existsSync(join(dir, 'reading', 'marks.json'))) {
  const { execFileSync } = await import('node:child_process')
  const script = new URL('reading-sheet.mjs', import.meta.url).pathname
  try {
    const args = [script, dir, ...(check ? ['--check'] : [])]
    process.stdout.write(execFileSync(process.execPath, args, { encoding: 'utf8' }))
  } catch (error) {
    stale += 1
    process.stdout.write(error.stdout ?? '  STALE   reading-notes.md\n')
  }
}

/**
 * The ledger — the one derived file nothing checked, on eight books of eleven.
 *
 * Its prose is the editor's and is never touched. What is checked is the
 * generated section: a ledger whose counts disagree with the book is a score
 * sheet for a book that no longer exists, and that is worse than none, because
 * a stale number reads exactly like a true one.
 *
 * A **missing** ledger is reported on any book, and it is the finding that
 * matters — the instruction to keep one is written in three places and was
 * kept on three books.
 */
const { ledgerNumbers, ledgerSection, withLedgerSection } =
  await import('../src/core/project/ledger.ts')
const ledgerPath = join(dir, 'ledger.md')
const hadLedger = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : null
const wantLedger = withLedgerSection(hadLedger, ledgerSection(ledgerNumbers(book)))
if (hadLedger === null) {
  stale += 1
  console.log(
    '  MISSING ledger.md  — findings raised, confirmed and refuted, per book. ' +
      'Run without --check to start one; the prose is yours to write.'
  )
  if (!check) {
    writeFileSync(ledgerPath, wantLedger)
    console.log('  written ledger.md  (the numbers; the reading is yours to write)')
  }
} else if (hadLedger === wantLedger) {
  console.log('  ok      ledger.md  (its numbers match the book)')
} else {
  stale += 1
  if (check) console.log('  STALE   ledger.md  — its numbers differ from book.json')
  else {
    writeFileSync(ledgerPath, wantLedger)
    console.log('  written ledger.md  (numbers rebuilt, prose kept)')
  }
}

/**
 * The conditions for "done", named in one place so that finishing a book is
 * something a command agrees with rather than something a session remembers.
 *
 * Every one of these is a rule already written down and already skipped at
 * least once. They are gathered here because the evidence of this repository
 * is unambiguous: a check that runs gets followed and a sentence does not.
 */
if (finish) {
  const owed = []
  if (book.run?.complete !== true) owed.push('the reading is not marked complete')
  if (hadLedger === null) owed.push('there is no ledger.md')
  // The shape decides which checks apply, so a book without one cannot say
  // its checks ran. Recorded by `shape.mjs`, measured or declared.
  if (!ledgerNumbers(book).shape)
    owed.push(
      'the shape is not recorded — `node scripts/shape.mjs <book-dir> --write`, or `--declare`'
    )
  if (!existsSync(join(dir, 'corrections.md')) && (book.run?.edits ?? []).length > 0)
    owed.push('corrections were made and there is no corrections.md')
  // The editorial channel: a query nobody ruled on is a decision the book is
  // still carrying as printed, which may be right — but it must be visible.
  //
  // **Matched, not subtracted.** A ruling names its query by leaf and quote,
  // and `rulings.length` also counts standing rulings that answer a class
  // rather than a spot — so 17 raised against 15 rulings is not 2 outstanding,
  // and the first version of this said it was.
  const settled = new Set((book.run?.rulings ?? []).map((r) => `${r.pageIndex}\u0000${r.quote}`))
  const outstanding = []
  for (const t of book.run?.transcriptions ?? []) {
    for (const q of t.queries ?? []) {
      if (!settled.has(`${t.pageIndex}\u0000${q.quote}`)) outstanding.push(t.pageIndex)
    }
  }
  if (outstanding.length > 0) {
    const leaves = [...new Set(outstanding)].join(', ')
    // A query a standing ruling reaches is held, not settled: it is filed
    // when the editor approves it, at the gate or with `drive.mjs held
    // approve`. Named apart because it is a nod rather than a decision.
    const heldCount = ledgerNumbers(book).queriesHeld
    owed.push(
      `${outstanding.length} quer${outstanding.length === 1 ? 'y has' : 'ies have'} ` +
        `no ruling (leaf ${leaves})` +
        (heldCount > 0
          ? ` — ${heldCount} of them held under a standing ruling, waiting for approval`
          : '')
    )
  }
  // The paper beside every waiting decision.
  //
  // The gate's own ruling is that a query can be settled from the words and
  // the crop is a help — true, and the editor's standing requirement is that
  // he wants that help at every one of them. So cutting them is part of
  // readying a book rather than something done only for a book whose scan the
  // shelf cannot hold, which is the one case that used to force it.
  //
  // Named by `queryKey`, imported rather than reimplemented: a crop written
  // under a key the gate computes differently is a crop the gate never asks
  // for, and nothing anywhere would say it exists under another name.
  if (outstanding.length > 0) {
    const { queryKey } = await import('../src/core/queries/key.ts')
    const missing = []
    for (const t of book.run?.transcriptions ?? []) {
      for (const q of t.queries ?? []) {
        if (settled.has(`${t.pageIndex}\u0000${q.quote}`)) continue
        const key = queryKey({ pageIndex: t.pageIndex, quote: q.quote })
        if (!existsSync(join(dir, 'queries', `${key}.jpg`))) missing.push(t.pageIndex)
      }
    }
    if (missing.length > 0) {
      owed.push(
        `${missing.length} waiting quer${missing.length === 1 ? 'y has' : 'ies have'} no crop ` +
          `on the shelf (leaf ${[...new Set(missing)].join(', ')}) — ` +
          '`drive.mjs querycrops` cuts them, from a session that has the scan'
      )
    }
  }
  // The two habits CLAUDE.md names and nothing enforces. Neither can be
  // settled from the book file alone, so they are *asked* rather than judged:
  // an unanswerable question in front of a person beats a silent omission.
  const glossary = sections.find((s) => /glossar/iu.test(s.title ?? ''))
  if (glossary && !flags.includes('--marks'))
    owed.push('this book has a glossary — run with --marks <body.json> to check its marks')
  console.log('')
  if (owed.length === 0) console.log(`${basename(dir)}: finished.`)
  else {
    console.log(`${basename(dir)}: not finished —`)
    for (const o of owed) console.log(`  · ${o}`)
    process.exitCode = 1
  }
}

console.log(`${basename(dir)}: ${stale === 0 ? 'in step with book.json' : `${stale} out of date`}`)
if (check && stale > 0) process.exitCode = 1
