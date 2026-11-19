/**
 * No scrap at the end of a paragraph.
 *
 * A runt is a last line too short to stand on its own: "pris-" at the end of
 * one line and "on." alone on the next, or a lone short word under a full
 * line. Knuth–Plass happily chooses one, because the last line's free fill
 * makes it cost nothing. This takes those breaks away before the breaker
 * looks, with two rules:
 *
 *   1. the line before the last is never broken inside a word: a hyphen (or a
 *      dash, or a slash) whose remainder would fit on one line may not be
 *      taken;
 *   2. the last line is never shorter than `minLastLineEms`: a break that
 *      would leave less than that after it may not be taken.
 *
 * Only a paragraph that ends on a runt is broken again (`breakParagraph`):
 * with both rules, then with rule 2 alone, each within `RUNT_TOLERANCE`; if
 * neither can be kept, the paragraph stays as it was. Every other paragraph is
 * left exactly as the plain breaker set it.
 *
 * Behind the `avoidShortLastLines` setting, because it moves line breaks and a
 * book already printed must not reflow when it is exported for a correction.
 *
 * Pure: an item stream in, an item stream out.
 */
import { MAX_COST, lineContentStart, type InputItem, type Penalty } from 'tex-linebreak'
import type { StyleProfile } from '@core/model'

/** What a paragraph's last line must hold, in ems of the paragraph's size. */
export interface RuntRule {
  minLastLineEms: number
}

/**
 * Three ems: about six or seven letters of a book face. "on." and "it." are
 * runts; "prison." stands.
 */
export const MIN_LAST_LINE_EMS = 3

/**
 * How loose a line may be set to avoid a runt, as TeX's adjustment ratio: a
 * space may grow by this many times its stretch. 1 is the normal limit; TeX's
 * customary tolerance of 200 is about 1.26. Past it the runt stays, because a
 * gappy paragraph is worse than a short last line.
 */
export const RUNT_TOLERANCE = 1.26

/** The rule a book's style asks for, or none. */
export function runtRule(profile: StyleProfile): RuntRule | undefined {
  return profile.avoidShortLastLines ? { minLastLineEms: MIN_LAST_LINE_EMS } : undefined
}

/**
 * Whether a paragraph broken at `breakpoints` ends on a runt: the line before
 * the last ends inside a word, or the last line holds less than
 * `minLastLinePt` at its natural width.
 */
export function endsOnRunt(
  items: readonly InputItem[],
  breakpoints: readonly number[],
  minLastLinePt: number
): boolean {
  if (breakpoints.length < 3) return false
  const before = breakpoints[breakpoints.length - 2]!
  const end = breakpoints[breakpoints.length - 1]!
  const turn = items[before]!
  if (turn.type === 'penalty' && turn.flagged) return true
  let width = 0
  for (let i = lineContentStart(items as InputItem[], before, end); i < end; i++) {
    const item = items[i]!
    if (item.type !== 'penalty') width += item.width
  }
  return width < minLastLinePt
}

function forbidden(): Penalty {
  return { type: 'penalty', width: 0, cost: MAX_COST, flagged: false }
}

/**
 * `items` with every break that would leave a runt made illegal.
 *
 * A break's remainder is what the last line would hold if the paragraph ended
 * one line later: the boxes and spaces from the first box after the break to
 * the end. Rule 2 measures it at its natural width; rule 1 at its tightest
 * (every space squeezed as far as it may go), against the widest line the
 * paragraph is given, so no break that *could* end the line before the last is
 * missed. A space is made illegal the way TeX does it, with a forbidding
 * penalty before it; a penalty is made illegal by raising its cost.
 * `widestLinePt` null leaves rule 1 out: the gentler rule, tried when both
 * together cannot be kept.
 */
export function withoutRunts(
  items: readonly InputItem[],
  minLastLinePt: number,
  widestLinePt: number | null
): InputItem[] {
  const n = items.length
  const natural = new Array<number>(n + 1).fill(0)
  const shrink = new Array<number>(n + 1).fill(0)
  const nextBox = new Array<number>(n + 1).fill(n)
  for (let i = n - 1; i >= 0; i--) {
    const item = items[i]!
    natural[i] = natural[i + 1]! + (item.type === 'penalty' ? 0 : item.width)
    shrink[i] = shrink[i + 1]! + (item.type === 'glue' ? item.shrink : 0)
    nextBox[i] = item.type === 'box' ? i : nextBox[i + 1]!
  }

  const out: InputItem[] = []
  for (let i = 0; i < n; i++) {
    const item = items[i]!
    const from = nextBox[i + 1]!
    // Nothing printed after it: the paragraph's own end, which must stay.
    if (from >= n) {
      out.push(item)
      continue
    }
    const rest = natural[from]!
    const tightest = rest - shrink[from]!
    if (item.type === 'glue' && i > 0 && items[i - 1]!.type === 'box') {
      if (rest < minLastLinePt) out.push(forbidden())
      out.push(item)
    } else if (item.type === 'penalty' && item.cost < MAX_COST) {
      const finalHyphen = item.flagged && widestLinePt !== null && tightest <= widestLinePt
      const runt = rest < minLastLinePt || finalHyphen
      out.push(runt ? { ...item, cost: MAX_COST } : item)
    } else {
      out.push(item)
    }
  }
  return out
}

/**
 * The options every paragraph of prose is broken with: hyphenated where the
 * style allows it, and kept from ending on a scrap where the style asks.
 */
export function proseBreaks(ctx: { hyphenate?: (word: string) => string[]; runts?: RuntRule }): {
  hyphenate?: (word: string) => string[]
  runts?: RuntRule
} {
  return {
    ...(ctx.hyphenate ? { hyphenate: ctx.hyphenate } : {}),
    ...(ctx.runts ? { runts: ctx.runts } : {})
  }
}
