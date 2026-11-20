/**
 * Display type for a cover: faces, wrapping (plain and with inline markup),
 * stacked titles, fitting a title to a box, and setting centred lines on ink.
 *
 * Pure: text is measured through the injected `TextMeasurer`.
 */
import type { FontRef, TextMeasurer } from '@core/layout'
import { parseInlineMarkup } from '@core/transcribe'
import { type CoverDocument, type Hex } from './document'
import { pt, type Rect } from './geometry'
import { LEADING, TITLE_MAX_PT, TITLE_MIN_PT } from './compose-constants'
import { type CoverItem } from './compose-items'

export function face(
  family: string,
  style: 'regular' | 'italic' | 'bold' = 'regular',
  smallCaps = false
): FontRef {
  return smallCaps ? { family, style, smallCaps: true } : { family, style }
}

/**
 * Break a paragraph greedily to a measure.
 *
 * Greedy, not Knuth–Plass, and deliberately: the book's paragraphs are
 * justified over a fixed measure where the total-badness optimum is visible,
 * and a cover's lines are centred, few, and short, where it is not. Running the
 * book's line breaker over a three-word title would be borrowing a machine to
 * make the same three lines.
 */
export function wrapText(
  text: string,
  maxWidthPt: number,
  font: FontRef,
  sizePt: number,
  measurer: TextMeasurer
): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0)
  if (words.length === 0) return []
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (line && measurer.widthOf(candidate, font, sizePt) > maxWidthPt) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

/** One stretch of a blurb line set in one face. */
export interface StyledRun {
  text: string
  font: FontRef
}

export const sameFont = (a: FontRef, b: FontRef): boolean =>
  a.family === b.family && a.style === b.style && !!a.smallCaps === !!b.smallCaps

/** `line` with one more word on the end, as a new array — the caller may discard it. */
export function appended(line: readonly StyledRun[], word: string, font: FontRef): StyledRun[] {
  const runs = line.map((r) => ({ ...r }))
  const last = runs[runs.length - 1]
  if (!last) return [{ text: word, font }]
  if (sameFont(last.font, font)) {
    last.text += ` ${word}`
    return runs
  }
  // The space between two differently-set words is drawn in the face of the
  // word *before* it, so a line's runs abut and the writer advances by widths it
  // measured rather than re-deriving a word space of its own.
  last.text += ' '
  runs.push({ text: word, font })
  return runs
}

/**
 * A paragraph of the editor's own prose, broken to a measure, keeping its
 * emphasis.
 *
 * The blurb is the one thing on a cover that is *written* rather than read off
 * a title page, and the editor's prose names books. Set as one string in one
 * face, `<i>The Secret Teachings of All Ages</i>` prints the angle brackets —
 * which is this repository's most-repeated fault, recorded three times over: a
 * table's cells kept their tags, a written section could not italicise a word,
 * and a glossary naming forty books printed every title in roman. Each was the
 * same shape as this one, a run of text emitted with a single font.
 *
 * The reader is `parseInlineMarkup` rather than a second one, and it fits
 * without translation: emphasis comes back as indices of whitespace-separated
 * words, which is already the coordinate `wrapText` walks in.
 *
 * Strong is offered to `fontFor` and resolved there, so a face with no bold
 * makes the same honest substitution the layout engine makes rather than a
 * smeared outline.
 */
export function wrapMarkup(
  raw: string,
  maxWidthPt: number,
  fontFor: (style: 'regular' | 'italic' | 'bold') => FontRef,
  sizePt: number,
  measurer: TextMeasurer
): StyledRun[][] {
  const { text, emphasis, strong } = parseInlineMarkup(raw)
  const italic = new Set(emphasis)
  const bold = new Set(strong)
  const words = text.split(/\s+/).filter((w) => w.length > 0)
  if (words.length === 0) return []

  // Strong first, as `spansFor` does: there is no bold italic here either, and
  // first match wins, so a marked word inside an italic phrase sets bold roman.
  const styleOf = (i: number): 'regular' | 'italic' | 'bold' =>
    bold.has(i) ? 'bold' : italic.has(i) ? 'italic' : 'regular'
  const widthOf = (runs: readonly StyledRun[]): number =>
    runs.reduce((w, r) => w + measurer.widthOf(r.text, r.font, sizePt), 0)

  const lines: StyledRun[][] = []
  let line: StyledRun[] = []
  for (let i = 0; i < words.length; i++) {
    const font = fontFor(styleOf(i))
    const candidate = appended(line, words[i]!, font)
    if (line.length > 0 && widthOf(candidate) > maxWidthPt) {
      lines.push(line)
      line = [{ text: words[i]!, font }]
    } else {
      line = candidate
    }
  }
  if (line.length > 0) lines.push(line)
  return lines
}

/**
 * The largest size at which `text` sets in at most `maxLines` within the box.
 *
 * Searched in half-point steps from the top down, so the answer is the same
 * every time this cover is composed — a title that resized by a point between
 * the preview and the export would make the gate meaningless.
 */
/**
 * A title's lines, honouring a stack the editor typed.
 *
 * A newline in a title is a **hard break**, and it is the one place in this
 * codebase where a hand break is right. The book's body forbids them because
 * it reflows to whatever measure the design gate settles on, so a break typed
 * against one measure rots against the next. A display title does not reflow:
 * it is three or four words set as a shape, and where those words divide is a
 * design decision no rule about measures will reproduce. `THE / MANUSCRIPT /
 * LECTURES` is not what a breaker would choose and is what the cover wants.
 *
 * Safe for a banked look by construction: the break lives in `content.title`,
 * and `CoverContent` is the half that never travels, so volume two cannot
 * inherit volume one's stacking.
 *
 * Each segment is still wrapped, so a stacked line too long for the measure
 * breaks rather than running off the board.
 */
/** A stacked title as one line, for anywhere a break cannot be set. */
export function flattened(text: string): string {
  return text.replace(/\s*\n\s*/gu, ' ').trim()
}

export function stackedLines(
  text: string,
  maxWidthPt: number,
  font: FontRef,
  sizePt: number,
  measurer: TextMeasurer
): string[] {
  if (!text.includes('\n')) return wrapText(text, maxWidthPt, font, sizePt, measurer)
  return text
    .split('\n')
    .flatMap((segment) => wrapText(segment, maxWidthPt, font, sizePt, measurer))
}

export function fitText(
  text: string,
  box: { widthPt: number; heightPt: number },
  maxLines: number,
  font: FontRef,
  measurer: TextMeasurer,
  maxPt = TITLE_MAX_PT,
  minPt = TITLE_MIN_PT
): { sizePt: number; lines: string[] } {
  for (let size = maxPt; size >= minPt; size -= 0.5) {
    const lines = stackedLines(text, box.widthPt, font, size, measurer)
    if (lines.length === 0) return { sizePt: size, lines: [] }
    if (lines.length > maxLines) continue
    const tallest = Math.max(...lines.map((l) => measurer.widthOf(l, font, size)))
    if (tallest > box.widthPt) continue
    if (lines.length * size * LEADING > box.heightPt) continue
    return { sizePt: size, lines }
  }
  // Nothing fit. Set it at the floor and let the validator say so — silently
  // dropping words off a title is the one outcome worse than a tight cover.
  return { sizePt: minPt, lines: stackedLines(text, box.widthPt, font, minPt, measurer) }
}

/**
 * One size that fits *every* one of these, largest first.
 *
 * Equal weight is the whole point of an omnibus cover: two works bound together
 * are two works, and setting the longer title smaller so it fits would say the
 * shorter one matters more. So the size is the smallest of what each could take
 * on its own, and they are all set at it.
 */
export function fitTitlesTogether(
  titles: readonly string[],
  box: { widthPt: number; heightPt: number },
  maxLinesEach: number,
  font: FontRef,
  measurer: TextMeasurer,
  maxPt = TITLE_MAX_PT,
  minPt = TITLE_MIN_PT
): { sizePt: number; lines: string[][] } {
  const budget = box.heightPt / Math.max(1, titles.length)
  let sizePt = maxPt
  for (const title of titles) {
    const fitted = fitText(
      title,
      { widthPt: box.widthPt, heightPt: budget },
      maxLinesEach,
      font,
      measurer,
      maxPt,
      minPt
    )
    sizePt = Math.min(sizePt, fitted.sizePt)
  }
  return {
    sizePt,
    lines: titles.map((t) => stackedLines(t, box.widthPt, font, sizePt, measurer))
  }
}

export function applyCase(text: string, kind: CoverDocument['look']['titleCase']): string {
  return kind === 'upper' ? text.toUpperCase() : text
}

/**
 * Lay a block of centred lines into `items`, returning the y below it.
 *
 * Centred on the **ink**, not on the advance box. Every line on a cover is
 * display type at 20 to 60 points, where the difference is visible: measured on
 * a real sheet, `THE ASTRAL WORLD` and `THE HUMAN AURA` set at the same size
 * and centred by advance landed 2.5 pixels — about 2.7 points — apart, because
 * a `D` has a tight right side bearing and an `A` has a wide one. Nothing was
 * wrong with the arithmetic; it was centring the wrong box.
 */
export function centeredLines(
  items: CoverItem[],
  lines: readonly string[],
  panel: Rect,
  topPt: number,
  font: FontRef,
  sizePt: number,
  color: Hex,
  measurer: TextMeasurer
): number {
  const metrics = measurer.metrics(font, sizePt)
  const leading = sizePt * LEADING
  const centreX = pt(panel.x + panel.width / 2)
  let y = topPt
  for (const line of lines) {
    const width = measurer.widthOf(line, font, sizePt)
    const ink = measurer.inkExtents(line, font, sizePt)
    // Put the middle of the ink on the middle of the panel: the origin is the
    // centre less half the ink span, less however far the ink starts from the
    // origin.
    const xPt = centreX - (ink.left + ink.right) / 2
    items.push({
      kind: 'text',
      text: line,
      font,
      sizePt,
      xPt,
      yPt: y + metrics.ascent,
      color,
      widthPt: width,
      ascentPt: metrics.ascent,
      descentPt: metrics.descent
    })
    y += leading
  }
  return y
}
