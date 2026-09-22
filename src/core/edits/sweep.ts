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
    // meant to add a full stop. Trimming the common prefix and suffix leaves
    // those runs where they were; the plain text that results is identical.
    const slice = plain.slice(hit, hit + query.length)
    const { prefix, suffix } = commonEnds(slice, replacement)
    const core = replacement.slice(prefix, replacement.length - suffix)
    const from = hit + prefix
    const to = hit + query.length - suffix
    // An insertion between two characters goes after the one before it, so
    // a stop added after `(Sk.)` lands inside the italic run that sets it.
    const start = from < to ? toMarkup[from]! : from > 0 ? toMarkup[from - 1]! + 1 : 0
    const end = from < to ? toMarkup[to - 1]! + 1 : start

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

    out = out.slice(0, start) + reclose.join('') + core + reopen.join('') + out.slice(end)
  }
  return { text: out, count: hits.length }
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
