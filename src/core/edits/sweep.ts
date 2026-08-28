/**
 * Find and replace across the book's own notation.
 *
 * The recurring OCR misreading is the case this exists for: the same wrong
 * word tends to appear dozens of times in one scan, and fixing it place by
 * place is a hunt. A sweep is a batch of ordinary `text` edits — previewable,
 * autosaved, and undone in one step — so the power tool costs the safety
 * rules nothing.
 *
 * The subtlety is emphasis. Text is edited as the `<i>`/`<b>` notation, but a
 * person searches what they *read* — so the search runs over the plain text
 * and the replacement is spliced back into the notation. Three cases, all
 * deliberate:
 *
 *  - a match wholly inside a marked run keeps the marking: fixing `belleves`
 *    inside `<i>he belleves it</i>` leaves the phrase italic;
 *  - a match that crosses a run's *edge* re-balances rather than corrupting:
 *    the tags the match swallowed are re-opened (or re-closed) at the splice,
 *    so replacing `the astral` in `the <i>astral body</i>` keeps `body`
 *    italic instead of silently stripping it;
 *  - the replacement itself is inserted as it was typed, so `<i>` written in
 *    the replace box means italic, the same convention as everywhere else.
 *
 * Pure: string work. The callers decide what a hit becomes — a `text` edit,
 * a rewritten section blob — through the same paths a hand edit takes.
 */

/** The only tags the notation prints — see `withMarkup`. */
const NOTATION_TAG = /<\/?[bi]>/y

interface PlainMap {
  /** The text with the tags removed — what a reader searches. */
  plain: string
  /** For each plain character, its index in the markup string. */
  toMarkup: number[]
}

function mapPlain(markup: string): PlainMap {
  const toMarkup: number[] = []
  let plain = ''
  let i = 0
  while (i < markup.length) {
    if (markup[i] === '<') {
      NOTATION_TAG.lastIndex = i
      if (NOTATION_TAG.test(markup)) {
        i = NOTATION_TAG.lastIndex
        continue
      }
    }
    toMarkup.push(i)
    plain += markup[i]
    i += 1
  }
  return { plain, toMarkup }
}

/** Non-overlapping plain-text match positions, case-folded unless asked not to. */
function positions(plain: string, query: string, matchCase: boolean): number[] {
  if (query.length === 0) return []
  const out: number[] = []
  // Compared slice by slice rather than on a lowercased copy of the whole
  // text, because case-folding can change a string's length and would put
  // every index after the first odd character off by one.
  const same = (a: string, b: string): boolean =>
    matchCase ? a === b : a.toLowerCase() === b.toLowerCase()
  let i = 0
  while (i <= plain.length - query.length) {
    if (same(plain.slice(i, i + query.length), query)) {
      out.push(i)
      i += query.length
    } else {
      i += 1
    }
  }
  return out
}

export interface SweepMatch {
  /** Plain-text offset of the match. */
  at: number
  /** The match with a few words either side, for a sheet a person can read. */
  context: string
}

/** Every place the query occurs in one block's notation, with reading context. */
export function findMatches(markup: string, query: string, matchCase = false): SweepMatch[] {
  const { plain } = mapPlain(markup)
  return positions(plain, query, matchCase).map((at) => {
    const before = plain.slice(Math.max(0, at - 30), at).trimStart()
    const after = plain.slice(at + query.length, at + query.length + 30).trimEnd()
    return {
      at,
      context: `…${before}[${plain.slice(at, at + query.length)}]${after}…`
    }
  })
}

/**
 * Replace every occurrence in one block's notation.
 *
 * Returns the notation with the replacements in and how many were made; a
 * count of zero returns the input string itself, so callers can tell "nothing
 * to do" from "rewrote it to the same thing".
 */
export function sweepText(
  markup: string,
  query: string,
  replacement: string,
  matchCase = false
): { text: string; count: number } {
  if (query.length === 0 || query === replacement) return { text: markup, count: 0 }
  const { plain, toMarkup } = mapPlain(markup)
  const hits = positions(plain, query, matchCase)
  if (hits.length === 0) return { text: markup, count: 0 }

  let out = markup
  // Right to left, so earlier splices do not move later indices.
  for (const at of [...hits].reverse()) {
    const start = toMarkup[at]!
    const last = toMarkup[at + query.length - 1]!
    const end = last + 1

    // Tags the match swallows. A run opened inside the match and closed after
    // it (or the mirror) would leave a stray tag behind — harmless to the
    // parser, which is forgiving, but it silently strips the marking from the
    // words outside the match. Re-balancing at the splice keeps them marked.
    const swallowed = out.slice(start, end).match(/<\/?[bi]>/gu) ?? []
    const reopen: string[] = []
    const reclose: string[] = []
    for (const tag of swallowed) {
      if (tag[1] === '/') {
        const open = reopen.findIndex((t) => t === `<${tag[2]}>`)
        // A closer whose opener is also in the match cancels it; one whose
        // opener is *before* the match must close again ahead of the splice.
        if (open >= 0) reopen.splice(open, 1)
        else reclose.push(tag)
      } else {
        reopen.push(tag)
      }
    }

    out = out.slice(0, start) + reclose.join('') + replacement + reopen.join('') + out.slice(end)
  }
  return { text: out, count: hits.length }
}
