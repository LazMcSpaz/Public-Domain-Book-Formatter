/**
 * Typewriter quotes into printer's quotes, at layout time.
 *
 * A scan of a 1916 book has real opening and closing quotes on the paper, but
 * what comes back from a reading of it is a mixture: this book arrived with 642
 * straight double quotes against 229 curly ones, and 185 straight apostrophes
 * against 76. On the page that is visible and ugly, a typewriter mark sitting in
 * the middle of a line of Garamond.
 *
 * ## Why this is not a correction
 *
 * The proof step's rule is that it fixes what a page *says* and never how it
 * looks, and quote shape is entirely how it looks. Baking it into the
 * transcription would also be expensive in the way that matters here: a text
 * edit carries its whole block, so normalising six hundred blocks would add
 * most of a megabyte to a book file that is rewritten in git on every save, and
 * would bury eighty real corrections in six hundred typographic ones.
 *
 * So it belongs where optical margins belong, applied to the document on the
 * way into `layout()`, off a switch in the style profile. Same reasoning, and
 * the same shape: a pure function of the document, changing nothing that a
 * later pass depends on.
 *
 * ## What it does not try to be
 *
 * There is no way to be certain from characters alone, and this does not
 * pretend otherwise. The rule is the ordinary one — a quote after a space or an
 * opening bracket opens, anything else closes — with the elisions this period
 * actually uses (`'tis`, `'em`, `'76`) listed rather than guessed at. Nested
 * single quotes inside doubles come out right because the same rule applies at
 * both levels, which is most of what this book needs: its long Cazotte
 * dialogue is quotation inside quotation for three pages.
 *
 * Pure: no I/O.
 */
import type { BookBlock, BookDocument } from '@core/assemble'

/** Elisions that open with an apostrophe, so a mark before them never opens. */
const ELISIONS = /^(tis|twas|twere|til|em|un|neath|gainst|prentice|\d\ds?\b)/iu

const OPENERS = new Set(['(', '[', '{', '“', '‘', '—', '–', '/', ' '])

/**
 * Whether what has been emitted so far leaves a quote in opening position.
 *
 * Decided against the *output* and not the input, which is what makes a
 * quotation inside a quotation come out right. In `"'Ah,' said Condorcet` the
 * single mark follows a double one, and reading the input there finds a plain
 * `"` that says nothing about which way it turned. Reading the output finds a
 * `“`, which is an opener, so the single mark opens too. At the other end the
 * output holds a `’`, which is not, so the double mark closes.
 *
 * `<i>` tags are stepped over rather than counted: a quotation beginning on an
 * italicised word has a tag between the space and the mark, and treating the
 * `>` as an ordinary letter would close every one of them.
 */
function opensAfter(out: string): boolean {
  let i = out.length - 1
  while (i >= 0) {
    if (out[i] === '>') {
      const start = out.lastIndexOf('<', i)
      if (start < 0) break
      i = start - 1
      continue
    }
    break
  }
  if (i < 0) return true
  const before = out[i]!
  return /\s/u.test(before) || OPENERS.has(before)
}

/** One run of text, with the quotes turned round. */
export function typographicQuotes(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '"') {
      out += opensAfter(out) ? '“' : '”'
    } else if (ch === "'") {
      const opening = opensAfter(out) && !ELISIONS.test(text.slice(i + 1))
      out += opening ? '‘' : '’'
    } else {
      out += ch
    }
  }
  return out
}

const overBlock = (b: BookBlock): BookBlock => {
  const text = typographicQuotes(b.text)
  if (text === b.text && !b.cells) return b
  return {
    ...b,
    text,
    ...(b.cells ? { cells: b.cells.map((row) => row.map(typographicQuotes)) } : {})
  }
}

/**
 * The whole document, quotes turned round.
 *
 * Chapters and footnotes are included because they are printed too: a chapter
 * title reaches the contents page and the running head, and a note the reader
 * sees at the foot of a page has no business being set differently from the
 * sentence that called it.
 */
export function withTypographicQuotes(doc: BookDocument): BookDocument {
  return {
    ...doc,
    blocks: doc.blocks.map(overBlock),
    chapters: doc.chapters.map((c) => ({ ...c, title: typographicQuotes(c.title) })),
    footnotes: doc.footnotes.map((f) => ({ ...f, text: typographicQuotes(f.text) })),
    sections: doc.sections.map((s) => ({
      ...s,
      title: typographicQuotes(s.title),
      blocks: s.blocks.map(overBlock)
    })),
    illustrations: doc.illustrations.map((ill) =>
      typeof ill.caption === 'string' ? { ...ill, caption: typographicQuotes(ill.caption) } : ill
    )
  }
}
