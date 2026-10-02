/**
 * Every deterministic check over a shelf book, read straight out of
 * `book.json` with no browser.
 *
 *   npx vite-node --config vitest.config.ts scripts/checks-of.ts <book.json> [<book.json> …] [--out <dir>] [--check]
 *
 * One line per book: the counts of `checkDamage`, `checkApparatus` and
 * `checkConsistency`, the as-printed rulings honoured, and the corrected
 * rulings whose correction the text does not carry. With `--out`, each book's
 * findings go to `<dir>/<book-dir>.checks.json` to be read in full. With
 * `--check`, the exit is non-zero when any book has a damage or apparatus
 * finding left after its rulings — `greek` excepted, as `drive.mjs damage
 * --check` excepts it, because it is a reading list and never a gate.
 *
 * The same assembly and edit list `drive.mjs` runs in the page (`body-of.ts`
 * makes the same argument), so a session can sweep the whole shelf for a
 * class of fault without loading a book: that is how the apparatus checks
 * were measured before their rules were set.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { assembleBook } from '@core/assemble'
import { applyEdits } from '@core/edits'
import { checkApparatus, checkConsistency, checkDamage, honourRulings } from '@core/coherence'
import { unapplied } from '@core/queries'

const args = process.argv.slice(2).filter((a) => !a.includes('checks-of'))
const at = args.indexOf('--out')
const outDir = at === -1 ? null : args[at + 1]
const check = args.includes('--check')
const books = args.filter((a, i) => a.endsWith('.json') && !(at !== -1 && i === at + 1))
if (books.length === 0) {
  throw new Error('checks-of.ts <book.json> [<book.json> …] [--out <dir>] [--check]')
}
if (outDir) mkdirSync(outDir, { recursive: true })

const tally = (xs: readonly { kind: string }[]): Record<string, number> => {
  const by: Record<string, number> = {}
  for (const x of xs) by[x.kind] = (by[x.kind] ?? 0) + 1
  return by
}
const line = (by: Record<string, number>): string =>
  Object.entries(by)
    .map(([k, n]) => `${n} ${k}`)
    .join(', ') || 'none'

let failing = 0
for (const path of books) {
  const book = JSON.parse(readFileSync(path, 'utf8'))
  const run = book.run
  const doc = applyEdits(assembleBook(run.transcriptions), run.edits ?? [])
  const rulings = run.rulings ?? []
  const damage = honourRulings(checkDamage(doc), rulings, doc)
  const apparatus = honourRulings(checkApparatus(doc), rulings, doc)
  const consistency = checkConsistency(doc)
  const notYet = unapplied(rulings, doc)
  const name = basename(dirname(path))
  const counted = [...damage.kept, ...apparatus.kept].filter((f) => f.kind !== 'greek').length
  if (counted > 0) failing++
  console.log(`${name}`)
  console.log(`  damage      ${line(tally(damage.kept))}`)
  console.log(`  apparatus   ${line(tally(apparatus.kept))}`)
  console.log(`  consistency ${line(tally(consistency))}`)
  console.log(
    `  rulings     ${damage.honoured.length + apparatus.honoured.length} findings honoured, ` +
      `${notYet.length} corrected rulings not found in the text`
  )
  if (outDir) {
    writeFileSync(
      join(outDir, `${name}.checks.json`),
      JSON.stringify(
        {
          damage: damage.kept,
          apparatus: apparatus.kept,
          honoured: [...damage.honoured, ...apparatus.honoured],
          consistency,
          unapplied: notYet
        },
        null,
        1
      )
    )
  }
}
if (check && failing > 0) {
  console.error(`${failing} of ${books.length} books have findings left after their rulings`)
  process.exit(1)
}
