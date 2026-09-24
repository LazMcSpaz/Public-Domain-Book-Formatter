/**
 * Marks against notes, leaf by leaf, on a batch before it lands.
 *
 * A footnote sits at the foot of the leaf its mark is on, so per leaf and per
 * marker the two balance. The engine pairs positionally through the whole
 * book, so one leaf that does not balance — a note the draft typed
 * `paragraph`, a `*` inside garbled Greek, a diagram whose marks are in the
 * picture — sets every later note of that marker under the wrong reference,
 * and `pairs` still reports every note claimed. On The Secret Doctrine, three
 * stretches landed with 143 of 237 notes misplaced before this was run.
 *
 * Prints each leaf where the running drift moves, which is where to look.
 * Leaves that carry a runover (a note with no mark) are not counted as notes.
 *
 *   node scripts/reading-kit/balance.mjs <batch.json> [more.json …]
 */
import { readFileSync } from 'node:fs'

const MARK = /(?<![*†‡§‖¶])(\*\*|††|[*†‡§‖¶])(?![*†‡§‖¶])/gu
const HEAD = /^\s*(\*\*|††|[*†‡§‖¶])/u
const pages = process.argv
  .slice(2)
  .flatMap((f) => JSON.parse(readFileSync(f, 'utf8')))
  .sort((a, b) => a.pageIndex - b.pageIndex)
const drift = new Map()
let moved = 0
for (const page of pages) {
  const marks = new Map()
  const notes = new Map()
  for (const b of page.blocks ?? []) {
    if (b.kind === 'footnote') {
      const m = String(b.text).match(HEAD)
      if (m) notes.set(m[1], (notes.get(m[1]) ?? 0) + 1)
      continue
    }
    if (HEAD.test(String(b.text)) && /^\s*\S+\s/u.test(String(b.text)))
      console.log(`  leaf ${page.pageIndex}: a ${b.kind} opens with a mark — a note typed wrong?`)
    for (const m of String(b.text).matchAll(MARK)) marks.set(m[1], (marks.get(m[1]) ?? 0) + 1)
  }
  for (const k of new Set([...marks.keys(), ...notes.keys()])) {
    const d = (marks.get(k) ?? 0) - (notes.get(k) ?? 0)
    if (!d) continue
    drift.set(k, (drift.get(k) ?? 0) + d)
    moved++
    console.log(
      `leaf ${page.pageIndex} ${k}: ${marks.get(k) ?? 0} marks, ${notes.get(k) ?? 0} notes — drift ${drift.get(k)}`
    )
  }
}
console.log(moved ? `${moved} leaf/marker pairs do not balance` : 'every leaf balances')
process.exit(moved ? 1 : 0)
