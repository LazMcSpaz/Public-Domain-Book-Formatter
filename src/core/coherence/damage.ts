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
import type { BookBlock, BookDocument } from '@core/assemble'

/** What kind of damage was found. A closed list, and short on purpose. */
export type DamageKind =
  /** A word the conversion broke in half: `descrip tion`, `amb iguity`. */
  | 'split-word'
  /** A full stop no compositor set: doubled, or mid-clause before a lowercase word. */
  | 'stray-point'
  /** An apostrophe standing where a comma belongs: `examination' I tell`. */
  | 'stray-apostrophe'

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
   * Present only on an `attested` finding, and **never applied by anything in
   * this module**. It is the hypothesis, carried so a sheet can show it beside
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
  'est',
  'esp',
  'anon'
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

      const a = left[0].toLocaleLowerCase()
      const b = right[0].toLocaleLowerCase()
      if (a.length < MIN_FRAGMENT || b.length < MIN_FRAGMENT) continue

      const joined = a + b
      if (count(joined) < JOINED_FLOOR) continue
      if (count(a) >= FRAGMENT_CEILING || count(b) >= FRAGMENT_CEILING) continue

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
        confidence: 'attested',
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
      if (word[1]!.toLocaleLowerCase().endsWith('s')) continue

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
  return [...splitWords(blocks), ...strayPoints(blocks), ...strayApostrophes(blocks)].sort(
    (a, b) => (order.get(a.blockId) ?? 0) - (order.get(b.blockId) ?? 0)
  )
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
  title = 'this book'
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
    `${attested.length} settled by the book itself · ${shape.length} needing eyes.`,
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
    shape.length === 0 ? '*None.*\n' : shape.map(entry).join('\n')
  ].join('\n')
}
