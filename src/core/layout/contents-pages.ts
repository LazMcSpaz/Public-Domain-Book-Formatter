/**
 * The original's page references, set to this edition's pages.
 *
 * The analytical contents of *The Mahatma Letters* closes every group of
 * topics on a page of the 1923 printing: `Dyan Chohans—…—the Universal Mind;
 * 54.` Printed as it stands, that sends a reader of this edition to the wrong
 * page; dropped, it takes away the half of the contents that says where
 * things are. The editor asked for the numbers to be updated, so each one is
 * answered here, from the layout that prints it.
 *
 * What a reference means is "the page where this group of topics is", and in
 * this edition that is **the page on which the first word of that 1923 page
 * falls** — exactly, not to within a page. Three facts make it exact, each
 * measured rather than estimated:
 *
 *  - **which leaf** carries the original's page, off the folios the leaves
 *    print (`folioRuns`, carried in the document as `folios`);
 *  - **which word** of the assembled book that leaf's text begins at, which
 *    is the start of a block or, where assembly joined a paragraph across the
 *    leaf, the seam inside it (`leafStart`);
 *  - **which page** that word was set on: the block's opening page, or the
 *    last page it ran on to at or before that word (`BlockPage.turns`).
 *
 * A page of the original with no text of its own (a blank, a plate) is
 * answered by the page its picture was set on, where it has one, and
 * otherwise by the page the next leaf's text begins on — what a reader turning
 * to it would come to next. A page the book never prints a folio for, or that
 * lies beyond the last text, has no answer, and a reference to it is printed
 * without a number and reported (`layoutWithToc`), never guessed.
 *
 * Pure.
 */
import { leafOfFolio, leafStart, type BookDocument } from '@core/assemble'
import { abbreviatedRange, type ContentsReference } from '@core/pages'
import type { BlockPage, LaidOutBook } from './types'

/** The page a word of a block was set on. */
export function pageOfWord(entry: BlockPage, word: number): number {
  let page = entry.pageIndex
  for (const turn of entry.turns ?? []) if (turn.word <= word) page = turn.pageIndex
  return page
}

/** Answers "which page of this edition" for pages of the original, against one layout. */
export interface ContentsPages {
  /** The page index the first word of the original's page `folio` fell on, or null. */
  pageOfFolio(folio: number): number | null
  /** What a reference prints in this edition — a page or a range — or null. */
  printed(ref: ContentsReference, original: string): string | null
}

export function contentsPages(
  doc: Pick<BookDocument, 'blocks' | 'illustrations' | 'folios'>,
  laid: Pick<LaidOutBook, 'pages' | 'blockPages' | 'imagesPlaced'>
): ContentsPages {
  const blockPages = new Map(laid.blockPages.map((b) => [b.blockId, b]))
  const lastLeaf = doc.blocks.reduce((max, b) => Math.max(max, ...b.sourcePages), -1)
  const pictures = new Map<number, number>()
  const placed = new Map(laid.imagesPlaced.map((i) => [i.id, i.pageIndex]))
  for (const illustration of doc.illustrations) {
    const at = placed.get(illustration.id)
    if (
      at !== undefined &&
      illustration.origin !== 'supplied' &&
      !pictures.has(illustration.pageIndex)
    ) {
      pictures.set(illustration.pageIndex, at)
    }
  }

  const order = new Map(doc.blocks.map((b, i) => [b.id, i]))
  /**
   * The page a word of a block was set on. A block the layout set as part of
   * another — `SECTION II` over its title, set small above it as one opening —
   * has no page of its own, and is on the page of the block it was set with.
   */
  const pageOfBlockWord = (blockId: string, word: number): number | null => {
    const entry = blockPages.get(blockId)
    if (entry) return pageOfWord(entry, word)
    for (let i = (order.get(blockId) ?? doc.blocks.length) + 1; i < doc.blocks.length; i++) {
      const next = blockPages.get(doc.blocks[i]!.id)
      if (next) return next.pageIndex
    }
    return null
  }

  const pageOfLeaf = (leaf: number): number | null => {
    for (let l = leaf; l <= lastLeaf; l++) {
      const start = leafStart(doc.blocks, l)
      if (start) return pageOfBlockWord(start.blockId, start.word)
      // No text of its own: a picture, where it has one, is what it holds.
      if (l === leaf && pictures.has(l)) return pictures.get(l)!
    }
    return null
  }

  const pageOfFolio = (folio: number): number | null => {
    const leaf = leafOfFolio(doc.folios ?? [], folio)
    return leaf === null ? null : pageOfLeaf(leaf)
  }

  return {
    pageOfFolio,
    printed(ref, original) {
      const from = pageOfFolio(ref.from)
      if (from === null) return null
      const first = laid.pages[from]?.folio ?? null
      if (first === null) return null
      const to = ref.to === ref.from ? from : pageOfFolio(ref.to)
      const last = to === null ? null : (laid.pages[to]?.folio ?? null)
      // A range keeps the book's own sign; a range whose end has no page is
      // the page it begins on, which is where the reader is sent first.
      const separator = /[–]/u.test(original.slice(ref.start, ref.end)) ? '–' : '-'
      return last === null || to! < from ? first : abbreviatedRange(first, last, separator)
    }
  }
}

/**
 * A synopsis with its references set: the k-th reference replaced by
 * `printed[k]`, and one with nothing to print taken out with the semicolon
 * that introduced it — `Test; 1. Solomons` becomes `Test. Solomons`, the stop
 * that closed the group staying where it was. `printed` null takes every
 * reference out, which is the contents a layout is measured with before any
 * number is known.
 */
export function synopsisWithPages(
  text: string,
  refs: readonly ContentsReference[],
  printed: readonly (string | null)[] | null
): string {
  let out = ''
  let at = 0
  refs.forEach((ref, k) => {
    const value = printed?.[k] ?? null
    if (value === null) {
      const lead = /;\s*$/u.exec(text.slice(at, ref.start))
      out += text.slice(at, lead ? ref.start - lead[0].length : ref.start)
    } else {
      out += text.slice(at, ref.start) + value
    }
    at = ref.end
  })
  return out + text.slice(at)
}
