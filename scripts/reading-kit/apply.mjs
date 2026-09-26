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
 * Rulings: a printer's error is `corrected` with the reader's fix, under
 * the shelf's standing ruling 1 (`RULINGS.md`: fix clear typos and damaged
 * type, which every book inherits), an
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

/**
 * The words `was` has that `now` does not, counted: a pair that mends a word
 * trades one for another and loses nothing, and one that drops a word beside
 * the fix loses it. Punctuation is not a word, so moving a stop is free.
 */
function wordsLost(was, now) {
  const words = (s) => s.replace(/<\/?(?:i|em|b|strong)>/giu, '').match(/[\p{L}\p{N}]+/gu) ?? []
  const left = words(now)
  const before = words(was)
  // A word mended in place is the same count on both sides.
  if (left.length >= before.length) return []
  const pool = [...left]
  return before.filter((w) => {
    const i = pool.indexOf(w)
    if (i === -1) return true
    pool.splice(i, 1)
    return false
  })
}

// Refuse to sweep a stretch whose readings are not in the run. A sweep is a
// text replacement over whatever the run holds, so run before `transcribe`
// has landed the batch (or after it refused) it corrects the unread drafts of
// those leaves instead, and the next landing buries the edits under text they
// were never written against. On *The Secret Doctrine* Vol. II that is what
// happened when a malformed batch was refused and this ran anyway. The test
// is cheap and needs no new verb: a sample of each leaf's reading must be in
// the pristine body `drive.mjs body` hands back.
{
  const batchPath = `${K}/batch-${tag}.json`
  if (existsSync(batchPath) && !process.env.SKIP_LANDED_CHECK) {
    const batch = JSON.parse(readFileSync(batchPath, 'utf8'))
    const bodyPath = `${K}/.landed-check.json`
    run(['body', bodyPath])
    const body = existsSync(bodyPath) ? JSON.parse(readFileSync(bodyPath, 'utf8')) : null
    const flat = (t) =>
      String(t)
        .replace(/<[^>]+>/gu, '')
        .replace(/\s+/gu, ' ')
    const haystack = body ? body.pristine.map((b) => flat(b.text)).join(' ') : ''
    const samples = batch
      .map((leaf) => {
        // Footnotes are pulled out of the body at assembly, so only the
        // body's own blocks can be looked for there.
        const texts = (leaf.blocks ?? [])
          .filter((b) => b.kind !== 'footnote')
          .map((b) => flat(b.text))
          .filter((t) => t.length > 80)
        const t = texts[Math.floor(texts.length / 2)]
        return t ? { leaf: leaf.pageIndex, probe: t.slice(20, 80) } : null
      })
      .filter(Boolean)
    const missing = samples.filter((s) => !haystack.includes(s.probe))
    if (!body || missing.length > samples.length / 10) {
      console.log(
        `REFUSED: ${missing.length} of ${samples.length} leaves in ${tag} do not read as the ` +
          `batch has them (first: leaf ${missing[0]?.leaf ?? '?'}). Land the batch with ` +
          '`drive.mjs transcribe` first; nothing was swept or filed.'
      )
      process.exit(2)
    }
  }
}

const corrPath = `${K}/corrections-${tag}.json`
let ok = 0
let pairs = []
if (existsSync(corrPath)) {
  pairs = JSON.parse(readFileSync(corrPath, 'utf8'))
  for (const [was, now] of pairs) {
    // A pair is written by hand with words either side of the fix to make it
    // unique, and those words have to come back out exactly. On *A Modern
    // Panarion* three did not: `error He confounds` went in as `error.
    // confounds`, and the book lost a word for every fix it gained. A
    // correction that takes a word out is sometimes the point (a doubled
    // word), so this holds the pair back and names it rather than guessing.
    const lost = wordsLost(was, now)
    if (lost.length > 0 && !process.env.ALLOW_WORD_LOSS) {
      console.log(
        `  CHECK drops ${JSON.stringify(lost)}: ${JSON.stringify(was)} → ${JSON.stringify(now)}`
      )
      continue
    }
    const n = json(run(['sweep', '--was', was, '--now', now]))?.replaced
    if (n === 1) ok++
    else console.log(`  CHECK ${n ?? 'no reply'}: ${JSON.stringify(was)}`)
  }
  console.log(`corrections one-for-one: ${ok} of ${pairs.length}`)
} else {
  console.log(`no ${corrPath}; nothing swept`)
}

const WHY = {
  'printers-error':
    'Editor: fix clear typos and damaged type (standing ruling 1, RULINGS.md on the shelf).',
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
