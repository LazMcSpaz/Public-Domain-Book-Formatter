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
 * and the replacement is spliced back into the notation. Four cases, all
 * deliberate:
 *
 *  - only the characters that differ are spliced: a phrase typed whole to
 *    pin down one word — `Lakshmi (Sk.) “ Prosperity ”` to add a stop —
 *    changes the stop and leaves the bold headword and the italic tag it
 *    spans exactly as they were (measured: twenty-six blocks of a glossary
 *    lost both before this held);
 *  - a match wholly inside a marked run keeps the marking: fixing `belleves`
 *    inside `<i>he belleves it</i>` leaves the phrase italic;
 *  - changed characters that cross a run's *edge* re-balance rather than
 *    corrupting: the tags the splice swallowed are re-opened (or re-closed)
 *    at its end, so `body` in `the <i>astral body</i>` stays italic whatever
 *    is done to `the astral`;
 *  - the replacement itself is inserted as it was typed, so `<i>` written in
 *    the replace box means italic, the same convention as everywhere else;
 *  - a tag *inside* a changed word — italic over part of it, `<i>un</i>spirtual`
 *    — stays where it is when the change is elsewhere in the word: changes are
 *    widened to whole words, and a word that carries a part of a word in one
 *    face would otherwise lose it to a fix of one of its other letters.
 *
 * Pure: string work. The callers decide what a hit becomes — a `text` edit,
 * a rewritten section blob — through the same paths a hand edit takes.
 */

/**
 * The only tags the notation prints — see `withMarkup`. Small capitals among
 * them: a word set partly in small capitals is printed `un<sc>spirit</sc>ual`,
 * and a search that read the tag as letters could not find the word.
 */
const NOTATION_TAG = /<\/?(?:[bi]|sc)>/y
/** The same tags, to find every one in a stretch. */
const NOTATION_TAGS = /<\/?(?:[bi]|sc)>/gu

export interface PlainMap {
  /** The text with the tags removed — what a reader searches. */
  plain: string
  /** For each plain character, its index in the markup string. */
  toMarkup: number[]
}

export function mapPlainText(markup: string): PlainMap {
  return mapPlain(markup)
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

/**
 * One code point's accent taken off, length preserved: `â` → `a`, `ï` → `i`,
 * `ö` → `o`. A search typed without the accent then finds the word the page
 * sets with one, which on a book of Sanskrit transliterations is most of the
 * words worth searching for — and typing the accent still works, since both
 * sides fold. Length is preserved on purpose: the match positions index the
 * plain text, so a fold that changed a string's length would put every
 * offset after it off by one. That is why `æ` and `œ` are left alone here
 * (they would become two letters); the shelf search in `blavatsky.mjs`, which
 * keeps its own offset map, folds those too.
 */
export function foldAccents(s: string): string {
  let out = ''
  for (const c of s) out += c.normalize('NFD')[0] ?? c
  return out
}

/** Non-overlapping plain-text match positions, case- and accent-folded unless asked not to. */
function positions(plain: string, query: string, matchCase: boolean): number[] {
  if (query.length === 0) return []
  const out: number[] = []
  // Compared slice by slice rather than on a folded copy of the whole text,
  // because case-folding can change a string's length and would put every
  // index after the first odd character off by one.
  const same = (a: string, b: string): boolean =>
    matchCase ? a === b : foldAccents(a).toLowerCase() === foldAccents(b).toLowerCase()
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
  for (const hit of [...hits].reverse()) {
    // Splice only the characters that actually change. A query typed as a
    // whole phrase usually differs from its replacement by a letter or a
    // stop — `Lakshmi (Sk.) “ Prosperity ”` against `Lakshmi (Sk.). “ …` — and
    // replacing the whole phrase drops every run the phrase spans: the
    // re-balancing below can re-open a run the match *crossed*, but a run
    // that begins and ends inside the match has nowhere to go and was
    // silently stripped. Measured on the Glossary: twenty-six blocks lost
    // their bold headword and italic tag that way, to sweeps that only ever
    // meant to add a full stop. The plain text that results is identical.
    //
    // And each changed stretch is spliced on its own, right to left, because
    // trimming only the shared ends is not enough: a phrase carrying two
    // changes — the spaces inside `“Abatur”` and `“Logos”` — spliced
    // everything between them as plain text, and a run lying wholly between
    // (`<i>Third</i>`) was dropped. Measured on the Glossary: nine blocks lost
    // italics and bold that way to a pass that only ever changed spaces.
    const slice = plain.slice(hit, hit + query.length)
    for (const h of hunks(slice, replacement).reverse()) {
      const core = replacement.slice(h.bFrom, h.bTo)
      const from = hit + h.aFrom
      const to = hit + h.aTo
      out = spliceAt(out, toMarkup, from, to, core)
    }
  }
  return { text: out, count: hits.length }
}

/**
 * Replace plain characters `[from, to)` of the notation with `core`,
 * re-balancing any tag the replaced stretch swallows.
 */
function spliceAt(out: string, toMarkup: number[], from: number, to: number, core: string): string {
  // An insertion between two characters goes after the one before it, so
  // a stop added after `(Sk.)` lands inside the italic run that sets it.
  const start = from < to ? toMarkup[from]! : from > 0 ? toMarkup[from - 1]! + 1 : 0
  const end = from < to ? toMarkup[to - 1]! + 1 : start

  // Tags the stretch swallows. A run opened inside it and closed after it
  // (or the mirror) would leave a stray tag behind — harmless to the parser,
  // which is forgiving, but it silently strips the marking from the words
  // outside. Re-balancing at the splice keeps them marked.
  const swallowed = out.slice(start, end).match(NOTATION_TAGS) ?? []

  // Unless every tag swallowed sits in letters the change leaves alone — the
  // stretch's shared head or tail. Widening a change to whole words is what
  // brings a tag inside a word into the stretch at all, and that only happens
  // to a word set partly in one face: `<i>un</i>spirtual` fixed to
  // `unspiritual` keeps its `un` italic. Each tag goes back at its place in
  // the new characters, so nothing needs re-balancing.
  if (swallowed.length > 0) {
    const kept = keptInPlace(out.slice(start, end), core)
    if (kept !== null) return out.slice(0, start) + kept + out.slice(end)
  }

  const reopen: string[] = []
  const reclose: string[] = []
  for (const tag of swallowed) {
    if (tag[1] === '/') {
      const open = reopen.findIndex((t) => t === `<${tag.slice(2)}`)
      // A closer whose opener is also inside cancels it; one whose opener is
      // *before* the stretch must close again ahead of the splice.
      if (open >= 0) reopen.splice(open, 1)
      else reclose.push(tag)
    } else {
      reopen.push(tag)
    }
  }
  return out.slice(0, start) + reclose.join('') + core + reopen.join('') + out.slice(end)
}

/**
 * `core` with the tags of `stretch` put back where they stood, when every one
 * of them stands in the characters the two share at their head or their tail;
 * null when any falls among the characters that change, which is re-balanced
 * as before.
 */
function keptInPlace(stretch: string, core: string): string | null {
  const tags: { at: number; tag: string }[] = []
  let plain = ''
  let i = 0
  while (i < stretch.length) {
    if (stretch[i] === '<') {
      NOTATION_TAG.lastIndex = i
      if (NOTATION_TAG.test(stretch)) {
        tags.push({ at: plain.length, tag: stretch.slice(i, NOTATION_TAG.lastIndex) })
        i = NOTATION_TAG.lastIndex
        continue
      }
    }
    plain += stretch[i]
    i += 1
  }
  let head = 0
  while (head < plain.length && head < core.length && plain[head] === core[head]) head += 1
  let tail = 0
  while (
    tail < plain.length - head &&
    tail < core.length - head &&
    plain[plain.length - 1 - tail] === core[core.length - 1 - tail]
  ) {
    tail += 1
  }
  const placed: { at: number; tag: string }[] = []
  for (const { at, tag } of tags) {
    if (at <= head) placed.push({ at, tag })
    else if (at >= plain.length - tail) placed.push({ at: at - plain.length + core.length, tag })
    else return null
  }
  let result = ''
  let cursor = 0
  for (const { at, tag } of placed) {
    result += core.slice(cursor, at) + tag
    cursor = at
  }
  return result + core.slice(cursor)
}

interface Hunk {
  aFrom: number
  aTo: number
  bFrom: number
  bTo: number
}

/**
 * Past this many cells the middle is not diffed and becomes one stretch. Only
 * the stretch between the first and last difference is diffed, so this binds
 * only when two changes are thousands of characters apart.
 */
const HUNK_CELLS = 4_000_000

/**
 * Where two strings differ, as stretches in order, each widened to whole
 * words and merged where they then touch (see `widen`). The shared ends are set aside first and a character-level longest
 * common subsequence finds the stretches in what is left — which is what
 * keeps this cheap when a whole block is the match, as it is when a
 * correction is replayed onto re-derived markup. Diffing the whole block
 * instead ran past the cap there and fell back to one stretch, and a run
 * between two changes was dropped again.
 */
function hunks(a: string, b: string): Hunk[] {
  const n = a.length
  const m = b.length
  let head = 0
  while (head < n && head < m && a[head] === b[head]) head += 1
  let tail = 0
  while (tail < n - head && tail < m - head && a[n - 1 - tail] === b[m - 1 - tail]) tail += 1
  const an = n - head - tail
  const bm = m - head - tail
  if (an * bm > HUNK_CELLS) {
    return widen(a, b, [{ aFrom: head, aTo: n - tail, bFrom: head, bTo: m - tail }])
  }
  const ai = (k: number): string => a[head + k]!
  const bj = (k: number): string => b[head + k]!
  // lcs[i][j] = LCS length of the middles from i and j on.
  const w = bm + 1
  const lcs = new Uint16Array((an + 1) * w)
  for (let i = an - 1; i >= 0; i -= 1) {
    for (let j = bm - 1; j >= 0; j -= 1) {
      lcs[i * w + j] =
        ai(i) === bj(j)
          ? lcs[(i + 1) * w + j + 1]! + 1
          : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!)
    }
  }
  const raw: Hunk[] = []
  let i = 0
  let j = 0
  let open: Hunk | null = null
  while (i < an || j < bm) {
    if (i < an && j < bm && ai(i) === bj(j)) {
      if (open) raw.push(open)
      open = null
      i += 1
      j += 1
      continue
    }
    open ??= { aFrom: head + i, aTo: head + i, bFrom: head + j, bTo: head + j }
    if (j < bm && (i === an || lcs[i * w + j + 1]! >= lcs[(i + 1) * w + j]!)) {
      j += 1
      open.bTo = head + j
    } else {
      i += 1
      open.aTo = head + i
    }
  }
  if (open) raw.push(open)
  return widen(a, b, raw)
}

/**
 * Each stretch widened to word boundaries, then merged where they touch.
 * Whole words, because a tag the splice swallows is re-opened at the splice's
 * end, and an end that falls inside a word puts the tag there: `the astral`
 * → `one ethereal` shares `al` and would set `ethere<i>al`. A boundary is one
 * the shared text has on both sides — the characters outside a stretch are
 * the same in both strings, so only the character just past them can differ,
 * and it has to be a non-word one in both for the cut to fall between words.
 */
function widen(a: string, b: string, raw: readonly Hunk[]): Hunk[] {
  const n = a.length
  // Widen each to word boundaries. The characters outside a hunk are shared,
  // so widening moves both sides together — which is true only up to the
  // next hunk, so that is as far as it may go. Widening past it once moved
  // the two strings out of step (its characters differ between them), and
  // the splice duplicated text: a whole note replaced on Isis Vol. II came
  // out `Franck  : “ Die Kabbal Kabbala.””`. Stopped at a neighbour, two
  // hunks meet exactly, and merging them keeps both sides in step.
  const merged: Hunk[] = []
  raw.forEach((h, k) => {
    let { aFrom, aTo, bFrom, bTo } = h
    const floor = merged[merged.length - 1]?.aTo ?? 0
    const ceiling = raw[k + 1]?.aFrom ?? n
    while (
      aFrom > floor &&
      isWordChar(a[aFrom - 1]) &&
      (isWordChar(a[aFrom]) || isWordChar(b[bFrom]))
    ) {
      aFrom -= 1
      bFrom -= 1
    }
    while (
      aTo < ceiling &&
      isWordChar(a[aTo]) &&
      (isWordChar(a[aTo - 1]) || isWordChar(b[bTo - 1]))
    ) {
      aTo += 1
      bTo += 1
    }
    const last = merged[merged.length - 1]
    if (last && aFrom <= last.aTo) {
      last.aTo = aTo
      last.bTo = bTo
    } else {
      merged.push({ aFrom, aTo, bFrom, bTo })
    }
  })
  return merged
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u
const isWordChar = (c: string | undefined): boolean => c !== undefined && WORD_CHAR.test(c)
