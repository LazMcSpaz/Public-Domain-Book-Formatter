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
import type { FontRef } from './types'

/** How a paragraph's lines are set within the measure. */
export type Alignment = 'justify' | 'left' | 'center'

/** One word (or hyphen fragment) placed on a line. */
export interface PlacedWord {
  text: string
  /** Offset from the left edge of the *measure*, not of the page. */
  xPt: number
}

export interface BrokenLine {
  words: PlacedWord[]
  /** Zero-based index of this line within its paragraph. */
  index: number
  /** True when the breaker split a word here and drew a hyphen. */
  hyphenated: boolean
  /** The measure this line was set to — varies when `lineWidths` is an array. */
  widthPt: number
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
}

/**
 * TeX's interword glue for a justified paragraph, as fractions of a space.
 * A space may grow by half its width and shrink by a third — the elasticity
 * that lets Knuth–Plass find good breaks without visible rivers.
 */
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

/** `\parfillskip`: the last line may end anywhere, so its slack is free. */
const PARAGRAPH_FILL_STRETCH = 1e6

interface TextBox extends Box {
  type: 'box'
  text: string
}

function isTextBox(item: InputItem): item is TextBox {
  return item.type === 'box'
}

function box(text: string, width: number): TextBox {
  return { type: 'box', width, text }
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
  const width = (s: string): number => measurer.widthOf(s, font, sizePt)

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
    items.push(box('', indent))
  }

  const words = text.split(/\s+/u).filter((w) => w.length > 0)

  words.forEach((word, i) => {
    if (i > 0) items.push(glue(spaceWidth, stretch, shrink))

    const pieces = hyphenate ? hyphenate(word) : [word]
    if (pieces.length <= 1) {
      items.push(box(word, width(word)))
      return
    }
    pieces.forEach((piece, p) => {
      if (p > 0) items.push(penalty(hyphenWidth, HYPHEN_PENALTY, true))
      items.push(box(piece, width(piece)))
    })
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

    const words: PlacedWord[] = []
    let x = 0
    // Hyphenation splits a word into several boxes with a penalty between them.
    // When the break isn't taken there, those boxes are one word again and must
    // be re-joined — otherwise "example" would be drawn as three abutting runs,
    // which is both wasteful and a chance for rounding to open a seam mid-word.
    let adjacent = false

    for (let j = start; j < end; j++) {
      const item = items[j]!
      if (isTextBox(item)) {
        const last = words[words.length - 1]
        if (item.text.length === 0) {
          // A paragraph indent: width but nothing to draw.
        } else if (adjacent && last) {
          last.text += item.text
        } else {
          words.push({ text: item.text, xPt: round(x) })
        }
        x += item.width
        adjacent = true
      } else if (item.type === 'glue') {
        x += item.width + (ratio >= 0 ? ratio * item.stretch : ratio * item.shrink)
        adjacent = false
      }
      // A penalty inside a line contributes nothing: its width is the hyphen,
      // which is only drawn when the break is actually taken there. It leaves
      // `adjacent` alone, because the pieces either side of it are one word.
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
      if (adjacent && last) last.text += '-'
      else words.push({ text: '-', xPt: round(x) })
      x += breakItem.width
    }

    if (words.length === 0) continue

    if (options.alignment === 'center') {
      const offset = (measure - x) / 2
      for (const w of words) w.xPt = round(w.xPt + offset)
    }

    lines.push({ words, index: lines.length, hyphenated, widthPt: measure })
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
