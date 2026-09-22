#!/usr/bin/env node
/**
 * Two readers disagreed. Which of them the corpus believes.
 *
 * `compareWitnesses` settles the `joined` class — the same letters broken
 * differently — and hands back the `substantive` ones, where the letters
 * differ and one reader is wrong. On a Blavatsky leaf that is around twenty a
 * page, which over a thousand leaves is a list nobody reads.
 *
 * Nearly all of them are not hard. `appeared` against `apoeared`, `latter`
 * against `laller`, `temple` against `tenmple`: one is a word this corpus
 * uses constantly and the other it has never used. So each side is counted
 * across all 1.88 million words, and a side that is attested while the other
 * is not settles it — the same argument `checkDamage` makes for a split word,
 * and the same one SOURCES.md makes for searching on letters.
 *
 * ## What this is and is not
 *
 * It is **not** a pixel check, and it does not pretend to be. These scans
 * have pixels and the rule for an edition is unchanged: where pixels exist
 * they are the only accepter. This corpus is not an edition — nothing here is
 * printed — and its standard is "accurate enough to write from, with the
 * paper checked for anything quoted", which is what `reference/SOURCES.md`
 * already tells a reader.
 *
 * So every settled row records **why** it was settled and what the counts
 * were, and a row the corpus cannot settle is never guessed at. Both sides
 * unattested, or both attested, means a person looks.
 *
 * The ratio matters because the corpus is itself OCR: `apoeared` really does
 * occur, once or twice, in two million words. A side needs to be ATTESTED_AT
 * or more, and to beat the other by DOMINANCE, before it settles anything.
 *
 * Usage:
 *   node scripts/settle-witness.mjs <witness.json> [--show <n>] [--open]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A form the corpus has never used loses to one it has used at least this
 * often. One is enough, and deliberately: the loser standing at *zero* is
 * what carries this, not the winner's count. `interconnunion` and `i575`
 * are nowhere in a million words and `intercommunion` and `1575` are there
 * once each, which settles them. Every such row records both counts, so a
 * thin call can be read back rather than taken on trust.
 */
const NEVER_BEATS_AT = 1
/** Otherwise a form must stand this often, and beat the other by DOMINANCE. */
const ATTESTED_AT = 5
const DOMINANCE = 8

/**
 * Which sources may vote on what a word is.
 *
 * Not all of them, and the reason was measured rather than assumed: counting
 * over the whole corpus made `medi val` beat `medieval` 35 to 20. The
 * Secret Doctrine's embedded layer shatters 9% of its tokens, so letting it
 * vote elects the damage — a dictionary built from the most broken text on
 * the shelf. It is excluded, and the corpus is still 1.1M words without it.
 *
 * **That exclusion was about the layer, not about the book**, and both
 * volumes have since been read off the pixels ClearScan draws — 1.37% and
 * 1.78% lone letters, which is the same order as everything else voting
 * here. So the two re-readings vote and the two `-clearscan` files do not.
 * Measured before the change: the electorate goes from 1.11M words and
 * 55,659 forms to 1.84M and 74,182, `doctrine` from 655 to 1,859 against
 * `doctrme` at zero either way, `ethereal` 69 to 179 against `etheral` at
 * zero — and `thc`, the one form that stands at all, from 7 to 9 against
 * `the` at 167,209. Nothing the old electorate settled is unsettled by it.
 *
 * `isis-vol2-layer` is excluded for a different fault of the same kind: it
 * runs words together, 4,305 tokens of fifteen letters or more against the
 * pixel reading's 669, so letting it vote would elect `knewthat`.
 *
 * `isis-vol1` is the only proofed text here, so it is worth more than the
 * rest; a form it uses is a form the editor has seen.
 */
const VOTERS =
  /^(isis-vol1|isis-vol2|theosophical-glossary|key-to-theosophy|modern-panarion|secret-doctrine-sd[12])\.txt$/u
const WEIGHT = { 'isis-vol1.txt': 3 }

const SHELF = process.env.SHELF ?? '/home/user/Public-Domain-Books-Storage'
const DIR = join(SHELF, 'reference', 'blavatsky')

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/gu, '')

function corpusCounts() {
  const count = new Map()
  for (const f of readdirSync(DIR).filter((f) => VOTERS.test(f))) {
    const weight = WEIGHT[f] ?? 1
    const raw = readFileSync(join(DIR, f), 'utf8').replace(/\f\[[^\]]*\]/gu, ' ')
    for (const w of raw.split(/\s+/u)) {
      const k = norm(w)
      if (k.length === 0) continue
      count.set(k, (count.get(k) ?? 0) + weight)
    }
  }
  return count
}

const words = (s) => s.trim().split(/\s+/u).filter(Boolean).length

/** Is `short` `long` with characters left out? */
function subsequence(short, long) {
  if (short.length === 0 || short.length >= long.length) return false
  let i = 0
  for (const c of long) if (c === short[i]) i += 1
  return i === short.length
}

export function settle(first, second, count) {
  const a = norm(first)
  const b = norm(second)
  if (a === '' || b === '' || a === b) return { verdict: 'skip' }
  // Both sides several words long means the readers lost each other, usually
  // around page furniture — `where j nu aes i` against
  // `wherc digized bygoogle` is the Google watermark, not a word anybody has
  // to choose between. Counting a phrase as if it were a word finds nothing
  // and would put every one of these in front of a person as a decision.
  if (words(first) > 1 && words(second) > 1) {
    return { verdict: 'misaligned', na: 0, nb: 0, detail: `${first} / ${second}` }
  }
  const na = count.get(a) ?? 0
  const nb = count.get(b) ?? 0
  const detail = `${first}×${na} vs ${second}×${nb}`
  // A word the corpus has *never* used, against one it uses, is the strongest
  // signal here and needs no great count behind it: `bifrost` stands four
  // times and `bifr st` none. Requiring five before anything could settle
  // left that whole class open, and it is most of the class.
  if (nb === 0 && na >= NEVER_BEATS_AT) return { verdict: 'first', take: first, na, nb, detail }
  if (na === 0 && nb >= NEVER_BEATS_AT) return { verdict: 'second', take: second, na, nb, detail }
  // One reading is the other with letters missing. That is PaddleOCR dropping
  // a diacritic it cannot draw — `bh ta` for Tesseract's `bhiita`, `se ti`
  // for `sekti`, `vih ra` for `vihdra` — and it is most of what survives the
  // count on a book full of transliterated Sanskrit. The fuller reading wins,
  // and this is the one rule here that says nothing about which vowel is
  // right: both engines guess at those and only the paper knows.
  if (subsequence(b, a))
    return { verdict: 'first', take: first, na, nb, detail, why: 'a gap in the other' }
  if (subsequence(a, b))
    return { verdict: 'second', take: second, na, nb, detail, why: 'a gap in the other' }
  // `1st` against `ist`, `1575` against `i575`, `1306` against `13o6`: one
  // reader saw digits where the other saw the letters they look like. The
  // digit reading wins when the two are the same string under that swap,
  // because a figure set in an 1892 book is a figure — the substitution only
  // ever runs one way, an engine inventing a digit inside a word is not a
  // failure mode either of these has.
  const digitish = (x) => x.replace(/[il]/gu, '1').replace(/o/gu, '0')
  if (digitish(a) === digitish(b) && a !== b) {
    const digitsIn = (x) => (x.match(/[0-9]/gu) ?? []).length
    if (digitsIn(a) > digitsIn(b))
      return {
        verdict: 'first',
        take: first,
        na,
        nb,
        detail,
        why: 'digits, not the letters they resemble'
      }
    if (digitsIn(b) > digitsIn(a))
      return {
        verdict: 'second',
        take: second,
        na,
        nb,
        detail,
        why: 'digits, not the letters they resemble'
      }
  }
  if (na >= ATTESTED_AT && na >= nb * DOMINANCE)
    return { verdict: 'first', take: first, na, nb, detail }
  if (nb >= ATTESTED_AT && nb >= na * DOMINANCE)
    return { verdict: 'second', take: second, na, nb, detail }
  if (na === 0 && nb === 0)
    return { verdict: 'open', why: 'neither form is in the corpus', na, nb, detail }
  return { verdict: 'open', why: 'the corpus uses both', na, nb, detail }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [path] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  if (!path || !existsSync(path)) {
    console.error('node scripts/settle-witness.mjs <witness.json> [--show <n>] [--open]')
    process.exit(2)
  }
  const args = process.argv.slice(2)
  const show = Number(args[args.indexOf('--show') + 1] ?? 0) || 0
  const openOnly = args.includes('--open')

  const count = corpusCounts()
  const report = JSON.parse(readFileSync(path, 'utf8'))
  const tally = { first: 0, second: 0, open: 0, skip: 0, joined: 0, misaligned: 0 }
  const open = []
  for (const leaf of report.leaves ?? []) {
    for (const d of leaf.disagreements ?? []) {
      if (d.kind === 'joined') {
        tally.joined += 1
        continue
      }
      const r = settle(d.first, d.second, count)
      tally[r.verdict] += 1
      if (r.verdict === 'open') open.push({ leaf: leaf.leaf, ...d, ...r })
    }
  }
  const settled = tally.first + tally.second
  const total = settled + tally.open + tally.misaligned
  console.log(
    `${report.leaves?.length ?? 0} leaves · ${tally.joined} joined (mechanical)\n` +
      `${total} substantive · ${settled} settled by the corpus · ` +
      `${tally.misaligned} misaligned (the readers lost each other) · ` +
      `${tally.open} for a person` +
      (total ? `  (${((100 * settled) / total).toFixed(1)}% settled)` : '')
  )
  const rows = openOnly ? open : open
  for (const r of rows.slice(0, show || rows.length)) {
    console.log(
      `  leaf ${r.leaf}  ${JSON.stringify(r.first)} / ${JSON.stringify(r.second)}  — ${r.why} (${r.detail})`
    )
  }
}
