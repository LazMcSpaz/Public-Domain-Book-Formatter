/**
 * An exported interior's text, page by page, with the words its lines broke
 * put back together — so a check can read what KDP reads, and not what this
 * repository believes the book to be.
 *
 * It exists because KDP's spell-check of *The Mahatma Letters* (10 November
 * 2026) found three faults in Barker's analytical contents that no check here
 * had read. The repair for that was to read everything the book file prints
 * (`printedTexts`); this is the net under it, for whatever prints that the
 * book file does not hold or a later check forgets: read the export itself.
 *
 * The input is `pdftotext -layout` of the interior, pages split on form feeds
 * and lines kept as the page set them. The plain mode of `pdftotext` was tried
 * first and mends breaks on its own, wrongly in two ways, each of which put a
 * non-word on the sheet: a compound broken at its own hyphen came out welded
 * (`self-` / `sacrifice` as `selfsacrifice`), and a word broken at the foot of
 * a page was glued to whatever line followed, the folio (`commu52`) or the
 * first footnote. So the breaks are mended here, where the book can be asked:
 *
 * - a line ending in a hyphen with a lower-case line under it (or a word in
 *   capitals with a line in capitals under it) is one word, and
 *   the hyphen stays only where the book prints that word hyphenated **at that
 *   place** (it sets both `dis-embodied` and `disembodied`, and a line ending
 *   `disem-` is the second);
 * - a line ending in a hyphen with anything else under it (a blank, a note,
 *   the folio) was broken by the page, and the rest of the word is the first
 *   line of the next page that opens in lower case, within the running head's
 *   few lines, **and makes a word with it**. One that makes none is left in
 *   halves, which reports it rather than guessing.
 *
 * Pure: the book's words and its hyphenated forms come in as arguments.
 */

export interface ExportVocabulary {
  /** A word, in any case, that the dictionary or the book knows. */
  known: (word: string) => boolean
  /** Every word the book prints with a hyphen, lower-cased, hyphens kept. */
  hyphenated: ReadonlySet<string>
}

/** How many non-blank lines at the head of a page may stand before the text resumes. */
const HEAD_LINES = 4

/** The whole compound before a line-end break: `beef-and-` is `beef-and`, not `and`. */
const BROKEN = /(\p{L}[\p{L}-]*)-\s*$/u
const OPENS_LOWER = /^\s*\p{Ll}/u

/**
 * Whether a line can be the rest of a word broken at the end of the one
 * above: it opens in lower case, or the word is in capitals and so is the
 * line (`the LAW OF RET-` / `RIBUTION`).
 */
function continues(fragment: string, line: string): boolean {
  return OPENS_LOWER.test(line) || (/\p{Lu}$/u.test(fragment) && /^\s*\p{Lu}/u.test(line))
}

export function exportPages(raw: string, book: ExportVocabulary): { id: string; text: string }[] {
  const pages = raw.split('\f').map((page) => page.split('\n'))
  // The first word of a line, as a compound (`pa-ngi`) for asking whether the
  // book prints the whole thing hyphenated (`Tong-pa-ngi`), and its first
  // piece alone for asking whether the halves make a word.
  const head = (line: string): string => /^\s*(\p{L}[\p{L}-]*\p{L}|\p{L})/u.exec(line)?.[1] ?? ''
  const piece = (line: string): string => /^\s*(\p{L}+)/u.exec(line)?.[1] ?? ''
  const brokenHere = (fragment: string, line: string): boolean =>
    book.hyphenated.has(`${fragment}-${head(line)}`.toLowerCase())
  const join = (fragment: string, line: string): string =>
    fragment + (brokenHere(fragment, line) ? '-' : '') + line.trimStart()
  const makesWord = (fragment: string, line: string): boolean =>
    brokenHere(fragment, line) || book.known(fragment.replace(/^.*-/u, '') + piece(line))

  pages.forEach((lines, p) => {
    for (let i = 0; i < lines.length; i++) {
      const broken = BROKEN.exec(lines[i]!)
      if (!broken) continue
      const fragment = broken[1]!
      const before = lines[i]!.slice(0, broken.index)
      // Within the page the rest of the word is the very next line. It is
      // taken out rather than blanked, because the joined line can end in a
      // break of its own, and a blank under it would read as the page's foot.
      if (continues(fragment, lines[i + 1] ?? '')) {
        lines[i] = before + join(fragment, lines[i + 1]!)
        lines.splice(i + 1, 1)
        i--
        continue
      }
      const next = pages[p + 1]
      if (!next) continue
      const target = next
        .map((line, k) => ({ line, k }))
        .filter(({ line }) => line.trim() !== '')
        .slice(0, HEAD_LINES)
        .find(({ line }) => continues(fragment, line) && makesWord(fragment, line))
      if (!target) continue
      next[target.k] = join(fragment, next[target.k]!)
      lines[i] = before
    }
  })
  return pages.map((lines, i) => ({
    id: `page${i + 1}`,
    text: lines.join(' ').replace(/\s+/gu, ' ').trim()
  }))
}
