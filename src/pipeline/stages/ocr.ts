/**
 * OCR stage (SPEC §3 OCR; SPEC §2 backbone) — REAL.
 *
 * For each extracted page image, runs Tesseract (hOCR config) via the wrapper,
 * reads the produced `.hocr`, and parses it with `@core/hocr` `parseHocr` into
 * `SourcePage`s. Words from all pages are merged (with corrected pageIndex/id),
 * then turned into an initial coordinate map (`MappingEntry[]`) and OCR flags.
 *
 * Output-offset convention for the coordinate map:
 *   The cleaned/markdown output text is modeled, at this stage, as the running
 *   concatenation of every word's text separated by a single space. Word k
 *   therefore occupies output offsets [start, start+len) where `start` is the
 *   cumulative length of all prior words plus their separating spaces, and
 *   `len` is the word's character length. `OutputRange.end` is exclusive. This
 *   is a deliberately simple, document-order mapping that later stages
 *   (cleanup/structure) refine as they edit the text.
 */
import * as fs from 'node:fs/promises'
import type {
  Flag,
  MappingEntry,
  SourcePage,
  WordToken,
} from '@core/model'
import { parseHocr, flagsFromPages } from '@core/hocr'
import { ocrToHocr } from '@tooling/wrappers'
import type { PipelineContext, Stage } from '../stage'

/** Read an hOCR file; return '' if it isn't present (e.g. hermetic tests). */
async function readHocr(hocrPath: string): Promise<string> {
  try {
    return await fs.readFile(hocrPath, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Build coordinate-map entries from ordered pages using the running-concat
 * convention documented above. Returns the entries; the consumed offset is
 * implicit in the entries themselves.
 */
export function buildCoordinateMap(pages: SourcePage[]): MappingEntry[] {
  const entries: MappingEntry[] = []
  let cursor = 0
  for (const page of pages) {
    for (const word of page.words) {
      const start = cursor
      const end = start + word.text.length
      entries.push({
        tokenId: word.id,
        pageIndex: word.pageIndex,
        bbox: word.bbox,
        output: { start, end },
      })
      // +1 for the single separating space between words.
      cursor = end + 1
    }
  }
  return entries
}

export const ocrStage: Stage = {
  name: 'ocr',
  async run(ctx: PipelineContext): Promise<void> {
    const sourcePages = ctx.pages ?? []
    const merged: SourcePage[] = []

    for (let i = 0; i < sourcePages.length; i++) {
      const src = sourcePages[i]!
      if (!src.imagePath) {
        merged.push(src)
        continue
      }
      const outBase = src.imagePath.replace(/\.[^.]+$/, '')
      const hocrPath = await ocrToHocr(src.imagePath, outBase, {}, ctx.run)
      const hocr = await readHocr(hocrPath)
      const parsed = parseHocr(hocr)
      const first = parsed[0]

      if (!first) {
        // No words recognized for this page; keep the extract-stage record.
        merged.push(src)
        continue
      }

      // parseHocr numbers pages/words from 0 per-document; re-key to this page's
      // global index so ids stay unique across the merged document.
      const words: WordToken[] = first.words.map((w, n) => ({
        ...w,
        id: `p${i}_w${n}`,
        pageIndex: i,
      }))

      merged.push({
        ...src,
        index: i,
        width: first.width || src.width,
        height: first.height || src.height,
        words,
      })
    }

    ctx.pages = merged
    if (ctx.document) ctx.document.pages = merged

    ctx.coordinateMap = buildCoordinateMap(merged)
    const ocrFlags: Flag[] = flagsFromPages(merged)
    ctx.flags = [...(ctx.flags ?? []), ...ocrFlags]
  },
}
