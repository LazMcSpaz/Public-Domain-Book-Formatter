/**
 * Does a cheap per-leaf signal say where the second reader is worth running?
 *
 * The plan asks for the second reading to be offered "on leaves `assessText`
 * flags". Before that is built, the question it rests on has to be answered
 * with numbers: over the 42 ground-truth leaves, do the leaves a per-leaf
 * signal flags actually hold the errors?
 */
import { register } from 'node:module'
register('file:///home/user/Public-Domain-Book-Formatter/scripts/resolve-ts.mjs')
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const { compareWitnesses } = await import('file:///home/user/Public-Domain-Book-Formatter/src/core/witness/index.ts')
const { assessText } = await import('file:///home/user/Public-Domain-Book-Formatter/src/core/textquality/assess.ts')

const DIR = '/home/user/Public-Domain-Book-Formatter/docs/ledger-data/second-reader'
const books = JSON.parse(readFileSync(join(DIR, 'regimes.json'), 'utf8'))

const rows = []
for (const [slug, meta] of Object.entries(books)) {
  const ours = JSON.parse(readFileSync(join(DIR, slug, 'ours.json'), 'utf8'))
  const truth = JSON.parse(readFileSync(join(DIR, slug, 'truth.json'), 'utf8'))
  const second = JSON.parse(readFileSync(join(DIR, slug, 'second.json'), 'utf8'))
  for (const leaf of truth.leaves) {
    const n = leaf.pageIndex
    const mine = ours.text?.[String(n)] ?? ''
    if (!mine) continue
    const gold = (leaf.words ?? []).join(' ')
    if (!gold) continue
    // Our reading against the proofed text: the leaf's REAL errors.
    const real = compareWitnesses(mine, gold).disagreements.filter((d) => d.kind === 'substantive')
    // The second reader against our reading: what it would raise on this leaf.
    const other = second[String(n)]
    const otherText = typeof other === 'string' ? other : (other?.text ?? '')
    const raised = otherText
      ? compareWitnesses(mine, otherText).disagreements.filter((d) => d.kind === 'substantive')
      : []
    const a = assessText(mine)
    rows.push({
      slug,
      regime: meta.regime,
      leaf: n,
      words: a.words,
      score: a.score,
      noise: a.noise,
      verdict: a.verdict,
      real: real.length,
      raised: raised.length
    })
  }
}

rows.sort((x, y) => x.score - y.score)
console.log(`${rows.length} leaves with a proofed reading.\n`)
console.log('worst-scoring ten by assessText, with what is actually wrong on them:')
console.log('  score  noise  verdict      words  real errs  raised  leaf')
for (const r of rows.slice(0, 10))
  console.log(
    `  ${r.score.toFixed(3)}  ${r.noise.toFixed(3)}  ${r.verdict.padEnd(11)}  ${String(r.words).padStart(5)}  ${String(r.real).padStart(9)}  ${String(r.raised).padStart(6)}  ${r.slug} ${r.leaf}`
  )
console.log('\nbest-scoring ten:')
for (const r of rows.slice(-10))
  console.log(
    `  ${r.score.toFixed(3)}  ${r.noise.toFixed(3)}  ${r.verdict.padEnd(11)}  ${String(r.words).padStart(5)}  ${String(r.real).padStart(9)}  ${String(r.raised).padStart(6)}  ${r.slug} ${r.leaf}`
  )

const total = rows.reduce((s, r) => s + r.real, 0)
console.log(`\n${total} real errors over ${rows.length} leaves.`)
for (const share of [0.25, 0.5]) {
  const take = Math.max(1, Math.round(rows.length * share))
  const got = rows.slice(0, take).reduce((s, r) => s + r.real, 0)
  console.log(
    `  worst ${Math.round(share * 100)}% of leaves by assessText score (${take} leaves) hold ${got} of them — ${((100 * got) / total).toFixed(0)}%`
  )
}
const byVerdict = {}
for (const r of rows) {
  byVerdict[r.verdict] ??= { leaves: 0, real: 0 }
  byVerdict[r.verdict].leaves += 1
  byVerdict[r.verdict].real += r.real
}
console.log('\nby verdict:')
for (const [v, c] of Object.entries(byVerdict))
  console.log(`  ${v.padEnd(12)} ${String(c.leaves).padStart(3)} leaves, ${String(c.real).padStart(4)} real errors  (${(c.real / c.leaves).toFixed(1)} a leaf)`)

// How good could any per-leaf ordering be, and how good is picking at random?
const byReal = [...rows].sort((a, b) => b.real - a.real)
const shuffled = [...rows]
let seed = 12345
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1))
  ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
}
const byNoise = [...rows].sort((a, b) => b.noise - a.noise || a.score - b.score)
const byWords = [...rows].sort((a, b) => b.words - a.words)
console.log('\nhow much of the damage each ordering reaches, by share of leaves read:')
console.log('  leaves   oracle  assessText  noise  longest  random')
for (const share of [0.25, 0.5, 0.75]) {
  const take = Math.max(1, Math.round(rows.length * share))
  const got = (list) => list.slice(0, take).reduce((s, r) => s + r.real, 0)
  const pct = (n) => `${((100 * n) / total).toFixed(0)}%`.padStart(6)
  console.log(
    `  ${String(Math.round(share * 100)).padStart(4)}%  ${pct(got(byReal))}  ${pct(got(rows))}      ${pct(got(byNoise))} ${pct(got(byWords))}  ${pct(got(shuffled))}`
  )
}
const withRaised = rows.filter((r) => r.raised > 0 || r.real > 0)
const bothZero = rows.filter((r) => r.raised === 0 && r.real > 0)
console.log(
  `\nleaves the second reader raises nothing on but which do carry errors: ${bothZero.length} of ${rows.length}, holding ${bothZero.reduce((s, r) => s + r.real, 0)} errors`
)
