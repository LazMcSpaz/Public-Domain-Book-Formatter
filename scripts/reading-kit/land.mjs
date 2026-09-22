/**
 * Fold a stretch's reader output back into its draft and shape it for
 * `drive.mjs transcribe`.
 *
 *   node scripts/reading-kit/land.mjs <kit> <from> <to>
 *
 * Reads `<kit>/ruled-<from>-<to>.json` (the draft, rules applied) and every
 * `<kit>/done/NNN-NNN.json` the readers wrote for it; writes
 * `<kit>/batch-<from>-<to>.json` for `transcribe` and
 * `<kit>/queries-<from>-<to>.json` for `apply.mjs`. Blocks a reader emptied
 * (scanner junk) are dropped; fields `transcribe` does not know are stripped,
 * because it refuses a page carrying one. Prints every printer's-error fix,
 * which is the list `corrections-<from>-<to>.json` is written from.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [, , kit, from, to] = process.argv
if (!kit || !from || !to) {
  console.error('usage: land.mjs <kit> <from> <to>')
  process.exit(2)
}
const K = resolve(kit)
const pad = (n) => String(n).padStart(3, '0')
const tag = `${pad(from)}-${pad(to)}`
const draft = JSON.parse(readFileSync(`${K}/ruled-${tag}.json`, 'utf8'))
const byLeaf = new Map(draft.map((p) => [p.pageIndex, p]))
const PAGE = new Set([
  'pageIndex',
  'role',
  'blocks',
  'uncertain',
  'furniture',
  'queries',
  'metadata',
  'words',
  'structural'
])
const BLOCK = new Set([
  'kind',
  'text',
  'cells',
  'headerRow',
  'emphasis',
  'strong',
  'level',
  'marker',
  'continuesNext'
])
const KINDS = new Set(['printers-error', 'inconsistent', 'unclear'])
let blocks = 0
let changed = 0
let emptied = 0
const queries = []
for (let s = Number(from); s <= Number(to); s += 5) {
  const name = `${pad(s)}-${pad(Math.min(s + 4, Number(to)))}`
  for (const page of JSON.parse(readFileSync(`${K}/done/${name}.json`, 'utf8'))) {
    const target = byLeaf.get(page.leaf)
    if (!target) {
      console.error(`no draft for leaf ${page.leaf}`)
      continue
    }
    for (const b of page.blocks ?? []) {
      const slot = target.blocks[b.i]
      if (!slot) {
        console.error(`leaf ${page.leaf} has no block ${b.i}`)
        continue
      }
      blocks++
      if (slot.text !== b.text) changed++
      if (String(b.text).trim() === '') emptied++
      slot.text = b.text
    }
    for (const q of page.queries ?? []) queries.push({ leaf: page.leaf, ...q })
  }
}
const out = draft.map((p) => {
  const page = {}
  for (const [k, v] of Object.entries(p)) if (PAGE.has(k)) page[k] = v
  page.blocks = p.blocks
    .filter((b) => String(b.text).trim() !== '')
    .map((b) => {
      const o = {}
      for (const [k, v] of Object.entries(b)) if (BLOCK.has(k)) o[k] = v
      return o
    })
  const qs = queries
    .filter((q) => q.leaf === p.pageIndex)
    .map((q) => ({
      quote: String(q.quote ?? '').slice(0, 300),
      why: String(q.why ?? ''),
      kind: KINDS.has(q.kind) ? q.kind : 'unclear'
    }))
  if (qs.length) page.queries = qs
  return page
})
writeFileSync(`${K}/batch-${tag}.json`, JSON.stringify(out, null, 1) + '\n')
writeFileSync(`${K}/queries-${tag}.json`, JSON.stringify(queries, null, 1) + '\n')
const kinds = {}
for (const q of queries) kinds[q.kind ?? '?'] = (kinds[q.kind ?? '?'] ?? 0) + 1
console.log(
  `${blocks} blocks read back, ${changed} changed, ${emptied} emptied; ` +
    `${out.reduce((s, p) => s + p.blocks.length, 0)} blocks over ${out.length} leaves; queries ${JSON.stringify(kinds)}`
)
for (const q of queries.filter((q) => q.kind === 'printers-error'))
  console.log(
    `  PE ${String(q.leaf).padStart(3)}  ${JSON.stringify(q.quote)}  →  ${JSON.stringify(q.fix)}`
  )
for (const q of queries.filter((q) => q.kind !== 'printers-error'))
  console.log(
    `  ${q.kind.padEnd(12)} ${String(q.leaf).padStart(3)}  ${JSON.stringify(q.quote).slice(0, 70)}`
  )
