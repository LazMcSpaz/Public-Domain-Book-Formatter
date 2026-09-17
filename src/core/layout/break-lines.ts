/**
 * Breaking a paragraph into lines, TeX's way.
 *
 * Knuth–Plass does not ask "does the next word fit?" — it considers the whole
 * paragraph at once and picks the set of breaks with the lowest total badness,
 * which is why TeX output looks the way it does and greedy wrapping doesn't.
 * `tex-linebreak` is a faithful implementation of it, so this module's job is
 * not the algorithm but the *model*: turning prose into the stream of boxes,
 * glue and penalties the algorithm consumes, and turning its chosen breakpoints
 * back into positioned words.
 *
 *   box     — something that occupies width and cannot be broken (a word, or a
 *             fragment of a hyphenated word)
 *   glue     — a space with a preferred width plus room to stretch and shrink
 *   penalty  — a legal break with a cost, and the width of anything that has to
 *              be drawn if the break is taken (the hyphen)
 *
 * Building it this way from the start is deliberate: retrofitting the shape
 * later means rewriting the module, and hyphenation and drop caps both fall out
 * of it almost for free (a hyphen is a flagged penalty; a drop cap is just
 * per-line widths).
 *
 * Pure: no DOM, no I/O. `tex-linebreak` and the hyphenation patterns are plain
 * computation over plain data.
 */
import {
  adjustmentRatios,
  breakLines,
  createHyphenator,
  forcedBreak,
  lineContentStart,
  MAX_COST,
  type Box,
  type Glue,
  type InputItem,
  type Penalty
} from 'tex-linebreak'
import patterns from 'hyphenation.en-us'
import type { TextMeasurer } from './measure'
import type { SubscriptRange } from '@core/transcribe'
import type { FontRef } from './types'

/** How a paragraph's lines are set within the measure. */
export type Alignment = 'justify' | 'left' | 'center'

/** One word (or hyphen fragment) placed on a line. */
export interface PlacedWord {
  text: string
  /** Offset from the left edge of the *measure*, not of the page. */
  xPt: number
  /** Set only for an attachment: its own size, not the paragraph's. */
  sizePt?: number
  /** Set only for an attachment: baseline offset, positive = raised. */
  risePt?: number
  /**
   * Index of the source word this came from, counting whitespace-separated
   * words in the paragraph's text. Attachments carry the index of their host.
   * This is how a footnote's reference mark is traced to the line it landed
   * on — string-matching the rendered line would be guesswork, and a marker
   * that is a bare digit is exactly the case guesswork gets wrong.
   */
  sourceIndex: number
}

/**
 * A short span glued to the end of a word and set differently from it — a
 * footnote's reference mark, and nothing else so far.
 *
 * It has to be modelled here rather than concatenated into the word, for two
 * reasons that pull in the same direction. It is drawn at its own size and
 * raised off the baseline, so it cannot share a run with its host; and it
 * occupies width, so a line breaker that did not know about it would set lines
 * fractionally too long.
 *
 * Synthesising the mark this way — rather than using the Unicode superscript
 * digits — is not fussiness. IM FELL English, the face this app recommends for
 * 17th-century books, carries ¹²³ and none of ⁰⁴⁵⁶⁷⁸⁹, so any note past the
 * third would have drawn as a missing glyph in the most likely configuration.
 */
export interface Attachment {
  /** Index of the whitespace-separated word this rides on the end of. */
  wordIndex: number
  text: string
  sizePt: number
  /** Baseline offset, positive = raised. */
  risePt: number
}

export interface BrokenLine {
  words: PlacedWord[]
  /** Zero-based index of this line within its paragraph. */
  index: number
  /** True when the breaker split a word here and drew a hyphen. */
  hyphenated: boolean
  /** The measure this line was set to — varies when `lineWidths` is an array. */
  widthPt: number
  /**
   * True when the line's content will not fit its measure even with every
   * space squeezed as far as it may go. This is TeX's "overfull hbox", and it
   * is the one line-quality complaint worth reporting: it means something —
   * usually an unbreakable word — physically sticks past the margin.
   */
  overfull: boolean
}

export interface BreakParagraphOptions {
  font: FontRef
  sizePt: number
  measurer: TextMeasurer
  /**
   * The measure, in points. An array sets per-line widths, which is how a drop
   * cap works: the first N lines are narrow, the rest full width.
   * The last entry applies to every line beyond it.
   */
  lineWidths: number | number[]
  alignment: Alignment
  /** Indent applied to the first line only, in points. */
  firstLineIndentPt?: number
  /** Splits a word into hyphenatable pieces. Omit to disable hyphenation. */
  hyphenate?: (word: string) => string[]
  /** Spans set differently from the paragraph, glued to the end of a word. */
  attachments?: readonly Attachment[]
  /**
   * Stretches of the paragraph's text to set below the line, as character
   * ranges — a chemical formula's figures, and nothing else so far.
   *
   * Character ranges rather than word indices because the figures sit *inside*
   * a word: `Na2CO3` is one word to the breaker and only two of its characters
   * drop. A word carrying any of these is emitted as several boxes with no
   * break between them, which also means such a word is never hyphenated: a
   * formula split across two lines is not a line-break decision anyone wants
   * the algorithm making.
   */
  subscripts?: readonly SubscriptRange[]
  /**
   * Runs set in a face other than the paragraph's own, by word index.
   *
   * The breaker has to know, rather than the renderer alone: italic and bold
   * advances differ from roman, and a paragraph measured entirely in roman then
   * drawn partly in italic breaks its lines in the wrong places.
   *
   * A list rather than one pair because a book needs two of these at once — the
   * emphasis a page printed, and the strong runs the editor wrote into a
   * glossary headword. First match wins, so the order is the caller's priority.
   */
  spans?: readonly TextSpan[]
}

/** Word indices to set in `font` instead of the paragraph's own face. */
export interface TextSpan {
  words: ReadonlySet<number>
  font: FontRef
  /**
   * Set these words in full capitals.
   *
   * The one span that changes the *text* rather than the face, and it exists
   * for one case: a small-capitals run in a face that has no `smcp`. Only two
   * of the seven faces offered carry the feature, and what a printer with no
   * small capitals in the case would do is set full ones — which is also what
   * `smcp` does to a letter that is already a capital, so the fallback has the
   * same shape as the real thing rather than a different one. Never capitals
   * scaled down: that is a forgery, and beside the text it sits in the stroke
   * weight gives it away.
   *
   * Applied where a word becomes a box, so the width the breaker measures is
   * the width that will be drawn.
   */
  upperCase?: boolean
}

/** The span that claims a word, or undefined — the first one wins. */
export function spanForWord(
  index: number,
  spans: readonly TextSpan[] | undefined
): TextSpan | undefined {
  if (!spans) return undefined
  for (const span of spans) if (span.words.has(index)) return span
  return undefined
}

/**
 * A word as it will be set, which is the word itself unless a span asks for
 * capitals.
 *
 * **Length-preserving or not at all.** A subscript is a character range into
 * the same string, so a word whose uppercase form is longer — `ß` becomes `SS`,
 * and the ligatures do the same — would shift every range after it and put a
 * figure under the wrong letter. Those cases are rare and this fallback is
 * rarer, so the word is left as written where the two lengths differ: a
 * headword in the wrong case is a blemish, and a formula with its subscript in
 * the wrong place is an error nobody would catch.
 */
export function wordAsSet(word: string, span: TextSpan | undefined): string {
  if (!span?.upperCase) return word
  const upper = word.toUpperCase()
  return upper.length === word.length ? upper : word
}

/** The face a word is set in: the first span that claims it, or the default. */
export function fontForWord(
  index: number,
  spans: readonly TextSpan[] | undefined,
  fallback: FontRef
): FontRef {
  if (spans) {
    for (const span of spans) if (span.words.has(index)) return span.font
  }
  return fallback
}

/**
 * TeX's interword glue for a justified paragraph, as fractions of a space.
 * A space may grow by half its width and shrink by a third — the elasticity
 * that lets Knuth–Plass find good breaks without visible rivers.
 */
/**
 * A piece the hyphenator ended at a mark that is already printed.
 *
 * `cross-legged` comes back as `["cross-", "legged"]` — the compound's own
 * hyphen, not a discretionary one — and the same is true of the dashes a
 * 19th-century text uses inside a word.
 */
const ENDS_HYPHENATED = /[-\u2010\u2011\u2012\u2013\u2014]$/u

const GLUE_STRETCH = 0.5
const GLUE_SHRINK = 0.333

/**
 * Ragged setting keeps spaces rigid and lets the *line* end short, so the glue
 * that absorbs the slack is at the end of the line rather than between words.
 * Modelled as a large stretch on the interword glue, with the words then drawn
 * at their natural spacing — the breaker gets the tolerance, the reader gets
 * even spaces.
 */
const RAGGED_STRETCH = 6

/**
 * The cost of breaking a word with a hyphen. TeX's `\hyphenpenalty` is 50 on a
 * scale where 1000 forbids the break outright; keeping the same number keeps
 * the same restraint about hyphenating at all.
 */
const HYPHEN_PENALTY = 50

/**
 * How big a subscript figure is, as a fraction of the type it sits in.
 *
 * Measured off the 1877 page rather than taken from a handbook: the displayed
 * reaction on leaf 520 of _Isis Unveiled_ Vol. I, rendered at 600 DPI and read
 * with `scripts/lib/ink.mjs`, sets its capitals 49 pixels tall and its
 * subscript figures 26, on both of its two lines. 26/49 is this number.
 */
const SUBSCRIPT_SCALE = 0.53
/**
 * How far a subscript drops below the baseline, as a fraction of cap height.
 *
 * From the same measurement: the capitals sit on a baseline at row 173 and the
 * subscript figures reach row 187, so the drop is 14 pixels against a 49-pixel
 * capital. Of cap height rather than of the em because that is what it was
 * measured against, and because the em would make it a different depth in
 * every face — Crimson Pro's capitals are 0.573 of its em and Libre
 * Baskerville's are 0.770.
 */
const SUBSCRIPT_DROP = 0.286

/** `\parfillskip`: the last line may end anywhere, so its slack is free. */
const PARAGRAPH_FILL_STRETCH = 1e6

interface TextBox extends Box {
  type: 'box'
  text: string
  /** Which whitespace-separated source word this box belongs to. -1 = none. */
  source: number
  /** Present on an attachment box, which never merges with its neighbours. */
  sizePt?: number
  risePt?: number
}

function isTextBox(item: InputItem): item is TextBox {
  return item.type === 'box'
}

function box(text: string, width: number, source: number): TextBox {
  return { type: 'box', width, text, source }
}

function glue(width: number, stretch: number, shrink: number): Glue {
  return { type: 'glue', width, stretch, shrink }
}

function penalty(width: number, cost: number, flagged: boolean): Penalty {
  return { type: 'penalty', width, cost, flagged }
}

/**
 * Round to a thousandth of a point — a quarter of a micron on paper, and well
 * under any printer's resolution. Its real job is to keep float noise out of
 * positions so two runs of the engine over the same input compare equal.
 */
function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** Width to use for line `i` when `lineWidths` may be a single number or a list. */
function widthForLine(lineWidths: number | number[], i: number): number {
  if (typeof lineWidths === 'number') return lineWidths
  if (lineWidths.length === 0) return 0
  return lineWidths[Math.min(i, lineWidths.length - 1)]!
}

/**
 * Pad a per-line width array so it covers every line the paragraph can produce.
 *
 * `breakLines` reads `lineLengths[i]` for each line and does not clamp: hand it
 * a three-entry array for a fifteen-line paragraph and it reads `undefined`,
 * arithmetic goes to NaN, and the paragraph comes back *silently truncated*.
 * A paragraph can never have more lines than it has items, so padding to the
 * item count is a bound that always holds — and the caller keeps the ergonomic
 * "three narrow lines, then full width" form that drop caps want.
 */
function padLineWidths(lineWidths: number | number[], itemCount: number): number | number[] {
  if (typeof lineWidths === 'number') return lineWidths
  if (lineWidths.length >= itemCount) return lineWidths
  const last = lineWidths[lineWidths.length - 1] ?? 0
  return [...lineWidths, ...Array.from({ length: itemCount - lineWidths.length }, () => last)]
}

/**
 * Turn prose into the item stream Knuth–Plass consumes.
 *
 * Exported because it is the interesting half of this module and worth testing
 * on its own: a bug here is a bug in what the algorithm is being asked, which
 * is much harder to see in the finished lines than in the items.
 */
export function itemsFromText(text: string, options: BreakParagraphOptions): InputItem[] {
  const { font, sizePt, measurer, alignment, hyphenate } = options
  /** A word's own face — italic or bold where a span claims it. */
  const fontAt = (index: number): FontRef => fontForWord(index, options.spans, font)
  const width = (s: string, index = -1): number =>
    measurer.widthOf(s, index >= 0 ? fontAt(index) : font, sizePt)

  const spaceWidth = width(' ')
  const hyphenWidth = width('-')
  const ragged = alignment !== 'justify'
  const stretch = ragged ? spaceWidth * RAGGED_STRETCH : spaceWidth * GLUE_STRETCH
  const shrink = ragged ? 0 : spaceWidth * GLUE_SHRINK

  const items: InputItem[] = []

  const indent = options.firstLineIndentPt ?? 0
  if (indent > 0) {
    // An indent is an empty box, exactly as TeX models `\parindent`. Making it
    // a box rather than glue matters: glue could be stretched or broken at.
    items.push(box('', indent, -1))
  }

  // Matched rather than split, because a subscript is a character range into
  // this same string and the words have to be locatable in it. `/\S+/` and
  // `split(/\s+/).filter(Boolean)` produce the same list, by construction.
  const found = [...text.matchAll(/\S+/gu)]
  const words = found.map((m, i) => wordAsSet(m[0], spanForWord(i, options.spans)))

  // Grouped so a word carrying two marks gets both, in order.
  const attachments = new Map<number, Attachment[]>()
  for (const attachment of options.attachments ?? []) {
    const list = attachments.get(attachment.wordIndex)
    if (list) list.push(attachment)
    else attachments.set(attachment.wordIndex, [attachment])
  }

  const subscripts = options.subscripts ?? []
  // Asked once: it is a lookup per face and the answer is the same for every
  // word in the paragraph.
  const subSizePt = sizePt * SUBSCRIPT_SCALE
  const subRisePt = subscripts.length
    ? -measurer.metrics(font, sizePt).capHeight * SUBSCRIPT_DROP
    : 0

  words.forEach((word, i) => {
    if (i > 0) items.push(glue(spaceWidth, stretch, shrink))

    const at = found[i]!.index
    const dropped = subscripts.filter((r) => r.from < at + word.length && r.to > at)
    if (dropped.length > 0) {
      // A word with a figure below the line is set as its own little sequence
      // of boxes and is never hyphenated: `Na2CO3` broken across two lines is
      // not a decision worth letting the algorithm make.
      let cut = 0
      for (const range of dropped) {
        const from = Math.max(range.from - at, 0)
        const to = Math.min(range.to - at, word.length)
        if (to <= from) continue
        if (from > cut) {
          const plain = word.slice(cut, from)
          items.push(box(plain, width(plain, i), i))
        }
        const low = word.slice(from, to)
        const figure: TextBox = {
          type: 'box',
          width: measurer.widthOf(low, fontAt(i), subSizePt),
          text: low,
          source: i,
          sizePt: subSizePt,
          risePt: subRisePt
        }
        items.push(figure)
        cut = to
      }
      if (cut < word.length) {
        const plain = word.slice(cut)
        items.push(box(plain, width(plain, i), i))
      }
      for (const attachment of attachments.get(i) ?? []) {
        const mark: TextBox = {
          type: 'box',
          width: measurer.widthOf(attachment.text, font, attachment.sizePt),
          text: attachment.text,
          source: i,
          sizePt: attachment.sizePt,
          risePt: attachment.risePt
        }
        items.push(mark)
      }
      return
    }

    const pieces = hyphenate ? hyphenate(word) : [word]
    if (pieces.length <= 1) {
      items.push(box(word, width(word, i), i))
    } else {
      pieces.forEach((piece, p) => {
        if (p > 0) {
          // A compound's own hyphen is a break point that needs no *drawn*
          // hyphen: the hyphenator hands back `["cross-", "legged"]`, so adding
          // one here set "cross--" at the margin. A zero-width penalty is what
          // says so — `hyphenated` below is decided on the penalty's width, and
          // a break taken at a zero-width one draws nothing.
          const already = ENDS_HYPHENATED.test(pieces[p - 1] ?? '')
          items.push(penalty(already ? 0 : hyphenWidth, HYPHEN_PENALTY, true))
        }
        items.push(box(piece, width(piece, i), i))
      })
    }

    // Attached after the word's last piece and with no glue between, so a mark
    // can never be separated from the word it refers to.
    for (const attachment of attachments.get(i) ?? []) {
      const mark: TextBox = {
        type: 'box',
        width: measurer.widthOf(attachment.text, font, attachment.sizePt),
        text: attachment.text,
        source: i,
        sizePt: attachment.sizePt,
        risePt: attachment.risePt
      }
      items.push(mark)
    }
  })

  // The standard paragraph ending: glue that can absorb any amount of slack, so
  // the final line is not stretched, followed by a break that must be taken.
  items.push(glue(0, PARAGRAPH_FILL_STRETCH, 0))
  items.push(forcedBreak())

  return items
}

/**
 * Choose breakpoints, retrying with looser tolerance before giving up.
 *
 * `breakLines` throws when no set of breaks stays inside the adjustment ratio
 * it was given. That happens on real books — a URL, a long chemical name, a
 * one-word line in verse — and the honest response is a slightly loose line,
 * not a crash at the design gate.
 */
function chooseBreakpoints(items: InputItem[], lineWidths: number | number[]): number[] {
  try {
    return breakLines(items, lineWidths)
  } catch {
    try {
      return breakLines(items, lineWidths, { maxAdjustmentRatio: null })
    } catch {
      return [0, items.length - 1]
    }
  }
}

/**
 * Break a paragraph into positioned lines.
 *
 * Word positions come out of the same adjustment ratios the algorithm used to
 * judge the breaks, so the spacing a renderer draws is the spacing the breaker
 * scored — there is no second opinion about it anywhere.
 */
/**
 * A verse block broken at the line breaks the poem actually has.
 *
 * Every other kind here reflows, and must: a paragraph's newline is an
 * artefact of where the 1877 compositor's measure happened to end, and
 * honouring it would be the manual line break this app refuses to offer,
 * because the book is set to a measure it has not chosen yet. Verse is the
 * exception and the only one — `\n` in a `verse` block is the poet's line,
 * not the typesetter's, and flowing it into a paragraph loses the poem.
 *
 * Each line is broken on its own so it is *measured* on its own (a line's
 * italics have to be known to the breaker or its length comes out wrong), and
 * then re-indexed back onto the whole block, so everything downstream — the
 * face a word is set in, the note a mark belongs to — goes on counting in the
 * block's own words and needs no idea that this happened. A line too long for
 * the measure still wraps, which is what a printed book does with a long
 * verse line; a blank line between stanzas comes back as a line with nothing
 * on it, so the stanza break survives too.
 */
export function breakVerse(text: string, options: BreakParagraphOptions): BrokenLine[] {
  const out: BrokenLine[] = []
  let wordsBefore = 0
  let charsBefore = 0

  for (const raw of text.split(/\r?\n/u)) {
    const lead = raw.length - raw.trimStart().length
    const line = raw.trim()
    const at = charsBefore + lead
    const words = line.split(/\s+/u).filter((w) => w.length > 0).length

    if (line.length === 0) {
      // A stanza break. An empty line of its own, carrying the measure so the
      // spacing machinery downstream has a width to work from.
      out.push({
        words: [],
        index: out.length,
        hyphenated: false,
        widthPt: widthForLine(options.lineWidths, 0),
        overfull: false
      })
      charsBefore += raw.length + 1
      continue
    }

    const spans = options.spans
      ?.map((span) => ({
        ...span,
        words: new Set(
          [...span.words]
            .filter((i) => i >= wordsBefore && i < wordsBefore + words)
            .map((i) => i - wordsBefore)
        )
      }))
      .filter((span) => span.words.size > 0)
    const attachments = options.attachments
      ?.filter((a) => a.wordIndex >= wordsBefore && a.wordIndex < wordsBefore + words)
      .map((a) => ({ ...a, wordIndex: a.wordIndex - wordsBefore }))
    const subscripts = options.subscripts
      ?.filter((r) => r.from >= at && r.to <= at + line.length)
      .map((r) => ({ from: r.from - at, to: r.to - at }))

    const broken = breakParagraph(line, {
      ...options,
      // A verse line is its own line; an indent on it belongs to the block,
      // and the block's style has already placed the whole thing.
      firstLineIndentPt: 0,
      ...(spans?.length ? { spans } : { spans: undefined }),
      ...(attachments?.length ? { attachments } : { attachments: undefined }),
      ...(subscripts?.length ? { subscripts } : { subscripts: undefined })
    })
    for (const one of broken) {
      out.push({
        ...one,
        index: out.length,
        // Back into the block's own coordinates, so a caller that knows
        // nothing about verse still reads the right span and the right note.
        words: one.words.map((w) => ({
          ...w,
          sourceIndex: w.sourceIndex < 0 ? w.sourceIndex : w.sourceIndex + wordsBefore
        }))
      })
    }

    wordsBefore += words
    charsBefore += raw.length + 1
  }

  return out
}

export function breakParagraph(text: string, options: BreakParagraphOptions): BrokenLine[] {
  if (text.trim().length === 0) return []

  const items = itemsFromText(text, options)
  const lineWidths = padLineWidths(options.lineWidths, items.length)
  const breakpoints = chooseBreakpoints(items, lineWidths)
  const ratios = adjustmentRatios(items, lineWidths, breakpoints)

  const lines: BrokenLine[] = []

  for (let i = 0; i < breakpoints.length - 1; i++) {
    const start = lineContentStart(items, breakpoints[i]!, breakpoints[i + 1]!)
    const end = breakpoints[i + 1]!
    const measure = widthForLine(lineWidths, i)
    // Ragged lines take their words at natural spacing; only justified lines
    // spend the adjustment ratio. A NaN ratio means a degenerate line, which is
    // the fallback path above — natural spacing is the safe reading.
    const rawRatio = ratios[i]
    const ratio =
      options.alignment === 'justify' && typeof rawRatio === 'number' && Number.isFinite(rawRatio)
        ? rawRatio
        : 0

    // A ratio below -1 means the line needed more shrink than its glue had.
    // A non-finite negative one means it had no shrink at all to give — which
    // is every ragged line, so those only count when there is genuinely no
    // room. The last line is exempt: its free-stretching fill glue makes the
    // ratio meaningless there.
    const lastLine = i === breakpoints.length - 2
    const overfull =
      !lastLine && typeof rawRatio === 'number' && (rawRatio < -1 || rawRatio === -Infinity)

    const words: PlacedWord[] = []
    let x = 0
    // Hyphenation splits a word into several boxes with a penalty between them.
    // When the break isn't taken there, those boxes are one word again and must
    // be re-joined — otherwise "example" would be drawn as three abutting runs,
    // which is both wasteful and a chance for rounding to open a seam mid-word.
    // An attachment is the exception: it abuts its host but is set at another
    // size, so merging the two would draw the mark as body text.
    let mergeable = false

    for (let j = start; j < end; j++) {
      const item = items[j]!
      if (isTextBox(item)) {
        const isAttachment = item.sizePt !== undefined
        const last = words[words.length - 1]
        if (item.text.length === 0) {
          // A paragraph indent: width but nothing to draw.
        } else if (mergeable && last && !isAttachment && last.sizePt === undefined) {
          last.text += item.text
        } else if (isAttachment) {
          words.push({
            text: item.text,
            xPt: round(x),
            sourceIndex: item.source,
            sizePt: item.sizePt!,
            risePt: item.risePt ?? 0
          })
        } else {
          words.push({ text: item.text, xPt: round(x), sourceIndex: item.source })
        }
        x += item.width
        mergeable = !isAttachment
      } else if (item.type === 'glue') {
        x += item.width + (ratio >= 0 ? ratio * item.stretch : ratio * item.shrink)
        mergeable = false
      }
      // A penalty inside a line contributes nothing: its width is the hyphen,
      // which is only drawn when the break is actually taken there. It leaves
      // `mergeable` alone, because the pieces either side of it are one word.
    }

    // A break taken *at* a flagged penalty is a hyphenated word: draw the mark.
    const breakItem = items[end]
    const hyphenated =
      breakItem !== undefined &&
      breakItem.type === 'penalty' &&
      breakItem.width > 0 &&
      breakItem.cost < MAX_COST
    if (hyphenated) {
      const last = words[words.length - 1]
      if (mergeable && last && last.sizePt === undefined) last.text += '-'
      else words.push({ text: '-', xPt: round(x), sourceIndex: last?.sourceIndex ?? -1 })
      x += breakItem.width
    }

    if (words.length === 0) continue

    if (options.alignment === 'center') {
      const offset = (measure - x) / 2
      for (const w of words) w.xPt = round(w.xPt + offset)
    }

    lines.push({ words, index: lines.length, hyphenated, widthPt: measure, overfull })
  }

  return lines
}

/**
 * An en-US hyphenator, built once and shared.
 *
 * Lazy because the patterns compile into a trie of a few thousand nodes, and a
 * book with no hyphenation enabled should not pay for it. Failing softly to "no
 * hyphenation points" is right: a book set without hyphenation is worse-looking
 * but correct, whereas a throw here would take out the whole design gate.
 */
let hyphenator: ((word: string) => string[]) | null = null

export function englishHyphenator(): (word: string) => string[] {
  if (hyphenator) return hyphenator
  try {
    // The published patterns carry `id` as a string *array*; the wrapper's type
    // says string. The trie builder never reads it, so the shape is a
    // documentation mismatch rather than a real one.
    const build = createHyphenator(patterns as unknown as Parameters<typeof createHyphenator>[0])
    hyphenator = (word: string) => {
      try {
        return build(word)
      } catch {
        return [word]
      }
    }
  } catch {
    hyphenator = (word: string) => [word]
  }
  return hyphenator
}
