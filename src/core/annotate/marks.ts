import { mapPlainText } from '../edits/sweep'

/**
 * Does every glossary entry the book actually uses have a mark on it?
 *
 * The circle after a word is the only thing that tells a reader an entry
 * exists. Without it a glossary is a back-matter section nobody has a reason
 * to open, and nothing anywhere reports that: the book file is valid, the
 * export is clean, and the KDP checks pass. One volume on this shelf carried
 * 85 marks and 23 notes; the next carried a 74-entry glossary, no marks at
 * all, and every report was perfectly happy about it.
 *
 * So this is the check, and it is deterministic: the headwords are in the book
 * file and the body is one `drive.mjs body` away. Pure on purpose — it takes
 * the entries and the blocks and knows nothing about where either came from.
 *
 * What it deliberately does **not** do is place a mark. Which occurrence to
 * mark, and whether a headword the book never uses deserves an entry at all,
 * are editorial calls. This says only: here is an entry, here is the word in
 * the running text, and there is no circle on it.
 */

/** A block of the assembled book, as `drive.mjs body` hands it back. */
export interface MarkableBlock {
  id: string
  kind: string
  /** The text as an edit must be written in terms of, markup included. */
  text: string
}

export interface MarkVerdict {
  /** The headword, as the glossary prints it. */
  entry: string
  /** Which alternative of a comma-separated headword was looked for. */
  term: string
  /** The block its first occurrence sits in, or null when the book never uses it. */
  blockId: string | null
  /** Whether that occurrence carries the mark. */
  marked: boolean
}

export interface MarkReport {
  marked: MarkVerdict[]
  /** The finding: the book uses the word and no circle is on it. */
  unmarked: MarkVerdict[]
  /** Legitimate: an entry for something the book never names. */
  absent: MarkVerdict[]
}

/** The circle this edition puts after a word that has an entry. */
export const GLOSSARY_MARK = '°'

/**
 * A headword that names a person, `Surname, Given Names (dates)`: the comma
 * there inverts a name, it does not list alternatives. Read as alternatives,
 * `Balfour, Arthur James (1848-1930)` looked for "Arthur James" on its own.
 */
const PERSON = /^\s*([^,()]+?),\s*[^()]+?\s*\([^)]*\d[^)]*\)\s*\.?\s*$/

export function isPersonHeadword(headword: string): boolean {
  return PERSON.test(headword)
}

/**
 * The alternatives a headword offers.
 *
 * `Nimbus, halo` and `Gnome, sylph, undine, salamander` are one entry covering
 * several words, and the book may use any of them. A leading article is
 * dropped because `Aura, the human aura` is an entry about *aura*. A person
 * is looked for by surname (`isPersonHeadword`).
 */
export function headwordTerms(headword: string): string[] {
  const person = PERSON.exec(headword)
  if (person) return [person[1]!.trim()]
  const unquote = (t: string) => t.replace(/^[\s"'\u201C\u2018]+|[\s"'\u201D\u2019.]+$/g, '')
  const whole = unquote(headword.trim().replace(/\.$/, ''))
  const parts = whole
    .split(',')
    .map((part) => part.replace(/\s*\(.*?\)\s*/g, '').trim())
    .map((part) => part.replace(/^(the|a|an)\s+/i, '').trim())
    .map(unquote)
    .filter((part) => part.length >= 3)
  // A saying or a phrase with a comma in it is one entry, not a list of
  // alternatives: `"When the pupil is ready, the Master appears."` was looked
  // for as two halves with the quote marks on, and its circle never found.
  // The whole is asked first; a true list never matches whole and falls
  // through to its parts.
  return whole.includes(',') ? [whole, ...parts] : parts
}

/**
 * What to look for in the running text.
 *
 * Hyphen and space are interchangeable, because a compositor's `sub-plane` and
 * a writer's `sub plane` are the same word; a trailing plural is allowed; and
 * `colour` matches `color`, since the glossary is written in this editor's
 * spelling and the book in its own. A circle may stand after a closing quote
 * (`"hex"°`), and is the word's circle all the same: missed, it was given a
 * second one inside the quote on _Clairvoyance_.
 *
 * A person's surname is matched as a name: capitalised, so Butler is not
 * Pharaoh's butler, and not followed by another capitalised word, so Balfour
 * is not the first name of Balfour Stewart.
 */
function pattern(term: string, person = false): RegExp {
  const parts = term.split(/[\s-]+/).map((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return (
      escaped
        .replace(/colou?r/gi, 'colou?r')
        // The glossary is typed with a straight apostrophe and the book is set
        // with a curly one. `Dante's Inferno` is on the page and was reported
        // as a word the book never uses.
        .replace(/['\u2019]/g, "['\u2019]") + (person ? '' : '(?:s|es)?')
    )
  })
  const notAName = person ? '(?![\\s-]+\\p{Lu})' : ''
  const mark = `(?:[\u201D\u2019"']?${GLOSSARY_MARK})?`
  return new RegExp(`\\b${parts.join('[\\s-]+')}\\b${notAName}${mark}`, person ? 'gu' : 'giu')
}

/**
 * Every entry, against the body the reader will hold.
 *
 * Headings are not searched. A mark on a chapter heading would travel into
 * the running head and the contents, which is not a place for a footnote-sized
 * circle, so a term the book uses only in a heading counts as absent and the
 * report says so. Every other block is prose a reader meets: a list item, a
 * quotation and a caption carry circles too, and reading paragraphs alone
 * reported 17 of the Hall collection's marked entries as unmarked, the
 * circle sitting in a numbered answer or a quoted stanza.
 */
export function checkGlossaryMarks(
  headwords: readonly string[],
  blocks: readonly MarkableBlock[]
): MarkReport {
  const prose = blocks.filter((block) => block.kind !== 'heading')
  const report: MarkReport = { marked: [], unmarked: [], absent: [] }

  for (const entry of headwords) {
    let verdict: MarkVerdict = { entry, term: entry, blockId: null, marked: false }
    let found = false

    // *Any* occurrence carrying the mark satisfies the entry, not the first
    // one. Which occurrence to mark is the editor's call and is not always the
    // first: the books introduce a term in a run-in heading set in capitals,
    // and a circle belongs on the words rather than on the heading. Reporting
    // the first occurrence unmarked would flag every one of those.
    const person = isPersonHeadword(entry)
    for (const term of headwordTerms(entry)) {
      const re = pattern(term, person)
      for (const block of prose) {
        for (const hit of block.text.matchAll(re)) {
          const marked = hit[0].endsWith(GLOSSARY_MARK)
          if (!found || (marked && !verdict.marked)) {
            verdict = { entry, term, blockId: block.id, marked }
          }
          found = true
          if (marked) break
        }
        if (verdict.marked) break
      }
      if (verdict.marked) break
    }

    if (!found) report.absent.push(verdict)
    else if (verdict.marked) report.marked.push(verdict)
    else report.unmarked.push(verdict)
  }

  return report
}

/**
 * The headwords of a glossary section, by the one rule everything reads them
 * with: a paragraph opening `<b>Headword.</b>` names an entry. The same regex
 * `book-files.mjs` checks the shelf with — one rule, or the galley and the
 * shelf report would drift into disagreeing about what the glossary holds.
 */
export function glossaryHeadwords(sectionText: string): string[] {
  return sectionText
    .split('\n')
    .map((line) => /^\s*<b>(.+?)<\/b>/.exec(line)?.[1])
    .filter((h): h is string => typeof h === 'string')
}

/**
 * The text with the glossary mark placed on the first unmarked use of a term.
 *
 * The mark is a character in the text, so placing one is an ordinary `text`
 * edit — undoable, autosaved, swept like anything else. The search reads
 * through the `<i>`/`<b>` notation the way the reader reads the page, and the
 * splice lands the circle directly after the matched words, inside whatever
 * run they sit in. Returns null when the term has no unmarked use here —
 * which occurrence deserves the mark stays the editor's call; this only
 * carries it out where they pointed.
 */
export function withGlossaryMark(markupText: string, term: string, person = false): string | null {
  const { plain, toMarkup } = mapPlainText(markupText)
  const re = pattern(term, person)
  for (const hit of plain.matchAll(re)) {
    if (hit[0].endsWith(GLOSSARY_MARK)) continue
    const end = (hit.index ?? 0) + hit[0].length
    const spliceAt = end - 1 < toMarkup.length ? toMarkup[end - 1]! + 1 : markupText.length
    return markupText.slice(0, spliceAt) + GLOSSARY_MARK + markupText.slice(spliceAt)
  }
  return null
}

export interface PlacedMark {
  entry: string
  term: string
  blockId: string
}

export interface MarkPlacement {
  placed: PlacedMark[]
  /** Unmarked entries whose use could not take a circle. Reported, never dropped. */
  unplaced: MarkVerdict[]
  /** Entries for words the book never uses: candidates for the cut list. */
  absent: MarkVerdict[]
  /** Each block a circle went into, as its whole new marked text. */
  blocks: { id: string; text: string }[]
}

/**
 * A circle for every entry the book uses and nothing points at, on its first
 * use in prose (`checkGlossaryMarks` says which use, `withGlossaryMark` puts
 * it there). The circle-placing script of the Hall glossary lived in one
 * session's scratchpad and went with it; this is its job as a pure function.
 *
 * No spacing rule. That script refused a circle within half a line of
 * another, which left six entries with no circle anywhere, and the editor
 * ruled (Hall, 2026-10-06) that a crowded circle is better than an entry
 * nothing points at.
 *
 * The check reads the plain text, because a circle typed after a closing tag
 * (`<i>Devachan</i>°`) is still on the word; the placement reads through the
 * notation, so the circle lands inside whatever run the word is in. Several
 * circles in one block accumulate on the one text.
 */
export function placeMissingMarks(
  headwords: readonly string[],
  blocks: readonly MarkableBlock[]
): MarkPlacement {
  const plain = blocks.map((b) => ({ ...b, text: b.text.replace(/<\/?[a-z]+>/gi, '') }))
  const report = checkGlossaryMarks(headwords, plain)
  const texts = new Map(blocks.map((b) => [b.id, b.text]))
  const changed = new Set<string>()
  const placed: PlacedMark[] = []
  const unplaced: MarkVerdict[] = []
  for (const verdict of report.unmarked) {
    const id = verdict.blockId
    const before = id === null ? undefined : texts.get(id)
    const after =
      before === undefined
        ? null
        : withGlossaryMark(before, verdict.term, isPersonHeadword(verdict.entry))
    if (id === null || after === null) {
      unplaced.push(verdict)
      continue
    }
    texts.set(id, after)
    changed.add(id)
    placed.push({ entry: verdict.entry, term: verdict.term, blockId: id })
  }
  return {
    placed,
    unplaced,
    absent: report.absent,
    blocks: [...changed].map((id) => ({ id, text: texts.get(id)! }))
  }
}

export interface StrayMark {
  blockId: string
  /** The words the circle stands after, for reading. */
  after: string
}

/**
 * Circles in the text that no entry claims, taken out.
 *
 * Cutting an entry leaves its circles behind: on the Hall collection and on
 * _The Human Aura and The Astral World_ a cut list removed entries whose
 * words still carried a circle, which sends a reader to the back for a word
 * that is not there. Every circle in prose is kept only if the words before
 * it match an entry (the same `pattern` the check uses), or if it follows a
 * digit, where it is a degree (`33°`). The rest are returned with the text
 * they leave, for a person to read before the batch lands.
 */
export function withoutStrayMarks(
  headwords: readonly string[],
  blocks: readonly MarkableBlock[]
): { blocks: { id: string; text: string }[]; removed: StrayMark[] } {
  // A circle on the opening words of a longer headword is the entry's too:
  // `magic-lantern°` is where Clairvoyance points at "Magic-lantern slide".
  const patterns = headwords.flatMap((entry) =>
    headwordTerms(entry).flatMap((term) => {
      const words = term.split(/[\s-]+/)
      const openings = words.slice(1).map((_, k) => words.slice(0, k + 1).join(' '))
      return [term, ...openings].map((t) => pattern(t, isPersonHeadword(entry)))
    })
  )
  const out: { id: string; text: string }[] = []
  const removed: StrayMark[] = []
  for (const block of blocks) {
    if (block.kind === 'heading' || !block.text.includes(GLOSSARY_MARK)) continue
    const { plain, toMarkup } = mapPlainText(block.text)
    const claimed = new Set<number>()
    for (const re of patterns) {
      for (const hit of plain.matchAll(re)) {
        if (hit[0].endsWith(GLOSSARY_MARK)) claimed.add((hit.index ?? 0) + hit[0].length - 1)
      }
    }
    const stray: number[] = []
    for (let i = plain.indexOf(GLOSSARY_MARK); i !== -1; i = plain.indexOf(GLOSSARY_MARK, i + 1)) {
      if (claimed.has(i) || /\d/.test(plain[i - 1] ?? '')) continue
      stray.push(i)
      removed.push({ blockId: block.id, after: plain.slice(Math.max(0, i - 40), i) })
    }
    if (stray.length === 0) continue
    let text = block.text
    for (const i of stray.reverse()) {
      const at = toMarkup[i]!
      text = text.slice(0, at) + text.slice(at + 1)
    }
    out.push({ id: block.id, text })
  }
  return { blocks: out, removed }
}
