/**
 * The judgement half of landing a stretch, once `transcribe` has taken the
 * batch: sweep each correction and file each ruling the standing rules cover.
 *
 *   node scripts/reading-kit/apply.mjs <kit> <from> <to>
 *
 * Reads `<kit>/corrections-<from>-<to>.json` — `[[was, now], …]`, written by
 * hand from `land.mjs`'s PE list with enough words either side to be unique
 * — and `<kit>/queries-<from>-<to>.json`. Every sweep must replace exactly
 * one match; anything else is printed as CHECK and not retried, because a
 * `--was` short enough to be a class has to be counted before it is landed.
 * Rulings: a printer's error is `corrected` with the reader's fix, an
 * `unclear` is `noted`, and an `inconsistent` is left for the editor and
 * listed. Runs the driver on `DRIVE_PORT` (default 7788).
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const [, , kit, from, to] = process.argv
if (!kit || !from || !to) {
  console.error('usage: apply.mjs <kit> <from> <to>')
  process.exit(2)
}
const K = resolve(kit)
const pad = (n) => String(n).padStart(3, '0')
const tag = `${pad(from)}-${pad(to)}`
const run = (args) => {
  const r = spawnSync('node', ['scripts/drive.mjs', ...args], { encoding: 'utf8', timeout: 120000 })
  return (r.stdout ?? '') + (r.stderr ?? '')
}
const json = (out) => {
  try {
    return JSON.parse(out.slice(out.indexOf('{')))
  } catch {
    return null
  }
}

const corrPath = `${K}/corrections-${tag}.json`
let ok = 0
let pairs = []
if (existsSync(corrPath)) {
  pairs = JSON.parse(readFileSync(corrPath, 'utf8'))
  for (const [was, now] of pairs) {
    const n = json(run(['sweep', '--was', was, '--now', now]))?.replaced
    if (n === 1) ok++
    else console.log(`  CHECK ${n ?? 'no reply'}: ${JSON.stringify(was)}`)
  }
  console.log(`corrections one-for-one: ${ok} of ${pairs.length}`)
} else {
  console.log(`no ${corrPath}; nothing swept`)
}

const WHY = {
  'printers-error': 'Editor: fix clear typos and damaged type.',
  unclear:
    'Editor: where the scan cannot settle a mark, read from the word and flag it; otherwise as printed.'
}
let filed = 0
const left = []
for (const q of JSON.parse(readFileSync(`${K}/queries-${tag}.json`, 'utf8'))) {
  let decision,
    correction = '-'
  if (q.kind === 'printers-error') {
    decision = 'corrected'
    correction = q.fix || '-'
  } else if (q.kind === 'unclear') {
    decision = 'noted'
  } else {
    left.push(`${q.leaf}: ${String(q.quote).slice(0, 40)}`)
    continue
  }
  const out = run(['rule', String(q.leaf), q.quote, decision, correction, WHY[q.kind]])
  if (/"error"\s*:\s*"/u.test(out)) console.log(`FAILED ${q.leaf}: ${out.slice(0, 160)}`)
  else filed++
}
console.log(`rulings filed: ${filed}`)
if (left.length) console.log(`for the editor (${left.length}):\n  ${left.join('\n  ')}`)
if (ok !== pairs.length) process.exit(1)
