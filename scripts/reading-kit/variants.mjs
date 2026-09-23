/**
 * Where a book sets one term two ways — and where it does not.
 *
 * Standing rulings 2 and 3 (`RULINGS.md` on the shelf) normalise a term that
 * a book spells two ways, so a search returns the whole set rather than half
 * of it. The rulings are safe only with a guard in front of them, and the
 * guard is the reason this file exists: **two forms that differ by an accent
 * are not always the same word.** The Theosophical Glossary sets `Brahma` and
 * `Brahmâ`, gives each its own entries, and speaks of "the two Brahmas" — the
 * neuter Absolute and the masculine creator. Normalising one into the other
 * would have merged two doctrines and read as a tidy-up. It sets `Matrâ` and
 * `Mâtrâ` as consecutive headwords with different definitions, likewise.
 *
 * So this reports, for every set of forms the book spells alike but for their
 * diacritics, the three things a decision needs:
 *
 *  - **how often each form occurs**, counted on word boundaries, because
 *    ruling 3 goes to the majority and a majority has to be counted;
 *  - **whether each form heads an entry of its own**, which is the book saying
 *    in its own voice that these are different words;
 *  - **whether the shorter form is a substring of a longer word elsewhere**,
 *    because a sweep matches text, not words: `Paramartha` also sits inside
 *    `Paramarthasatya`, and sweeping the first corrupts the second.
 *
 * The verdict is advisory and deliberately timid: anything it cannot settle
 * goes to the editor. It writes nothing.
 *
 *   node scripts/reading-kit/variants.mjs <book.json> --body body.json
 *   node scripts/reading-kit/variants.mjs <book.json> --all     # every set
 *   node scripts/reading-kit/variants.mjs <book.json> --pair "Kala|Kâla"
 *
 * A sweep that acts on this must run `--case`: the accent fold in
 * `@core/edits/sweep.ts` makes a bare query match the accented form, which is
 * what searching wants and the opposite of what this change wants.
 */
import { readFileSync } from 'node:fs'

const [, , bookPath, ...flags] = process.argv
if (!bookPath) {
  console.error('usage: variants.mjs <book.json> [--body body.json] [--all] [--pair "A|B"]')
  process.exit(2)
}
const ALL = flags.includes('--all')
const pairArg = flags.includes('--pair') ? flags[flags.indexOf('--pair') + 1] : null

// `book.json` carries the **pristine** reading; every correction since lives
// in `run.edits`, keyed to blocks that only exist once the book is assembled.
// So a count taken off the transcriptions is a count of the book as it was
// read, not as it stands — it would report a term still set two ways after a
// sweep had already settled it. `drive.mjs body <out.json>` hands back the
// assembled, edited strings, and that is what to measure. Without it this
// still runs, and says on its last line which text it counted.
const bodyPath = flags.includes('--body') ? flags[flags.indexOf('--body') + 1] : null
let blocks
let source
if (bodyPath) {
  const body = JSON.parse(readFileSync(bodyPath, 'utf8'))
  blocks = (body.edited ?? []).map((b) => b.text ?? '')
  source = `the book as it stands (${bodyPath})`
} else {
  const book = JSON.parse(readFileSync(bookPath, 'utf8'))
  blocks = (book.run?.transcriptions ?? []).flatMap((p) =>
    (p.blocks ?? []).map((b) => b.text ?? '')
  )
  source =
    'the PRISTINE reading — corrections already made are not counted; pass --body from `drive.mjs body` for the book as it stands'
}
const text = blocks.join('\n').replace(/<\/?[bi]>/gu, '')

/**
 * Diacritics off, case kept. Case must stay: folding it groups `The` with
 * `the` and buries the sets that matter under two thousand sets that do not.
 * A term set with a capital in one place and lower case in another is a
 * different question, and not this ruling's.
 */
const fold = (s) => [...s].map((c) => c.normalize('NFD')[0] ?? c).join('')

const words = text.match(/[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu) ?? []
const seen = new Map()
for (const w of words) {
  const k = fold(w)
  if (!seen.has(k)) seen.set(k, new Map())
  const m = seen.get(k)
  m.set(w, (m.get(w) ?? 0) + 1)
}

/**
 * Does this form open an entry? A glossary sets one entry to a block, so the
 * headword is what stands before the language tag or the first full stop.
 */
const HEAD =
  /^\s*([\p{Lu}][^.(]{0,40}?)\s*(?:\((?:Sk|Gr|Heb|Chald|Tib|Eg|Zend|Kab|Pers|Scand|Lat|Slav|Chin|Tam)[^)]*\)|\.)/u
const heads = new Set()
for (const b of blocks) {
  const m = HEAD.exec(b.replace(/<\/?[bi]>/gu, ''))
  if (m) heads.add(m[1].trim())
}
const headsForm = (w) =>
  [...heads].some((h) => h === w || h.startsWith(w + ' ') || h.startsWith(w + '’'))

/** Is this form ever part of a longer word? Then a sweep on it is unsafe. */
function insideLonger(w) {
  const re = new RegExp(`(?<=[\\p{L}\\p{M}])${escape(w)}|${escape(w)}(?=[\\p{L}\\p{M}])`, 'u')
  return re.test(text)
}
function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function report(forms) {
  const rows = [...forms.entries()].sort((a, b) => b[1] - a[1])
  const withHead = rows.map(([w, n]) => ({ w, n, head: headsForm(w), inside: insideLonger(w) }))
  const bothHead = withHead.filter((r) => r.head).length > 1
  const top = withHead[0]
  const tie = withHead.length > 1 && withHead[1].n === top.n
  const accented = withHead.filter(
    (r) => r.w !== fold(r.w).normalize('NFC') && /[\p{M}]/u.test(r.w.normalize('NFD'))
  )
  let verdict
  if (bothHead)
    verdict = 'EDITOR — each form heads its own entry, so the book calls them different words'
  else if (accented.length === 1 && withHead.length === 2)
    verdict = `apply ruling 2 → ${accented[0].w}`
  else if (!tie) verdict = `apply ruling 3 → ${top.w} (majority ${top.n})`
  else verdict = 'EDITOR — no majority, and the book cannot settle it'
  const unsafe = withHead.filter((r) => r.inside).map((r) => r.w)
  return { withHead, verdict, unsafe }
}

const sets = pairArg
  ? [
      new Map(
        pairArg
          .split('|')
          .map((w) => [
            w,
            (
              text.match(new RegExp(`(?<![\\p{L}\\p{M}])${escape(w)}(?![\\p{L}\\p{M}])`, 'gu')) ??
              []
            ).length
          ])
      )
    ]
  : [...seen.values()].filter((m) => m.size > 1)

let shown = 0
let editorial = 0
for (const forms of sets) {
  const { withHead, verdict, unsafe } = report(forms)
  const isEditor = verdict.startsWith('EDITOR')
  if (isEditor) editorial += 1
  if (!ALL && !pairArg && !isEditor && withHead.every((r) => r.n > 2)) continue
  shown += 1
  if (!ALL && shown > 60) continue
  console.log(
    withHead.map((r) => `${r.w}×${r.n}${r.head ? ' [headword]' : ''}`).join('  |  ') +
      `\n    ${verdict}` +
      (unsafe.length
        ? `\n    SWEEP UNSAFE on ${unsafe.join(', ')} — also inside a longer word; use a longer --was`
        : '')
  )
}
console.log(
  `\n${sets.length} variant set(s); ${editorial} the book cannot settle on its own.` +
    (shown > 60 && !ALL ? ' (first 60 shown; --all for the rest)' : '') +
    `\nCounted over ${source}.`
)
