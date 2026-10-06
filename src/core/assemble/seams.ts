/**
 * Where, inside a paragraph joined across leaves, each later leaf begins.
 *
 * Assembly joins a paragraph that runs over the foot of a leaf into one block,
 * which is what a reader of this edition needs and what makes `blockPages` an
 * answer about the *opening* of a paragraph only. That was enough until a
 * question arrived that is about a page of the original rather than a block of
 * this edition: the contents of *The Mahatma Letters* sends the reader to page
 * 52 of the 1923 printing, page 52 opens in the middle of a paragraph that
 * began on 51, and "the page that paragraph opens on" is a page too early
 * whenever the paragraph is long. Exact, not ±1, so a joined block carries
 * the word each later leaf's text begins at.
 *
 * Words are counted the way everything else here counts them — runs of
 * non-space in the block's text — and a hyphen healed at the seam counts as
 * the word it makes: `chirur-` over `geon` is `chirurgeon`, which began on the
 * earlier leaf, so the seam names it.
 *
 * Kept sound through every edit that moves words (`applyEdits`): a retyping
 * follows the change in word count, a split hands each half its own seams and
 * the leaves it really covers, and a merge carries the second block's seams on
 * and adds one where the second block began a leaf of its own.
 *
 * Pure.
 */

/** Leaf `page`'s text begins at word `word` of the block. */
export interface Seam {
  page: number
  word: number
}

/** The whitespace-separated words of a text, as the layout counts them. */
const wordsOf = (text: string): string[] => text.split(/\s+/u).filter((w) => w.length > 0)

/**
 * Seams after the block's text was replaced: a seam before the change keeps
 * its word, one after it moves by however many words the change added or took
 * away, and one inside it stays at its place in the changed stretch as far as
 * the new stretch reaches.
 */
export function seamsAfterRetyping(
  seams: readonly Seam[] | undefined,
  before: string,
  after: string
): Seam[] | undefined {
  if (!seams?.length) return undefined
  const a = wordsOf(before)
  const b = wordsOf(after)
  if (b.length === 0) return undefined
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++
  }
  const moved = (word: number): number => {
    if (word < head) return word
    if (word >= a.length - tail) return word + (b.length - a.length)
    return Math.min(word, Math.max(head, b.length - tail - 1))
  }
  return tidy(seams.map((s) => ({ page: s.page, word: Math.min(moved(s.word), b.length - 1) })))
}

/** One half of a split block: the leaves it covers and its own seams. */
export interface SplitHalf {
  sourcePages: number[]
  seams?: Seam[]
}

/**
 * The two halves of a block split at character `at`, each with the leaves its
 * text really covers — or null when the block carries no seams, which leaves
 * a split exactly as it was before seams existed.
 *
 * `wordsInFirst` and `secondFrom` are the split's own word arithmetic (a cut
 * inside a word leaves that word's two ends in both halves), passed in rather
 * than worked out again here.
 */
export function seamsAfterSplit(
  block: { sourcePages: readonly number[]; seams?: readonly Seam[] },
  wordsInFirst: number,
  secondFrom: number
): [SplitHalf, SplitHalf] | null {
  if (!block.seams?.length) return null
  const firstPage = block.sourcePages[0]
  const before = block.seams.filter((s) => s.word < wordsInFirst)
  // The leaf the second half opens on: the last one to begin at or before it.
  const opening = [...block.seams].reverse().find((s) => s.word <= secondFrom)?.page ?? firstPage
  const after = block.seams
    .filter((s) => s.word > secondFrom)
    .map((s) => ({ page: s.page, word: s.word - secondFrom }))
  const half = (page: number | undefined, seams: Seam[]): SplitHalf => ({
    sourcePages: [...new Set([...(page === undefined ? [] : [page]), ...seams.map((s) => s.page)])],
    ...(seams.length > 0 ? { seams } : {})
  })
  return [half(firstPage, before), half(opening, after)]
}

/**
 * The seams of two blocks merged into one, the second's words now standing
 * after `shift` words of the first. Where the second block opened a leaf the
 * first never reached, that leaf begins at the join.
 */
export function seamsAfterMerge(
  first: { sourcePages: readonly number[]; seams?: readonly Seam[] },
  second: { sourcePages: readonly number[]; seams?: readonly Seam[] },
  shift: number
): Seam[] | undefined {
  const opening = second.sourcePages[0]
  const reached = new Set([...first.sourcePages, ...(first.seams ?? []).map((s) => s.page)])
  return tidy([
    ...(first.seams ?? []),
    ...(opening !== undefined && !reached.has(opening) ? [{ page: opening, word: shift }] : []),
    ...(second.seams ?? []).map((s) => ({ page: s.page, word: s.word + shift }))
  ])
}

/** In word order, one per leaf, absent rather than empty. */
function tidy(seams: readonly Seam[]): Seam[] | undefined {
  const out: Seam[] = []
  for (const seam of [...seams].sort((x, y) => x.word - y.word)) {
    if (!out.some((s) => s.page === seam.page)) out.push(seam)
  }
  return out.length > 0 ? out : undefined
}

/**
 * Where leaf `leaf`'s text begins in the assembled body: the block, and the
 * word of it. The first block, in reading order, that opens on the leaf or
 * carries a seam for it — which is where the leaf's first word went.
 *
 * Null for a leaf no body block came from: a plate, a blank, front matter
 * that was replaced, a page whose every block was dropped. The caller says
 * what such a page means.
 *
 * A block that lists the leaf among its pages with no seam for it is a record
 * written before seams were kept; the paragraph's opening is the most it can
 * say, and `exact` says so.
 */
export function leafStart(
  blocks: readonly { id: string; sourcePages: readonly number[]; seams?: readonly Seam[] }[],
  leaf: number
): { blockId: string; word: number; exact: boolean } | null {
  for (const block of blocks) {
    if (block.sourcePages[0] === leaf) return { blockId: block.id, word: 0, exact: true }
    const seam = block.seams?.find((s) => s.page === leaf)
    if (seam) return { blockId: block.id, word: seam.word, exact: true }
    if (block.sourcePages.includes(leaf)) return { blockId: block.id, word: 0, exact: false }
  }
  return null
}
