/**
 * The proofed book, projected back onto its leaves.
 *
 * ## Why this exists
 *
 * Both measurement plans — cleaning the page before Tesseract reads it, and a
 * second OCR engine as a witness — score a reading against "the proofed text
 * of that leaf." That text does not exist. Corrections are keyed to
 * **assembled blocks**, and assembly joins a paragraph across a page seam, so
 * a block belongs to two leaves at once and its corrected words carry no
 * record of which leaf each came from. CLAUDE.md's *a leaf's text is not a
 * block's text* is the rule, and a count taken against a reconstruction that
 * ignored it was wrong by eight in sixteen the first time it was tried here.
 *
 * So this projects the edited body back onto leaves, once, and both plans
 * measure against the result rather than each rebuilding it.
 *
 * ## How a word finds its leaf
 *
 * A block on one leaf is the easy case: every word is that leaf's.
 *
 * A block joined across a seam is labelled by **alignment, not by
 * reconstruction**. Its words are aligned against the raw text of each source
 * leaf in turn with `matchingRuns` — the witness module's own aligner, shared
 * so a ground truth and a witness report cannot disagree about where words
 * are — and a word that matches leaf *a* is leaf *a*'s. A word that matches no
 * leaf is one the seam healed (`ad-` + `vanced` → `advanced` matches neither
 * `ad` nor `vanced`) and is given to the leaf of the word before it, where it
 * began.
 *
 * The edited block is then aligned against its pristine parent, and each
 * edited word inherits the leaf of the pristine word it matched. A word the
 * editor inserted or changed matches nothing and takes its neighbour's leaf.
 * That is a guess and a safe one — a correction sits where the fault was.
 *
 * ## What is reported rather than guessed
 *
 * A block **merged** across leaves has words from a second pristine block this
 * projection did not align against, and giving them the neighbouring leaf
 * would be wrong on the leaf that matters. Those words are counted as
 * `unplaced` on the block's first leaf and never assigned. A leaf with
 * unplaced words is one a measurement should skip, and it can only skip what
 * it has been told about.
 *
 * `unsettled` marks a leaf carrying a query with no ruling: its "proofed" text
 * is one the editor has not finished deciding, and a reading scored against it
 * is scored against an open question.
 *
 * ## The tokens
 *
 * Words are whitespace tokens with punctuation intact, so a measurement can
 * score points apart from letters — despeckle can eat the dot on an *i*, and
 * a preset that wins on words and loses on stops is a preset that loses.
 * Alignment runs on each token's letters and digits, lower-cased, which is
 * the witness module's own normalisation applied per token rather than per
 * text, so a token maps to exactly one key. A token with no key (a lone dash,
 * an ellipsis) aligns to nothing and inherits its neighbour's leaf.
 *
 * Pure: no DOM, no I/O, no network.
 */
import type { BookDocument } from '@core/assemble'
import type { PageTranscription } from '@core/transcribe'
import { matchingRuns } from './index'

export interface LeafTruth {
  pageIndex: number
  /** Body words as the edited book has them, in reading order, punctuation intact. */
  words: string[]
  /** The leaf's own footnotes, as the edited book has them. */
  notes: string[]
  /** Running head, folio — what the leaf prints that is not content. */
  furniture: string[]
  /** Edited block ids that put words on this leaf, in order. */
  blocks: string[]
  /** Words that could not be placed and were not guessed at. */
  unplaced: number
  /** A query on this leaf has no ruling. */
  unsettled: boolean
}

/** A ruling names the query it answers by leaf and quote. */
export interface RulingRef {
  pageIndex: number
  quote: string
}

const TOKEN = /\S+/gu

/** One key per token: its letters and digits, lower-cased; empty for punctuation alone. */
function keyOf(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/gu, '')
}

function tokens(text: string): string[] {
  return text.replace(/<[^>]*>/gu, '').match(TOKEN) ?? []
}

/** Keys of the tokens, with the empty ones left in so indices line up. */
function keys(toks: readonly string[]): string[] {
  return toks.map(keyOf)
}

/**
 * Align `words` against `against` and return, per word, the index it matched
 * or -1. Empty-keyed words never match; they are punctuation and are placed
 * by their neighbours.
 */
function matchedIndex(words: readonly string[], against: readonly string[]): number[] {
  const out = new Array<number>(words.length).fill(-1)
  const wk = keys(words)
  const ak = keys(against)
  for (const [i, j] of matchingRuns(wk, ak)) if (wk[i]!.length > 0) out[i] = j
  return out
}

/** Fill -1 gaps from the nearest labelled neighbour — before first, then after. */
function fillFromNeighbours(labels: number[], fallback: number): number[] {
  const out = [...labels]
  let last = -1
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== -1) last = out[i]!
    else if (last !== -1) out[i] = last
  }
  let next = -1
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] !== -1) next = out[i]!
    else out[i] = next !== -1 ? next : fallback
  }
  return out
}

/**
 * Which leaf each word of a pristine block came from.
 *
 * For a single-leaf block, all of them. For a seam block, by **one alignment
 * against every source leaf's raw words laid end to end**, each raw word
 * tagged with its leaf: a matched block word takes its raw word's tag, and
 * because the aligner preserves order the tags come out non-decreasing along
 * the block — leaf 0's words, then leaf 1's, then leaf 2's — with no way for
 * a word two leaves print to be claimed by the wrong one.
 *
 * The first version aligned leaf by leaf and masked words an earlier leaf had
 * claimed. That happened to work for two leaves only because the aligner
 * breaks ties towards the later copy, and it could not have worked for three:
 * the middle leaf's alignment had no way to refuse a word that belonged to
 * the leaf after it. Concatenating makes the order the alignment's own.
 *
 * A word matching nothing is one the seam healed (`ad-` + `vanced` matches
 * neither `ad` nor `vanced`) and takes the leaf of the word before it, where
 * it began.
 */
function leafOfPristineWords(
  words: readonly string[],
  sourcePages: readonly number[],
  leafText: ReadonlyMap<number, string>
): number[] {
  if (sourcePages.length <= 1) return new Array<number>(words.length).fill(sourcePages[0] ?? -1)
  const raw: string[] = []
  const tag: number[] = []
  for (const page of sourcePages) {
    for (const t of tokens(leafText.get(page) ?? '')) {
      raw.push(t)
      tag.push(page)
    }
  }
  const matched = matchedIndex(words, raw)
  const labels = matched.map((j) => (j === -1 ? -1 : tag[j]!))
  return fillFromNeighbours(labels, sourcePages[0] ?? -1)
}

/**
 * Project the edited book onto its leaves.
 *
 * `pristine` is `assembleBook(transcriptions)` and `edited` is that with the
 * edits applied. Both are taken rather than rebuilt here, because assembling
 * is the caller's business and this must not disagree with what the caller
 * assembled.
 */
export function leafTruth(
  transcriptions: readonly PageTranscription[],
  pristine: BookDocument,
  edited: BookDocument,
  rulings: readonly RulingRef[] = []
): LeafTruth[] {
  const leafText = new Map<number, string>()
  const furniture = new Map<number, string[]>()
  const unsettled = new Set<number>()
  const settled = new Set(rulings.map((r) => `${r.pageIndex}\u0000${r.quote}`))

  for (const leaf of transcriptions) {
    leafText.set(leaf.pageIndex, leaf.blocks.map((b) => b.text).join('\n'))
    const f = Object.values(leaf.furniture ?? {}).filter(
      (v): v is string => typeof v === 'string' && v.trim().length > 0
    )
    furniture.set(
      leaf.pageIndex,
      f.flatMap((v) => tokens(v))
    )
    for (const q of leaf.queries ?? []) {
      if (!settled.has(`${leaf.pageIndex}\u0000${q.quote}`)) unsettled.add(leaf.pageIndex)
    }
  }

  const pristineById = new Map(pristine.blocks.map((b) => [b.id, b]))
  const perLeaf = new Map<number, LeafTruth>()
  const leafFor = (page: number): LeafTruth => {
    let t = perLeaf.get(page)
    if (t === undefined) {
      t = {
        pageIndex: page,
        words: [],
        notes: [],
        furniture: furniture.get(page) ?? [],
        blocks: [],
        unplaced: 0,
        unsettled: unsettled.has(page)
      }
      perLeaf.set(page, t)
    }
    return t
  }

  for (const block of edited.blocks) {
    // A written section's blocks stand on no leaf; nothing OCR read them from.
    if (block.sourcePages.length === 0) continue
    const words = tokens(block.text)
    if (words.length === 0) continue

    const parent = pristineById.get(block.id.split('/')[0]!)
    const parentWords = parent ? tokens(parent.text) : []
    const parentLeaf = parent ? leafOfPristineWords(parentWords, parent.sourcePages, leafText) : []

    // Each edited word inherits the leaf of the pristine word it aligned to.
    const matched = matchedIndex(words, parentWords)
    const labels = words.map((_, i) => (matched[i] === -1 ? -1 : parentLeaf[matched[i]!]!))

    // A merge brings words from a pristine block this did not align against:
    // the edited block names leaves its parent never had. Those words are not
    // placeable from here, and are reported rather than given a neighbour's leaf.
    const parentPages = new Set(parent?.sourcePages ?? [])
    const foreign = block.sourcePages.filter((p) => !parentPages.has(p))
    let unplaced = 0
    if (foreign.length > 0) {
      unplaced = labels.filter((l) => l === -1).length
      for (let i = 0; i < labels.length; i++) if (labels[i] === -1) labels[i] = -2
    }
    const placed = fillFromNeighbours(
      labels.map((l) => (l === -2 ? -1 : l)),
      block.sourcePages[0]!
    )

    const touched = new Set<number>()
    for (let i = 0; i < words.length; i++) {
      if (labels[i] === -2) continue
      const t = leafFor(placed[i]!)
      t.words.push(words[i]!)
      touched.add(placed[i]!)
    }
    if (unplaced > 0) leafFor(block.sourcePages[0]!).unplaced += unplaced
    for (const p of touched) leafFor(p).blocks.push(block.id)
  }

  for (const note of edited.footnotes) {
    const toks = tokens(note.text)
    if (toks.length > 0) leafFor(note.pageIndex).notes.push(...toks)
  }

  // Every read leaf appears, even one that put no words in the body — a
  // title page mined for metadata is still a leaf a reader can be scored on.
  for (const leaf of transcriptions) leafFor(leaf.pageIndex)

  return [...perLeaf.values()].sort((a, b) => a.pageIndex - b.pageIndex)
}
