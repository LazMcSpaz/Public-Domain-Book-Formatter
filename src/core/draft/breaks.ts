/**
 * Line breaks a text layer dropped, put back from the geometry.
 *
 * A born-digital PDF's text layer has no line structure, so matter the
 * compositor set on its own lines — a stack of example sentences, a numbered
 * list, an address, a word list — arrives as one run of lines that reads as
 * one paragraph. On *Patterns of the Hypnotic Techniques* Vol. I three
 * examples printed as `The man drank the rock The flower was angry The happy
 * chair sang a love song`. Which breaks were real was measured off the word
 * boxes after the fact, fifty-seven of them, and the measurement is what this
 * module is.
 *
 * Three things decide it, and each was learnt by getting it wrong first.
 *
 * - **The run's own margin, not the column's.** A quotation set narrow wraps
 *   at a margin of its own; against the column every one of its lines looks
 *   short. So `margin` is the run's longest line.
 * - **Whether the run is display matter at all.** Justified prose is flush on
 *   nearly every line; a list on hardly any. The share is counted over every
 *   line *but the last*, because a paragraph's last line is always short and
 *   a three-line paragraph would otherwise look like a list.
 * - **The words at the seam.** A line ending on `of`, `the`, `and`, `by` is a
 *   wrap whatever its length — `in its Surface / Structure representation`
 *   is one phrase. A line the next of which opens `(2)` or `Step 3` is a
 *   break whatever its length.
 *
 * Prose runs get one rule of their own: a line falling a quarter short that
 * ends a sentence, with a capital opening the next, is a paragraph the
 * conversion swallowed. Four on that volume, each checked against its leaf.
 * Anything short of all three signals is the typescript's own ragged
 * setting, and splitting there cuts a clause in half.
 */
import type { DraftLine } from './index'

/** A run flush on more than this share of its inner lines is prose. */
export const DISPLAY_FLUSH_AT = 0.55
/** The "new sentence" and "word list" rules need a run this far from prose. */
export const CAPITAL_FLUSH_AT = 0.4
/** A line within this share of the run's margin counts as reaching it. */
export const FLUSH_WITHIN = 0.08
/** A prose line this far short of the margin may end a paragraph. */
export const SHORT_LINE_AT = 0.25
/** Two lines of at most this many words each are a word list. */
export const LIST_LINE_WORDS = 4
/**
 * A run shorter than this cannot be called display matter. `flush` is a share
 * of the inner lines, and a two-line run has one: a rate built from one event
 * flags an indented first line whose paragraph runs on at the full measure as
 * a list, and on a scanned leaf of *Isis Unveiled* it did. Such a run is
 * judged by the prose rule alone, which needs the seam itself to say so.
 */
export const SHAPE_FLOOR_LINES = 3

export const FUNCTION_WORDS: ReadonlySet<string> = new Set(
  `a an the and or but nor of to in on at by for with from into onto upon as
   that which who whom whose this these those is are was were be been being am
   will would can could shall should may might must do does did have has had
   not no if then than so such very more most some any each every both either
   neither about over under between among through during before after while
   his her its their our your my me him them us it he she they we you i`.split(/\s+/u)
)

/** `(a)`, `(2)`, `3.`, `Step 4`, `E:`, and `except` — a line that opens an item. */
const ENUMERATOR = /^(\(?[a-zA-Z0-9]{1,3}[).]\s|\(\d+\)|Step\s+\d|[A-Z]{1,2}:|except\b)/u
const SENTENCE_END = /[.!?]["”')\]]?\s*$/u

export type BreakReason = 'enumerator' | 'new sentence' | 'word list' | 'paragraph'

export interface RunShape {
  /** Right edge of the run's longest line. */
  margin: number
  /** Left edge of its leftmost line. */
  left: number
  measure: number
  /** Share of lines but the last that reach the margin. */
  flush: number
}

export function shapeOf(run: readonly DraftLine[]): RunShape {
  const margin = Math.max(...run.map((l) => l.right))
  const left = Math.min(...run.map((l) => l.left))
  const measure = Math.max(1, margin - left)
  const inner = run.length > 1 ? run.slice(0, -1) : run
  const flush =
    inner.filter((l) => (margin - l.right) / measure <= FLUSH_WITHIN).length / inner.length
  return { margin, left, measure, flush }
}

const lastWord = (s: string): string => {
  const m = s.match(/[A-Za-z']+(?=[^A-Za-z']*$)/u)
  return m ? m[0].toLowerCase() : ''
}
const wordCount = (s: string): number => s.trim().split(/\s+/u).filter(Boolean).length

/**
 * Whether the seam between two lines of a display run is a hard break, and
 * why. `null` is "a wrap", and the reason it was called one is not returned
 * because nothing downstream acts on it — the line stays joined.
 */
export function seamVerdict(prev: string, next: string, flush: number): BreakReason | null {
  const p = prev.trim()
  const n = next.trim()
  if (p.endsWith('-')) return null
  if (ENUMERATOR.test(n)) return 'enumerator'
  if (FUNCTION_WORDS.has(lastWord(p)) && !/[.!?;:]$/u.test(p)) return null
  if (flush > CAPITAL_FLUSH_AT) return null
  if (/^\p{Lu}/u.test(n)) return 'new sentence'
  if (wordCount(p) <= LIST_LINE_WORDS && wordCount(n) <= LIST_LINE_WORDS) return 'word list'
  return null
}

export interface RunBreak {
  /** Index into the run of the line that opens a new block. */
  at: number
  reason: BreakReason
}

/**
 * Where a run of lines should be cut into blocks. Empty for a run that is one
 * block, which is nearly every run on an ordinary page.
 */
export function breaksIn(run: readonly DraftLine[]): RunBreak[] {
  if (run.length < 2) return []
  const shape = shapeOf(run)
  const out: RunBreak[] = []
  if (run.length >= SHAPE_FLOOR_LINES && shape.flush <= DISPLAY_FLUSH_AT) {
    // Display matter: every seam is judged, not only the ones after a short
    // line — the longest line of a list has no slack at all, and the break
    // after it was the one an earlier version could not see.
    for (let i = 1; i < run.length; i++) {
      const reason = seamVerdict(run[i - 1]!.text, run[i]!.text, shape.flush)
      if (reason) out.push({ at: i, reason })
    }
    return out
  }
  // Prose: only a sentence ending well short of the margin, with a capital
  // under it. The last line is never a seam; it is the paragraph's own end.
  for (let i = 1; i < run.length; i++) {
    const prev = run[i - 1]!
    const slack = (shape.margin - prev.right) / shape.measure
    if (slack < SHORT_LINE_AT) continue
    if (!SENTENCE_END.test(prev.text)) continue
    if (!/^\p{Lu}/u.test(run[i]!.text.trim())) continue
    out.push({ at: i, reason: 'paragraph' })
  }
  return out
}

/** The run cut at its breaks, each piece a block of its own. */
export function cutRun(run: readonly DraftLine[]): { pieces: DraftLine[][]; breaks: RunBreak[] } {
  const breaks = breaksIn(run)
  if (breaks.length === 0) return { pieces: [[...run]], breaks }
  const pieces: DraftLine[][] = []
  let from = 0
  for (const b of breaks) {
    pieces.push(run.slice(from, b.at))
    from = b.at
  }
  pieces.push(run.slice(from))
  return { pieces, breaks }
}
