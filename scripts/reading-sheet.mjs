#!/usr/bin/env node
/**
 * The editor's reading, sorted into what each mark is.
 *
 * `apple-notes.mjs` gets the marks off a Books notes summary; this turns
 * them into the sheet a person reads. The two are separate because the
 * **sort is a judgement** — is this a fault in the text, a footnote to be
 * cut, a thing to go and research — and a judgement belongs in a file on
 * the shelf rather than in a script's head. So `reading/marks.json` beside
 * the book carries every mark with its class and, where one was reached,
 * the verdict; this writes `reading-notes.md` from it.
 *
 * That split is the lesson `corrections.md` already paid for. Its entries
 * were built by a script in one session's scratchpad, so the first session
 * to end took the only thing that could rewrite them. A sheet nobody can
 * regenerate is a sheet that starts drifting from the book the moment it is
 * written, and `--check` is what keeps this one honest.
 *
 * Usage:
 *   node scripts/reading-sheet.mjs <book-dir> [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** The classes, in the order they are worth reading, with what each means. */
const SECTIONS = [
  [
    'fix',
    'Faults in the text',
    'Checked against the paper before anything was changed. The pixels are the accepter here, not the book’s own word counts — on this volume they moved three of the answers.'
  ],
  [
    'apparatus',
    'Apparatus to cut or rewrite',
    'Footnotes, glossary entries and introduction prose the editor has asked to be dropped, verified or reworked. None of it needs him again before it is done.'
  ],
  [
    'write',
    'Research, then a footnote',
    'Each wants a source before a word is written. The draft is the assistant’s; the claim is the editor’s to check, because a footnote asserting something a reader can look up is the one place this edition can be caught out.'
  ],
  [
    'answer',
    'Answered from the book',
    'Questions the volume or a measurement settles. Most imply no change; where one does, it is listed under a heading above.'
  ],
  ['yours', 'Yours to decide', 'Nothing here is the assistant’s to settle.'],
  [
    'unclear',
    'Marked, with nothing said',
    'Highlights carrying no note. The passage alone does not say what the fault is.'
  ]
]

function sheet(record) {
  const { marks } = record
  const by = new Map(SECTIONS.map(([key]) => [key, []]))
  for (const mark of marks) {
    const list = by.get(mark.class)
    if (!list) throw new Error(`mark ${mark.n}: unknown class ${JSON.stringify(mark.class)}`)
    list.push(mark)
  }

  const revised = marks.filter((m) => m.where === 'not-in-export')
  const unplaced = marks.filter((m) => m.where === 'unplaced')
  const moved = marks.filter((m) => m.where === 'moved')

  let md = `# The editor's reading of this volume

${marks.length} marks, made in Apple Books on an exported PDF and read back by
\`apple-notes.mjs\`. The marks themselves, with the class each was sorted into,
are in \`reading/marks.json\`; the export they were made on is
\`reading/apple-books-notes.pdf\`. This file is written from both and is not
the record — \`reading-sheet.mjs --check\` says whether it still matches.

`
  md += `Measured against \`${record.against}\`: **${marks.length - revised.length - unplaced.length - moved.length} of ${marks.length} land on the folio the note names**`
  md += moved.length > 0 ? `, ${moved.length} on another` : ' and none has moved'
  md += `. ${revised.length === 0 ? 'Every passage is still in the export.' : `${revised.length} are not in this export at all — all of them prose reworded since the copy that was read, and each note still applies to the passage it was made on.`}`
  if (unplaced.length > 0) {
    md += ` ${unplaced.length} could not be placed and ${unplaced.length === 1 ? 'is' : 'are'} answered below.`
  }
  md += `\n\n| | |\n| --- | ---: |\n`
  for (const [key, title] of SECTIONS) md += `| ${title} | ${by.get(key).length} |\n`
  md += `| **Total** | **${marks.length}** |\n`

  for (const [key, title, blurb] of SECTIONS) {
    md += `\n---\n\n## ${title}\n\n${blurb}\n`
    for (const mark of by.get(key)) {
      const aside =
        mark.where === 'not-in-export'
          ? ' *(the prose has been reworded since)*'
          : mark.where === 'unplaced'
            ? ' *(not located in the export)*'
            : mark.where === 'moved'
              ? ` *(found on folio ${mark.pdfPages?.join(', ')})*`
              : ''
      md += `\n### ${mark.n}. Folio ${mark.folio}${aside}\n\n`
      md += `> ${(mark.around ?? mark.quote).replace(/\s+/gu, ' ').trim()}\n\n`
      md += mark.note ? `**The note.** ${mark.note}\n` : `**No note.**\n`
      if (mark.verdict) md += `\n${mark.verdict}\n`
    }
  }
  return md
}

const [dir, ...flags] = process.argv.slice(2)
if (!dir) {
  console.error('node scripts/reading-sheet.mjs <book-dir> [--check]')
  process.exit(2)
}
const record = JSON.parse(readFileSync(resolve(dir, 'reading/marks.json'), 'utf8'))
const built = sheet(record)
const out = resolve(dir, 'reading-notes.md')

if (flags.includes('--check')) {
  let current = null
  try {
    current = readFileSync(out, 'utf8')
  } catch {
    /* not written yet */
  }
  if (current === built) {
    console.log(`  ok      reading-notes.md  (${record.marks.length} marks)`)
    process.exit(0)
  }
  console.log(
    `  STALE   reading-notes.md  — ${current === null ? 'missing' : 'differs from reading/marks.json'}`
  )
  process.exit(1)
}
writeFileSync(out, built)
console.log(`  written reading-notes.md  (${record.marks.length} marks)`)
