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
 *    the replace box means italic, the same convention as everywhere else.
 *
 * Pure: string work. The callers decide what a hit becomes — a `text` edit,
 * a rewritten section blob — through the same paths a hand edit takes.
 */

/** The only tags the notation prints — see `withMarkup`. */
const NOTATION_TAG = /<\/?[bi]>/y

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
  const swallowed = out.slice(start, end).match(/<\/?[bi]>/gu) ?? []
  const reopen: string[] = []
  const reclose: string[] = []
  for (const tag of swallowed) {
    if (tag[1] === '/') {
      const open = reopen.findIndex((t) => t === `<${tag[2]}>`)
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

interface Hunk {
  aFrom: number
  aTo: number
  bFrom: number
  bTo: number
}

/** Past this many cells the diff is not worth it and the ends are trimmed instead. */
const HUNK_CELLS = 250_000

/**
 * Where two strings differ, as stretches in order, each widened to whole
 * words and merged where they then touch. Whole words for the reason
 * `commonEnds` gives: a tag re-opened at a splice's end must not land inside
 * a word. A character-level longest common subsequence finds the stretches;
 * a match is a phrase, so the table is small, and past `HUNK_CELLS` the old
 * single stretch between the shared ends is used.
 */
function hunks(a: string, b: string): Hunk[] {
  const n = a.length
  const m = b.length
  if (n * m > HUNK_CELLS) {
    const { prefix, suffix } = commonEnds(a, b)
    return [{ aFrom: prefix, aTo: n - suffix, bFrom: prefix, bTo: m - suffix }]
  }
  // lcs[i][j] = LCS length of a[i..] and b[j..].
  const w = m + 1
  const lcs = new Uint16Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i * w + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * w + j + 1]! + 1
          : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!)
    }
  }
  const raw: Hunk[] = []
  let i = 0
  let j = 0
  let open: Hunk | null = null
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      if (open) raw.push(open)
      open = null
      i += 1
      j += 1
      continue
    }
    open ??= { aFrom: i, aTo: i, bFrom: j, bTo: j }
    if (j < m && (i === n || lcs[i * w + j + 1]! >= lcs[(i + 1) * w + j]!)) {
      j += 1
      open.bTo = j
    } else {
      i += 1
      open.aTo = i
    }
  }
  if (open) raw.push(open)

  // Widen each to word boundaries. The characters outside a hunk are shared,
  // so widening moves both sides together.
  const widened = raw.map((h) => {
    let { aFrom, aTo, bFrom, bTo } = h
    while (
      aFrom > 0 &&
      isWordChar(a[aFrom - 1]) &&
      (isWordChar(a[aFrom]) || isWordChar(b[bFrom]))
    ) {
      aFrom -= 1
      bFrom -= 1
    }
    while (aTo < n && isWordChar(a[aTo]) && (isWordChar(a[aTo - 1]) || isWordChar(b[bTo - 1]))) {
      aTo += 1
      bTo += 1
    }
    return { aFrom, aTo, bFrom, bTo }
  })
  const merged: Hunk[] = []
  for (const h of widened) {
    const last = merged[merged.length - 1]
    if (last && h.aFrom <= last.aTo) {
      last.aTo = Math.max(last.aTo, h.aTo)
      last.bTo = Math.max(last.bTo, h.bTo)
    } else {
      merged.push({ ...h })
    }
  }
  return merged
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u
const isWordChar = (c: string | undefined): boolean => c !== undefined && WORD_CHAR.test(c)

/**
 * How much two strings share at each end, never overlapping, and cut back
 * to a word boundary on both sides. Whole words, because a tag the splice
 * swallows is re-opened at the splice's end, and an end that falls inside a
 * word puts the tag there: `the astral` → `one ethereal` shares `al` and
 * would set `ethere<i>al`. A boundary is one the shared text has on both
 * sides — the shared characters are the same in both strings, so only the
 * character just past them can differ, and it has to be a non-word one in
 * both for the cut to fall between words in both.
 */
function commonEnds(a: string, b: string): { prefix: number; suffix: number } {
  const most = Math.min(a.length, b.length)
  let prefix = 0
  while (prefix < most && a[prefix] === b[prefix]) prefix += 1
  while (
    prefix > 0 &&
    isWordChar(a[prefix - 1]) &&
    (isWordChar(a[prefix]) || isWordChar(b[prefix]))
  ) {
    prefix -= 1
  }
  let suffix = 0
  while (suffix < most - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) {
    suffix += 1
  }
  while (
    suffix > 0 &&
    isWordChar(a[a.length - suffix]) &&
    (isWordChar(a[a.length - suffix - 1]) || isWordChar(b[b.length - suffix - 1]))
  ) {
    suffix -= 1
  }
  return { prefix, suffix }
}
