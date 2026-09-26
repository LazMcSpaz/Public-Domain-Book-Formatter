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
 *
 * A reader may also give a block a `kind` where the draft guessed it wrong —
 * the draft types by geometry, and on a book set in two sizes a quotation in
 * small type comes out `footnote`, which assembly then pulls out of the text.
 * Only the kinds in `RETYPE` are taken, and every change is counted. A page's
 * `cut` (what the scan lost at the head of the leaf) is written to
 * `<kit>/cuts-<from>-<to>.json` rather than raised as a query on every leaf.
 * And a page's `add` — `[{after, kind, text}]` — puts in a block the draft
 * left out altogether (a footnote, a sub-head, a section numeral), read off
 * the page by the reader; `after` is the `i` it follows, -1 for the top.
 * A block marked `join: true` continues the one before it on the same leaf
 * and is folded into it — the draft cuts a paragraph or a note wherever the
 * text layer's lines misled it, and a reader can say so without renumbering.
 * Joining runs before `add`, so an added block's `after` still names the `i`
 * the reader saw; a join never crosses a leaf.
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
const RETYPE = new Set(['paragraph', 'heading', 'blockquote', 'footnote', 'caption'])
let blocks = 0
let changed = 0
let retyped = 0
const cuts = []
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
      // A heading's level, where the reader set one: a text layer carries none.
      if ([1, 2, 3].includes(b.level)) slot.level = b.level
      // A block that only continues the one before it (a paragraph or a note
      // the draft cut at a line) is folded into it after every text is in.
      if (b.join === true) slot.join = true
      if (b.kind && b.kind !== slot.kind) {
        if (RETYPE.has(b.kind)) {
          // A table that was really prose: its cells are what the table is
          // regenerated from, so they go with the kind.
          if (slot.kind === 'table') {
            delete slot.cells
            delete slot.headerRow
          }
          slot.kind = b.kind
          retyped++
        } else console.error(`leaf ${page.leaf} block ${b.i}: kind ${b.kind} not taken`)
      }
    }
    if (page.cut) cuts.push({ leaf: page.leaf, ...page.cut })
    for (const a of page.add ?? []) {
      if (!RETYPE.has(a.kind) || !String(a.text ?? '').trim()) {
        console.error(`leaf ${page.leaf}: an added block needs a kind and a text`)
        continue
      }
      ;(target.added ??= []).push(a)
    }
    for (const q of page.queries ?? []) queries.push({ leaf: page.leaf, ...q })
  }
}
let joinedBlocks = 0
// An added block's `after` names the `i` the reader saw, so it is resolved to
// that block *object* before any join takes blocks out of the list: it once
// was an index into the list after joining, which put a note one block early
// for every join above it, and several adds sharing one `after` were spliced
// at the same index in turn and so came out in reverse (Isis Vol. II, the
// Würzburg register on leaf 79, twenty-four lines added after one block).
for (const p of draft) {
  const anchored = new Map()
  const top = []
  for (const a of p.added ?? []) {
    const block = { kind: a.kind, text: a.text }
    if (a.kind === 'heading' && [1, 2, 3].includes(a.level)) block.level = a.level
    const at = a.after >= 0 ? p.blocks[a.after] : null
    if (a.after >= 0 && !at) {
      console.error(
        `leaf ${p.pageIndex}: an added block names block ${a.after}, which is not there`
      )
      continue
    }
    if (at) anchored.set(at, [...(anchored.get(at) ?? []), block])
    else top.push(block)
  }
  delete p.added
  p.anchored = anchored
  p.top = top
}
for (const p of draft) {
  const kept = []
  for (const b of p.blocks) {
    const prev = [...kept].reverse().find((k) => String(k.text).trim() !== '')
    if (b.join && prev && String(b.text).trim() !== '') {
      const glue = /[-—]$/u.test(prev.text) ? '' : ' '
      prev.text = `${prev.text.trimEnd()}${glue}${String(b.text).trimStart()}`
      joinedBlocks++
      // What was to follow the joined block follows what it joined.
      const after = p.anchored.get(b)
      if (after) p.anchored.set(prev, [...(p.anchored.get(prev) ?? []), ...after])
      p.anchored.delete(b)
      continue
    }
    delete b.join
    kept.push(b)
  }
  p.blocks = kept
}
let added = 0
for (const p of draft) {
  const out = [...p.top]
  for (const b of p.blocks) {
    out.push(b)
    // In the order the reader listed them: that is printed order.
    out.push(...(p.anchored.get(b) ?? []))
  }
  added += out.length - p.blocks.length
  p.blocks = out
  delete p.anchored
  delete p.top
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
// A footnote left typed as body text keeps its mark at its head, which the
// engine then counts as a reference in the text, and every note of that mark
// after it is set one reference early. On Isis Vol. II three leaves did that
// and 93 of 123 notes stood under the wrong mark, with every count balanced.
// Named here, where it is one line to fix, rather than found by `pairs`.
for (const page of out) {
  for (const b of page.blocks) {
    if (
      b.kind !== 'footnote' &&
      /^(\*{1,3}|†{1,2}|‡{1,2}|§{1,2}|‖|¶)\s/u.test(String(b.text).replace(/<[^>]+>/gu, ''))
    ) {
      console.error(
        `  NOTE?  ${page.pageIndex}  a ${b.kind} opens with a mark: ${String(b.text).slice(0, 60)}`
      )
    }
  }
}
writeFileSync(`${K}/batch-${tag}.json`, JSON.stringify(out, null, 1) + '\n')
writeFileSync(`${K}/queries-${tag}.json`, JSON.stringify(queries, null, 1) + '\n')
if (cuts.length) writeFileSync(`${K}/cuts-${tag}.json`, JSON.stringify(cuts, null, 1) + '\n')
const kinds = {}
for (const q of queries) kinds[q.kind ?? '?'] = (kinds[q.kind ?? '?'] ?? 0) + 1
console.log(
  `${blocks} blocks read back, ${changed} changed, ${emptied} emptied, ${retyped} retyped, ${joinedBlocks} joined, ${added} added; ` +
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
