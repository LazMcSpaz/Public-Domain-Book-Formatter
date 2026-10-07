/**
 * Fold rewritten glossary entries back into the glossary, and check them.
 *
 *   npx vite-node --config vitest.config.ts scripts/glossary-merge.ts <book.json> --out <section.txt>
 *       [--packets <dir>] [--drop "<Head>" …] <written.json> [<written.json> …]
 *
 * Each `written.json` is what a writer returns for a packet (PROCESS-glossary,
 * Stage G3): `{ "<Head>": "<b>Head.</b> …", "__preamble__": "…" }`, holding
 * only the entries it changed. The glossary as it stands in `book.json` is
 * the base, so an entry nobody rewrote is kept exactly, and the order is the
 * glossary's own. `--drop` takes an entry out (the cut list, Stage G1).
 *
 * Refuses, with a non-zero exit, what would damage the glossary: a rewritten
 * entry for a head the glossary does not have, or one that does not open on
 * its own `<b>Head.</b>`. Reports, for reading: the quotations no packet
 * carries (`quotesNotInPacket`, with `--packets`), entries over 150 words,
 * long dashes, and the entry count, which the preamble states and has to be
 * changed by hand when a cut moves it.
 *
 * Writes the section text to `--out`; nothing reaches the book until
 * `node scripts/drive.mjs section glossary --from <section.txt>`.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { glossaryHeadwords, quotesNotInPacket, type GlossaryPacket } from '@core/annotate'

const args = process.argv.slice(2).filter((a) => !a.includes('glossary-merge'))
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}
const flagged = new Set(
  args.flatMap((a, i) => (['--out', '--packets', '--drop'].includes(a) ? [i, i + 1] : []))
)
const positional = args.filter((a, i) => !flagged.has(i) && !a.startsWith('--'))
const [bookPath, ...written] = positional
const out = flag('--out')
if (!bookPath?.endsWith('.json') || !out) {
  throw new Error(
    'glossary-merge.ts <book.json> --out <section.txt> [--packets <dir>] [--drop "<Head>" …] <written.json> …'
  )
}
const drops = new Set(
  args.flatMap((a, i) => (a === '--drop' && args[i + 1] ? [bare(args[i + 1]!)] : []))
)

/** A head as compared: no tags, no final full stop, no surrounding space. */
function bare(head: string): string {
  return head
    .replace(/<\/?b>/g, '')
    .trim()
    .replace(/\.$/, '')
}
const words = (t: string) =>
  t
    .replace(/<[^>]+>/g, '')
    .split(/\s+/)
    .filter(Boolean).length

const run = JSON.parse(readFileSync(bookPath, 'utf8')).run
const section = [...(run.edits ?? [])]
  .reverse()
  .find(
    (e: { kind?: string; sectionId?: string }) => e.kind === 'section' && e.sectionId === 'glossary'
  ) as { text: string } | undefined
if (!section) throw new Error('The book has no glossary section.')

const paragraphs = section.text.split(/\n\s*\n/).map((p) => p.trim())
const firstEntry = paragraphs.findIndex((p) => p.startsWith('<b>'))
const preamble = paragraphs.slice(0, firstEntry === -1 ? paragraphs.length : firstEntry)
const entries = paragraphs.slice(firstEntry === -1 ? paragraphs.length : firstEntry)
const heads = glossaryHeadwords(entries.join('\n'))
const byHead = new Map(heads.map((h, i) => [bare(h), { head: h, text: entries[i]! }]))

const packets = new Map<string, GlossaryPacket>()
const packetDir = flag('--packets')
if (packetDir) {
  for (const f of readdirSync(packetDir).filter((f) => /^packet-\d+\.json$/.test(f))) {
    for (const p of JSON.parse(readFileSync(join(packetDir, f), 'utf8')) as GlossaryPacket[]) {
      packets.set(bare(p.head), p)
    }
  }
}

const errors: string[] = []
let newPreamble: string[] | null = null
const changed = new Map<string, string>()
for (const file of written) {
  const got = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
  for (const [key, text] of Object.entries(got)) {
    if (key === '__preamble__') {
      newPreamble = text
        .split(/\n+/)
        .map((p) => p.trim())
        .filter(Boolean)
      continue
    }
    const entry = byHead.get(bare(key))
    if (!entry) {
      errors.push(`${file}: "${key}" is not a head in this glossary`)
      continue
    }
    if (!text.trim().startsWith(`<b>${entry.head}</b>`)) {
      errors.push(`${file}: "${key}" does not open on <b>${entry.head}</b>`)
      continue
    }
    changed.set(bare(key), text.trim())
  }
}
for (const d of drops)
  if (!byHead.has(d)) errors.push(`--drop "${d}" is not a head in this glossary`)
if (errors.length > 0) {
  for (const e of errors) console.error(`  REFUSED  ${e}`)
  process.exit(1)
}

const kept = heads.filter((h) => !drops.has(bare(h)))
const merged = kept.map((h) => changed.get(bare(h)) ?? byHead.get(bare(h))!.text)
writeFileSync(out, [...(newPreamble ?? preamble), ...merged].join('\n\n') + '\n')

let flagged2 = 0
for (const h of kept) {
  const text = changed.get(bare(h))
  if (!text) continue
  const notes: string[] = []
  const n = words(text)
  if (n > 150) notes.push(`${n} words`)
  if (/[–—]/.test(text)) notes.push('long dash')
  const packet = packets.get(bare(h))
  if (packet)
    for (const q of quotesNotInPacket(text, packet)) notes.push(`quote not in packet: “${q}”`)
  if (notes.length > 0) {
    flagged2++
    for (const note of notes) console.log(`  READ     ${h}  ${note}`)
  }
}
const before = entries.reduce((s, e) => s + words(e), 0)
const after = merged.reduce((s, e) => s + words(e), 0)
console.log(
  `${changed.size} rewritten, ${drops.size} dropped, ${kept.length} entries ` +
    `(${heads.length} before); ${before} → ${after} words; ${flagged2} to read → ${out}`
)
const stated = /(\d+) (?:of them|entries)/.exec((newPreamble ?? preamble).join(' '))
if (stated && Number(stated[1]) !== kept.length) {
  console.log(`  READ     the preamble says ${stated[1]} entries; there are ${kept.length}`)
}
if (!packetDir) console.log('  (no --packets: quotations were not checked)')
console.log(`next: node scripts/drive.mjs section glossary --from ${out}`)
