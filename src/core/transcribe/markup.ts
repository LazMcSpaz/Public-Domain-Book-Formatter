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
 * ## Word indices, and parts of words
 *
 * The line breaker splits a paragraph on whitespace and gives every placed word
 * a `sourceIndex` back into that split — which is already exactly the
 * coordinate system needed to set one word in italic and its neighbour in
 * roman. So a word set wholly in a face is recorded as its index, in
 * `emphasis`, `strong` or `smallCaps`, and that is nearly every word a book
 * marks.
 *
 * Nearly. A book of letters prints its writers' underlining in italic, and a
 * writer underlines what he means: _The Mahatma Letters_ sets
 * `<i>un</i>spiritual`, the prefix and nothing else. Read at word granularity
 * that printed _unspiritual_ — a different emphasis, and the editor's ruling
 * was that the engine must do better than that. So a tag boundary that falls
 * **inside a word's letters** is kept as a **part**: the word, a half-open
 * range of UTF-16 offsets within its whitespace-separated token, and the
 * style. The rule is exactly that and no wider:
 *
 *  - the characters a style covers include **every** letter and digit of the
 *    word (`\p{L}\p{M}\p{Nd}\p{Nl}` — a superscript reference mark is not
 *    one): the whole word, as always —
 *    `(pron. <i>pho-o</i>)` and `“<i>Presence.</i>”¹` are italic words;
 *  - they include **none** of them, only punctuation (`<i>(</i>word`): the
 *    whole word too, which is the any-overlap reading this module has always
 *    given a stray tag;
 *  - they include **some**: a part, covering exactly those characters.
 *
 * So a word wholly in a style never carries a part for it, every block marked
 * before parts existed reads exactly as it did, and `withMarkup` puts a part
 * back as the mid-word tags it came from, so the notation round-trips.
 * `settleParts` is that rule applied after any change of text — a seam joined,
 * a block split — so a part that has come to cover a whole word becomes one.
 *
 * Indices still go stale the moment a correction changes the wording, and
 * that is still handled the way it always was: a corrected block's text
 * arrives as notation and is read again.
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
 * The letters inside are written in the case the page shows them at full
 * size: `<sc>spirit</sc>` is all small capitals and `<sc>Soul</sc>` a full
 * capital S before them, which is how `smcp` reads a word and how a
 * compositor sets one. Whether the run prints in real small capitals, and in
 * which face, is the engine's to decide.
 */
const SMALL_CAPS_TAGS = new Set(['sc'])
/**
 * Tags whose content is kept but whose meaning the book expresses another way.
 *
 * `sup` is the interesting one: it is nearly always a footnote reference mark,
 * and the footnote machinery finds those by looking for the bare marker in the
 * text. Keeping the digit and dropping the tag is what lets it work.
 */
const TRANSPARENT_TAGS = new Set(['sup', 'sub', 'span', 'p', 'small'])

/** The three faces the notation can mark, by the name a part carries. */
export type InlineStyle = 'italic' | 'strong' | 'smallCaps'

/** In the order a part list is sorted in, which is also the order they are parsed in. */
export const INLINE_STYLES: readonly InlineStyle[] = ['italic', 'strong', 'smallCaps']

/**
 * One style over part of one word: `<i>un</i>spiritual` is
 * `{ word, from: 0, to: 2, style: 'italic' }`.
 *
 * Made only where a tag boundary splits the word's letters — see the module
 * note. A word wholly in a style carries its index in that style's list and no
 * part for it, so a part is never a second way of saying what an index says.
 */
export interface InlinePart {
  /** The whitespace-separated word, counted exactly as `emphasis` counts. */
  word: number
  /** UTF-16 offset within the word's token where the style starts. */
  from: number
  /** And where it stops: half-open, and never equal to `from`. */
  to: number
  style: InlineStyle
}

/**
 * Everything that marks a block's or a note's words, as the stored fields.
 *
 * The one shape every carrier — a transcribed block, a footnote, a note ready
 * to set — shares, so the helpers below can take any of them.
 */
export interface InlineStyling {
  emphasis?: readonly number[]
  strong?: readonly number[]
  smallCaps?: readonly number[]
  parts?: readonly InlinePart[]
}

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
   * Indices of whitespace-separated words to set in small capitals, ascending.
   * Same convention as `emphasis`, and omitted by callers where there is none.
   */
  smallCaps: number[]
  /**
   * Styles covering part of a word's letters — see `InlinePart`. Absent when
   * there are none, which is nearly always, so a result read before parts
   * existed and one read now compare equal.
   */
  parts?: InlinePart[]
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
  if (!raw.includes('<')) return { text: raw, emphasis: [], strong: [], smallCaps: [] }

  // Walk the source once, building the clean text and remembering the character
  // ranges each kind of tag covered. Words are counted afterwards, from the
  // clean text, so the indices match what the breaker will produce.
  let text = ''
  const ranges = { italic: [] as Range[], strong: [] as Range[], smallCaps: [] as Range[] }
  const open = { italic: [] as number[], strong: [] as number[], smallCaps: [] as number[] }
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
  for (const kind of INLINE_STYLES) {
    for (const start of open[kind]) ranges[kind].push({ start, end: text.length })
  }

  if (ranges.italic.length === 0 && ranges.strong.length === 0 && ranges.smallCaps.length === 0) {
    return { text, emphasis: [], strong: [], smallCaps: [] }
  }

  // Map character ranges onto word indices, counting words exactly as
  // `itemsFromText` does — by splitting on whitespace.
  const whole = {
    italic: new Set<number>(),
    strong: new Set<number>(),
    smallCaps: new Set<number>()
  }
  const parts: InlinePart[] = []
  let index = 0
  let cursor = 0
  for (const word of text.split(/(\s+)/u)) {
    if (word.length === 0) continue
    const isSpace = /^\s+$/u.test(word)
    if (!isSpace) {
      const start = cursor
      const end = cursor + word.length
      for (const kind of INLINE_STYLES) {
        // What this kind covers of this word, in the word's own offsets.
        const covered = ranges[kind]
          .filter((r) => r.start < end && r.end > start)
          .map((r): [number, number] => [
            Math.max(r.start, start) - start,
            Math.min(r.end, end) - start
          ])
        if (covered.length === 0) continue
        const kept = partRanges(word, covered)
        if (kept === 'whole') whole[kind].add(index)
        else for (const [from, to] of kept) parts.push({ word: index, from, to, style: kind })
      }
      index += 1
    }
    cursor += word.length
  }

  const sorted = (set: Set<number>): number[] => [...set].sort((a, b) => a - b)
  return {
    text,
    emphasis: sorted(whole.italic),
    strong: sorted(whole.strong),
    smallCaps: sorted(whole.smallCaps),
    ...(parts.length > 0 ? { parts } : {})
  }
}

interface Range {
  start: number
  end: number
}

/**
 * A letter, a combining mark or a digit — what a part is judged against.
 *
 * Digits are decimal digits and letter-like numerals, and not the rest of
 * `\p{N}`: a superscript `¹` is a reference mark, not part of the word it is
 * printed against, so `“<i>Presence.</i>”¹` is an italic word as it always was.
 */
const LETTER = /[\p{L}\p{M}\p{Nd}\p{Nl}]/u

/**
 * What a style covering `covered` of `word` amounts to: the whole word, or
 * the covered stretches merged, ascending.
 *
 * The whole word when the stretches cover every letter of it or none of it —
 * see the module note — so that a tag a page put round `pho-o` or round a
 * stray bracket reads exactly as it always did, and a part is made only where
 * the tag genuinely falls among the letters.
 */
function partRanges(
  word: string,
  covered: readonly [number, number][]
): 'whole' | [number, number][] {
  const merged: [number, number][] = []
  for (const [from, to] of [...covered].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    if (to <= from) continue
    const previous = merged[merged.length - 1]
    if (previous && from <= previous[1]) previous[1] = Math.max(previous[1], to)
    else merged.push([from, to])
  }
  if (merged.length === 0) return 'whole'
  let letters = 0
  let inside = 0
  let at = 0
  for (const ch of word) {
    if (LETTER.test(ch)) {
      letters += 1
      if (merged.some(([from, to]) => at >= from && at < to)) inside += 1
    }
    at += ch.length
  }
  return inside === 0 || inside === letters ? 'whole' : merged
}

/** The stored list a style's whole words are kept in. */
const FIELD = { italic: 'emphasis', strong: 'strong', smallCaps: 'smallCaps' } as const

/** Whitespace-separated words, the one tokenisation an index here means. */
function tokens(text: string): string[] {
  return text.split(/\s+/u).filter((w) => w.length > 0)
}

/** A styling with every list present, as `settleParts` returns it. */
export interface SettledStyling {
  emphasis: number[]
  strong: number[]
  smallCaps: number[]
  parts: InlinePart[]
}

/**
 * Parts made sound against `text`, by the same rule the reader applies.
 *
 * Every transform that carries parts across a change of text — a seam joined,
 * a block split, a run spliced in, a record read back from storage — ends
 * here, so the rule lives in one place: a part on a word that no longer
 * exists is dropped, offsets are clamped to the word, overlapping parts of one
 * style merge, a part on a word already wholly in its style is dropped, and a
 * part that has come to cover all of a word's letters (or none of them)
 * becomes the whole word. What comes out is what `parseInlineMarkup` would
 * make of `withMarkup` of it, which is the property the round trip relies on.
 * Never throws: a malformed part is dropped, not refused, because a book
 * should not fail to set over a fragment of italic.
 *
 * The whole-word lists are handed back **as given** unless a part was
 * promoted into one, so a block with no parts comes through untouched.
 */
export function settleParts(text: string, styling: InlineStyling): SettledStyling {
  const out: SettledStyling = {
    emphasis: [...(styling.emphasis ?? [])],
    strong: [...(styling.strong ?? [])],
    smallCaps: [...(styling.smallCaps ?? [])],
    parts: []
  }
  const given = styling.parts ?? []
  if (given.length === 0) return out
  const words = tokens(text)
  const whole = {
    italic: new Set(out.emphasis),
    strong: new Set(out.strong),
    smallCaps: new Set(out.smallCaps)
  }
  /** Ranges per word and style, keyed `${word}:${style}`, clamped. */
  const grouped = new Map<
    string,
    { word: number; style: InlineStyle; ranges: [number, number][] }
  >()
  for (const part of given) {
    if (!isPart(part)) continue
    const token = words[part.word]
    if (token === undefined || whole[part.style].has(part.word)) continue
    const from = Math.max(0, Math.min(token.length, part.from))
    const to = Math.max(0, Math.min(token.length, part.to))
    if (to <= from) continue
    const key = `${part.word}:${part.style}`
    const group = grouped.get(key) ?? { word: part.word, style: part.style, ranges: [] }
    group.ranges.push([from, to])
    grouped.set(key, group)
  }
  const promoted = new Set<InlineStyle>()
  for (const { word, style, ranges } of grouped.values()) {
    const kept = partRanges(words[word]!, ranges)
    if (kept === 'whole') {
      whole[style].add(word)
      promoted.add(style)
    } else {
      for (const [from, to] of kept) out.parts.push({ word, from, to, style })
    }
  }
  for (const style of promoted) out[FIELD[style]] = [...whole[style]].sort((a, b) => a - b)
  out.parts.sort(byPlace)
  return out
}

/** Word, then style, then offset: the order the reader produces parts in. */
function byPlace(a: InlinePart, b: InlinePart): number {
  return (
    a.word - b.word ||
    INLINE_STYLES.indexOf(a.style) - INLINE_STYLES.indexOf(b.style) ||
    a.from - b.from
  )
}

/** Whether a value read from anywhere is a well-formed part, before it is clamped. */
function isPart(value: unknown): value is InlinePart {
  if (typeof value !== 'object' || value === null) return false
  const part = value as Record<string, unknown>
  return (
    Number.isInteger(part['word']) &&
    (part['word'] as number) >= 0 &&
    Number.isInteger(part['from']) &&
    Number.isInteger(part['to']) &&
    INLINE_STYLES.includes(part['style'] as InlineStyle)
  )
}

/**
 * Parts read from storage or a batch, with anything malformed left out.
 *
 * Only the shape is checked here; `settleParts` is what checks a part against
 * the text it sits in.
 */
export function readParts(raw: unknown): InlinePart[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isPart).map((p) => ({ word: p.word, from: p.from, to: p.to, style: p.style }))
}

/**
 * The fields a carrier stores, from a settled styling: each list only where it
 * has something in it, which is how every block here is written.
 */
export function stylingFields(styling: SettledStyling): {
  emphasis?: number[]
  strong?: number[]
  smallCaps?: number[]
  parts?: InlinePart[]
} {
  return {
    ...(styling.emphasis.length > 0 ? { emphasis: styling.emphasis } : {}),
    ...(styling.strong.length > 0 ? { strong: styling.strong } : {}),
    ...(styling.smallCaps.length > 0 ? { smallCaps: styling.smallCaps } : {}),
    ...(styling.parts.length > 0 ? { parts: styling.parts } : {})
  }
}

/** Only the parts in the named styles, for a caller that passes only those lists. */
export function partsIn(
  parts: readonly InlinePart[] | undefined,
  styles: readonly InlineStyle[]
): InlinePart[] | undefined {
  if (!parts?.length) return undefined
  const kept = parts.filter((p) => styles.includes(p.style))
  return kept.length > 0 ? kept : undefined
}

/**
 * One style's parts by word, as the engine wants them: offset pairs within the
 * word, ascending.
 */
export function partsByWord(
  parts: readonly InlinePart[] | undefined,
  style: InlineStyle
): Map<number, [number, number][]> {
  const out = new Map<number, [number, number][]>()
  for (const part of parts ?? []) {
    if (part.style !== style) continue
    const list = out.get(part.word)
    if (list) list.push([part.from, part.to])
    else out.set(part.word, [[part.from, part.to]])
  }
  for (const list of out.values()) list.sort((a, b) => a[0] - b[0])
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
 * phrase rather than as five tagged words. A part goes back as the mid-word
 * tags it was read from — `<i>un</i>spiritual` — so a correction typed against
 * this string keeps it, and `drive.mjs body` shows it.
 */
export function withMarkup(
  text: string,
  emphasis: readonly number[] | undefined,
  strong?: readonly number[],
  smallCaps?: readonly number[],
  parts?: readonly InlinePart[]
): string {
  if (!emphasis?.length && !strong?.length && !smallCaps?.length && !parts?.length) return text
  return renderMarkup(text, { emphasis, strong, smallCaps, parts }, (s) => s)
}

/**
 * The notation's one writer, for `withMarkup` and for the editor's HTML.
 *
 * `escape` is applied to the words and to nothing else, so the HTML view of a
 * block (`htmlOfMarkup`) and its notation (`withMarkup`) are the same walk and
 * cannot come to disagree about where a tag goes.
 *
 * A word is written a stretch at a time, a stretch being a run of its
 * characters in one set of styles; a word with no parts is one stretch, which
 * is exactly the walk this replaced. Tags close before they open, innermost
 * first, so `<sc>` sits outside `<b>` outside `<i>` wherever runs begin
 * together; a closing tag goes before any whitespace already written, so a run
 * never swallows the space after it.
 */
export function renderMarkup(
  text: string,
  styling: InlineStyling,
  escape: (s: string) => string
): string {
  const state: { words: Set<number>; style: InlineStyle; tag: string; inside: boolean }[] = [
    { words: new Set(styling.smallCaps ?? []), style: 'smallCaps', tag: 'sc', inside: false },
    { words: new Set(styling.strong ?? []), style: 'strong', tag: 'b', inside: false },
    { words: new Set(styling.emphasis ?? []), style: 'italic', tag: 'i', inside: false }
  ]
  const partsOf = new Map<number, InlinePart[]>()
  for (const part of styling.parts ?? []) {
    const list = partsOf.get(part.word)
    if (list) list.push(part)
    else partsOf.set(part.word, [part])
  }

  let out = ''
  let index = 0
  for (const token of text.split(/(\s+)/u)) {
    if (token.length === 0) continue
    if (/^\s+$/u.test(token)) {
      out += token
      continue
    }
    for (const [from, to] of stretchesOf(token, partsOf.get(index))) {
      const on = (mark: (typeof state)[number]): boolean =>
        mark.words.has(index) ||
        (partsOf.get(index) ?? []).some(
          (p) => p.style === mark.style && p.from <= from && p.to >= to
        )
      // Closing runs before opening any, and in reverse, so the tags nest:
      // `<b><i>…</i></b>` and never `<b><i>…</b></i>`.
      for (const mark of [...state].reverse()) {
        if (mark.inside && !on(mark)) {
          out = out.replace(/(\s*)$/u, `</${mark.tag}>$1`)
          mark.inside = false
        }
      }
      for (const mark of state) {
        if (!mark.inside && on(mark)) {
          out += `<${mark.tag}>`
          mark.inside = true
        }
      }
      out += escape(token.slice(from, to))
    }
    index += 1
  }
  for (const mark of [...state].reverse()) if (mark.inside) out += `</${mark.tag}>`
  return out
}

/** A word cut at every part boundary on it: one stretch where it has none. */
function stretchesOf(token: string, parts: readonly InlinePart[] | undefined): [number, number][] {
  if (!parts?.length) return [[0, token.length]]
  const cuts = new Set([0, token.length])
  for (const part of parts) {
    if (part.from > 0 && part.from < token.length) cuts.add(part.from)
    if (part.to > 0 && part.to < token.length) cuts.add(part.to)
  }
  const at = [...cuts].sort((a, b) => a - b)
  const out: [number, number][] = []
  for (let i = 1; i < at.length; i++) out.push([at[i - 1]!, at[i]!])
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
 * Shift parts by a number of words — `shiftEmphasis` for the parts, and needed
 * in every place that is.
 *
 * Only the word moves; the offsets are within the word and do not. Where a
 * join also lengthens a word (a hyphen healed across a seam) the offsets move
 * too, and that is `joinStyling`'s to do, not this.
 */
export function shiftParts(parts: readonly InlinePart[], by: number): InlinePart[] {
  return parts.map((p) => ({ ...p, word: p.word + by }))
}

/** Where each whitespace-separated word of `text` starts and ends. */
function wordSpans(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  for (const match of text.matchAll(/\S+/gu)) {
    out.push({ start: match.index, end: match.index + match[0].length })
  }
  return out
}

/**
 * Parts carried through an edit of the characters under them.
 *
 * `map` takes an offset into `oldText` to the offset the same place has in
 * `newText`. Each part is mapped as a stretch of the whole text, clamped to the
 * new one, and cut again at the new text's word boundaries — so a part keeps
 * to the characters it was on whether the edit deleted a soft hyphen inside
 * the word, lifted a printed mark off the front of it, or cut the text in two
 * through the middle of it. A part that maps to nothing is dropped.
 *
 * Unsettled: the caller runs `settleParts` over the result, which is where a
 * part that now covers a whole word becomes one.
 */
export function moveParts(
  oldText: string,
  parts: readonly InlinePart[] | undefined,
  newText: string,
  map: (offset: number) => number
): InlinePart[] {
  if (!parts?.length) return []
  const oldSpans = wordSpans(oldText)
  const newSpans = wordSpans(newText)
  const clamp = (n: number): number => Math.max(0, Math.min(newText.length, n))
  const out: InlinePart[] = []
  for (const part of parts) {
    const span = oldSpans[part.word]
    if (!span) continue
    const start = clamp(map(span.start + Math.max(0, part.from)))
    const end = clamp(map(span.start + Math.min(span.end - span.start, part.to)))
    if (end <= start) continue
    newSpans.forEach((word, index) => {
      const from = Math.max(start, word.start)
      const to = Math.min(end, word.end)
      if (to > from) {
        out.push({ word: index, from: from - word.start, to: to - word.start, style: part.style })
      }
    })
  }
  return out
}

/**
 * Parts carried across deleting some characters from their text — soft
 * hyphens, which assembly strips from every block. The words stay the words
 * they were; a character deleted before a part moves it back, and one deleted
 * inside it shortens it.
 */
export function partsAfterDeleting(
  text: string,
  parts: readonly InlinePart[] | undefined,
  deleted: RegExp
): InlinePart[] {
  if (!parts?.length) return []
  const gone: number[] = []
  let kept = ''
  for (let i = 0; i < text.length; i++) {
    if (deleted.test(text[i]!)) gone.push(i)
    else kept += text[i]
  }
  if (gone.length === 0) return [...parts]
  return moveParts(text, parts, kept, (offset) => offset - gone.filter((g) => g < offset).length)
}

/**
 * The styling of two texts joined into one, where the join may have made the
 * last word of the first and the first word of the second into one word.
 *
 * Assembly joins a paragraph across a page seam and a note across its runover,
 * and `joinText` heals a hyphen there: `chirur-` and `geon` become one word.
 * Whole-word styles take the union on the healed word, as they always have:
 * the second half's indices move along by the first half's words less one
 * where a word was healed, which is the shift measured off the joined text.
 * A part keeps to its characters — one on the second half's first word lands
 * on the healed word moved along by the first half's last word as it now
 * stands, hyphen taken off — and then `settleParts`, so a part the union has
 * made redundant (the healed word is wholly that style) goes, and a part that
 * has come to cover the whole healed word becomes it.
 *
 * `joined` is exactly what `joinText(leftText, rightText)` returned, so the
 * first text sits at its head and the second, trimmed, at its tail.
 */
export function joinStyling(
  leftText: string,
  left: InlineStyling,
  rightText: string,
  right: InlineStyling,
  joined: string
): SettledStyling {
  const shift = wordCount(joined) - wordCount(rightText)
  const merge = (a: readonly number[] | undefined, b: readonly number[] | undefined): number[] => [
    ...(a ?? []),
    ...shiftEmphasis(b ?? [], shift)
  ]
  const rightTrimmed = rightText.trimStart()
  const lead = rightText.length - rightTrimmed.length
  const rightStart = joined.endsWith(rightTrimmed)
    ? joined.length - rightTrimmed.length
    : joined.length
  // Everything of the first text that survived the join sits before the
  // second: a space, or nothing where a hyphen was healed and taken off.
  const leftEnd = /\s$/u.test(joined.slice(0, rightStart)) ? rightStart - 1 : rightStart
  const parts = [
    ...moveParts(leftText, left.parts, joined, (o) => Math.min(o, leftEnd)),
    ...moveParts(rightText, right.parts, joined, (o) => Math.max(0, o - lead) + rightStart)
  ]
  return settleParts(joined, {
    emphasis: merge(left.emphasis, right.emphasis),
    strong: merge(left.strong, right.strong),
    smallCaps: merge(left.smallCaps, right.smallCaps),
    parts
  })
}

/** How many whitespace-separated words a string holds, counted as the breaker does. */
export function wordCount(text: string): number {
  return text.split(/\s+/u).filter((w) => w.length > 0).length
}
