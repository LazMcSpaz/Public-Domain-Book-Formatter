/**
 * Check a revised set of notes against the set it was revised from.
 *
 * A revision pass is the one editorial job where the writer is asked to change
 * everything about a sentence except what it asserts, and that is exactly the
 * job a fluent writer does badly: a note tightened from thirty-five words to
 * twenty-eight is easy, and a note that gains a date on the way is easier
 * still. Nothing downstream can catch it. `checkProposals` compares a note
 * against the *book*, which is the right check for a note written from the
 * book, and no check at all for a note written from another note.
 *
 * So the invariant here is narrow and mechanical: **a revision may not
 * introduce a fact.** Every digit run and every proper name in the new text
 * must already be in the old one. That is a real cross-check under SPEC §4 —
 * it does not ask the writer whether they invented anything, it compares two
 * strings — and it is the only one available for this pass.
 *
 * The rest is the voice's own hard limits, the ones that are countable:
 * length, long dashes, the banned openings and the balance of `<i>`.
 *
 *   node scripts/revise-check.mjs <before.json> <after.json>
 *
 * Both files are arrays of `{ noteId, text }`; the after file may also carry
 * `changed`. Exits non-zero when a person needs to look.
 */
import { readFile } from 'node:fs/promises'

const MAX_WORDS = 45

/** Words a capital at the head of a sentence explains, so they prove nothing. */
const OPENERS = new Set([
  'a',
  'an',
  'the',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'he',
  'she',
  'they',
  'i',
  'my',
  'and',
  'but',
  'or',
  'so',
  'for',
  'no',
  'not',
  'none',
  'both',
  'all',
  'some',
  'one',
  'two',
  'three',
  'in',
  'on',
  'at',
  'of',
  'to',
  'by',
  'from',
  'with',
  'without',
  'as',
  'if',
  'when',
  'where',
  'what',
  'there',
  'here',
  'his',
  'her',
  'their',
  'our',
  'was',
  'were',
  'is',
  'are',
  'has',
  'have',
  'had',
  'read',
  'say',
  'said',
  'says',
  'set',
  'give',
  'given',
  'write',
  'written',
  'call',
  'called',
  'nothing',
  'nobody',
  'neither',
  'either',
  'every',
  'each',
  'most',
  'much',
  'many',
  'more',
  'less',
  'first',
  'second',
  'last',
  'next',
  'same',
  'other',
  'another',
  'such',
  'only',
  'also',
  'still',
  'yet',
  'then',
  'than',
  'because',
  'since',
  'while',
  'though',
  'although',
  'before',
  'after',
  'against',
  'between',
  'among',
  'through',
  'under',
  'over',
  'about',
  'within',
  'beyond',
  'upon',
  'nor',
  'whether',
  'which',
  'who',
  'whom',
  'whose',
  'how',
  'why',
  'do',
  'does',
  'did',
  'be',
  'been',
  'can',
  'could',
  'may',
  'might',
  'must',
  'shall',
  'should',
  'will',
  'would',
  'let',
  'make',
  'made'
])

const stripMarkup = (s) => s.replace(/<\/?[a-z]+>/gu, '')
const words = (s) => stripMarkup(s).trim().split(/\s+/u).filter(Boolean)

/**
 * The facts a note asserts, as far as a string can tell: numbers, and names.
 *
 * Deliberately over-inclusive. A false positive costs a glance; a false
 * negative is a date nobody checked printed in a book for sale.
 */
function claims(text) {
  const t = stripMarkup(text)
  const out = new Set()
  for (const m of t.matchAll(/\d[\d,.]*/gu)) out.add(m[0].replace(/[.,]$/u, ''))
  // Every capitalised word, minus the ones a sentence opening explains. Position
  // is not the filter — the stoplist is. Skipping sentence-initial capitals to
  // duck "The" and "It" also ducks "Mesmer proposed" and "Kilner published",
  // which is where a name in a note of this length actually sits: the check
  // passed a name invented into the head of a sentence, which is the one place
  // it was certain to be.
  for (const m of t.matchAll(/[A-Z][A-Za-z’'-]+/gu)) {
    if (!OPENERS.has(m[0].toLowerCase())) out.add(m[0])
  }
  return out
}

const [beforePath, afterPath] = process.argv.slice(2)
if (!beforePath || !afterPath) {
  console.error('usage: node scripts/revise-check.mjs <before.json> <after.json>')
  process.exit(2)
}
const before = JSON.parse(await readFile(beforePath, 'utf8'))
const after = JSON.parse(await readFile(afterPath, 'utf8'))
const was = new Map(before.map((n) => [n.noteId, n.text]))

let faults = 0
const fault = (id, msg) => {
  faults += 1
  console.log(`  ${id}  ${msg}`)
}

if (after.length !== before.length) {
  fault('(set)', `${before.length} notes in, ${after.length} out`)
}
for (const [i, n] of after.entries()) {
  const old = was.get(n.noteId)
  if (old === undefined) {
    fault(n.noteId, 'is not a note in the input')
    continue
  }
  if (before[i]?.noteId !== n.noteId)
    fault(n.noteId, `is out of order (expected ${before[i]?.noteId})`)

  const w = words(n.text).length
  if (w > MAX_WORDS) fault(n.noteId, `${w} words, over the ${MAX_WORDS} the voice allows`)
  if (/[—–]/u.test(n.text)) fault(n.noteId, 'has a long dash')
  if (/^The author\b/u.test(n.text)) fault(n.noteId, 'opens "The author"')
  if (/\?/u.test(n.text)) fault(n.noteId, 'has a question mark')
  for (const bad of [
    'fascinating',
    'intriguing',
    'curiously',
    'it is worth noting',
    'dear reader',
    'whether or not you believe'
  ])
    if (n.text.toLowerCase().includes(bad)) fault(n.noteId, `says "${bad}"`)
  const opens = (n.text.match(/<i>/gu) ?? []).length
  const closes = (n.text.match(/<\/i>/gu) ?? []).length
  if (opens !== closes) fault(n.noteId, `${opens} <i> against ${closes} </i>`)

  // The one that matters.
  // Case-insensitively against the old text, because "fifteen" at the head of a
  // sentence is "Fifteen" and "Marconi had" is "Marconi's": a check that
  // reports those alongside a real invention is a check whose output stops
  // being read, and the repo's own rule is that a check nobody can score is
  // worse than none. A name is the same name in either case.
  const lower = old.toLowerCase()
  const added = [...claims(n.text)].filter(
    (c) => !lower.includes(c.toLowerCase().replace(/’s$|'s$/u, ''))
  )
  for (const c of added) fault(n.noteId, `asserts "${c}", which the note it revises does not`)
}
for (const n of before)
  if (!after.some((a) => a.noteId === n.noteId)) fault(n.noteId, 'was dropped')

const changed = after.filter((n) => n.changed !== false).length
console.log(
  faults === 0
    ? `  ${after.length} notes, ${changed} revised, nothing introduced. CLEAN`
    : `  ${faults} thing(s) for a person to look at`
)
if (faults > 0) process.exitCode = 1
