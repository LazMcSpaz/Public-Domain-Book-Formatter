/**
 * The book checked against itself, with no model and no spend.
 *
 * The sense pass costs attention and its findings all have to be adjudicated
 * against a crop before any of them can be believed. This runs first and costs
 * nothing, because everything it catches is caught *deterministically* — it
 * never proposes a reading, only points at a place where the book disagrees
 * with itself. A finding from here needs no hypothesis and no second reader;
 * it needs somebody to look at the two spots and say which is right.
 *
 * That is the same division the rest of this app is built on. `checkProposals`
 * compares every date, figure and name a note asserts against the book's own
 * text; this is that machinery turned inward, on the body against itself.
 *
 * ## What it will and will not say
 *
 * Every check here is chosen for **precision over recall**, and the numbers
 * behind each threshold were measured on finished books rather than chosen.
 *
 * Every check here is chosen for **precision over recall**. A check that fires
 * on the author's own 1916 style is worse than one that stays quiet, because a
 * list nobody trusts is a list nobody reads — and the reprint's whole promise
 * is that the book's own spelling and punctuation are left alone. So there is
 * no check for archaism, none for punctuation, none for "unusual" wording, and
 * none that needs a dictionary. What is left is disagreement the book has with
 * itself, which is a fact about the text rather than an opinion about it.
 *
 * Pure: no DOM, no I/O, no network.
 */
import type { BookBlock, BookDocument } from '@core/assemble'
import { isCommonWord } from '@core/lexicon'

/** What kind of disagreement was found. */
export type ConsistencyKind =
  | 'name-variant'
  | 'stray-spelling'
  | 'doubled-word'
  | 'doubled-phrase'
  | 'unclosed-quote'
  | 'missing-chapter'

export interface ConsistencyFinding {
  kind: ConsistencyKind
  /** The block it sits in, so a crop can be cut from the leaf behind it. */
  blockId: string
  /** Source leaves the block came from — more than one across a seam. */
  pages: number[]
  /** The exact text at issue, as printed. */
  found: string
  /** What it disagrees with: the commoner spelling, the chapter list, itself. */
  against: string
  /** Enough of the sentence to recognise the place without opening the book. */
  context: string
}

/** Words too short or too common for a one-letter difference to mean anything. */
const MIN_NAME_LENGTH = 5

/**
 * How many times a spelling must appear before it is treated as the book's.
 *
 * A name printed once is not evidence of anything; a name printed nine times
 * one way and once another is a compositor's slip, and that asymmetry is the
 * whole signal. Both halves matter — without a floor on the common spelling,
 * two one-off misreadings flag each other and neither is the book's.
 */
const ESTABLISHED_USES = 3

/** Words that are legitimately doubled in ordinary English. */
const DOUBLABLE = new Set(['had', 'that', 'no', 'so', 'very', 'long', 'far', 'ha'])

/** Length of a repeated run, in words, before it is worth reporting. */
const PHRASE_WORDS = 4

/**
 * The longest repeat worth hunting for, in words.
 *
 * A doubled *line* is the common case — ten words or so — and a doubled
 * sentence the rarer one. Past this the search costs more than it finds.
 */
const MAX_PHRASE_WORDS = 24

/**
 * How far apart two spellings of a name may be.
 *
 * One, and the number was measured rather than chosen. At two this check ran
 * over a finished book and returned seventeen findings of which one was real:
 * `India`/`Indians`, `Europe`/`European`, `Attraction`/`Attractive`,
 * `Marie`/`Market`. Two edits is simply the distance at which ordinary English
 * words start colliding, and no amount of length floor or prefix rule rescues
 * it — the collisions are legitimate words, not near-misses.
 *
 * At one it returns nothing on that book, which is the right answer: a single
 * substitution is what a scan actually produces (`rn` for `m`, `l` for `I`,
 * `e` for `c`), and that is what this is for.
 *
 * The cost is real and worth stating. `Baillie` for `Bailly` is two edits, and
 * this will never catch it. That pair was found by *reading*, and finding it is
 * the sense pass's job — a name that changes shape mid-book is exactly what a
 * reader notices and what no cheap string measure can separate from morphology.
 */
const MAX_NAME_EDITS = 1

/** Letters two spellings must share at the front before they can be paired. */
const SHARED_PREFIX = 3

/**
 * How often a spelling may appear before it stops being a name.
 *
 * `Society` appears forty-eight times in the first book here and is an ordinary
 * noun that happens to be capitalised inside a title. Pairing a hapax against
 * it says nothing. A proper name that a compositor fumbled once appears a
 * handful of times, not fifty.
 */
const MAX_ESTABLISHED_USES = 20

const WORD = /[\p{L}][\p{L}'’-]*/gu

/** A block's text with markup and reference marks out of the way. */
function plain(block: BookBlock): string {
  return block.text.replace(/<[^>]*>/gu, '')
}

/** Enough either side of a hit to recognise the place. */
function around(text: string, at: number, length: number): string {
  const start = Math.max(0, at - 60)
  const end = Math.min(text.length, at + length + 60)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

/** Levenshtein distance, capped — anything past `max` is reported as `max + 1`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + cost)
      row.push(value)
      if (value < best) best = value
    }
    if (best > max) return max + 1
    previous = row
  }
  return previous[b.length]!
}

/**
 * Proper names as the book prints them, with where each one appears.
 *
 * Sentence-initial capitals say nothing about whether a word is a name, so the
 * first word of a sentence is skipped — the same reasoning, and the same
 * exclusion, as `claimsIn` in the annotation checker.
 */
function properNames(
  blocks: readonly BookBlock[]
): Map<string, { block: BookBlock; at: number }[]> {
  const names = new Map<string, { block: BookBlock; at: number }[]>()
  for (const block of blocks) {
    // A heading is set in capitals in most books of this period, so every word
    // in it looks like a name. Nothing here can learn anything from that.
    if (block.kind === 'heading') continue
    const text = plain(block)
    for (const sentence of splitSentences(text)) {
      let first = true
      for (const match of sentence.text.matchAll(WORD)) {
        const word = match[0]
        const wasFirst = first
        first = false
        if (wasFirst) continue
        if (word.length < MIN_NAME_LENGTH) continue
        if (!/^\p{Lu}/u.test(word)) continue
        // An all-capitals word is emphasis or a running head, not a spelling.
        if (word === word.toLocaleUpperCase()) continue
        const at = sentence.at + match.index
        const list = names.get(word) ?? []
        list.push({ block, at })
        names.set(word, list)
      }
    }
  }
  return names
}

/**
 * Titles and abbreviations whose full stop does not end a sentence.
 *
 * Without these "M. Bailly" splits in two and "Bailly" becomes the first word
 * of a sentence — which is exactly the position this file skips, because a
 * sentence-initial capital says nothing about whether a word is a name. The
 * effect is that every name introduced by a title becomes invisible, and names
 * introduced by a title are most of the names in a book of this kind.
 */
const NOT_A_SENTENCE_END = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'st',
  'rev',
  'prof',
  'hon',
  'jr',
  'sr',
  'messrs',
  'mme',
  'mlle',
  'no',
  'vs',
  'etc',
  'viz',
  'cf',
  'ca'
])

/** Sentences with their offsets into the block, so a finding can point at one. */
function splitSentences(text: string): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = []
  let start = 0
  const re = /[.!?]+(\s+)/gu
  for (const match of text.matchAll(re)) {
    const before = text.slice(start, match.index)
    const last = /([\p{L}]+)$/u.exec(before)?.[1] ?? ''
    // A single letter is an initial — "F. W. H. Myers" — and a listed
    // abbreviation is an abbreviation. Neither closes a sentence.
    if (last.length === 1 || NOT_A_SENTENCE_END.has(last.toLocaleLowerCase())) continue
    const end = match.index + match[0].length
    out.push({ text: text.slice(start, end), at: start })
    start = end
  }
  if (start < text.length) out.push({ text: text.slice(start), at: start })
  return out
}

/**
 * Whether two spellings are near enough to be one name printed two ways.
 *
 * The distance alone is not enough. "Hindu" and "Hindus" are one edit apart and
 * are a word and its plural; "Vedas" and "Veda" likewise. So an inflection is
 * exempted outright rather than left to a threshold, because no threshold can
 * tell a plural from a slip and a check that flags every plural in a book about
 * India is a check nobody will read to the end of.
 */
function nearlyTheSame(rare: string, common: string): boolean {
  const a = rare.toLocaleLowerCase()
  const b = common.toLocaleLowerCase()
  if (Math.max(a.length, b.length) < MIN_NAME_LENGTH + 1) return false
  // A plural, a possessive, or any other suffix is not a misspelling: one
  // spelling being the front of the other is what morphology looks like, and
  // `Europe`/`European`, `Highlands`/`Highlanders` and `Crookes`/`Crookes’`
  // are all of them that shape.
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  if (long.startsWith(short)) return false
  let shared = 0
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++
  if (shared < SHARED_PREFIX) return false
  return distance(a, b, MAX_NAME_EDITS) <= MAX_NAME_EDITS
}

/**
 * A name the book spells two ways.
 *
 * Reported when one spelling is established and the other is nearly it and
 * nearly absent: "Baillie" once against "Bailly" nine times is a slip, and
 * "Bailly" against "Barrett" is two people. One edit apart only — two lets in
 * genuinely different names of similar length, and this check is worth more
 * quiet than loud.
 */
function nameVariants(blocks: readonly BookBlock[]): ConsistencyFinding[] {
  const names = properNames(blocks)
  const established = [...names.entries()].filter(([, uses]) => uses.length >= ESTABLISHED_USES)
  const findings: ConsistencyFinding[] = []

  for (const [rare, uses] of names) {
    if (uses.length >= ESTABLISHED_USES) continue
    for (const [common, commonUses] of established) {
      if (common === rare) continue
      if (commonUses.length > MAX_ESTABLISHED_USES) continue
      if (commonUses.length <= uses.length * 2) continue
      if (!nearlyTheSame(rare, common)) continue
      for (const use of uses) {
        const text = plain(use.block)
        findings.push({
          kind: 'name-variant',
          blockId: use.block.id,
          pages: [...use.block.sourcePages],
          found: rare,
          against: `${common} (${commonUses.length} uses against ${uses.length})`,
          context: around(text, use.at, rare.length)
        })
      }
      break
    }
  }
  return findings
}

/**
 * How often a word must appear before it counts as this book's own spelling.
 *
 * Four, and measured. At eight this returned six findings on *Clairvoyance*, of
 * which five were real. At four it returns nineteen, of which about fourteen
 * are — `monsier` for `monsieur`, `leaning` for `learning`, `deign` for
 * `design`, `union` for `unison`, `hundrds`, `arrivd`, `discoverd`. Doubling
 * the list roughly trebled what it caught, and nineteen rows on a 328-leaf book
 * is a minute's reading.
 *
 * Below four it would meet `ESTABLISHED_USES`, where the name check's own note
 * says ordinary English starts colliding, and the floor stops being a floor.
 *
 * The cost of any floor is honest: a short book may have no settled spelling to
 * measure a stray against. *The Human Aura* is 88 leaves and prints
 * `radio-active` three times, so its own `radioative` — a real slip, found by a
 * second transcription — is invisible here. This check wants a long book.
 */
const SETTLED_USES = 4

/** Below this a word has too many neighbours for one edit to mean anything. */
const MIN_STRAY_LENGTH = 5

/**
 * A word the book uses **once** that is one slip away from a word it uses often.
 *
 * The one check here that would have caught, with no second transcription and
 * no model, most of what a second transcription actually caught: `belleves` for
 * `believes`, `snbstance` for `substance`, `tlairvoyant` for `clairvoyant`,
 * `gresn` for `green`, `adtral` for `astral`, `physicgl` for `physical`,
 * `radioative` for `radio-active`, `perscription` for `prescription`. Every one
 * of them is a hapax sitting one edit from a word the same book prints dozens
 * of times.
 *
 * It needs no dictionary, which is what makes it usable on a book nobody else
 * has transcribed: **the book's own vocabulary is the dictionary**. That is the
 * same trick Gate 1's term review runs on, turned on the finished text.
 *
 * ## Kept quiet on purpose
 *
 * Four guards, and each one was needed:
 *
 * - **The stray appears once.** Twice is a spelling the book has, not a slip.
 * - **A transposition counts as one slip**, because a compositor reaching into
 *   the wrong box produces `perscription` and Levenshtein calls that two.
 * - **A difference in the last position is ignored.** That is where plurals and
 *   tenses live — `aura`/`auras`, `believe`/`believed` — and every one of them
 *   would otherwise be a finding.
 * - **An ordinary English word is never a stray.** A book may use `wove` once
 *   and `wave` often, and neither is an error. `isCommonWord` only ever makes
 *   this quieter, which is why a stop list is allowed here where a dictionary
 *   of real words would not be: it cannot invent a finding, only withdraw one.
 */
function straySpellings(blocks: readonly BookBlock[]): ConsistencyFinding[] {
  const uses = new Map<string, { block: BookBlock; at: number }[]>()
  for (const block of blocks) {
    if (block.kind === 'table') continue
    const text = plain(block)
    for (const m of text.matchAll(WORD)) {
      const word = m[0].toLowerCase().replace(/[’']/gu, "'")
      if (!uses.has(word)) uses.set(word, [])
      uses.get(word)!.push({ block, at: m.index ?? 0 })
    }
  }

  const settled = [...uses.entries()].filter(([w, u]) => u.length >= SETTLED_USES && w.length >= 3)
  const findings: ConsistencyFinding[] = []

  for (const [stray, where] of uses) {
    if (where.length !== 1) continue
    if (stray.length < MIN_STRAY_LENGTH) continue
    if (isCommonWord(stray)) continue

    for (const [common, commonUses] of settled) {
      if (common === stray) continue
      if (!oneSlipApart(stray, common)) continue
      const use = where[0]!
      findings.push({
        kind: 'stray-spelling',
        blockId: use.block.id,
        pages: [...use.block.sourcePages],
        found: stray,
        against: `${common} (${commonUses.length} uses against 1)`,
        context: around(plain(use.block), use.at, stray.length)
      })
      break
    }
  }
  return findings
}

/**
 * One slip apart: a **dropped or added letter**, or a transposition of
 * neighbours — and never at the final letter.
 *
 * ## Why substitutions are excluded, which was measured
 *
 * Allowing one substitution returned 129 findings on *Clairvoyance* and not one
 * of them was real: `winds` against `minds`, `crass` against `class`, `smart`
 * against `start`, `sneer` against `seer`, `chose` against `those`, `coarse`
 * against `course`. Changing one letter of an English word very often produces
 * another English word, and with no dictionary there is nothing here that can
 * tell those apart from `gresn` for `green`.
 *
 * Dropping or adding one rarely does. That asymmetry is the whole of this
 * check: `hundrds`, `developd`, `arrivd`, `discoverd`, `conciously` are all
 * dropped letters, and all five were real slips in a real book.
 *
 * What that gives up is honest and worth stating: `tlairvoyant` for
 * `clairvoyant` and `snbstance` for `substance` are substitutions, and this
 * will never see them. Those are what a *second reader* is for — two engines
 * reading the same ink do not make the same substitution — and the two checks
 * divide the work between them rather than overlapping.
 *
 * The last position is excluded because that is where English keeps its plurals
 * and its tenses, and a check that reported `aura` against `auras` would report
 * a hundred of them.
 */
function oneSlipApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false

  if (a.length === b.length) {
    // A transposition of two neighbours: Levenshtein scores it 2, and it is the
    // commonest thing a compositor does with a pair of adjacent sorts.
    const differs = []
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differs.push(i)
    if (differs.length !== 2 || differs[1] !== differs[0]! + 1) return false
    const [i, j] = differs as [number, number]
    if (a[i] !== b[j] || a[j] !== b[i]) return false
    // Only the very first pair is excluded: `raising` for `arising` swaps the
    // opening two letters and is an ordinary word. One in from there,
    // `perscription` for `prescription` is a compositor reaching into the
    // wrong box, and a swap that deep almost never makes another word.
    return i >= 1 && j < a.length - 1
  }

  // A **dropped** letter, and only that: the stray must be the shorter word.
  // An added one is not symmetrical with it, because a letter added at the
  // front of an English word so often makes another English word — `sever`,
  // `beach`, `lover`, `treason`, `strain`, `prays`, `swords` and `mothers`
  // were all findings of that kind, and every one of them was wrong.
  if (a.length > b.length) return false
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  let j = 0
  while (j < a.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++
  if (i + j < a.length) return false
  // Not in the first couple of letters, where `lanes` for `planes` and `bought`
  // for `brought` live, and not at the very end, where the plurals do.
  return i >= GAP_FROM_FRONT && i < a.length
}

/**
 * How far into a word a dropped letter must fall to be damage.
 *
 * A letter missing from the front is usually a different word rather than a
 * damaged one. Inside the word it is nearly always damage.
 */
const GAP_FROM_FRONT = 2

/**
 * A word printed twice in a row.
 *
 * Very high precision and the classic artefact of a page seam or a line the
 * compositor set twice. A short list of words English really does double
 * ("that that", "had had") keeps it honest.
 */
function doubledWords(blocks: readonly BookBlock[]): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = []
  for (const block of blocks) {
    const text = plain(block)
    const re = /\b(\p{L}[\p{L}'’-]*)(\s+)(\1)\b/giu
    for (const match of text.matchAll(re)) {
      const word = match[1]!.toLocaleLowerCase()
      if (DOUBLABLE.has(word)) continue
      findings.push({
        kind: 'doubled-word',
        blockId: block.id,
        pages: [...block.sourcePages],
        found: match[0],
        against: 'the same word twice',
        context: around(text, match.index, match[0].length)
      })
    }
  }
  return findings
}

/**
 * A run of words printed twice in a row.
 *
 * What a page seam does when a line is set on both leaves. Assembly heals
 * hyphens and rejoins broken sentences, but a phrase genuinely printed twice
 * survives it — and it survives looking right, which is why it needs a check
 * rather than a reader.
 */
function doubledPhrases(blocks: readonly BookBlock[]): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = []
  for (const block of blocks) {
    const text = plain(block)
    const words = [...text.matchAll(WORD)]
    const same = (i: number, j: number): boolean =>
      words[i]![0].toLocaleLowerCase() === words[j]![0].toLocaleLowerCase()
    for (let i = 0; i + PHRASE_WORDS * 2 <= words.length; i++) {
      // Every repeat length, longest first, because a doubled line contains a
      // doubled phrase and it is the line that should be reported. Searching
      // one fixed width finds only a repeat of exactly that period — an eight-
      // word line set twice slips straight through a four-word window.
      const longest = Math.min(MAX_PHRASE_WORDS, (words.length - i) >> 1)
      let run = 0
      for (let n = longest; n >= PHRASE_WORDS; n--) {
        let k = 0
        while (k < n && same(i + k, i + n + k)) k++
        if (k === n) {
          run = n
          break
        }
      }
      if (run === 0) continue
      const last = words[i + run * 2 - 1]!
      const at = words[i]!.index
      const end = last.index + last[0].length
      findings.push({
        kind: 'doubled-phrase',
        blockId: block.id,
        pages: [...block.sourcePages],
        found: text.slice(at, end),
        against: `${run} words repeated immediately`,
        context: around(text, at, end - at)
      })
      i += run * 2 - 1
    }
  }
  return findings
}

/**
 * A block that opens a quotation and never closes it.
 *
 * Counted in printer's marks only. Straight marks are ambiguous by nature —
 * the same character opens and closes — so a book still carrying them cannot
 * be measured this way and is left alone rather than guessed at. Run this after
 * `withTypographicQuotes` and it has something to count; run it before and it
 * correctly says nothing.
 *
 * A quotation running over several paragraphs is normal typography: each
 * paragraph opens and only the last closes. So an unclosed mark is reported
 * only when the *next* block does not open one, which is what tells a continued
 * quotation from a lost one.
 */
function unclosedQuotes(blocks: readonly BookBlock[]): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = []
  blocks.forEach((block, i) => {
    const text = plain(block)
    const opens = (text.match(/“/gu) ?? []).length
    const closes = (text.match(/”/gu) ?? []).length
    if (opens <= closes) return
    const next = blocks[i + 1]
    if (next && plain(next).trimStart().startsWith('“')) return
    const at = text.lastIndexOf('“')
    findings.push({
      kind: 'unclosed-quote',
      blockId: block.id,
      pages: [...block.sourcePages],
      found: around(text, at, 1),
      against: `${opens} opening marks against ${closes} closing`,
      context: around(text, Math.max(0, text.length - 80), 80)
    })
  })
  return findings
}

const ROMAN = /\b(?:LESSON|CHAPTER|PART|BOOK)\s+([IVXLC]+)\b/giu

/**
 * A cross-reference to a chapter the book does not have.
 *
 * "See Lesson XXII" in a book of twenty is either a misreading of the numeral
 * or a reference to a book that was never printed, and either way somebody
 * should look. Roman numerals only, because that is what a book of this period
 * uses and because a bare arabic number in running prose is far more often a
 * quantity than a reference.
 */
function missingChapters(doc: BookDocument): ConsistencyFinding[] {
  const printed = new Set<string>()
  for (const chapter of doc.chapters) {
    for (const match of `${chapter.label ?? ''} ${chapter.title}`.matchAll(ROMAN)) {
      printed.add(match[1]!.toLocaleUpperCase())
    }
  }
  if (printed.size === 0) return []

  const findings: ConsistencyFinding[] = []
  for (const block of doc.blocks) {
    if (block.kind === 'heading') continue
    const text = plain(block)
    for (const match of text.matchAll(ROMAN)) {
      const numeral = match[1]!.toLocaleUpperCase()
      if (printed.has(numeral)) continue
      findings.push({
        kind: 'missing-chapter',
        blockId: block.id,
        pages: [...block.sourcePages],
        found: match[0],
        against: `the book prints ${[...printed].join(', ')}`,
        context: around(text, match.index, match[0].length)
      })
    }
  }
  return findings
}

/**
 * Every way the book disagrees with itself, in reading order.
 *
 * Runs over the *assembled* document, never over raw pages: a doubled phrase
 * and a name variant both live at page seams, and a seam is exactly what a raw
 * leaf cannot show you.
 */
export function checkConsistency(doc: BookDocument): ConsistencyFinding[] {
  const blocks = [...doc.blocks, ...doc.sections.flatMap((s) => s.blocks)]
  const order = new Map(blocks.map((b, i) => [b.id, i]))
  return [
    ...nameVariants(blocks),
    ...straySpellings(blocks),
    ...doubledWords(blocks),
    ...doubledPhrases(blocks),
    ...unclosedQuotes(blocks),
    ...missingChapters(doc)
  ].sort((a, b) => (order.get(a.blockId) ?? 0) - (order.get(b.blockId) ?? 0))
}
