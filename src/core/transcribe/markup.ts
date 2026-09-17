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
 * ## The one thing that is not word-granular
 *
 * A chemical formula is. `Na2CO3` is one whitespace-separated word and the two
 * figures in it are set below the line while the letters are not, so no word
 * index can describe it — the case the paragraph above says "has not come up"
 * came up, on page 462 of _Isis Unveiled_ Vol. I. `subscript` is therefore
 * **character ranges** into the clean text, and it is the only kind here that
 * is, deliberately: emphasis stays word-granular because that is the breaker's
 * own coordinate system and nothing has ever needed finer.
 *
 * What makes the offsets safe is the same thing that makes the word indices
 * safe — they are re-derived from the notation on every edit rather than
 * stored once and re-applied to text that has since moved. `parseInlineMarkup`
 * already computed these ranges and threw them away; now it keeps one set.
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
 * Tags that mean "set this in small capitals".
 *
 * The one mark here whose meaning depends on the *case of the text it covers*,
 * and that is the whole of how to use it. A face's `smcp` feature replaces
 * lower-case letters with small capitals and leaves capitals alone, so the
 * word is written the way it is spelt — `<sc>Hermetist</sc>` — and the page
 * sets a full H over small ERMETIST, which is what caps-and-small-caps is and
 * what an 1877 glossary headword looks like. Writing `<sc>HERMETIST</sc>`
 * asks for small capitals and gets full ones, correctly: there are no
 * lower-case letters in it to replace.
 *
 * That is why the notation could not simply be hung on the capitals the
 * reading already carries. A transcription that reads `HERMETIST.` records
 * what letters are on the paper and says nothing about their size, and marking
 * it changes nothing; the word has to be written in its own case for the mark
 * to have anything to act on.
 *
 * What a small-caps run is actually *drawn* as is the engine's decision, and
 * it refuses to synthesise: a face with no `smcp` sets the run in full
 * capitals rather than in capitals scaled down, for the same reason a face
 * with no bold sets a strong run in italic. Scaled capitals are a forgery and
 * they look like one — the weight of the strokes gives it away beside the
 * text they sit in.
 */
const SMALL_CAPS_TAGS = new Set(['sc', 'smallcaps'])
/**
 * Tags that mean "set this below the line".
 *
 * `sub` was transparent — content kept, tag dropped — for as long as nothing
 * downstream could set a figure below the baseline, which meant a chemical
 * formula arrived in the book as the flat word `Na2CO3` with no record that the
 * paper had set anything low. What a subscript is actually *drawn* as is the
 * layout engine's decision, and it is a synthesised one: a smaller size on a
 * lowered baseline, never the Unicode subscript figures. That is the same
 * refusal a footnote's reference mark already makes, for the same measured
 * reason — IM FELL English carries no U+2082 at all, and neither Cardo's italic
 * nor its bold carries the `subs` feature, so anything resting on a glyph the
 * face may not have would draw as a hole in the most likely configuration.
 */
const SUBSCRIPT_TAGS = new Set(['sub'])
/**
 * Tags whose content is kept but whose meaning the book expresses another way.
 *
 * `sup` is the interesting one: it is nearly always a footnote reference mark,
 * and the footnote machinery finds those by looking for the bare marker in the
 * text. Keeping the digit and dropping the tag is what lets it work.
 */
const TRANSPARENT_TAGS = new Set(['sup', 'span', 'p', 'small'])

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
  /**
   * Stretches of `text` to set in small capitals, as character ranges.
   *
   * **Character ranges, not word indices, and measured rather than assumed.**
   * Every glossary headword in *Isis Unveiled* is glued to the em dash that
   * introduces its definition — `HERMETIST.—From Hermes` is one
   * whitespace-separated word — so a word index cannot say "these nine letters
   * and not the two after them", and marking the word would have set `FROM` in
   * small capitals too. Thirty headwords, thirty words that no word index
   * describes. The same reason `subscript` is ranges, arrived at the same way.
   *
   * Ascending, non-overlapping and never touching, exactly as `subscript`.
   */
  smallCaps: MarkRange[]
  /**
   * Stretches of `text` to set below the line, as character ranges.
   *
   * Character ranges rather than word indices because the thing this exists for
   * sits inside a word — see the note at the head of this module. Ascending,
   * non-overlapping and never touching (two adjacent ranges are merged into
   * one), so a caller can walk them in step with the text.
   */
  subscript: SubscriptRange[]
}

/** Half-open character range `[from, to)` into a block's clean text. */
export interface MarkRange {
  from: number
  to: number
}

/**
 * What a subscript's ranges have always been called.
 *
 * Kept as the name because `subscript` is the field it describes everywhere,
 * and the shape is now shared with small capitals: both mark a stretch of
 * characters rather than a run of words, for the same reason.
 */
export type SubscriptRange = MarkRange

/** The inline marks a block, a footnote or a written section carries. */
export interface InlineMarks {
  emphasis?: readonly number[]
  strong?: readonly number[]
  smallCaps?: readonly MarkRange[]
  subscript?: readonly MarkRange[]
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
  if (!raw.includes('<')) {
    return { text: raw, emphasis: [], strong: [], smallCaps: [], subscript: [] }
  }

  // Walk the source once, building the clean text and remembering the character
  // ranges each kind of tag covered. Words are counted afterwards, from the
  // clean text, so the indices match what the breaker will produce — except for
  // the subscript ranges, which are kept as they stand.
  let text = ''
  const ranges = {
    italic: [] as Range[],
    strong: [] as Range[],
    smallCaps: [] as Range[],
    sub: [] as Range[]
  }
  const open = {
    italic: [] as number[],
    strong: [] as number[],
    smallCaps: [] as number[],
    sub: [] as number[]
  }
  let last = 0

  for (const match of raw.matchAll(TAG)) {
    const [whole, closing, rawName] = match
    const name = (rawName ?? '').toLowerCase()
    const kind = ITALIC_TAGS.has(name)
      ? 'italic'
      : STRONG_TAGS.has(name)
        ? 'strong'
        : SMALL_CAPS_TAGS.has(name)
          ? 'smallCaps'
          : SUBSCRIPT_TAGS.has(name)
            ? 'sub'
            : null
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
  for (const kind of ['italic', 'strong', 'smallCaps', 'sub'] as const) {
    for (const start of open[kind]) ranges[kind].push({ start, end: text.length })
  }

  const subscript = mergeRanges(ranges.sub, text)
  const smallCaps = mergeRanges(ranges.smallCaps, text)

  if (ranges.italic.length === 0 && ranges.strong.length === 0) {
    return { text, emphasis: [], strong: [], smallCaps, subscript }
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
  return { text, emphasis: sorted(emphasis), strong: sorted(strong), smallCaps, subscript }
}

interface Range {
  start: number
  end: number
}

/**
 * Overlapping, touching and space-separated ranges folded into one list.
 *
 * `Na<sub>2</sub><sub>3</sub>` and `Na<sub>23</sub>` describe the same page, so
 * they had better produce the same record: a serialiser that emitted two
 * adjacent pairs of tags would round-trip to a different string every time.
 * Empty ranges are dropped — `<sub></sub>` marks nothing.
 *
 * **A gap that is nothing but whitespace is not a gap**, and that is what
 * makes the round trip stable rather than a nicety. `withMarkup` writes these
 * tags a word at a time, so that they can nest inside `<i>` and `<b>` without
 * ever crossing one — so a run spanning two words goes out as two pairs and
 * would come back as two ranges, and the notation would grow a range every
 * time the editor saved. Joining them costs nothing that can be drawn: a space
 * set in small capitals is the same space.
 */
function mergeRanges(ranges: readonly Range[], text: string): MarkRange[] {
  const sorted = [...ranges]
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const out: MarkRange[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    const gap = last ? text.slice(last.to, r.start) : ''
    if (last && (r.start <= last.to || gap.trim().length === 0)) {
      last.to = Math.max(last.to, r.end)
    } else out.push({ from: r.start, to: r.end })
  }
  return out
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
 *
 * The marks arrive as one object rather than as a run of positional arguments,
 * and that is a fix rather than a tidy-up. `strong` was added as a third
 * positional and `drive.mjs body` went on calling this with two — so an edit
 * written against what the driver handed back and posted straight back as a
 * `text` edit silently stripped every bold run in the block, because
 * `applyEdits` re-derives the marks from the notation it is given. A block, a
 * footnote and a prepared note all carry these three fields under these three
 * names, so every call site can now pass the thing itself and cannot forget a
 * kind it has never heard of.
 */
export function withMarkup(text: string, marks: InlineMarks | undefined): string {
  const emphasis = marks?.emphasis
  const strong = marks?.strong
  const smallCaps = marks?.smallCaps
  const subscript = marks?.subscript
  if (!emphasis?.length && !strong?.length && !smallCaps?.length && !subscript?.length) {
    return text
  }
  const runs = [
    { words: new Set(strong ?? []), tag: 'b', inside: false },
    { words: new Set(emphasis ?? []), tag: 'i', inside: false }
  ]

  let out = ''
  let index = 0
  let cursor = 0
  for (const part of text.split(/(\s+)/u)) {
    if (part.length === 0) continue
    if (/^\s+$/u.test(part)) {
      out += part
      cursor += part.length
      continue
    }
    // Closing runs before opening any, and in reverse, so the tags nest:
    // `<b><i>…</i></b>` and never `<b><i>…</b></i>`.
    for (const run of [...runs].reverse()) {
      if (run.inside && !run.words.has(index)) {
        out = out.replace(/(\s*)$/u, `</${run.tag}>$1`)
        run.inside = false
      }
    }
    for (const run of runs) {
      if (!run.inside && run.words.has(index)) {
        out += `<${run.tag}>`
        run.inside = true
      }
    }
    // `<sc>` and `<sub>` are character ranges, so they open and close inside
    // the word and never have to be closed and reopened around a word
    // boundary — they always nest innermost. A range spanning several words is
    // written once per word, which reads the same and keeps this one loop.
    out += taggedWord(part, cursor, smallCaps ?? [], subscript ?? [])
    cursor += part.length
    index += 1
  }
  for (const run of [...runs].reverse()) if (run.inside) out += `</${run.tag}>`
  return out
}

/**
 * One word with the character-range tags put back around the stretches they
 * cover.
 *
 * Both kinds in one walk, because they can overlap — a formula inside a
 * small-capitals headword is not a shape this book has, but a serialiser that
 * handled them separately would emit `<sc>Na<sub>2</sub></sc>` from one order
 * and crossing tags from the other. Cut at every boundary and the nesting
 * falls out: small capitals outside, the figure inside it.
 */
function taggedWord(
  word: string,
  start: number,
  smallCaps: readonly MarkRange[],
  subscript: readonly MarkRange[]
): string {
  if (smallCaps.length === 0 && subscript.length === 0) return word
  const inside = (ranges: readonly MarkRange[], at: number): boolean =>
    ranges.some((r) => r.from <= start + at && r.to > start + at)
  // Every character's pair of answers, cut where either changes.
  let out = ''
  let sc = false
  let sub = false
  for (let at = 0; at <= word.length; at += 1) {
    const wantSc = at < word.length && inside(smallCaps, at)
    const wantSub = at < word.length && inside(subscript, at)
    if (sub && (!wantSub || wantSc !== sc)) {
      out += '</sub>'
      sub = false
    }
    if (sc && !wantSc) {
      out += '</sc>'
      sc = false
    }
    if (wantSc && !sc) {
      out += '<sc>'
      sc = true
    }
    if (wantSub && !sub) {
      out += '<sub>'
      sub = true
    }
    if (at < word.length) out += word[at]
  }
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

/**
 * Subscript ranges carried onto a string the text has been folded into.
 *
 * The word-index kinds shift by a word count and that is the whole of it. A
 * character range cannot: assembly does not merely move a block's text, it
 * *edits* it on the way — trimming the ends, healing a hyphen across a page
 * seam, taking soft hyphens out, stripping a footnote's leading marker — and
 * every one of those deletions moves the characters after it.
 *
 * So the map is built rather than assumed. `after` must be `before` with
 * characters deleted and nothing else, which is what all four of those
 * transformations are; a two-pointer walk then says where each original
 * character ended up, and `at` says where `after` was placed in the
 * destination. A range whose text was deleted outright collapses to nothing
 * and is dropped, which is the right answer: there is no character left under
 * it.
 *
 * Returns null when `after` is not a deletion of `before`, because a caller
 * that has changed the text some other way is asking a question this cannot
 * answer, and a guess would put a figure under the wrong letter.
 */
export function rebaseRanges(
  ranges: readonly SubscriptRange[] | undefined,
  before: string,
  after: string,
  at: number
): SubscriptRange[] | null {
  if (!ranges?.length) return []
  // `map[i]` is where `before[i]` sits in the destination; `map[before.length]`
  // is the end, so a range's exclusive `to` maps like any other index.
  const map = new Array<number>(before.length + 1)
  let j = 0
  for (let i = 0; i < before.length; i++) {
    if (j < after.length && after[j] === before[i]) {
      map[i] = at + j
      j += 1
    } else {
      // Deleted: anything anchored here collapses onto what follows it.
      map[i] = at + j
    }
  }
  map[before.length] = at + j
  if (j !== after.length) return null
  const out: SubscriptRange[] = []
  for (const range of ranges) {
    const from = map[Math.max(0, Math.min(before.length, range.from))]!
    const to = map[Math.max(0, Math.min(before.length, range.to))]!
    if (to > from) out.push({ from, to })
  }
  return out
}

/** Subscript ranges moved along by a fixed number of characters. */
export function shiftRanges(ranges: readonly SubscriptRange[], by: number): SubscriptRange[] {
  return ranges.map((r) => ({ from: r.from + by, to: r.to + by }))
}

/** How many whitespace-separated words a string holds, counted as the breaker does. */
export function wordCount(text: string): number {
  return text.split(/\s+/u).filter((w) => w.length > 0).length
}
