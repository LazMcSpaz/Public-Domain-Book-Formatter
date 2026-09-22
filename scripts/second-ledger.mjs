/**
 * The second-reader ledger's tables, from the trial files.
 *
 *   node scripts/second-ledger.mjs <dir>... [--regimes regimes.json]
 *
 * Each directory holds one book's trial: `truth.json` (`drive.mjs truth`),
 * `ours.json` (`drive.mjs ocr … fresh`, Tesseract's reading of the leaves),
 * `second.json` (`drive.mjs second`, the engine under test) and, where the
 * scan carries somebody's OCR, `layer.json` (`drive.mjs second --layer`).
 * For every leaf and every witness this scores what the plan asks: the
 * witness alone against the proofed text, how much it raises against
 * Tesseract, how much of that is real (precision), how much of Tesseract's
 * real error it catches (recall), and — written down rather than hidden —
 * the errors both readers made alike, which no witness can find.
 *
 * The rule: **the reader earns its place if its disagreements are mostly
 * real errors and it catches a meaningful share of them.** Taken here as
 * precision of one half or better and recall of one half or better, in
 * aggregate, and precision not under a third on any single book. Numbers a
 * person can argue with, written where they can.
 */
import { register } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

register('./resolve-ts.mjs', import.meta.url)
const { scoreWitness, scoreWitnesses } = await import('../src/core/witness/score.ts')

const args = process.argv.slice(2)
const regimesAt = args.indexOf('--regimes')
const regimes = regimesAt === -1 ? {} : JSON.parse(readFileSync(args[regimesAt + 1], 'utf8'))
const dirs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--regimes')
if (dirs.length === 0) {
  console.error('usage: node scripts/second-ledger.mjs <trial-dir>... [--regimes regimes.json]')
  process.exit(2)
}

const PRECISION_FLOOR = 0.5
const RECALL_FLOOR = 0.5
const BOOK_PRECISION_FLOOR = 1 / 3

const rows = []
for (const dir of dirs) {
  const truth = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8'))
  const ours = JSON.parse(readFileSync(join(dir, 'ours.json'), 'utf8'))
  const witnesses = {}
  for (const [name, file] of [
    ['paddle', 'second.json'],
    ['layer', 'layer.json']
  ]) {
    if (existsSync(join(dir, file)))
      witnesses[name] = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  }
  const byLeaf = new Map(truth.leaves.map((l) => [String(l.pageIndex), l]))
  const timing = existsSync(join(dir, 'timing.json'))
    ? JSON.parse(readFileSync(join(dir, 'timing.json'), 'utf8'))
    : {}
  for (const leaf of Object.keys(ours.text ?? ours)) {
    const l = byLeaf.get(leaf)
    if (!l) continue
    const truthText = [...l.furniture, ...l.words, ...l.notes].join(' ')
    const first = String((ours.text ?? ours)[leaf] ?? '')
    for (const [name, texts] of Object.entries(witnesses)) {
      if (typeof texts[leaf] !== 'string') continue
      const s = scoreWitness(first, texts[leaf], truthText)
      rows.push({
        book: basename(dir),
        leaf: Number(leaf),
        witness: name,
        ...s,
        ms: timing[name]?.[leaf] ?? timing[name]?.['*'] ?? null
      })
    }
    // Both together, where the book has both: what an editor is handed.
    const have = Object.values(witnesses).filter((t) => typeof t[leaf] === 'string')
    if (have.length > 1) {
      const u = scoreWitnesses(
        first,
        have.map((t) => t[leaf]),
        truthText
      )
      rows.push({
        book: basename(dir),
        leaf: Number(leaf),
        witness: 'either',
        words: 0,
        raised: u.raised,
        hits: 0,
        errors: u.errors,
        caught: u.caught,
        missed: u.errors - u.caught,
        witnessErrors: 0,
        ms: null
      })
    }
  }
}

function tally(list) {
  const t = {
    leaves: 0,
    words: 0,
    raised: 0,
    hits: 0,
    errors: 0,
    caught: 0,
    missed: 0,
    witnessErrors: 0,
    ms: []
  }
  for (const r of list) {
    t.leaves += 1
    t.words += r.words
    t.raised += r.raised
    t.hits += r.hits
    t.errors += r.errors
    t.caught += r.caught
    t.missed += r.missed
    t.witnessErrors += r.witnessErrors
    if (typeof r.ms === 'number') t.ms.push(r.ms)
  }
  return {
    ...t,
    precision: t.raised ? t.hits / t.raised : null,
    recall: t.errors ? t.caught / t.errors : null,
    msPerLeaf: t.ms.length ? t.ms.reduce((a, b) => a + b, 0) / t.ms.length : null
  }
}
const pct = (v) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const head =
  '| Witness | Leaves | Tesseract errors | Witness errors | Raised | Real | Precision | Caught | Recall | Both wrong | ms/leaf |'
const rule = '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
const line = (name, t) =>
  name === 'either'
    ? `| \`${name}\` | ${t.leaves} | ${t.errors} | — | — | — | — | ${t.caught} | **${pct(t.recall)}** | ${t.missed} | — |`
    : `| \`${name}\` | ${t.leaves} | ${t.errors} | ${t.witnessErrors} | ${t.raised} | ${t.hits} | **${pct(t.precision)}** | ${t.caught} | **${pct(t.recall)}** | ${t.missed} | ${t.msPerLeaf === null ? '—' : Math.round(t.msPerLeaf)} |`

const books = [...new Set(rows.map((r) => r.book))]
const witnesses = [...new Set(rows.map((r) => r.witness))]
const out = []
const perBook = {}
for (const book of books) {
  const label = regimes[book] ? `${regimes[book].name} — ${regimes[book].regime}` : book
  out.push(`### ${label}`, '', head, rule)
  perBook[book] = {}
  for (const w of witnesses) {
    const list = rows.filter((r) => r.book === book && r.witness === w)
    if (list.length === 0) continue
    perBook[book][w] = tally(list)
    out.push(line(w, perBook[book][w]))
  }
  out.push('')
}
out.push('### All books', '', head, rule)
const all = {}
for (const w of witnesses) {
  all[w] = tally(rows.filter((r) => r.witness === w))
  out.push(line(w, all[w]))
}
out.push('', '### The rule, applied', '')
out.push(
  `A witness earns its place at precision ≥ ${pct(PRECISION_FLOOR)} and recall ≥ ${pct(RECALL_FLOOR)} in aggregate, with precision not under ${pct(BOOK_PRECISION_FLOOR)} on any single book.`,
  ''
)
for (const w of witnesses) {
  if (w === 'either') continue
  const t = all[w]
  const weak = books.filter(
    (b) =>
      perBook[b][w] &&
      perBook[b][w].precision !== null &&
      perBook[b][w].precision < BOOK_PRECISION_FLOOR
  )
  const ok =
    t.precision !== null &&
    t.precision >= PRECISION_FLOOR &&
    t.recall !== null &&
    t.recall >= RECALL_FLOOR &&
    weak.length === 0
  out.push(
    `- \`${w}\`: precision ${pct(t.precision)}, recall ${pct(t.recall)}` +
      (weak.length
        ? `; precision under ${pct(BOOK_PRECISION_FLOOR)} on ${weak.map((b) => regimes[b]?.name ?? b).join(', ')}`
        : '') +
      ` → ${ok ? '**earns its place**' : 'does not earn its place'}`
  )
}
out.push('')
console.log(out.join('\n'))
