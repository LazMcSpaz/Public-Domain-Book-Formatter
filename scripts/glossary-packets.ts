/**
 * The evidence a glossary is written from, one packet per entry.
 *
 *   npx vite-node --config vitest.config.ts scripts/glossary-packets.ts <book.json> --shelf <shelf-dir> --out <dir>
 *       [--terms <file>] [--size 30] [--per 3] [--uses 3] [--source <dir>=<Title>[:dict]]
 *       [--alias <Term>=<Spelling>]
 *
 * For every entry of the book's glossary (or every line of `--terms`, for a
 * glossary not yet written): Blavatsky's own *Theosophical Glossary* entry,
 * the places the word stands in her other books on the shelf, and the
 * author's own sentences, circled uses first (`glossaryPacket`). Written as
 * `packet-<n>.json`, `--size` entries to a file, so each can go to one
 * writing agent, and `index.md`, which lists the entries Blavatsky defines
 * and the ones she does not: the second list is where a writer has only the
 * author and general knowledge to go on, and is the list to read hardest.
 *
 * What the packets are for is docs/PROCESS-glossary.md. The sources are the
 * shelf's own readings of her books, assembled with their corrections, so a
 * quotation taken from a packet is what this edition prints.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { assembleBook } from '@core/assemble'
import { applyEdits } from '@core/edits'
import {
  glossaryHeadwords,
  glossaryPacket,
  type GlossaryPacket,
  type SourceBook
} from '@core/annotate'

/** The tradition's books on the shelf, dictionary first, in the order to read them. */
const DEFAULT_SOURCES: { dir: string; title: string; dictionary?: boolean }[] = [
  {
    dir: 'Blavatsky-TheTheosophicalGlossary-1s37ewg',
    title: 'The Theosophical Glossary',
    dictionary: true
  },
  { dir: 'Blavatsky-TheKeyToTheosophy-1tku72n', title: 'The Key to Theosophy' },
  { dir: 'Blavatsky-TheSecretDoctrineVolI-tup', title: 'The Secret Doctrine, Vol. I' },
  { dir: 'Blavatsky-TheSecretDoctrineVolII-tup', title: 'The Secret Doctrine, Vol. II' },
  { dir: 'isis-vol1-vjj34f', title: 'Isis Unveiled, Vol. I' },
  { dir: 'Blavatsky-IsisUnveiledVolII-pq5d27', title: 'Isis Unveiled, Vol. II' }
]

/**
 * Spellings no rule folds, found on the Hall glossary: the author learnt the
 * word from a different book than the dictionary's. Add to it with
 * `--alias <Term>=<Spelling>` rather than here, unless the variant is general.
 */
const DEFAULT_ALIASES: Record<string, string[]> = {
  Cabbalist: ['Kabalist'],
  Cabbala: ['Kabalah', 'Kabala'],
  Aryan: ['Ârya'],
  Daemon: ['Daimon']
}

const args = process.argv.slice(2).filter((a) => !a.includes('glossary-packets'))
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}
const flags = (name: string): string[] =>
  args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]!] : []))
const bookPath = args.find((a, i) => a.endsWith('.json') && !args[i - 1]?.startsWith('--'))
const shelf = flag('--shelf')
const out = flag('--out')
if (!bookPath || !shelf || !out) {
  throw new Error(
    'glossary-packets.ts <book.json> --shelf <shelf-dir> --out <dir> [--terms <file>] [--size 30] [--per 3] [--uses 3] [--source <dir>=<Title>[:dict]]'
  )
}
const size = Number(flag('--size') ?? 30)
const perSource = Number(flag('--per') ?? 3)
const authorUses = Number(flag('--uses') ?? 3)

const docOf = (path: string) => {
  const run = JSON.parse(readFileSync(path, 'utf8')).run
  return { run, doc: applyEdits(assembleBook(run.transcriptions), run.edits ?? []) }
}

const aliases: Record<string, string[]> = { ...DEFAULT_ALIASES }
for (const a of flags('--alias')) {
  const [from, to] = a.split('=')
  if (from && to) aliases[from] = [...(aliases[from] ?? []), to]
}

const sourceList = [
  ...DEFAULT_SOURCES,
  ...flags('--source').map((s) => {
    const [dir, rest = ''] = s.split('=')
    const dictionary = rest.endsWith(':dict')
    return { dir: dir!, title: dictionary ? rest.slice(0, -5) : rest || dir!, dictionary }
  })
]
const sources: SourceBook[] = []
for (const s of sourceList) {
  const path = join(shelf, 'books', s.dir, 'book.json')
  if (!existsSync(path)) {
    console.warn(`  skipped  ${s.title}: no ${path}`)
    continue
  }
  sources.push({ title: s.title, dictionary: s.dictionary, blocks: docOf(path).doc.blocks })
  console.log(`  source   ${s.title}${s.dictionary ? ' (dictionary)' : ''}`)
}

const { run, doc } = docOf(bookPath)
const body = doc.blocks

// The entries to build: the glossary as it stands, or a list of terms.
let entries: { head: string; current?: string }[]
const termsFile = flag('--terms')
if (termsFile) {
  entries = readFileSync(termsFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((head) => ({ head }))
} else {
  const section = [...(run.edits ?? [])]
    .reverse()
    .find(
      (e: { kind?: string; sectionId?: string }) =>
        e.kind === 'section' && e.sectionId === 'glossary'
    ) as { text: string } | undefined
  if (!section) throw new Error('The book has no glossary section; pass --terms <file>.')
  const lines = section.text.split('\n')
  entries = glossaryHeadwords(section.text).map((head) => ({
    head,
    current: lines.find((l) => l.trimStart().startsWith(`<b>${head}</b>`))?.trim()
  }))
}

const packets: GlossaryPacket[] = entries.map((e) =>
  glossaryPacket(e.head, e.current, sources, body, { perSource, authorUses, aliases })
)

mkdirSync(out, { recursive: true })
for (let i = 0; i * size < packets.length; i++) {
  writeFileSync(
    join(out, `packet-${i + 1}.json`),
    JSON.stringify(packets.slice(i * size, (i + 1) * size), null, 1) + '\n'
  )
}
const defined = packets.filter((p) => Object.keys(p.definitions).length > 0)
const undefinedHere = packets.filter((p) => Object.keys(p.definitions).length === 0)
const unused = packets.filter((p) => p.authorUses.length === 0)
const list = (ps: GlossaryPacket[]) => ps.map((p) => `- ${p.head}`).join('\n') || '- none'
writeFileSync(
  join(out, 'index.md'),
  `# Glossary packets: ${basename(dirname(bookPath))}\n\n` +
    `${packets.length} entries in ${Math.ceil(packets.length / size)} packet(s). ` +
    `Sources: ${sources.map((s) => s.title).join('; ')}.\n\n` +
    `## Blavatsky defines it (${defined.length})\n\n${list(defined)}\n\n` +
    `## No dictionary entry (${undefinedHere.length})\n\n` +
    `Written from the author and general knowledge only. Read these hardest.\n\n${list(undefinedHere)}\n\n` +
    `## Never used in the book (${unused.length})\n\n` +
    `An entry for a word the book does not use is a candidate for the cut list.\n\n${list(unused)}\n`
)
console.log(
  `${packets.length} entries: ${defined.length} defined by the dictionary, ` +
    `${undefinedHere.length} not, ${unused.length} not used in the book → ${out}`
)
