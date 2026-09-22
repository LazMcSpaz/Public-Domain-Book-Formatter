/**
 * Which per-leaf signal says where a second reading is worth running.
 *
 *   node scripts/select-ledger.mjs [<ledger-dir>]
 *
 * `PLAN-second-reader.md` asks for the second reading to be offered "on
 * leaves `assessText` flags". This is the measurement that question rests on,
 * over the same trial files `second-ledger.mjs` scores: for every proofed
 * leaf, the errors our reading really has, and each candidate signal's
 * ranking of the leaves. A signal is worth having only if reading the leaves
 * it puts first reaches more of the damage than reading the same number at
 * random.
 *
 * Two things this table had wrong in its first version, both of which
 * flattered the signals, and both worth recognising elsewhere:
 *
 * - **The baseline was one shuffle.** A sample of size one, quoted as though
 *   it were the coin. It read 24% where the mean over 500 shuffles is 31%.
 * - **The tie-break was doing the work.** Most leaves carry no junk character
 *   at all, so `noise` says nothing about them and whatever breaks the tie
 *   decides which of them get read. Ranking noise with a score tie-break and
 *   calling the result "noise" credited one signal with another's work.
 *
 * So the orderings here are named by what they actually sort on, tie-break
 * included, and the module implements one of these exactly.
 */
import { register } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

register('./resolve-ts.mjs', import.meta.url)
const { compareWitnesses } = await import('../src/core/witness/index.ts')
const { assessText } = await import('../src/core/textquality/assess.ts')

const DIR = process.argv[2] ?? 'docs/ledger-data/second-reader'
const books = JSON.parse(readFileSync(join(DIR, 'regimes.json'), 'utf8'))

const rows = []
for (const slug of Object.keys(books)) {
  const ours = JSON.parse(readFileSync(join(DIR, slug, 'ours.json'), 'utf8'))
  const truth = JSON.parse(readFileSync(join(DIR, slug, 'truth.json'), 'utf8'))
  for (const leaf of truth.leaves ?? []) {
    const mine = ours.text?.[String(leaf.pageIndex)] ?? ''
    const gold = (leaf.words ?? []).join(' ')
    if (!mine || !gold) continue
    // Our reading against the proofed text: this leaf's real errors. `joined`
    // is the same letters broken differently and is nobody's mistake.
    const real = compareWitnesses(mine, gold).disagreements.filter((d) => d.kind === 'substantive')
    const a = assessText(mine)
    rows.push({ slug, leaf: leaf.pageIndex, ...a, real: real.length })
  }
}

const total = rows.reduce((s, r) => s + r.real, 0)
console.log(`${rows.length} proofed leaves, ${total} real errors.\n`)

const SHUFFLES = 500
let seed = 12345
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
function randomReach(take) {
  const deck = [...rows]
  let sum = 0
  for (let s = 0; s < SHUFFLES; s++) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      ;[deck[i], deck[j]] = [deck[j], deck[i]]
    }
    sum += deck.slice(0, take).reduce((a, r) => a + r.real, 0)
  }
  return sum / SHUFFLES
}

const orderings = {
  oracle: [...rows].sort((a, b) => b.real - a.real),
  'noise,score': [...rows].sort((a, b) => b.noise - a.noise || a.score - b.score),
  'noise,leaf': [...rows].sort((a, b) => b.noise - a.noise || a.leaf - b.leaf),
  score: [...rows].sort((a, b) => a.score - b.score || a.leaf - b.leaf),
  longest: [...rows].sort((a, b) => b.words - a.words)
}
const columns = [...Object.keys(orderings), 'random']

console.log('damage reached, by share of leaves read:')
console.log('  share  ' + columns.map((k) => k.padStart(13)).join(''))
for (const share of [0.25, 0.5, 0.75]) {
  const take = Math.max(1, Math.round(rows.length * share))
  const pct = (n) => `${((100 * n) / total).toFixed(0)}%`.padStart(13)
  const cells = Object.values(orderings).map((list) =>
    pct(list.slice(0, take).reduce((s, r) => s + r.real, 0))
  )
  console.log(
    `  ${String(Math.round(share * 100)).padStart(4)}%  ` + cells.join('') + pct(randomReach(take))
  )
}

const flat = rows.filter((r) => r.noise === 0).length
console.log(
  `\n${flat} of ${rows.length} leaves carry no junk character at all, so noise cannot rank them ` +
    'and the tie-break decides which get read.'
)

const byVerdict = {}
for (const r of rows) {
  byVerdict[r.verdict] ??= { leaves: 0, real: 0 }
  byVerdict[r.verdict].leaves += 1
  byVerdict[r.verdict].real += r.real
}
console.log('\nby verdict — how little it separates them:')
for (const [v, c] of Object.entries(byVerdict))
  console.log(
    `  ${v.padEnd(12)} ${String(c.leaves).padStart(3)} leaves, ${String(c.real).padStart(4)} errors  (${(c.real / c.leaves).toFixed(1)} a leaf)`
  )
