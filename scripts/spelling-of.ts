/**
 * Every word a shelf book uses that no dictionary knows, graded by how alone
 * it stands — the check KDP runs on a submitted interior.
 *
 *   npx vite-node --config vitest.config.ts scripts/spelling-of.ts <book.json> [--shelf <books-dir>] [--out <file.md>]
 *
 * `--shelf` points at the shelf's `books/` directory; every other book there,
 * and the `reference/` texts beside it, become the second filter: a word the
 * dictionary lacks but the shelf uses is a term, not a fault. Without it only
 * the dictionary filters, and the list is three times as long.
 *
 * The output is a sheet to read, never a gate: each word with its count here,
 * its count on the shelf, and the words around its first use. Names are
 * listed apart (every use capitalised), because they are the bulk of what an
 * English dictionary does not know and the least likely to be wrong.
 *
 * The dictionary is `word-list`, 274,000 English words, a development
 * dependency: this runs under Node over `books/*` and never in the page.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { assembleBook } from '@core/assemble'
import { applyEdits } from '@core/edits'
import { checkSpelling, spellingTokens, type SpellingSuspect } from '@core/coherence'

const args = process.argv.slice(2).filter((a) => !a.includes('spelling-of'))
const flag = (name: string): string | null => {
  const i = args.indexOf(name)
  return i === -1 ? null : (args[i + 1] ?? null)
}
const bookPath = args.find((a) => a.endsWith('book.json'))
if (!bookPath) throw new Error('spelling-of.ts <book.json> [--shelf <books-dir>] [--out <file.md>]')
const shelfDir = flag('--shelf')
const outPath = flag('--out')

const wordsFile = join(
  dirname(new URL(import.meta.url).pathname),
  '..',
  'node_modules',
  'word-list',
  'words.txt'
)
const dictionary = new Set(readFileSync(wordsFile, 'utf8').split('\n'))

/** The words of a book file's whole text, body, notes and the editor's sections. */
function textsOf(path: string): { id: string; text: string }[] {
  const file = JSON.parse(readFileSync(path, 'utf8'))
  const doc = applyEdits(assembleBook(file.run.transcriptions), file.run.edits ?? [])
  return [
    ...doc.blocks.map((b) => ({ id: b.id, text: b.text })),
    ...doc.footnotes.map((n, i) => ({ id: `fn${i + 1}`, text: n.text })),
    ...(doc.sections ?? []).flatMap((s) => s.blocks.map((b) => ({ id: b.id, text: b.text })))
  ]
}

// The rest of the shelf, as a word count: every other book's text, and the
// reference texts, so a term shared with Blavatsky's own glossary is known.
const shelf = new Map<string, number>()
const count = (text: string): void => {
  for (const w of spellingTokens(text)) {
    const k = w.toLowerCase()
    shelf.set(k, (shelf.get(k) ?? 0) + 1)
  }
}
if (shelfDir) {
  const mine = resolve(dirname(bookPath))
  for (const dir of readdirSync(shelfDir)) {
    const other = join(shelfDir, dir, 'book.json')
    if (resolve(dirname(other)) === mine || !existsSync(other)) continue
    for (const t of textsOf(other)) count(t.text)
  }
  const reference = join(shelfDir, '..', 'reference')
  if (existsSync(reference)) {
    for (const dir of readdirSync(reference)) {
      const sub = join(reference, dir)
      let files: string[] = []
      try {
        files = readdirSync(sub).filter((f) => f.endsWith('.txt'))
      } catch {
        continue
      }
      for (const f of files) count(readFileSync(join(sub, f), 'utf8'))
    }
  }
}

const report = checkSpelling(textsOf(bookPath), dictionary, shelf)
const name = basename(dirname(bookPath))
const names = report.alone.filter((s) => s.capitalised)
const words = report.alone.filter((s) => !s.capitalised)

const row = (s: SpellingSuspect): string =>
  `| \`${s.word}\` | ${s.count} | ${s.shelf} | \`${s.blockId}\` | ${s.context.replace(/\|/g, '\\|')} |`
const table = (xs: SpellingSuspect[]): string =>
  xs.length
    ? [
        '| word | here | shelf | block | context |',
        '| --- | ---: | ---: | --- | --- |',
        ...xs.map(row)
      ].join('\n')
    : '_none_'

const md = `# Spelling: ${name}

${report.vocabulary} distinct words; ${report.alone.length + report.repeated.length} unknown to the dictionary; **${report.alone.length} alone** (once here, under three times on the shelf), ${report.repeated.length} used again.

A list to read, not a gate. A word here is one the dictionary lacks and the shelf does not vouch for; whether it is a fault, a coinage or the author's own spelling is the editor's call, and the context is there to make it a quick one.

## Words (${words.length})

${table(words)}

## Names (${names.length})

Every use capitalised. Most are people and places; read for the ones that are not.

${table(names)}
`
if (outPath) writeFileSync(outPath, md)
console.log(
  JSON.stringify(
    {
      book: name,
      vocabulary: report.vocabulary,
      unknown: report.alone.length + report.repeated.length,
      alone: report.alone.length,
      words: words.length,
      names: names.length,
      wrote: outPath
    },
    null,
    2
  )
)
if (!outPath) {
  for (const s of words) console.log(`${s.word.padEnd(22)} ${s.blockId.padEnd(10)} ${s.context}`)
}
