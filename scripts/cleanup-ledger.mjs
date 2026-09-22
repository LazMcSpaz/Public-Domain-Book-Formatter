/**
 * The page-cleanup ledger's table, from the trial files.
 *
 *   node scripts/cleanup-ledger.mjs <trial.json>... [--regimes regimes.json]
 *
 * Each trial file is what `drive.mjs cleantrial` wrote for one book: one row
 * per leaf and preset, with the reading aligned against the proofed text.
 * This prints the per-book and aggregate tables in Markdown and applies the
 * plan's decision rule, so the ledger's numbers and its verdict come out of
 * one place and cannot be copied wrong.
 *
 * The rule (`docs/PLAN-page-cleanup.md`): a preset becomes the default only
 * if it reduces substantive disagreements with the proofed text in aggregate
 * **and** does not increase them on any single book by more than a few
 * percent (taken here as 3% of that book's `off` count, or one disagreement,
 * whichever is larger). Mean confidence is reported and never decides.
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const regimesAt = args.indexOf('--regimes')
const regimes = regimesAt === -1 ? {} : JSON.parse(readFileSync(args[regimesAt + 1], 'utf8'))
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--regimes')
if (files.length === 0) {
  console.error('usage: node scripts/cleanup-ledger.mjs <trial.json>... [--regimes regimes.json]')
  process.exit(2)
}

const rows = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')))
const presets = [...new Set(rows.map((r) => r.preset))]
const books = [...new Set(rows.map((r) => r.book))]

function tally(list) {
  const t = {
    leaves: new Set(),
    truthWords: 0,
    words: 0,
    agreeing: 0,
    substantive: 0,
    joined: 0,
    conf: 0,
    cleanupMs: 0,
    ocrMs: 0
  }
  for (const r of list) {
    t.leaves.add(`${r.book}\u0000${r.leaf}`)
    t.truthWords += r.truthWords
    t.words += r.words
    t.agreeing += r.agreeing
    t.substantive += r.substantive
    t.joined += r.joined
    t.conf += r.meanConfidence
    t.cleanupMs += r.cleanupMs
    t.ocrMs += r.ocrMs
  }
  const n = Math.max(1, list.length)
  return {
    leaves: t.leaves.size,
    truthWords: t.truthWords,
    words: t.words,
    agreeing: t.agreeing,
    substantive: t.substantive,
    joined: t.joined,
    meanConfidence: t.conf / n,
    cleanupMs: t.cleanupMs / n,
    ocrMs: t.ocrMs / n
  }
}

const head =
  '| Preset | Leaves | Words read | Agreeing | Substantive | Joined | Mean conf. | Clean ms | OCR ms |'
const rule = '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
const line = (name, t) =>
  `| \`${name}\` | ${t.leaves} | ${t.words} | ${t.agreeing} | **${t.substantive}** | ${t.joined} | ${t.meanConfidence.toFixed(1)} | ${t.cleanupMs.toFixed(0)} | ${t.ocrMs.toFixed(0)} |`

const out = []
const perBook = {}
for (const book of books) {
  const label = regimes[book] ? `${regimes[book].name} — ${regimes[book].regime}` : book
  out.push(`### ${label}`, '', head, rule)
  perBook[book] = {}
  for (const p of presets) {
    const t = tally(rows.filter((r) => r.book === book && r.preset === p))
    perBook[book][p] = t
    out.push(line(p, t))
  }
  out.push('')
}
out.push('### All books', '', head, rule)
const all = {}
for (const p of presets) {
  all[p] = tally(rows.filter((r) => r.preset === p))
  out.push(line(p, all[p]))
}
out.push('')

// The decision rule, applied.
const off = all['off']
// "Reduces substantive disagreements in aggregate" has to mean more than a
// count that happens to be lower: two fewer in two hundred and forty is the
// run-to-run noise of an OCR engine, and a default changed on that would be
// changed back by the next forty leaves. So the reduction must clear a floor
// — a twentieth of `off`'s count, and never fewer than ten — before it is a
// reduction at all. The floor is the one number here that is a judgement,
// and it is written down so the next ledger argues with it rather than
// around it.
const FLOOR_SHARE = 0.05
const FLOOR_COUNT = 10
const floor = off ? Math.max(FLOOR_COUNT, Math.ceil(off.substantive * FLOOR_SHARE)) : 0
const verdicts = []
for (const p of presets) {
  if (p === 'off' || !off) continue
  const better = off.substantive - all[p].substantive >= floor
  const losers = books.filter((b) => {
    const base = perBook[b]['off']?.substantive ?? 0
    const mine = perBook[b][p]?.substantive ?? 0
    return mine > base + Math.max(1, Math.ceil(base * 0.03))
  })
  verdicts.push({ preset: p, better, losers, delta: all[p].substantive - off.substantive })
}
out.push(
  '### The rule, applied',
  '',
  `A reduction counts only past a floor of ${floor} (a twentieth of \`off\`'s ${off?.substantive ?? 0}, never under ${FLOOR_COUNT}); a book loses when its count rises by more than 3% or one, whichever is larger.`,
  ''
)
for (const v of verdicts) {
  out.push(
    `- \`${v.preset}\`: ${v.delta <= 0 ? '' : '+'}${v.delta} substantive against \`off\` in aggregate` +
      (v.better ? ' (better)' : ' (not better)') +
      (v.losers.length
        ? `; loses on ${v.losers.map((b) => regimes[b]?.name ?? b).join(', ')}`
        : '; loses on no book') +
      ` → ${v.better && v.losers.length === 0 ? '**eligible**' : 'not eligible'}`
  )
}
const eligible = verdicts
  .filter((v) => v.better && v.losers.length === 0)
  .sort((a, b) => a.delta - b.delta)
out.push(
  '',
  eligible.length
    ? `**Default: \`${eligible[0].preset}\`** (the eligible preset with the fewest substantive disagreements).`
    : '**Default: `off`** — no preset is eligible.',
  ''
)
console.log(out.join('\n'))
