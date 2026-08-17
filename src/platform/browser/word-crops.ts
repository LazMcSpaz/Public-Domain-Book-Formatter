/**
 * Cutting named words out of a leaf, on demand.
 *
 * Recon pre-crops one word per lexicon entry — a few hundred for a book, made
 * while the page is already rendered and cheap to take. It cannot pre-crop
 * *every* word: a three-hundred-page book is a hundred thousand of them, and
 * the store already holds the thumbnails and the boxes.
 *
 * The review gate needs a different few: the words a cross-check says are
 * missing, which are not known until the vision pass has run and are different
 * on every leaf. So they are cut when the leaf is looked at, from one render of
 * that leaf, and released when the user moves on.
 *
 * One render per leaf, never one per word — which is why this takes the whole
 * list rather than being called in a loop. The gate shows a leaf at a time, so
 * that is one page render per screen.
 *
 * Browser-only.
 */
import { cropToObjectUrl, openPdf, renderPage } from './pdf'

/** A word to cut out, in the coordinate space of the page at `dpi`. */
export interface WordBox {
  id: string
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

/**
 * The DPI the boxes are in.
 *
 * Must match what recon rendered at, because the boxes came from OCR of *that*
 * render and mean nothing at another scale. `RECON_DPI` is the one number both
 * sides agree on; passing it explicitly keeps this module from importing the
 * runner just to read a constant.
 */
export interface CropWordsOptions {
  dpi: number
  /** Pixels of margin around each word, so a crop is readable rather than tight. */
  padding?: number
}

/** A run of words to cut out as one picture, under one name. */
export interface CropGroup {
  /** What the caller will look the crop up by — a discrepancy row's id. */
  id: string
  words: WordBox[]
}

/**
 * The box that contains all of these.
 *
 * A discrepancy is usually several words, and cropping only the first of them
 * shows the reader the word `THE` as evidence for a missing clause — which
 * looks like the app pointing at the wrong thing, and is. The union is the
 * whole phrase where it sits on one line, and the block it occupies where it
 * runs across two; both are the thing the row is actually about.
 */
export function unionBox(words: readonly WordBox[]): WordBox['bbox'] | null {
  if (words.length === 0) return null
  let { x0, y0, x1, y1 } = words[0]!.bbox
  for (const w of words.slice(1)) {
    x0 = Math.min(x0, w.bbox.x0)
    y0 = Math.min(y0, w.bbox.y0)
    x1 = Math.max(x1, w.bbox.x1)
    y1 = Math.max(y1, w.bbox.y1)
  }
  return { x0, y0, x1, y1 }
}

/**
 * Crop each group out of one leaf, as one picture per group.
 *
 * Returns object URLs the caller must revoke — the same contract as every other
 * crop in this app, and the reason the gate releases them when it moves to the
 * next leaf rather than accumulating a book's worth.
 *
 * Best-effort per group: a box that cannot be cut is left out of the map rather
 * than failing the screen. A row without its picture still names what is
 * missing and where it goes, which is more than the count it replaced.
 */
export async function cropWordsFromPage(
  file: Blob,
  pageIndex: number,
  groups: readonly CropGroup[],
  options: CropWordsOptions
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const wanted = groups.filter((g) => g.words.length > 0)
  if (wanted.length === 0) return out

  const doc = await openPdf(file)
  const rendered = await renderPage(doc, pageIndex, options.dpi)
  try {
    for (const group of wanted) {
      const box = unionBox(group.words)
      if (!box) continue
      try {
        out.set(group.id, await cropToObjectUrl(rendered.canvas, box, options.padding ?? 6))
      } catch {
        // A crop is evidence, not load-bearing. Skip a bad box silently.
      }
    }
  } finally {
    rendered.canvas.width = 0
    rendered.canvas.height = 0
  }
  return out
}
