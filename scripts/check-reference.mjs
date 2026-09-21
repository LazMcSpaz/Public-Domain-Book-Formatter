#!/usr/bin/env node
/**
 * The free checks, over the Blavatsky reference texts.
 *
 * `reference/blavatsky` was put on the shelf as raw OCR and nothing had asked
 * it a single question. These texts are not an edition and will not be set,
 * but they are what a glossary entry gets written from, so the damage in them
 * is worth knowing rather than discovering in a footnote.
 *
 * `checkDamage` asks the one question that needs neither a second reader nor
 * pixels: **is this a mark the printing trade sets at all?** A word the
 * conversion split, a full stop mid-clause, an apostrophe standing where a
 * comma belongs. It writes nothing and proposes nothing — `attested` where
 * the volume's own vocabulary settles what the words were, `shape` where it
 * does not and the finding is only a place to look.
 *
 * Each page is one block, which is the honest granularity: nothing here has
 * been assembled, so no paragraph has been joined across a page seam and a
 * block that claimed to be one would be lying about where its text came from.
 *
 * Usage:
 *   node scripts/check-reference.mjs [--source <name>] [--kind <kind>] [--show <n>]
 */
import { register } from 'node:module'
register('./resolve-ts.mjs', import.meta.url)
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// `damage.ts` directly, never `@core/coherence`'s index: that index reaches
// `transcribe/client.ts`, whose TypeScript parameter property Node's
// strip-only mode refuses. damage.ts imports one *type* and nothing else,
// so it loads under plain Node as it stands.
const { checkDamage } = await import('@core/coherence/damage.ts')

const SHELF = process.env.SHELF ?? '/home/user/Public-Domain-Books-Storage'
const DIR = join(SHELF, 'reference', 'blavatsky')
if (!existsSync(DIR)) {
  console.error(`no reference corpus at ${DIR}`)
  process.exit(2)
}

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const only = flag('--source', null)
const kindWanted = flag('--kind', null)
const show = Number(flag('--show', 0))

/** A page per block, keyed by the marker the extractor wrote. */
function blocksOf(raw) {
  const blocks = []
  const parts = raw.split(/\f\[([^\]]*)\]\n?/u)
  for (let i = 1; i < parts.length; i += 2) {
    const text = (parts[i + 1] ?? '').trim()
    if (text.length === 0) continue
    blocks.push({
      id: parts[i].replace(/\s+/gu, '-'),
      kind: 'paragraph',
      text,
      sourcePages: []
    })
  }
  return blocks
}

let grand = 0
for (const file of readdirSync(DIR)
  .filter((f) => f.endsWith('.txt'))
  .sort()) {
  const name = file.replace(/\.txt$/, '')
  if (only && !name.startsWith(only)) continue
  const blocks = blocksOf(readFileSync(join(DIR, file), 'utf8'))
  const found = checkDamage({ blocks, sections: [] }).filter(
    (f) => !kindWanted || f.kind === kindWanted
  )
  grand += found.length
  const by = {}
  for (const f of found) by[f.kind] = (by[f.kind] ?? 0) + 1
  const attested = found.filter((f) => f.confidence === 'attested').length
  console.log(
    `${name.padEnd(24)} ${String(blocks.length).padStart(5)} pages  ` +
      `${String(found.length).padStart(5)} findings, ${attested} attested  ` +
      Object.entries(by)
        .sort()
        .map(([k, v]) => `${k}:${v}`)
        .join(' ')
  )
  for (const f of found.slice(0, show)) {
    console.log(`    [${f.blockId}] ${f.kind} (${f.confidence})  ${JSON.stringify(f.found)}`)
    console.log(`        ${f.context.replace(/\s+/gu, ' ')}`)
    if (f.expected) console.log(`        expected: ${JSON.stringify(f.expected)} — ${f.against}`)
  }
}
console.log(`\n${grand} findings. Nothing has been changed: checkDamage writes nothing.`)
