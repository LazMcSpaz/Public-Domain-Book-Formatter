/**
 * The recon stage: render → OCR → harvest, one page at a time.
 *
 * This is the free, local pass that runs before anything is spent on the model.
 * It produces the coordinate-map words, the book's lexicon, and the word crops
 * that back the Gate 1 review grid.
 *
 * Memory discipline is the point of the loop shape: each page's canvas is
 * rendered, consumed, and dropped before the next is created, so peak usage is
 * one page (~19 MB) rather than the whole book (~5.8 GB for 300 pages).
 */
import { buildLexicon, type LexiconEntry, type LexiconToken } from '@core/lexicon'
import { openPdf, renderPage, cropToObjectUrl, thumbnailToObjectUrl } from './pdf'
import { detectIllustrations, type RegionCandidate } from './illustrations'
import { OcrEngine, type OcrWord, type OcrAssetPaths } from './ocr'

export interface ReconProgress {
  page: number
  total: number
  phase: 'rendering' | 'ocr' | 'harvesting' | 'done'
  meanConfidence?: number
}

export interface ReconResult {
  pageCount: number
  words: OcrWord[]
  lexicon: LexiconEntry[]
  /** tokenId → object URL of that word's pixels (review-grid evidence). */
  crops: Map<string, string>
  /** pageIndex → object URL of a page thumbnail (front-matter review). */
  thumbnails: Map<number, string>
  /**
   * Candidate illustrations, in page order, each with a crop to judge it by.
   *
   * Found here rather than later because the page is already rendered: the
   * detector reads the OCR word boxes that were just produced, so this costs
   * nothing beyond the ink test. They are candidates, not decisions — every one
   * is reviewed at the structure gate (SPEC §6, low trust).
   */
  illustrations: RegionCandidate[]
  /** Full OCR text per page, used later as the model's cross-check witness. */
  pageText: string[]
}

export interface ReconOptions {
  dpi?: number
  /** Cap pages processed — used by the "try a few pages first" path. */
  maxPages?: number
  /** How many top lexicon terms get a word crop rendered. Default 60. */
  cropLimit?: number
  assets?: OcrAssetPaths
  onProgress?: (p: ReconProgress) => void
  signal?: AbortSignal
}

export async function runRecon(
  fileData: ArrayBuffer | Blob,
  options: ReconOptions = {}
): Promise<ReconResult> {
  const { dpi = 300, cropLimit = 60, onProgress, signal } = options

  const doc = await openPdf(fileData)
  const total = Math.min(doc.numPages, options.maxPages ?? doc.numPages)

  const engine = new OcrEngine(options.assets)
  await engine.init()

  const words: OcrWord[] = []
  const pageText: string[] = []
  const thumbnails = new Map<number, string>()
  const illustrations: RegionCandidate[] = []
  // Word boxes are kept (tiny) so crops can be re-rendered on demand; the page
  // canvases themselves are not retained.
  const boxesByPage = new Map<number, OcrWord[]>()

  try {
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new Error('Cancelled')

      onProgress?.({ page: i + 1, total, phase: 'rendering' })
      const rendered = await renderPage(doc, i, dpi)

      onProgress?.({ page: i + 1, total, phase: 'ocr' })
      const result = await engine.recognize(rendered.canvas, i)

      words.push(...result.words)
      pageText[i] = result.text
      boxesByPage.set(i, result.words)

      // Every page gets a thumbnail: front matter needs one for the identity
      // gate, and any page can later be flagged for review, where the scan is
      // the evidence. Thumbnails are small (~200px wide) so a whole book of
      // them is cheap compared with holding page canvases.
      thumbnails.set(i, await thumbnailToObjectUrl(rendered.canvas))

      // While the page is still in hand. Doing this later would mean rendering
      // every page a second time to find out most of them have no pictures.
      illustrations.push(...(await detectIllustrations(rendered.canvas, i, result.words)))

      onProgress?.({ page: i + 1, total, phase: 'ocr', meanConfidence: result.meanConfidence })

      // Release the page before the next one is rendered.
      rendered.canvas.width = 0
      rendered.canvas.height = 0
    }

    // --- harvest the book's vocabulary from everything OCR saw ---
    onProgress?.({ page: total, total, phase: 'harvesting' })
    const tokens: LexiconToken[] = words.map((w) => ({
      text: w.text,
      confidence: w.confidence,
      pageIndex: w.pageIndex,
      tokenId: w.id
    }))
    const lexicon = buildLexicon(tokens)

    // --- render crops for the terms that will actually be reviewed ---
    const crops = new Map<string, string>()
    const wanted = lexicon.slice(0, cropLimit)
    const pagesNeeded = new Set<number>()
    for (const e of wanted) {
      const w = e.sampleTokenId ? words.find((x) => x.id === e.sampleTokenId) : undefined
      if (w) pagesNeeded.add(w.pageIndex)
    }
    for (const pageIndex of [...pagesNeeded].sort((a, b) => a - b)) {
      if (signal?.aborted) throw new Error('Cancelled')
      const rendered = await renderPage(doc, pageIndex, dpi)
      for (const e of wanted) {
        const w = e.sampleTokenId
          ? boxesByPage.get(pageIndex)?.find((x) => x.id === e.sampleTokenId)
          : undefined
        if (!w) continue
        try {
          crops.set(w.id, await cropToObjectUrl(rendered.canvas, w.bbox))
        } catch {
          // A crop is evidence, not load-bearing — skip a bad box silently.
        }
      }
      rendered.canvas.width = 0
      rendered.canvas.height = 0
    }

    onProgress?.({ page: total, total, phase: 'done' })
    return { pageCount: doc.numPages, words, lexicon, crops, thumbnails, illustrations, pageText }
  } finally {
    await engine.dispose()
  }
}

/** Release every object URL a recon produced. */
export function releaseRecon(result: ReconResult): void {
  for (const url of result.crops.values()) URL.revokeObjectURL(url)
  for (const url of result.thumbnails.values()) URL.revokeObjectURL(url)
  for (const c of result.illustrations) URL.revokeObjectURL(c.previewUrl)
}
