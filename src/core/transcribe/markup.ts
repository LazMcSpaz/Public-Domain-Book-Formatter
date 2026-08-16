/**
 * Inline markup the model emits, turned into something the book can set.
 *
 * The vision pass was never asked for markup, and it produces it anyway:
 * `<em>how to project the astral body</em>`, `<i>spontaneous</i>`,
 * `<sup>1</sup>`. That is not misbehaviour — the original *prints* those words
 * in italic, the schema gave the model no field to say so, and it reached for
 * the only notation it had. Left alone the tags are drawn verbatim by the
 * layout engine, so a finished book prints the angle brackets.
 *
 * The obvious fix is to strip them. The better one is to believe them: the
 * model is telling us where the emphasis is, which is information the scan
 * genuinely contains and which nothing else in the pipeline recovers. So the
 * tags are read, converted, and removed.
 *
 * ## Why word indices and not character offsets
 *
 * The line breaker splits a paragraph on whitespace and gives every placed word
 * a `sourceIndex` back into that split — which is already exactly the
 * coordinate system needed to set one word in italic and its neighbour in
 * roman. Character offsets would have to be mapped onto it at every use, and
 * would go stale the moment a correction changed the text by one letter.
 *
 * The cost is that emphasis is word-granular: `un<i>doubted</i>ly` italicises
 * the whole word. Books emphasise words and phrases, not fragments of words, so
 * this has not come up — and the alternative is threading character ranges
 * through the breaker, the hyphenator and the seam repair.
 *
 * Pure: text in, text and indices out.
 */

/** Tags that mean "set this in italic", which is all a book actually needs. */
const ITALIC_TAGS = new Set(['i', 'em', 'cite', 'var'])
/**
 * Tags whose content is kept but whose meaning the book expresses another way.
 *
 * `sup` is the interesting one: it is nearly always a footnote reference mark,
 * and the footnote machinery finds those by looking for the bare marker in the
 * text. Keeping the digit and dropping the tag is what lets it work.
 */
const TRANSPARENT_TAGS = new Set(['sup', 'sub', 'b', 'strong', 'span', 'p', 'small'])

export interface InlineMarkup {
  /** The text with every tag removed. */
  text: string
  /**
   * Indices of whitespace-separated words to set in italic, ascending.
   *
   * Empty when there is no emphasis, and omitted entirely by the callers that
   * store it, so an unemphasised book carries no extra bytes.
   */
  emphasis: number[]
}

/** Anything that looks like a tag, closing or not, with or without attributes. */
const TAG = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/gu

/**
 * Read the tags, record what they emphasise, and take them out.
 *
 * Deliberately forgiving. A model that opens `<em>` and never closes it, or
 * closes one it never opened, is producing a book that still has to be set:
 * an unclosed tag runs to the end of the block, and a stray closing tag is
 * dropped. Neither is worth failing a page over, and neither can leave a tag
 * in the printed text.
 */
export function parseInlineMarkup(raw: string): InlineMarkup {
  if (!raw.includes('<')) return { text: raw, emphasis: [] }

  // Walk the source once, building the clean text and remembering the character
  // ranges the italic tags covered. Words are counted afterwards, from the
  // clean text, so the indices match what the breaker will produce.
  let text = ''
  const ranges: { start: number; end: number }[] = []
  const open: number[] = []
  let last = 0

  for (const match of raw.matchAll(TAG)) {
    const [whole, closing, rawName] = match
    const name = (rawName ?? '').toLowerCase()
    if (!ITALIC_TAGS.has(name) && !TRANSPARENT_TAGS.has(name)) continue

    text += raw.slice(last, match.index)
    last = match.index + whole.length

    if (!ITALIC_TAGS.has(name)) continue
    if (closing === '/') {
      const start = open.pop()
      if (start !== undefined) ranges.push({ start, end: text.length })
    } else {
      open.push(text.length)
    }
  }
  text += raw.slice(last)

  // An unclosed tag emphasises the rest of the block, which is what it asked
  // for and the least surprising reading of a mistake.
  for (const start of open) ranges.push({ start, end: text.length })

  if (ranges.length === 0) return { text, emphasis: [] }

  // Map character ranges onto word indices, counting words exactly as
  // `itemsFromText` does — by splitting on whitespace.
  const emphasis = new Set<number>()
  let index = 0
  let cursor = 0
  for (const word of text.split(/(\s+)/u)) {
    if (word.length === 0) continue
    const isSpace = /^\s+$/u.test(word)
    if (!isSpace) {
      const start = cursor
      const end = cursor + word.length
      // Any overlap counts: a range covering half a word italicises the word.
      if (ranges.some((r) => r.start < end && r.end > start)) emphasis.add(index)
      index += 1
    }
    cursor += word.length
  }

  return { text, emphasis: [...emphasis].sort((a, b) => a - b) }
}

/**
 * Shift emphasis indices by a number of words.
 *
 * Needed when assembly joins two blocks across a page seam: the second half's
 * words move along by however many the first half had, and its emphasis has to
 * move with them or the italics land on the wrong words.
 */
export function shiftEmphasis(emphasis: readonly number[], by: number): number[] {
  return emphasis.map((i) => i + by)
}

/** How many whitespace-separated words a string holds, counted as the breaker does. */
export function wordCount(text: string): number {
  return text.split(/\s+/u).filter((w) => w.length > 0).length
}
