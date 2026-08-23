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

/** Tags that mean "set this in italic", which is most of what a book needs. */
const ITALIC_TAGS = new Set(['i', 'em', 'cite', 'var'])
/**
 * Tags that mean "set this strong".
 *
 * These were transparent — content kept, tag dropped — for as long as nothing
 * downstream could set a bold run. Now something can, and the same argument
 * that applies to `<i>` applies here: where the original prints a word bold the
 * model is telling us so, and where the *editor* writes a glossary the headword
 * is the one thing on the page that has to be findable at a glance. The face a
 * strong run is actually set in is decided in the layout engine, which knows
 * whether the book's typeface has a bold at all.
 */
const STRONG_TAGS = new Set(['b', 'strong'])
/**
 * Tags whose content is kept but whose meaning the book expresses another way.
 *
 * `sup` is the interesting one: it is nearly always a footnote reference mark,
 * and the footnote machinery finds those by looking for the bare marker in the
 * text. Keeping the digit and dropping the tag is what lets it work.
 */
const TRANSPARENT_TAGS = new Set(['sup', 'sub', 'span', 'p', 'small'])

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
  /**
   * Indices of whitespace-separated words to set strong, ascending.
   *
   * Same convention and same reasons as `emphasis`, and stored the same way:
   * omitted entirely where there is none.
   */
  strong: number[]
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
  if (!raw.includes('<')) return { text: raw, emphasis: [], strong: [] }

  // Walk the source once, building the clean text and remembering the character
  // ranges each kind of tag covered. Words are counted afterwards, from the
  // clean text, so the indices match what the breaker will produce.
  let text = ''
  const ranges = { italic: [] as Range[], strong: [] as Range[] }
  const open = { italic: [] as number[], strong: [] as number[] }
  let last = 0

  for (const match of raw.matchAll(TAG)) {
    const [whole, closing, rawName] = match
    const name = (rawName ?? '').toLowerCase()
    const kind = ITALIC_TAGS.has(name) ? 'italic' : STRONG_TAGS.has(name) ? 'strong' : null
    if (!kind && !TRANSPARENT_TAGS.has(name)) continue

    text += raw.slice(last, match.index)
    last = match.index + whole.length

    if (!kind) continue
    if (closing === '/') {
      const start = open[kind].pop()
      if (start !== undefined) ranges[kind].push({ start, end: text.length })
    } else {
      open[kind].push(text.length)
    }
  }
  text += raw.slice(last)

  // An unclosed tag marks the rest of the block, which is what it asked for and
  // the least surprising reading of a mistake.
  for (const kind of ['italic', 'strong'] as const) {
    for (const start of open[kind]) ranges[kind].push({ start, end: text.length })
  }

  if (ranges.italic.length === 0 && ranges.strong.length === 0) {
    return { text, emphasis: [], strong: [] }
  }

  // Map character ranges onto word indices, counting words exactly as
  // `itemsFromText` does — by splitting on whitespace.
  const emphasis = new Set<number>()
  const strong = new Set<number>()
  let index = 0
  let cursor = 0
  for (const word of text.split(/(\s+)/u)) {
    if (word.length === 0) continue
    const isSpace = /^\s+$/u.test(word)
    if (!isSpace) {
      const start = cursor
      const end = cursor + word.length
      // Any overlap counts: a range covering half a word marks the word.
      const hits = (rs: Range[]): boolean => rs.some((r) => r.start < end && r.end > start)
      if (hits(ranges.italic)) emphasis.add(index)
      if (hits(ranges.strong)) strong.add(index)
      index += 1
    }
    cursor += word.length
  }

  const sorted = (set: Set<number>): number[] => [...set].sort((a, b) => a - b)
  return { text, emphasis: sorted(emphasis), strong: sorted(strong) }
}

interface Range {
  start: number
  end: number
}

/**
 * Put the tags back — the inverse of `parseInlineMarkup`.
 *
 * Emphasis is real content: the original *prints* those words in italic, and a
 * reprint that loses them is a worse book. But it is invisible everywhere the
 * text is shown for correction, because a textarea has no italics — so someone
 * proofreading cannot tell whether it was captured, cannot add it where the
 * pass missed it, and cannot see that retyping the paragraph discarded it.
 *
 * Showing the tags fixes all three at once, and needs no new field and no
 * re-mapping of indices when the wording changes: the editor shows `<i>…</i>`,
 * the user edits it as text, and `normalizeMarkup` reads it straight back on
 * the way in. This is the same trick a table already uses — its `text` is a
 * derived flattened view with `|` between the cells, reconciled by
 * `normalizeTable` — applied to the same editor for the same reason.
 *
 * Contiguous emphasised words share one pair of tags, so a phrase reads as a
 * phrase rather than as five tagged words.
 */
export function withMarkup(
  text: string,
  emphasis: readonly number[] | undefined,
  strong?: readonly number[]
): string {
  if (!emphasis?.length && !strong?.length) return text
  const marks = [
    { words: new Set(strong ?? []), tag: 'b', inside: false },
    { words: new Set(emphasis ?? []), tag: 'i', inside: false }
  ]

  let out = ''
  let index = 0
  for (const part of text.split(/(\s+)/u)) {
    if (part.length === 0) continue
    if (/^\s+$/u.test(part)) {
      out += part
      continue
    }
    // Closing runs before opening any, and in reverse, so the tags nest:
    // `<b><i>…</i></b>` and never `<b><i>…</b></i>`.
    for (const mark of [...marks].reverse()) {
      if (mark.inside && !mark.words.has(index)) {
        out = out.replace(/(\s*)$/u, `</${mark.tag}>$1`)
        mark.inside = false
      }
    }
    for (const mark of marks) {
      if (!mark.inside && mark.words.has(index)) {
        out += `<${mark.tag}>`
        mark.inside = true
      }
    }
    out += part
    index += 1
  }
  for (const mark of [...marks].reverse()) if (mark.inside) out += `</${mark.tag}>`
  return out
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
