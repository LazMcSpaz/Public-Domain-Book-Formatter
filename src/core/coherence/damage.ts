/**
 * Conversion damage: the faults a *text layer* carries that a scan does not.
 *
 * `consistency.ts` asks where the book disagrees with itself about a word or a
 * structure. This asks a narrower question with a different provenance behind
 * it: where does the text carry a mark that **no compositor sets** — a word
 * split by a space, a full stop in the middle of a clause, an apostrophe doing
 * a comma's work?
 *
 * ## Why this is a separate module, and why it is not a style checker
 *
 * The rule those two live under is stated in `sense.ts` and is worth repeating
 * here, because this module looks from the outside like the thing that rule
 * forbids: *"There is deliberately no `style`, no `punctuation`, no `spelling`
 * and no `archaism`. The 1916 prose is the deliverable, not a draft to
 * improve."*
 *
 * That holds, and nothing here softens it. The distinction is **provenance,
 * not taste**. On a photographed leaf, a full stop where a comma would read
 * better is the compositor's pointing, and this edition promises to reproduce
 * it. In a PDF whose "scan" is a text layer somebody OCR'd in 2016, the same
 * character was produced by a program that mistook a comma for a period, and
 * reproducing it is reproducing the *conversion* rather than the book. No
 * reader of the 1975 typescript ever saw `descrip tion`.
 *
 * So this check does not ask whether a mark reads well. It asks whether a mark
 * is one the printing trade produces at all, and every kind below is chosen
 * because the answer is no.
 *
 * ## What replaces the pixels
 *
 * CLAUDE.md's standing rule is **a model may propose a reading; only pixels
 * may accept one**. A born-digital PDF with no page images has no pixels to
 * offer: `looksScanned` says, correctly, that the page is not a photograph,
 * and a "crop" of such a leaf is the text layer drawn again. That is not an
 * independent witness; it is the same witness in a larger typeface.
 *
 * What stands in its place is the **book's own text**, and the substitution is
 * only sound where the book can actually answer. So every finding here carries
 * a `confidence`, and the two values mean genuinely different things:
 *
 * - `attested` — *the book settled it.* `description` is set 29 times in this
 *   volume and `descrip` is set once, inside the fault itself. That is the
 *   same argument `draft/hyphens.ts` already makes about a line-break hyphen,
 *   and it is not a reading: OCR read the characters, and whether the space
 *   between them is one the author typed is a typographic question the
 *   volume answers by having typed the word whole three hundred pages away.
 * - `shape` — *the book cannot settle it, and a person must look.* A stray
 *   full stop has no joined form to attest. The check says where, and stops.
 *
 * Nothing here emits replacement text into the book. `expected` is a
 * hypothesis, carried so the sheet can show it and the ledger can score it,
 * and it is never a character that reaches a page without someone saying so —
 * the same discipline `settle()` enforces for the sense pass.
 *
 * Pure: no DOM, no I/O, no network.
 */
import type { BookBlock, BookDocument, Footnote } from '@core/assemble'
import { greekModel, greekWordsIn, hasGreek } from './greek'

/** What kind of damage was found. A closed list, and short on purpose. */
export type DamageKind =
  /** A word the conversion broke in half: `descrip tion`, `amb iguity`. */
  | 'split-word'
  /** A full stop no compositor set: doubled, or mid-clause before a lowercase word. */
  | 'stray-point'
  /** An apostrophe standing where a comma belongs: `examination' I tell`. */
  | 'stray-apostrophe'
  /** A footnote that prints its own reference mark at its head: `*Eve is…`. */
  | 'marked-note'
  /** A paragraph a page break cut in two where the seam rule could not see it. */
  | 'seam-split'
  /** Characters no compositor set: `rSSS`, `C<esarea`, `Av8pw11`, `�`. */
  | 'garbled'
  /** Greek the conversion read as Latin letters alone: `Moipa`, `Xpbvos`. */
  | 'greek'
  /** A table run into a paragraph: mostly figures and one- or two-letter tokens. */
  | 'table-as-prose'
  /** A whole book with almost no italic, which no book of any length sets. */
  | 'italics-absent'

/**
 * How much authority the finding carries.
 *
 * SPEC §4's honest tiers, applied to a check rather than to a model. `attested`
 * is a measurement over the book's own vocabulary and can be acted on once a
 * person has agreed the class is real; `shape` is a pattern match and is a
 * place to look, nothing more. A check that reported both as one number would
 * be claiming an authority half its findings do not have.
 */
export type DamageConfidence = 'attested' | 'shape'

export interface DamageFinding {
  kind: DamageKind
  /** The block it sits in, so an edit can be keyed to it. */
  blockId: string
  /** Source leaves the block came from — more than one across a seam. */
  pages: number[]
  /** The exact text at issue, as it stands. */
  found: string
  /** What decided it: the book's own count, or the shape of the mark. */
  against: string
  /** Enough of the sentence to recognise the place without opening the book. */
  context: string
  confidence: DamageConfidence
  /**
   * What the book's own vocabulary says the words were: `description`.
   *
   * Present on every split word, including the `shape` tier where one half
   * is a common word, and **never applied by anything in this module**. It is the hypothesis, carried so a sheet can show it beside
   * the evidence that produced it.
   */
  expected?: string
}

/**
 * How often a fragment may appear before it stops being a fragment.
 *
 * Three, and the number is a bug fix rather than a preference. The first
 * version of this check asked only whether the joined form was attested and
 * each half was not — and it returned **nothing at all** on a book with ten
 * real splits in it, because *the fragments enter the vocabulary themselves*.
 * `tion` is "a word this book uses" precisely because `descrip tion` and
 * `induc tion` are the two places it uses it. A presence test cannot see a
 * fault that supplies its own evidence; a frequency test can.
 */
const FRAGMENT_CEILING = 3

/**
 * How often the joined form must appear before it is the book's word.
 *
 * Two. One is a hapax and says nothing — and worse, a book containing
 * `descrip tion` twice would attest `description` once against itself if the
 * floor were one.
 */
const JOINED_FLOOR = 2

/** The shortest fragment worth pairing. Below this, ordinary words collide. */
const MIN_FRAGMENT = 2

/**
 * A lower-case letter standing alone that no English sentence sets as a word.
 *
 * `a` is a word and `I` is written upper case, so a lower-case `i` or `t`
 * standing alone is a piece of something: `i t would`, `t hat one`. Only
 * lower case counts, because upper-case letters are what a book uses for
 * variables and sets (`X as Y`, `set B`) and those are words in their place.
 */
const LONE_LETTER = /^[b-z]$/u

/** A word set with an initial capital and the rest lower case. */
const TITLE_CASE = /^\p{Lu}[\p{Ll}\p{M}'’-]+$/u

/** Words that stand before a letter when the letter itself is the subject. */
const NAMES_A_LETTER = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'or', 'as', 'letter'])

/**
 * Abbreviations that legitimately take a full stop mid-sentence.
 *
 * Without this list every `etc. and`, `vol. ii` and `cf. the` is a finding.
 * Single letters need no entry: the rule below requires three letters before
 * the stop, which excludes `e.g.`, `i.e.` and a set of initials on its own.
 */
const ABBREVIATIONS = new Set([
  // The apparatus of a nineteenth-century citation, which is what these
  // books are full of. `“Simpl. in Phys.,”` and `“Hist. of Magic,” vol. i.`
  // were being read as commas mis-set as full stops, because the word after
  // the stop is lower case and cannot open a sentence — which is exactly the
  // invariant `stray-point` rests on, and exactly what an abbreviated title
  // breaks.
  'hist',
  'simpl',
  'phys',
  'lib',
  'bk',
  'pt',
  'pts',
  'sect',
  'sects',
  'art',
  'arts',
  'pl',
  'pls',
  'ch',
  'nos',
  'ser',
  'comm',
  'quaest',
  'etc',
  // `per cent.`: the period's form, and a figure, not a word, precedes `per`.
  'cent',
  'viz',
  'cf',
  'ibid',
  'op',
  'cit',
  'vol',
  'vols',
  'fig',
  'figs',
  'chap',
  'chaps',
  'sec',
  'secs',
  'pp',
  'ed',
  'eds',
  'trans',
  'rev',
  'inc',
  'ltd',
  'co',
  'dr',
  'mr',
  'mrs',
  'prof',
  'jr',
  'sr',
  'st',
  'approx',
  // The Theosophical Glossary's citations: `(A Dict. of Christian
  // Biography)` and `(Hieronymus’ Comment. to Matthew)`.
  'dict',
  'comment',
  'est',
  'esp',
  'anon',
  // `1 et seq. for easier reading` — the Latin of a citation, not a stop.
  'seq',
  'seqq',
  // Months, in a dated citation: `Nos. 10 and 11, of Jan. and Feb. 1887`.
  // `mar` is left out: it is a word, and a month abbreviated before a
  // lower-case function word is rare enough to look at.
  'jan',
  'feb',
  'apr',
  'jun',
  'jul',
  'aug',
  'sept',
  'oct',
  'nov',
  'dec'
])

/**
 * Words that cannot open a sentence in lower case.
 *
 * This is the whole precision of `stray-point`, and it is a closed list rather
 * than a rule because the invariant it encodes is about English typography
 * rather than about grammar: **a sentence begins with a capital.** A lower-case
 * word after a full stop is therefore either an abbreviation (excluded above),
 * a proper noun the book sets lower case (vanishingly rare), or a comma the
 * conversion read as a period. Restricting it further to function words — which
 * carry no capitalisation of their own under any convention — removes the last
 * class of doubt.
 */
const CANNOT_OPEN_A_SENTENCE = new Set([
  'the',
  'he',
  'she',
  'it',
  'they',
  'we',
  'you',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'and',
  'but',
  'that',
  'this',
  'which',
  'who',
  'whom',
  'to',
  'of',
  'in',
  'on',
  'for',
  'with',
  'as',
  'at',
  'by',
  'from',
  'not',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'will',
  'would',
  'can',
  'could',
  'should',
  'may',
  'might',
  'must',
  'its',
  'his',
  'her',
  'their',
  'our',
  'your',
  'my',
  'there',
  'then',
  'these',
  'those',
  'if',
  'when',
  'while',
  'than',
  'or',
  'nor',
  'so',
  'yet',
  'because',
  'although',
  'though',
  'since',
  'until',
  'upon',
  'into',
  'onto',
  'about',
  'over',
  'under',
  'after',
  'before',
  'during'
])

/** A block's text with markup out of the way. */
function plain(block: BookBlock): string {
  return block.text.replace(/<[^>]*>/gu, '')
}

/** Enough either side of a hit to recognise the place. */
function around(text: string, at: number, length: number): string {
  const start = Math.max(0, at - 60)
  const end = Math.min(text.length, at + length + 60)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

const WORD = /[\p{L}][\p{L}\p{M}'’-]*/gu

/** Every word the book sets, and how often — the witness the pixels are not. */
function vocabulary(blocks: readonly BookBlock[]): Map<string, number> {
  const seen = new Map<string, number>()
  for (const block of blocks) {
    for (const match of plain(block).matchAll(WORD)) {
      const word = match[0].toLocaleLowerCase()
      seen.set(word, (seen.get(word) ?? 0) + 1)
    }
  }
  return seen
}

/**
 * A word the conversion broke in half.
 *
 * The highest-precision check here — measured at **10 findings, 10 real, no
 * false positives** over a finished 121-leaf volume that had already been
 * through a full reading, 465 corrections and an export.
 *
 * **Adjacent pairs, not regex matches, and that distinction hid six of the
 * ten.** The obvious implementation runs a two-word pattern with `matchAll`,
 * which consumes what it matches: scanning `lines of the induc tion and`, it
 * takes `lines of`, then `the induc`, and `induc tion` is never a pair the
 * check considers at all. Every word must be tried against the one after it,
 * which means walking the token list rather than letting a regex walk it.
 *
 * The space must be exactly one and it must be a space — a line break carries
 * no claim about whether the words are one, and a book with a hard break
 * inside a block would flag on every line of it.
 *
 * **Both halves rare is `attested`; one half rare is `shape`.** The strict
 * rule returned nothing on the same volume while it still held `i t`,
 * `t hat`, `be fore` and `let ters`: a split whose half is a common word
 * (`be`, `let`) or a single letter never passes a test that needs both
 * halves rare. So a second tier takes a pair where only one half is rare, or
 * is a lone lower-case letter, and the joined word is the book's. It is a
 * place to look rather than a verdict, because a common word beside a rare
 * one is sometimes just two words: `came in sight` is not `insight`.
 */
function splitWords(blocks: readonly BookBlock[]): DamageFinding[] {
  const seen = vocabulary(blocks)
  const count = (word: string): number => seen.get(word) ?? 0
  const findings: DamageFinding[] = []

  for (const block of blocks) {
    const text = plain(block)
    const words = [...text.matchAll(WORD)]
    for (let i = 0; i + 1 < words.length; i++) {
      const left = words[i]!
      const right = words[i + 1]!
      const gap = text.slice(left.index + left[0].length, right.index)
      if (gap !== ' ') continue
      // A word is only letters to this walk, so the `th` of `19th` is a word
      // of its own and `19th in` would read as `th in`. A token glued to a
      // digit on either side is part of something longer.
      if (/\d/u.test(text[left.index - 1] ?? '')) continue
      if (/\d/u.test(text[right.index + right[0].length] ?? '')) continue

      const a = left[0].toLocaleLowerCase()
      const b = right[0].toLocaleLowerCase()
      const joined = a + b
      if (count(joined) < JOINED_FLOOR) continue
      // Two title-case halves are a name, `Sakya Muni` or `Du Bois`, however
      // the book elsewhere runs them together. Capitals throughout are a
      // heading, where a split is still a split.
      if (TITLE_CASE.test(left[0]) && TITLE_CASE.test(right[0])) continue

      const rare = (raw: string, word: string): boolean =>
        raw.length < MIN_FRAGMENT ? LONE_LETTER.test(raw) : count(word) < FRAGMENT_CEILING
      const rareA = rare(left[0], a)
      const rareB = rare(right[0], b)
      const strict = a.length >= MIN_FRAGMENT && b.length >= MIN_FRAGMENT && rareA && rareB
      if (!strict) {
        // The loose tier: one rare half is enough, but a single letter that
        // is a word (`a`, `I`, a variable) never takes part — `a part` is two
        // words, where `i t` is a word broken twice over.
        if (!rareA && !rareB) continue
        if ((a.length < MIN_FRAGMENT && !rareA) || (b.length < MIN_FRAGMENT && !rareB)) continue
        // A lone letter after an article or preposition is a letter being
        // named (`the m and the n`), and one before a stop is an abbreviation
        // or an initial (`turn to p. 47`).
        if (b.length < MIN_FRAGMENT && NAMES_A_LETTER.has(a)) continue
        if (b.length < MIN_FRAGMENT && text[right.index + 1] === '.') continue
      }

      const at = left.index
      const end = right.index + right[0].length
      findings.push({
        kind: 'split-word',
        blockId: block.id,
        pages: [...block.sourcePages],
        found: text.slice(at, end),
        against:
          `the book sets ${joined} ${count(joined)} times, ` +
          `${a} ${count(a)} and ${b} ${count(b)}`,
        context: around(text, at, end - at),
        confidence: strict ? 'attested' : 'shape',
        expected: joined
      })
    }
  }
  return findings
}

/**
 * A full stop the printing trade does not set.
 *
 * Two shapes, both lexical, both `shape` rather than `attested` because a
 * stray stop has no joined form for the book to have set elsewhere.
 *
 * **Doubled.** `linguistics.. . . forms part` — the conversion joined a
 * lead-in to a displayed quotation that opened on an ellipsis, and the two
 * stops met. A letter must stand immediately before the pair: without that,
 * a contents page of dot leaders (`……..5`) produces a finding per entry, which
 * was measured and is why the guard is on the letter rather than on the dots.
 *
 * **Mid-clause.** `his accomplishments, typically. are either viewed` — a
 * comma the conversion read as a period. The stop is followed by a lower-case
 * word that cannot open a sentence, which is the invariant doing the work
 * here; see `CANNOT_OPEN_A_SENTENCE`.
 */
/** A lower-case roman numeral of two letters or more, and only a valid one. */
const ROMAN = /^(?=[ivxlc]{2})c{0,3}(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/u

function strayPoints(blocks: readonly BookBlock[]): DamageFinding[] {
  const findings: DamageFinding[] = []
  for (const block of blocks) {
    const text = plain(block)

    for (const match of text.matchAll(/(?<=\p{L})\.\.(?!\.)/gu)) {
      findings.push({
        kind: 'stray-point',
        blockId: block.id,
        pages: [...block.sourcePages],
        found: match[0],
        against: 'two full stops with no ellipsis around them',
        context: around(text, match.index, match[0].length),
        confidence: 'shape'
      })
    }

    // The word before the stop is captured **whole**, capital and all. It used
    // to be a run of lower-case letters only, which matched `impl` inside
    // `Simpl.` and `ist` inside `Hist.` — so the abbreviation lookup below was
    // handed a fragment that is in no list, and every abbreviated citation
    // title in an 1877 book came back as a comma mis-read. The reported text
    // was the giveaway: findings that read `"impl. in"` and `"ist. of"`.
    // Catching a capitalised word is still wanted — `Professor Sterry Hunt. in
    // showing` is a real one — it just has to be recognised first.
    for (const match of text.matchAll(/(\p{L}[\p{L}\p{M}]{2,})\.[ ]([\p{Ll}]+)\b/gu)) {
      const word = match[1]!
      const before = word.toLocaleLowerCase()
      const after = match[2]!.toLocaleLowerCase()
      if (ABBREVIATIONS.has(before)) continue
      // A chapter or verse in small roman numerals — `In Genesis xxxii. the
      // God-Sun` — is a citation, and a citation's stop is not a sentence's.
      if (ROMAN.test(word)) continue
      // A word in full capitals before a stop is a running head, a heading or
      // an initialism — never a comma the conversion mis-read. Without this,
      // widening the capture to take a capitalised word turned the head at the
      // top of every page into a finding: `A MODERN PANARION.` followed by the
      // first lower-case word of the body, sixty times in one book. `MSS.` and
      // `SPR.` go the same way, and no abbreviation list would have covered
      // them all.
      if (word === word.toLocaleUpperCase() && /\p{L}{2,}/u.test(word)) continue
      if (!CANNOT_OPEN_A_SENTENCE.has(after)) continue
      // Not inside a run of dot leaders, where every gap looks like this.
      if (text.slice(Math.max(0, match.index - 4), match.index).includes('.')) continue
      findings.push({
        kind: 'stray-point',
        blockId: block.id,
        pages: [...block.sourcePages],
        found: match[0],
        against: `a sentence cannot open with “${after}”`,
        context: around(text, match.index, match[0].length),
        confidence: 'shape'
      })
    }
  }
  return findings
}

/**
 * An apostrophe standing where a comma belongs.
 *
 * `when I have reached that part of the physical examination' I tell my
 * patients` — the conversion read a comma as an apostrophe, and the sentence
 * now has a quotation mark in it that opens nothing.
 *
 * **The quotation walk is the whole precision of this check.** A naive pattern
 * flags every closing single quote in the book: measured over one volume it
 * returned ten findings of which five were `'hello'`, `'something'` and
 * `'vestibule'` — ordinary quoted words. Walking the block and tracking
 * whether a quotation is open takes it to **seven findings, seven real**, on
 * the same text. A mark that closes something is not a stray mark, and only a
 * left-to-right walk can tell that a given apostrophe does.
 *
 * A possessive is excluded by its `s`, which also costs this check the plural
 * possessive it would otherwise catch — `the authors' intention` is correct and
 * `the childrens' book` is not, and neither is distinguishable from here.
 */
function strayApostrophes(blocks: readonly BookBlock[]): DamageFinding[] {
  const findings: DamageFinding[] = []
  // `’` and `'` can each be a possessive, a contraction, a closing quote or
  // a comma the conversion mis-read. `‘` can only open a quotation, so it is
  // never a finding — but it has to be *seen*, because the walk's whole
  // precision comes from knowing a quotation is open. Leaving it out made
  // every closing `’` after an opening `‘` look stray: on *Isis Unveiled*
  // Vol. I that was `‘psychic force’ are` and `‘tukki’ is`, and eighteen of
  // that book's forty findings were this one mistake.
  const isMark = (c: string): boolean => c === "'" || c === '\u2019'
  const opensQuotation = (c: string): boolean => c === '\u2018' || c === '\u201b'

  for (const block of blocks) {
    const text = plain(block)
    let quotationOpen = false

    for (let i = 0; i < text.length; i++) {
      if (opensQuotation(text[i]!)) {
        quotationOpen = true
        continue
      }
      if (!isMark(text[i]!)) continue
      const before = i > 0 ? text[i - 1]! : ' '
      const after = i + 1 < text.length ? text[i + 1]! : ' '

      // Opens a quotation: nothing word-like before it, a letter after.
      if (!/\p{L}/u.test(before) && /\p{L}/u.test(after)) {
        quotationOpen = true
        continue
      }
      // Closes the one that is open. Not a stray mark, whatever it looks like.
      if (quotationOpen) {
        quotationOpen = false
        continue
      }
      // A letter before and a space after: not a possessive, not a contraction,
      // and closing nothing. That is a comma the conversion mis-read.
      if (!/\p{L}/u.test(before) || after !== ' ') continue
      const word = /([\p{L}][\p{L}\p{M}-]{2,})$/u.exec(text.slice(0, i))
      const next = /^ ([\p{L}]+)/u.exec(text.slice(i + 1))
      if (!word || !next) continue
      // A name ending in any sibilant takes the bare apostrophe for its
      // possessive in these books, not only one ending in `s`: `the German
      // annalist Archenholz’ work` (the Theosophical Glossary, leaf 121).
      if (/[sxz]$/u.test(word[1]!.toLocaleLowerCase())) continue

      const at = i - word[1]!.length
      const end = i + 1 + next[0].length
      findings.push({
        kind: 'stray-apostrophe',
        blockId: block.id,
        pages: [...block.sourcePages],
        found: text.slice(at, end),
        against: 'an apostrophe that is neither possessive nor closing a quotation',
        context: around(text, at, end - at),
        confidence: 'shape'
      })
    }
  }
  return findings
}

/**
 * Every mark in the book that the printing trade does not set, in reading order.
 *
 * Runs over the *assembled* document for the same reason `checkConsistency`
 * does: a word split across a page seam is joined by assembly, and the
 * vocabulary that settles a split word is the whole volume's rather than one
 * leaf's. Run this over raw pages and both halves of it get weaker.
 *
 * Free, deterministic, and it never proposes a character that reaches the page.
 */
export function checkDamage(doc: BookDocument): DamageFinding[] {
  const blocks = [...doc.blocks, ...doc.sections.flatMap((s) => s.blocks)]
  const order = new Map(blocks.map((b, i) => [b.id, i]))
  const inBody = [
    ...splitWords(blocks),
    ...strayPoints(blocks),
    ...strayApostrophes(blocks),
    ...seamSplits(doc.blocks),
    ...garbled(blocks),
    ...tablesAsProse(blocks)
  ].sort((a, b) => (order.get(a.blockId) ?? 0) - (order.get(b.blockId) ?? 0))
  const units = [
    ...blocks
      .filter((b) => b.kind !== 'table')
      .map((b) => ({ id: b.id, pages: [...b.sourcePages], text: b.text })),
    ...doc.footnotes.map((n) => ({ id: n.id, pages: [n.pageIndex], text: n.text }))
  ]
  const greek = greekGarbles(units)
  const greekIn = (id: string) => greek.filter((f) => f.blockId === id)
  const withGreek = (findings: DamageFinding[], ids: readonly string[]): DamageFinding[] =>
    ids.flatMap((id) => [...findings.filter((f) => f.blockId === id), ...greekIn(id)])
  // Notes after the body, in their own reading order: they are keyed by `fnN`,
  // which no block order knows. Greek sits with the rest of its block's damage,
  // because a run of it is read and mended as one passage.
  const bodyIds = [...new Set([...inBody.map((f) => f.blockId), ...greek.map((f) => f.blockId)])]
    .filter((id) => order.has(id))
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
  const noteIds = doc.footnotes.map((n) => n.id)
  return [
    ...italicsAbsent(doc),
    ...withGreek(inBody, bodyIds),
    ...withGreek([...markedNotes(doc.footnotes), ...garbledNotes(doc.footnotes)], noteIds)
  ]
}

/** A token a table is made of and prose is not: a figure, a symbol, a rule. */
const TABLE_TOKEN = /^[\d·.,;:'’"“”()\-—|{}!]+$|^\p{L}{1,2}[.,;:]?$/u
/** Fewest tokens before a paragraph's share of them means anything. */
const TABLE_MIN_TOKENS = 30
/** Share of table tokens past which a paragraph is a table set as prose. */
const TABLE_SHARE = 0.6

/**
 * A table run into a paragraph.
 *
 * Leaf 640 of _The Secret Doctrine_ Vol. II, Hellenbach's table of the
 * elements, landed as two paragraphs of `Row I j Group I I Group! …` and sat
 * in the book through a reading and a class sweep. A table set as prose is
 * mostly figures and one- or two-letter symbols, which prose never is. Measured
 * over the shelf before the threshold was set: at 60% of thirty tokens or more
 * it names that table, a contents page run into _A Modern Panarion_'s body, a
 * number table on _Isis_ Vol. II leaf 413, and the residue of diagrams, and
 * nothing else.
 */
function tablesAsProse(blocks: readonly BookBlock[]): DamageFinding[] {
  const out: DamageFinding[] = []
  for (const block of blocks) {
    if (block.kind === 'table') continue
    const text = plain(block)
    const tokens = text.split(/\s+/u).filter(Boolean)
    if (tokens.length < TABLE_MIN_TOKENS) continue
    const share = tokens.filter((t) => TABLE_TOKEN.test(t)).length / tokens.length
    if (share < TABLE_SHARE) continue
    out.push({
      kind: 'table-as-prose',
      blockId: block.id,
      pages: [...block.sourcePages],
      found: tokens.slice(0, 8).join(' '),
      against: `${Math.round(share * 100)}% of its ${tokens.length} tokens are figures or one- and two-letter symbols, which is a table`,
      context: around(text, 0, 0),
      confidence: 'shape'
    })
  }
  return out
}

/** A book shorter than this has too little prose to say its italic is missing. */
const ITALIC_MIN_WORDS = 5000
/**
 * Fewest italic runs per ten thousand words a book can set and still have
 * kept its italic. Measured on the shelf: the books that kept theirs set 22 to
 * 417 (a lecture series at the low end, a glossary at the high); the eleven
 * that came in at 0 to 3 had lost theirs to a conversion, as both volumes of
 * _The Secret Doctrine_ had (0.1 and 0.2 before their italic was put back).
 */
const ITALIC_FLOOR = 5

/**
 * A whole book with almost no italic.
 *
 * Every other check here looks at a place; this one looks at the book, because
 * a missing italic has no place: a block with no `<i>` looks exactly like a
 * block that never had any. One finding, on the book's first body block. If
 * the source truly sets none, an `as-printed` ruling quoting `no italic` on
 * that leaf says so and takes it off the count.
 */
function italicsAbsent(doc: BookDocument): DamageFinding[] {
  let words = 0
  let runs = 0
  const count = (b: { text: string; emphasis?: readonly number[] }) => {
    words += b.text.split(/\s+/u).filter(Boolean).length
    const e = [...(b.emphasis ?? [])].sort((x, y) => x - y)
    e.forEach((w, i) => {
      if (i === 0 || w !== e[i - 1]! + 1) runs++
    })
  }
  doc.blocks.forEach(count)
  doc.footnotes.forEach(count)
  if (words < ITALIC_MIN_WORDS) return []
  const rate = (runs / words) * 10000
  if (rate >= ITALIC_FLOOR) return []
  const first = doc.blocks.find((b) => b.kind === 'paragraph') ?? doc.blocks[0]
  if (!first) return []
  return [
    {
      kind: 'italics-absent',
      blockId: first.id,
      pages: [...first.sourcePages],
      found: 'no italic',
      against:
        `${runs} italic runs in ${words} words (${rate.toFixed(1)} per 10,000; a book that kept ` +
        `its italic sets 22 or more). Find a witness that saw the type (PROCESS-reading, ` +
        `Stage 4b); if the source truly sets none, rule it as printed quoting "no italic"`,
      context: '',
      confidence: 'shape'
    }
  ]
}

/** A reference mark, as `prepareFootnotes` knows them. */
const MARK = /^[*†‡§‖¶⁂]+/u

/**
 * A footnote whose text opens with its own mark.
 *
 * The mark is set in the body and the note is printed under the rule with the
 * engine's number at its head, so a mark left at the start of the text prints
 * twice: `¹ *Eve is the trinity…`. The reading strips a mark followed by a
 * space; one the scan ran into the first word (`*Eve`) survives, and nothing
 * reported the three on the two *Isis* volumes until a reader saw one.
 */
function markedNotes(notes: readonly Footnote[]): DamageFinding[] {
  return notes
    .filter((n) => n.originalMarker !== '' && MARK.test(n.text.trimStart()))
    .map((n) => {
      const text = n.text.replace(/<[^>]*>/gu, '').trimStart()
      return {
        kind: 'marked-note' as const,
        blockId: n.id,
        pages: [n.pageIndex],
        found: text.match(MARK)![0],
        against: 'a note prints its mark from the body, never at its own head',
        context: around(text, 0, 1),
        confidence: 'shape' as const
      }
    })
}

/** Closing punctuation a paragraph may end on. */
const CLOSED = /[.!?:;—–]["”’)\]]*\s*[*†‡§‖¶⁂\d\s]*$|[.!?]["”’]?\s*$/u

/**
 * A paragraph a page break cut in two, of the shapes the seam rule misses.
 *
 * Assembly joins a paragraph across a leaf when the next leaf opens lower
 * case. A quotation mark before the lower-case word hides it — `in the eyes of
 * the educated | “heathen” the spiritual…` — and so does a run-on line that
 * opens on an ellipsis. Twenty-two such splits were in the two *Isis* volumes
 * after the seam pass, every one a paragraph printed as two.
 *
 * `shape`, because the leaf decides: a line on the paper that is indented
 * really is a new paragraph (two of the eighteen ellipsis-and-quote openings
 * measured on *Isis* Vol. I were). Only a paragraph ending open is a
 * candidate, and only one whose successor begins on a *later* leaf.
 */
function seamSplits(blocks: readonly BookBlock[]): DamageFinding[] {
  const findings: DamageFinding[] = []
  for (let i = 0; i + 1 < blocks.length; i++) {
    const block = blocks[i]!
    const next = blocks[i + 1]!
    if (block.kind !== 'paragraph' || next.kind !== 'paragraph') continue
    const last = Math.max(...block.sourcePages)
    if (!(next.sourcePages[0]! > last)) continue
    const text = plain(block).trimEnd()
    const opens = plain(next).trimStart()
    const quoted = /^["“‘'(]\s*\p{Ll}/u.test(opens)
    const ellipsis = /^(?:\. ){2,}|^\.\.\.|^…/u.test(opens)
    if (!quoted && !ellipsis) continue
    if (CLOSED.test(text) && !ellipsis) continue
    findings.push({
      kind: 'seam-split',
      blockId: block.id,
      pages: [last, next.sourcePages[0]!],
      found: `${text.slice(-30)} | ${opens.slice(0, 30)}`,
      against: quoted
        ? 'the next leaf opens on a quotation mark and a lower-case word'
        : 'the next leaf opens on an ellipsis',
      context: around(text, text.length, 0),
      confidence: 'shape'
    })
  }
  return findings
}

/**
 * Tokens no compositor set, in four shapes.
 *
 * A text layer is made of words shaped like right ones, which is why no
 * measure of word shapes can say a layer is sound. What it *can* say is that
 * some tokens are not words of any language the book prints: a replacement
 * character where the OCR gave up; a letter fused with a symbol no word
 * carries (`C<esarea`, `\Vhat`); letters and digits interleaved where neither
 * a formula nor an ordinal is (`rSSS` beside `1888`, `Av8pw11` for Greek the
 * OCR read as Latin); and capitals after a lower-case letter inside a word
 * (`EvoLUTION`, small capitals read as two cases). Measured on the shelf before
 * it was added: six hits over the two *Isis* volumes, which a reader proofed,
 * and some two hundred passages over the two TUP-converted *Secret Doctrine*
 * volumes, which no one had.
 */
const GARBLE: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\S*�\S*/gu, why: 'the conversion gave up on a character here' },
  {
    pattern: /\S*\p{L}[<>\\#$%¢¤¦€£]\S*|\S*[<>\\#$%¢¤¦€£]\p{L}\S*/gu,
    why: 'a letter fused with a symbol no word carries'
  },
  {
    pattern: /\S*\p{Script=Latin}[!?;:•\]]+\p{Script=Latin}\S*/gu,
    why: 'punctuation set inside a word'
  },
  {
    pattern:
      /(?<![\p{L}\d])(?=[\p{L}\d]*\p{Script=Latin})(?=[\p{L}\d]*\d)[\p{Script=Latin}\d]{2,}(?![\p{L}\d])/gu,
    why: 'letters and digits interleaved'
  },
  {
    pattern:
      /(?<!\p{L})\p{Script=Latin}*(?:(?=\p{Script=Latin})\p{Ll})\p{Lu}{2,}\p{Script=Latin}*(?!\p{L})|(?<!\p{L})(?:(?=\p{Script=Latin})\p{Ll})+\p{Lu}\p{Script=Latin}+(?!\p{L})/gu,
    why: 'capitals after a lower-case letter inside a word'
  }
]

/**
 * Digits with letters that are ordinary print: ordinals in English and French
 * (`3me`), book formats, a nineteenth-century `13deg.` or `20min.` (the paper
 * prints them so), and chemical formulas with or without a coefficient.
 */
const DIGITS_ALLOWED =
  /^(?:\d+(?:st|nd|rd|th|d|s|vo|mo|to|fo|me|e|er|re|deg|min|sec)|\d+[a-z]{1,2}|\d+\p{Lm}+|[A-Z]?\d+|\d*(?:[A-Z][a-z]?\d*)+|[ivxlc]+\d+|\d+[A-Z])$/u

/** A formula, where a bracket or a colon between letters is the notation: `ab]h/3`. */
const FORMULA = /[/=^{}_\u00b2\u00b3\u00b9\u2070-\u209f\u1d2c-\u1d6a∑∞]/u

/** A capital after a lower-case letter that is a name, not a fault. */
const CASE_ALLOWED = /^(?:Mc|Mac|Fitz|De|Di|Da|Du|La|Le|Van|Von)\p{Lu}|^[ei]\p{Lu}\p{Ll}+s?$/u

/** Where `GARBLE` hits in a text with markup already out, earliest first. */
function garbleHits(text: string): { at: number; token: string; why: string }[] {
  const found = new Map<number, { at: number; token: string; why: string }>()
  for (const { pattern, why } of GARBLE) {
    for (const match of text.matchAll(pattern)) {
      const token = match[0]
      if (why.startsWith('letters and digits') && DIGITS_ALLOWED.test(token)) continue
      if (why.startsWith('capitals') && CASE_ALLOWED.test(token)) continue
      if (why.startsWith('punctuation') && FORMULA.test(token)) continue
      if (found.has(match.index)) continue
      found.set(match.index, { at: match.index, token, why })
    }
  }
  return [...found.values()].sort((a, b) => a.at - b.at)
}

function garbledIn(id: string, pages: number[], raw: string): DamageFinding[] {
  const text = raw.replace(/<[^>]*>/gu, '')
  return garbleHits(text).map(({ at, token, why }) => ({
    kind: 'garbled' as const,
    blockId: id,
    pages,
    found: token,
    against: why,
    context: around(text, at, token.length),
    confidence: 'shape' as const
  }))
}

function garbled(blocks: readonly BookBlock[]): DamageFinding[] {
  return blocks.flatMap((b) =>
    b.kind === 'table' ? [] : garbledIn(b.id, [...b.sourcePages], b.text)
  )
}

function garbledNotes(notes: readonly Footnote[]): DamageFinding[] {
  return notes.flatMap((n) => garbledIn(n.id, [n.pageIndex], n.text))
}

/** What the Greek check reads: a block or a note, by id. */
interface TextUnit {
  id: string
  pages: number[]
  text: string
}

/** How far each way a neighbour counts as "beside" a word, in words. */
const GREEK_REACH = 2
/** Score above which a word is listed on its own shape alone. */
const GREEK_ALONE = 1.5
/** Lower score enough when the word sits beside other damage or Greek. */
const GREEK_BESIDE = 0.3
/**
 * Lowest score at which a match to a known Greek word is believed, and only
 * for five letters or more: the confusions are loose enough that `Bach`
 * matches `βαφη`, and a short word matches something by chance.
 */
const GREEK_KNOWN = -0.5
/** A word set more often than this is the book's vocabulary, not damage. */
const GREEK_RARE = 2

/** `Nov.`, `Ahr.`, `lbs.`: an abbreviation, which is rare and short by nature. */
const ABBREVIATED = /^[“‘"'(]*\p{Lu}?\p{Ll}{1,3}\.[”’"'),;:†‡*]*$/u
/** A Latin letter with a diacritic: Sanskrit, French, German. Greek read as Latin carries none. */
const ACCENTED_LATIN = /[\u00c0-\u024f]/u
/**
 * Mathematics and initials: `x²/[n(n`, `Pr{T/N}`, `LL.B.`, `K.F.R.C.`.
 * Pólya's formulas and a lecturer's radio stations were the whole of what
 * this check found in two books with no Greek in them. A garbling that
 * carries a digit is `garbled`'s already.
 */
const NOT_A_WORD = /[\d=^{}_/+\u00b2\u00b3\u00b9\u2070-\u209f∑∞]|^(?:\p{L}{1,2}\.)+\p{L}{0,2}\.?$/u
const ANY_ROMAN = /^(?=[ivxlcdm]+$)m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/iu
const EDGES = /^[“”‘’"'()[\],.;:!?†‡*§]+|[“”‘’"'()[\],.;:!?†‡*§]+$/gu

/**
 * Greek the conversion read as Latin letters and left word-shaped.
 *
 * See `greek.ts` for the models. This is the walk: every word of a block or a
 * note, scored where it is rare enough to be damage, and listed where it looks
 * Greek on its own, or less so but beside a `garbled` hit or real Greek, or
 * where it can be matched letter by letter to a Greek word the shelf prints.
 * Greek comes in runs, so the neighbour is the strongest evidence there is.
 */
function greekGarbles(units: readonly TextUnit[]): DamageFinding[] {
  const vocabulary = new Map<string, number>()
  const own: string[] = []
  const read = units.map((unit) => {
    const text = unit.text.replace(/<[^>]*>/gu, '')
    own.push(...greekWordsIn(text))
    const words = [...text.matchAll(/[^\s—–]+/gu)].map((m) => ({
      at: m.index,
      raw: m[0],
      core: m[0].replace(EDGES, '')
    }))
    for (const w of words) {
      if (/^[A-Za-z]+$/u.test(w.core)) {
        const key = w.core.toLowerCase()
        vocabulary.set(key, (vocabulary.get(key) ?? 0) + 1)
      }
    }
    return { unit, text, words }
  })
  const model = greekModel(vocabulary, own)

  const out: DamageFinding[] = []
  for (const { unit, text, words } of read) {
    const hits = garbleHits(text)
    const bad = words.map(
      (w) =>
        hasGreek(w.raw) ||
        hits.some((h) => h.at < w.at + w.raw.length && w.at < h.at + h.token.length)
    )
    const scores = words.map((w, i) => {
      const letters = w.raw.replace(/[^A-Za-z]/gu, '')
      if (bad[i] || letters.length < 3) return undefined
      if (
        ACCENTED_LATIN.test(w.raw) ||
        ABBREVIATED.test(w.raw) ||
        NOT_A_WORD.test(w.core) ||
        ANY_ROMAN.test(letters)
      ) {
        return undefined
      }
      if ((vocabulary.get(letters.toLowerCase()) ?? 0) > GREEK_RARE) return undefined
      return { letters, score: model.score(letters) }
    })
    // A neighbour is evidence when it is damage, real Greek, or Greek-shaped
    // enough to be listed on its own: a run spreads from its worst word. Two
    // rare names side by side are not evidence of anything, which is why a
    // merely middling neighbour no longer counts.
    const strong = scores.map((s) => (s?.score ?? -Infinity) > GREEK_ALONE)
    words.forEach((w, i) => {
      const s = scores[i]
      if (s === undefined) return
      const beside = words.some((_, j) => {
        if (j === i || Math.abs(j - i) > GREEK_REACH) return false
        return bad[j] || strong[j]
      })
      let why: string | undefined
      let expected: string | undefined
      if (strong[i]) why = 'Latin letters in the shape of a Greek word'
      else if (beside && s.score > GREEK_BESIDE) why = 'Greek-shaped, beside other damage or Greek'
      else if (s.letters.length >= 5 && s.score > GREEK_KNOWN) {
        expected = model.couldBe(s.letters)
        if (expected !== undefined) why = 'a Greek word the shelf prints, read as Latin'
      }
      if (why === undefined) return
      out.push({
        kind: 'greek',
        blockId: unit.id,
        pages: unit.pages,
        found: w.core,
        against: why,
        context: around(text, w.at, w.raw.length),
        confidence: 'shape',
        ...(expected === undefined ? {} : { expected })
      })
    })
  }
  return out
}

/**
 * The part of a ruling this check needs: which leaf, which words, and whether
 * the editor said to leave them.
 *
 * Structural rather than imported from `@core/queries`, so a shelf script
 * running under plain Node can load this module without dragging in a chain
 * Node's type stripping cannot read (CLAUDE.md, on `standing.ts`).
 */
export interface DamageRuling {
  pageIndex: number | null
  quote: string
  decision: string
}

export interface HonouredFinding {
  finding: DamageFinding
  ruling: DamageRuling
}

/**
 * The findings, less those the editor has already ruled are the book's own.
 *
 * `checkDamage` asks whether a mark is one the printing trade sets, and on
 * leaf 377 of *The Secret Doctrine* the answer is no and the mark is still
 * right: `“Egg’ or` opens with a double mark and closes with a single, the
 * render shows exactly that, and the editor ruled it as printed. A gate that
 * cannot honour that ruling fails the book for ever, or is switched off —
 * and a gate switched off is worse than none.
 *
 * So a finding is honoured, and taken out of the count, when a ruling
 * **filed on its leaf** says `as-printed` over words that overlap it. Only a
 * filed leaf ruling: a standing ruling holds a query for approval and files
 * one of these when the editor approves, so the gate goes green when the
 * editor has looked and not before. A `corrected` ruling is not honoured,
 * because its sweep removes the finding by itself, and one that has not is a
 * finding still. Nothing is dropped silently: the honoured list comes back
 * beside the kept one, and the sheet prints it.
 */
export function honourRulings(
  findings: readonly DamageFinding[],
  rulings: readonly DamageRuling[],
  doc: BookDocument
): { kept: DamageFinding[]; honoured: HonouredFinding[] } {
  const blocks = new Map(
    [...doc.blocks, ...doc.sections.flatMap((s) => s.blocks)].map((b) => [b.id, b])
  )
  const asPrinted = rulings.filter((r) => r.decision === 'as-printed' && r.pageIndex !== null)
  const kept: DamageFinding[] = []
  const honoured: HonouredFinding[] = []
  for (const finding of findings) {
    const block = blocks.get(finding.blockId)
    const text = block ? loose(plain(block)) : loose(finding.context)
    const found = loose(finding.found)
    const ruling = asPrinted.find((r) => {
      if (!finding.pages.includes(r.pageIndex as number)) return false
      const quote = loose(r.quote)
      if (!quote) return false
      // The two overlap in the block, or one contains the other outright —
      // the second for a quote the block no longer carries verbatim.
      if (quote.includes(found) || found.includes(quote)) return true
      const q = text.indexOf(quote)
      if (q === -1) return false
      for (let at = text.indexOf(found); at !== -1; at = text.indexOf(found, at + 1)) {
        if (at < q + quote.length && q < at + found.length) return true
      }
      return false
    })
    if (ruling) honoured.push({ finding, ruling })
    else kept.push(finding)
  }
  return { kept, honoured }
}

/**
 * Text as a reader matches it: letters and digits only, lower case.
 *
 * A query is typed from the screen and a finding is cut from the text, and
 * the two disagree about curl and about where a space falls beside a mark
 * more often than about words — the leaf-377 query reads `Egg ‘or` over a
 * text that prints `Egg’ or`. Punctuation is what the finding is *about*, so
 * it cannot be what decides whether the ruling reaches it.
 */
function loose(s: string): string {
  return s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * The findings as a sheet to read, grouped by kind and carrying the whole block.
 *
 * **The whole block, not the window, and that is the point of the sheet.**
 * CLAUDE.md records what the snippet costs: four places in one chapter of
 * *Uncommon Therapy* were held back as undeterminable and put to the editor,
 * and three of the four answered themselves the moment the paragraph was in
 * view — the next sentence said the word, or the author used the same
 * construction twice on the following leaf. That was a cost paid on the wrong
 * side, and the fix is not to raise fewer findings but to raise them with the
 * context a reader needs already attached.
 *
 * So this is the artefact the **cheap** pass reads: a reader settles two dozen
 * flagged places with their paragraphs beside them, rather than reading three
 * hundred leaves of prose to find them. What it hands back is a verdict per
 * finding — never text, and never a rewritten paragraph.
 *
 * `attested` findings are listed first and separately, because the book has
 * already settled them and what they need from a person is agreement rather
 * than adjudication.
 */
export function damageSheet(
  findings: readonly DamageFinding[],
  doc: BookDocument,
  title = 'this book',
  honoured: readonly HonouredFinding[] = []
): string {
  const blocks = new Map(
    [...doc.blocks, ...doc.sections.flatMap((s) => s.blocks)].map((b) => [b.id, b])
  )
  const attested = findings.filter((f) => f.confidence === 'attested')
  const shape = findings.filter((f) => f.confidence === 'shape')

  const entry = (f: DamageFinding): string => {
    const block = blocks.get(f.blockId)
    const leaves = f.pages.length > 1 ? `leaves ${f.pages.join(', ')}` : `leaf ${f.pages[0]}`
    const head =
      f.expected === undefined
        ? `### \`${f.found}\` — ${f.blockId}, ${leaves}`
        : `### \`${f.found}\` → \`${f.expected}\` — ${f.blockId}, ${leaves}`
    return [
      head,
      '',
      `*${f.kind}: ${f.against}.*`,
      '',
      '> ' + (block ? plain(block).replace(/\n/gu, '\n> ') : f.context),
      ''
    ].join('\n')
  }

  return [
    `# Conversion damage — ${title}`,
    '',
    'Marks in the text that the printing trade does not set. Every one of these',
    'was produced by whatever turned this book into characters, not by the',
    'compositor, so reproducing it would be reproducing the conversion rather',
    'than the book.',
    '',
    '**Nothing here has been changed.** `expected` is what the volume’s own',
    'vocabulary says, and it is a hypothesis until a person agrees with it.',
    '',
    `${attested.length} settled by the book itself · ${shape.length} needing eyes` +
      (honoured.length > 0 ? ` · ${honoured.length} honoured by a ruling.` : '.'),
    '',
    '---',
    '',
    '## Settled by the book itself',
    '',
    attested.length === 0
      ? '*None.*\n'
      : 'The volume sets the joined word elsewhere and sets neither fragment.\n' +
        'That is the same argument `draft/hyphens.ts` makes about a line-break\n' +
        'hyphen: not a reading, a typographic join the book answers.\n\n' +
        attested.map(entry).join('\n'),
    '---',
    '',
    '## Needing eyes',
    '',
    shape.length === 0 ? '*None.*\n' : shape.map(entry).join('\n'),
    ...(honoured.length === 0
      ? []
      : [
          '---',
          '',
          '## Honoured by a ruling',
          '',
          'The editor has ruled these as printed, on the leaf each sits on. They',
          'are not counted, and they are listed so nothing leaves the sheet in',
          'silence.',
          '',
          ...honoured.map(
            (h) =>
              `- \`${h.finding.found}\` — ${h.finding.blockId}, leaf ${h.ruling.pageIndex}: ` +
              `ruled as printed over \`${h.ruling.quote}\`.`
          ),
          ''
        ])
  ].join('\n')
}
