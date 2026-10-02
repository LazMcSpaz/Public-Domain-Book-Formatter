/**
 * The apparatus as the reader meets it: reference marks, the notes they point
 * to, and the cross-references a book makes to its own pages.
 *
 * `damage.ts` asks whether a mark is one the printing trade sets at all, and
 * `checkFootnotePairing` whether each leaf's marks and notes balance. Neither
 * asks the questions a reader with the finished book in hand asks first: does
 * this raised figure lead anywhere, do the figures count up the way the notes
 * are numbered, and does "see page 103" still mean page 103? Every finding
 * here came off the NLP shelf before the check existed, and none of it was
 * visible to any check that did:
 *
 * - **Marks no note claims.** _The Structure of Magic_ Vol. I carries 48
 *   superscript marks and not one note: its notes were read as body
 *   paragraphs under "FOOTNOTES FOR CHAPTER 1", which is a structure the
 *   reader may want, and a structure nothing said had been chosen. Vol. II
 *   carries twenty marks and **one** note — the one a reader typed as a
 *   footnote while the rest of its section went in as paragraphs, so the
 *   section printed a continuation with no beginning.
 * - **Marks that do not count up.** Vol. II's Part II runs ⁴ ⁵ ⁶ ⁵ ⁷: a mark
 *   read one figure short, which puts a reader looking for note 6 at note 5.
 *   A Part whose marks begin at ² has lost its first.
 * - **Pages that are not this edition's.** _Patterns_ Vol. I was exported
 *   with "(see page 103)" four times over, naming pages of the 1975 typescript.
 *   An edition renumbers every page, so each of those now points at whatever
 *   this one happens to print there.
 *
 * Every finding is a place to look, never a verdict, and nothing here writes
 * a character into the book. A book that prints its notes as a section on
 * purpose says so with an as-printed ruling, which `honourRulings` reads for
 * these findings exactly as it does for damage.
 *
 * Pure: no DOM, no I/O.
 */
import type { BookBlock, BookDocument } from '@core/assemble'
import { prepareFootnotes } from '@core/layout/footnotes'

export type ApparatusKind =
  /** "see page 103": the original's pagination, which this edition does not print. */
  | 'page-reference'
  /** A reference mark no note claims: the note is elsewhere as text, or lost. */
  | 'unclaimed-mark'
  /** A numbered mark out of its count: ⁴ ⁵ ⁶ ⁵ ⁷, or a run that opens at ². */
  | 'mark-sequence'
  /** A notes heading with numbered paragraphs under it, in a book with marks no note claims. */
  | 'notes-as-text'

export interface ApparatusFinding {
  kind: ApparatusKind
  blockId: string
  pages: number[]
  found: string
  against: string
  context: string
}

const SUPERSCRIPT = '¹²³⁴⁵⁶⁷⁸⁹⁰'
const SUPER_RUN = new RegExp(`[${SUPERSCRIPT}]+`, 'gu')
const SYMBOL_RUN = /[*†‡§‖¶]+/gu
const valueOf = (run: string): number =>
  Number(
    [...run]
      .map((ch) => SUPERSCRIPT.indexOf(ch) + 1)
      .map((d) => (d === 10 ? 0 : d))
      .join('')
  )

/**
 * Whether a raised figure is notation rather than a reference mark.
 *
 * Three books on this shelf are written in it. _The Structure of Magic_ sets
 * `d⁻¹` for an inverse, `c¹` … `c⁴` for the members of a family and `NP¹ V
 * NP²` for the noun phrases of a rule; Pólya sets `(1/6)⁶`, `p³⁰` and
 * `A₀⁽¹⁾`; _Instant Rapport_ quotes `E = mc²`. A reference mark follows a
 * word of some length or the punctuation after one, and sits against it. So a
 * figure is notation when it follows a sign, a digit, a bracket, or a
 * symbol of two letters or fewer — and it is no mark at all when it stands
 * after a space, as in "the super-script ³ on the predicate".
 */
function isNotation(text: string, at: number): boolean {
  const before = text[at - 1] ?? ' '
  if (/\s/u.test(before)) return true
  if (/[⁻⁺⁽⁾()[\]{}=+\-−/×\d₀-₉]/u.test(before)) return true
  if (/\p{L}/u.test(before)) {
    const word = /[\p{L}]+$/u.exec(text.slice(0, at))![0]
    if (word.length <= 2) return true
  }
  return false
}

/**
 * Whether a symbol is a reference mark. In a linguistics book `*the boy are`
 * marks a sentence as ill-formed, and a book about that usage quotes the star
 * itself (`uses the "*" to mark`): a mark always closes onto the word or the
 * stop it refers to, so a star after a space, a quotation mark or a bracket is
 * the sign and not a reference.
 */
function isSymbolMark(text: string, at: number): boolean {
  const before = text[at - 1] ?? ' '
  return !/[\s"“‘'([\d₀-₉]/u.test(before)
}

/** Enough either side to recognise the place. */
function around(text: string, at: number, length: number): string {
  const start = Math.max(0, at - 50)
  const end = Math.min(text.length, at + length + 30)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

/**
 * A reference to a page of the book itself.
 *
 * Only the forms a book uses for its own pages: "(see page 103)", "see pages
 * 40 and 41", "as shown on page 223". A bare "(p. 278)" is left alone because
 * it is how these books cite *another* work — measured on the shelf, every one
 * of the hundred-odd in the Blavatsky volumes closes a quotation from some
 * other author, and none points into the book that prints it.
 */
const PAGE_REFERENCE =
  /\(\s*see\s+(?:also\s+)?pages?\s+\d+[^)]*\)|\bsee\s+(?:also\s+)?pages?\s+\d+(?:\s*(?:-|–|and|,|or)\s*\d+)*|\b(?:shown|given|described|discussed|listed|presented|reproduced|printed|explained|defined|illustrated|outlined|mentioned|set\s+out|found)\s+on\s+pages?\s+\d+/giu
/**
 * The words that say a page number belongs to some other book: `see page 423
 * of Volume I`, `Magic II, see page 40`.
 */
const ANOTHER_WORK =
  /\b(?:book|volume|vol\.|edition|ed\.|journal|magic\s+i{1,2}\b|chapter\s+\d+\s+of|op\.\s*cit|ibid)/iu

function pageReferences(units: readonly Unit[]): ApparatusFinding[] {
  const out: ApparatusFinding[] = []
  for (const unit of units) {
    for (const match of unit.text.matchAll(PAGE_REFERENCE)) {
      const before = unit.text.slice(Math.max(0, match.index - 60), match.index)
      const after = unit.text.slice(
        match.index + match[0].length,
        match.index + match[0].length + 25
      )
      if (ANOTHER_WORK.test(before) || /^\s*(?:of|in)\s/iu.test(after)) continue
      out.push({
        kind: 'page-reference',
        blockId: unit.id,
        pages: unit.pages,
        found: match[0],
        against:
          'a page of the original, which this edition renumbers; the reference now names whatever this edition prints there',
        context: around(unit.text, match.index, match[0].length)
      })
    }
  }
  return out
}

interface Unit {
  id: string
  pages: number[]
  text: string
}

/** Every mark the engine would print with nothing under it, in reading order. */
function unclaimedMarks(doc: BookDocument): ApparatusFinding[] {
  const prepared = prepareFootnotes(doc.blocks, doc.footnotes, doc.bareMarks)
  const bareCount = new Map<string, number>()
  for (const mark of doc.bareMarks ?? []) {
    const key = `${mark.blockId}\u0000${mark.marker}`
    bareCount.set(key, (bareCount.get(key) ?? 0) + 1)
  }
  const out: ApparatusFinding[] = []
  doc.blocks.forEach((block, i) => {
    if (block.kind === 'table') return
    const text = prepared.blocks[i]?.text ?? block.text
    const seen = new Map<string, number>()
    const hits = [
      ...[...text.matchAll(SUPER_RUN)].filter((m) => !isNotation(text, m.index)),
      ...[...text.matchAll(SYMBOL_RUN)].filter((m) => isSymbolMark(text, m.index))
    ].sort((a, b) => a.index - b.index)
    for (const hit of hits) {
      // A mark the editor declared bare is meant to stand alone.
      const key = `${block.id}\u0000${hit[0]}`
      const n = (seen.get(key) ?? 0) + 1
      seen.set(key, n)
      if (n <= (bareCount.get(key) ?? 0)) continue
      out.push({
        kind: 'unclaimed-mark',
        blockId: block.id,
        pages: [...block.sourcePages],
        found: hit[0],
        against: doc.footnotes.some((f) => f.originalMarker !== '')
          ? 'no note of this book claims it, so it prints raised with nothing under it'
          : 'this book has no notes at all, so it prints raised with nothing under it',
        context: around(text, hit.index, hit[0].length)
      })
    }
  })
  return out
}

/**
 * Numbered marks that do not count up.
 *
 * Read off the text as printed, claimed or not, because the count is the
 * compositor's and holds whichever note the engine attaches: each mark is one
 * more than the last, or a fresh 1 where a chapter or Part restarts it. One
 * mark out of step between two that agree — ⁵ ⁶ **⁵** ⁷ — is that mark, and
 * is reported once; a run that skips is reported where it skips.
 */
function markSequence(blocks: readonly BookBlock[]): ApparatusFinding[] {
  const marks: { value: number; block: BookBlock; at: number; text: string }[] = []
  for (const block of blocks) {
    if (block.kind === 'table') continue
    for (const m of block.text.matchAll(SUPER_RUN)) {
      if (isNotation(block.text, m.index)) continue
      marks.push({ value: valueOf(m[0]), block, at: m.index, text: block.text })
    }
  }
  const out: ApparatusFinding[] = []
  let previous = 0
  const report = (mark: (typeof marks)[number], against: string) =>
    out.push({
      kind: 'mark-sequence',
      blockId: mark.block.id,
      pages: [...mark.block.sourcePages],
      found: [...String(mark.value)].map((d) => SUPERSCRIPT[(Number(d) + 9) % 10]).join(''),
      against,
      context: around(mark.text, mark.at, 1)
    })
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i]!
    const expected = previous + 1
    if (mark.value === expected || mark.value === 1) {
      previous = mark.value
      continue
    }
    const next = marks[i + 1]
    if (mark.value < expected) {
      // A count that carries on upward from here has restarted without its 1,
      // as a Part does whose first note lost its mark. One that does not is a
      // number used twice: a second reference to an earlier note, or a figure
      // read short, and the count carries on from where it was.
      if (next !== undefined && next.value === mark.value + 1) {
        report(
          mark,
          `the count restarts here at ${mark.value} (the mark before it reads ${previous}): its 1 is missing`
        )
        previous = mark.value
      } else {
        report(
          mark,
          `it repeats a number already used (the mark before it reads ${previous}): a second reference to that note, or a figure misread`
        )
      }
      continue
    }
    if (next !== undefined && next.value === expected + 1) {
      report(
        mark,
        `the marks either side read ${previous} and ${expected + 1}, so this one should read ${expected}`
      )
      previous = expected
      continue
    }
    report(
      mark,
      previous === 0
        ? `the book's first numbered mark reads ${mark.value}: its first is missing`
        : `the mark before it reads ${previous}: ${mark.value - previous === 2 ? 'one is' : 'some are'} missing, or the count restarts without a 1`
    )
    previous = mark.value
  }
  return out
}

/** A heading that introduces notes: `Notes`, `Footnotes for Part I`, `Notes to Chapter 3`. */
const NOTES_HEADING = /^(?:foot)?notes\b(?:\s+(?:to|for|on)\b.*)?$/iu
/** A paragraph that is a numbered note: `2. By most highly valued…`, `³ Others could exist`. */
const NUMBERED_NOTE = new RegExp(`^(?:\\d{1,3}[.)]\\s|[${SUPERSCRIPT}]+\\s?\\S)`, 'u')

function notesAsText(doc: BookDocument, unclaimed: number): ApparatusFinding[] {
  if (unclaimed === 0) return []
  const out: ApparatusFinding[] = []
  const blocks = doc.blocks
  blocks.forEach((block, i) => {
    if (block.kind !== 'heading' || !NOTES_HEADING.test(block.text.trim())) return
    let numbered = 0
    for (let j = i + 1; j < blocks.length && blocks[j]!.kind !== 'heading'; j++) {
      if (NUMBERED_NOTE.test(blocks[j]!.text.trimStart())) numbered++
    }
    if (numbered === 0) return
    out.push({
      kind: 'notes-as-text',
      blockId: block.id,
      pages: [...block.sourcePages],
      found: block.text.trim(),
      against:
        `${numbered} numbered paragraph${numbered === 1 ? '' : 's'} under it, and ${unclaimed} ` +
        `mark${unclaimed === 1 ? '' : 's'} in the book no note claims: the notes are set as body ` +
        'text, so no mark leads to one',
      context: block.text.trim()
    })
  })
  return out
}

/**
 * The apparatus findings for a book, in reading order within each kind:
 * notes set as text first, because they explain the unclaimed marks that
 * follow, then the marks, their count, and the page references.
 */
export function checkApparatus(doc: BookDocument): ApparatusFinding[] {
  const units: Unit[] = [
    ...doc.blocks.map((b) => ({ id: b.id, pages: [...b.sourcePages], text: b.text })),
    ...doc.footnotes
      .filter((n) => n.originalMarker !== '')
      .map((n) => ({ id: n.id, pages: [n.pageIndex], text: n.text }))
  ]
  const unclaimed = unclaimedMarks(doc)
  return [
    ...notesAsText(doc, unclaimed.length),
    ...unclaimed,
    ...markSequence(doc.blocks),
    ...pageReferences(units)
  ]
}
