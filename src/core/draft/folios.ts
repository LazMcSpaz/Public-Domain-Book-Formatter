/**
 * The volume's own numbering, and what it settles about a leaf's furniture.
 *
 * A running head is decided per leaf, from geometry alone: a short line at the
 * top, standing clear of the text below it. That is the only evidence one leaf
 * has, and on a real scan it is not quite enough. Measured on Chapter II of
 * _Isis Unveiled_, **7 of 34 leaves** carried a head that missed the standoff
 * test by a few pixels — `THE WISE BARRACHIAS-HASSAN-OGLU. 43` stands 35 off
 * the line below where the rule wants 36 — so the head went into the body text
 * as a paragraph. That is worse than a wrong word: it puts furniture into the
 * prose, and nothing downstream can tell.
 *
 * The book knows the answer. Leaves are numbered consecutively, so
 * `leaf = folio + offset` holds across the whole volume, and the offset is
 * voted by the leaves whose furniture the draft *did* take confidently. A line
 * at the top of leaf 101 that contains `43`, on a volume whose offset is 58, is
 * a running head whatever the gap measures.
 *
 * The same arithmetic works the other way and catches the folio OCR misread:
 * leaf 120's head came back with the folio `4` where the volume predicts `62`,
 * and leaf 126's read `63` where it predicts `68`. Those are different faults —
 * the first is a box OCR clipped, the second may be the book misnumbering its
 * own leaf — so the first is corrected from the line's own words and the second
 * is only ever **reported**. A reprint does not renumber its original.
 *
 * Measured on Chapter I against what six readers with the images decided:
 * **9 of 12 near-miss heads rescued, 0 disagreements**, and the folio check
 * caught exactly the two leaves whose numbers were misread. The three it
 * abstains on are the right three — on two of them OCR mangled the number past
 * reading (`37` came through as `fig`) and the third is a chapter opening that
 * prints no head at all.
 *
 * Pure: no DOM, no I/O.
 */

/**
 * Digits OCR routinely reads as letters on this kind of scan, folded back.
 *
 * Not a general cleanup: it is applied **only** when asking whether a token is
 * the number the volume predicts, where the answer is already constrained to
 * one value. `5I` becomes `51` here and nowhere else, so nothing in the book's
 * text is touched by it.
 */
const AS_DIGITS: Record<string, string> = {
  I: '1',
  l: '1',
  i: '1',
  O: '0',
  o: '0',
  S: '5',
  s: '5',
  Z: '2',
  z: '2',
  B: '8',
  G: '6',
  g: '9',
  q: '9'
}

/** A token reduced to the digits it could be. Empty when it could be none. */
export function asFolio(token: string): string {
  const stripped = token.replace(/[^\p{L}\p{N}]+/gu, '')
  if (stripped === '') return ''
  let out = ''
  for (const ch of stripped) {
    if (ch >= '0' && ch <= '9') out += ch
    else if (AS_DIGITS[ch] !== undefined) out += AS_DIGITS[ch]
    else return ''
  }
  return out.replace(/^0+(?=\d)/u, '')
}

/**
 * Does this line carry the number the volume predicts for this leaf?
 *
 * Token by token, because a running head is `HEAD. 43` or `43 HEAD.` and the
 * number is a word of its own. Never a substring match: `143` contains `43` and
 * is a different leaf.
 */
export function namesFolio(text: string, folio: number): boolean {
  const wanted = String(folio)
  return text.split(/\s+/u).some((token) => asFolio(token) === wanted)
}

/** One leaf's contribution to the vote. */
export interface FolioSighting {
  pageIndex: number
  folio: string
}

export interface FolioOffset {
  /** `leaf = folio + offset`, or null when the sightings do not agree. */
  offset: number | null
  /** How many sightings backed the winner. */
  agreed: number
  /** How many were usable at all. */
  votes: number
  /** The leaves that dissented — the ones whose folio is worth looking at. */
  dissenting: number[]
}

/**
 * The volume's offset, voted rather than assumed.
 *
 * A plurality, not an average: a misread folio is not a small error in the
 * offset, it is a different number entirely, so averaging would move the answer
 * for every leaf rather than leaving one leaf wrong. The dissenters are named
 * because they are the check — on Chapter I the two that disagreed with the
 * winner were precisely the two whose folios OCR had misread, so the offset and
 * the list of leaves to look at fall out of the same count.
 *
 * `minimum` guards the other direction: an offset voted by two leaves is not
 * evidence, and a rule that rescued heads on it would be inventing furniture.
 */
export function folioOffset(sightings: readonly FolioSighting[], minimum = 5): FolioOffset {
  const counts = new Map<number, number[]>()
  for (const s of sightings) {
    const digits = asFolio(s.folio)
    if (digits === '') continue
    const offset = s.pageIndex - Number(digits)
    const seen = counts.get(offset) ?? []
    seen.push(s.pageIndex)
    counts.set(offset, seen)
  }
  const votes = [...counts.values()].reduce((n, l) => n + l.length, 0)
  let best: number | null = null
  let agreed = 0
  for (const [offset, leaves] of counts) {
    if (leaves.length > agreed) {
      best = offset
      agreed = leaves.length
    }
  }
  if (best === null || agreed < minimum) {
    return { offset: null, agreed, votes, dissenting: [] }
  }
  const dissenting = [...counts.entries()]
    .filter(([offset]) => offset !== best)
    .flatMap(([, leaves]) => leaves)
    .sort((a, b) => a - b)
  return { offset: best, agreed, votes, dissenting }
}

/** What the volume predicts this leaf's folio is, given an offset. */
export function folioFor(pageIndex: number, offset: number): number {
  return pageIndex - offset
}
