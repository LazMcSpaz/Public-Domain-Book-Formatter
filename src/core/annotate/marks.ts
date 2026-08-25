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
 * The alternatives a headword offers.
 *
 * `Nimbus, halo` and `Gnome, sylph, undine, salamander` are one entry covering
 * several words, and the book may use any of them. A leading article is
 * dropped because `Aura, the human aura` is an entry about *aura*.
 */
export function headwordTerms(headword: string): string[] {
  return headword
    .trim()
    .replace(/\.$/, '')
    .split(',')
    .map((part) => part.replace(/\s*\(.*?\)\s*/g, '').trim())
    .map((part) => part.replace(/^(the|a|an)\s+/i, '').trim())
    .filter((part) => part.length >= 3)
}

/**
 * What to look for in the running text.
 *
 * Hyphen and space are interchangeable, because a compositor's `sub-plane` and
 * a writer's `sub plane` are the same word; a trailing plural is allowed; and
 * `colour` matches `color`, since the glossary is written in this editor's
 * spelling and the book in its own.
 */
function pattern(term: string): RegExp {
  const parts = term.split(/[\s-]+/).map((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return (
      escaped
        .replace(/colou?r/gi, 'colou?r')
        // The glossary is typed with a straight apostrophe and the book is set
        // with a curly one. `Dante's Inferno` is on the page and was reported
        // as a word the book never uses.
        .replace(/['\u2019]/g, "['\u2019]") + '(?:s|es)?'
    )
  })
  return new RegExp(`\\b${parts.join('[\\s-]+')}\\b${GLOSSARY_MARK}?`, 'giu')
}

/**
 * Every entry, against the body the reader will hold.
 *
 * Only paragraphs are searched. A mark on a chapter heading would travel into
 * the running head and the contents, which is not a place for a footnote-sized
 * circle, so a term the book uses only in a heading counts as absent and the
 * report says so.
 */
export function checkGlossaryMarks(
  headwords: readonly string[],
  blocks: readonly MarkableBlock[]
): MarkReport {
  const prose = blocks.filter((block) => block.kind === 'paragraph')
  const report: MarkReport = { marked: [], unmarked: [], absent: [] }

  for (const entry of headwords) {
    let verdict: MarkVerdict = { entry, term: entry, blockId: null, marked: false }
    let found = false

    // *Any* occurrence carrying the mark satisfies the entry, not the first
    // one. Which occurrence to mark is the editor's call and is not always the
    // first: the books introduce a term in a run-in heading set in capitals,
    // and a circle belongs on the words rather than on the heading. Reporting
    // the first occurrence unmarked would flag every one of those.
    for (const term of headwordTerms(entry)) {
      const re = pattern(term)
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
