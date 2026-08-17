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
import { buildLexicon, contextBox, type LexiconEntry, type LexiconToken } from '@core/lexicon'
import {
  openPdf,
  renderPage,
  cropToObjectUrl,
  thumbnailToBlob,
  blobOfUrl,
  looksScanned,
  extractPageWords
} from './pdf'
import { detectIllustrations, type RegionCandidate } from './illustrations'
import { OcrEngine, type OcrWord, type OcrAssetPaths } from './ocr'

/**
 * The resolution pages are read at, and every pixel coordinate recon produces.
 *
 * Named rather than inlined because a stored reading is only reusable at the
 * DPI it was taken under — word boxes, crops and illustration regions are all
 * in these pixels — so the cache has to be able to say what it was made with.
 */
export const RECON_DPI = 300

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
  /**
   * A wider cut of the same word, showing it among its neighbours on the line.
   *
   * Shown on hover at the term grid: a word alone is enough to read the letters
   * and not always enough to judge them — `mineralls` could be the book's own
   * spelling or OCR doubling an `l`, and the sentence around it settles that.
   * Taken while the page is already rendered for the word crop, so it costs an
   * encode and nothing else.
   */
  contextCrops: Map<string, string>
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
  /**
   * Where the words came from.
   *
   * `embedded` means the file supplied its own text and no OCR was run — a
   * born-digital PDF, which is a different kind of source and should be told
   * apart from a scan everywhere the difference matters.
   */
  source: 'ocr' | 'embedded'
}

/**
 * The leaves already read, handed back in to carry on from.
 *
 * Everything here is per-leaf and additive, which is what makes resuming a
 * matter of starting the loop later rather than of merging two readings. The
 * lexicon and the word crops are *not* carried: both are derived from the words
 * at the end and cost seconds, where re-OCR-ing the leaves costs minutes.
 */
export interface ReconPartial {
  pagesDone: number
  words: OcrWord[]
  pageText: string[]
  thumbnails: Map<number, Blob>
  illustrations: { region: RegionCandidate['region']; ink: number; preview: Blob }[]
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
  /** Leaves read on an earlier visit, to be carried on from rather than redone. */
  resumeFrom?: ReconPartial | null
  /**
   * Called every `checkpointEvery` leaves with everything read so far.
   *
   * The mitigation for the thing a wake lock cannot fix: a phone that freezes
   * the tab anyway, or a browser that discards it under memory pressure. What
   * is handed over is Blobs rather than object URLs, because a URL names a Blob
   * in a page that may not exist by the time anyone reads the record.
   */
  onCheckpoint?: (partial: ReconPartial) => void
  /** Leaves between checkpoints. Default 20. */
  checkpointEvery?: number
  /**
   * Read the PDF's own text instead of running OCR over pictures of it.
   *
   * Decided by `looksScanned` rather than passed by a caller's guess: a page
   * that is a photograph has to be OCR'd whatever text is laid over it, and a
   * page that is not was typeset from real characters that are simply *there*.
   * Left undefined the question is asked here.
   */
  useEmbeddedText?: boolean
}

export async function runRecon(
  fileData: ArrayBuffer | Blob,
  options: ReconOptions = {}
): Promise<ReconResult> {
  const {
    dpi = RECON_DPI,
    cropLimit = 60,
    onProgress,
    signal,
    resumeFrom = null,
    onCheckpoint,
    checkpointEvery = 20
  } = options

  const doc = await openPdf(fileData)
  const total = Math.min(doc.numPages, options.maxPages ?? doc.numPages)

  // Is this a photograph of a book, or a book? Asked once, structurally, before
  // ten minutes are spent OCR-ing text the file was carrying all along.
  const embedded =
    options.useEmbeddedText ??
    (await looksScanned(doc).then((m) => !m.scanned && m.textPerPage > 200))

  // Tesseract is a few seconds and a worker to start. A book that needs no OCR
  // should not pay for it.
  const engine = embedded ? null : new OcrEngine(options.assets)
  await engine?.init()

  // Whatever an earlier visit got through, if it was reading the same book the
  // same way. `from` is the first leaf this run has to do itself.
  const from = Math.max(0, Math.min(resumeFrom?.pagesDone ?? 0, total))
  const words: OcrWord[] = [...(resumeFrom?.words ?? [])]
  const pageText: string[] = [...(resumeFrom?.pageText ?? [])]
  const illustrations: RegionCandidate[] = (resumeFrom?.illustrations ?? []).map((c) => ({
    region: c.region,
    ink: c.ink,
    previewUrl: URL.createObjectURL(c.preview)
  }))
  // The Blobs are kept beside the object URLs made from them, so a checkpoint
  // is assembled from references rather than by reading every thumbnail back
  // out of its URL — which would be O(n²) work over a long book.
  const thumbBlobs = new Map<number, Blob>(resumeFrom?.thumbnails ?? [])
  const thumbnails = new Map<number, string>()
  for (const [page, blob] of thumbBlobs) thumbnails.set(page, URL.createObjectURL(blob))
  const illustrationBlobs: { region: RegionCandidate['region']; ink: number; preview: Blob }[] = [
    ...(resumeFrom?.illustrations ?? [])
  ]
  // Word boxes are kept (tiny) so crops can be re-rendered on demand; the page
  // canvases themselves are not retained.
  const boxesByPage = new Map<number, OcrWord[]>()
  for (const w of words) {
    const list = boxesByPage.get(w.pageIndex) ?? []
    list.push(w)
    boxesByPage.set(w.pageIndex, list)
  }

  const checkpoint = (pagesDone: number): void =>
    onCheckpoint?.({
      pagesDone,
      words,
      pageText,
      thumbnails: thumbBlobs,
      illustrations: illustrationBlobs
    })

  try {
    for (let i = from; i < total; i++) {
      if (signal?.aborted) throw new Error('Cancelled')

      onProgress?.({ page: i + 1, total, phase: 'rendering' })
      const rendered = await renderPage(doc, i, dpi)

      onProgress?.({ page: i + 1, total, phase: 'ocr' })
      // The file's own words where it has them, Tesseract's where it does not.
      // Shaped identically, so nothing after this point can tell the difference
      // or has to.
      const result = engine
        ? await engine.recognize(rendered.canvas, i)
        : await extractPageWords(doc, i, dpi).then((e) => ({
            words: e.words,
            text: e.text,
            meanConfidence: 100
          }))

      words.push(...result.words)
      pageText[i] = result.text
      boxesByPage.set(i, result.words)

      // Every page gets a thumbnail: front matter needs one for the identity
      // gate, and any page can later be flagged for review, where the scan is
      // the evidence. Thumbnails are small (~200px wide) so a whole book of
      // them is cheap compared with holding page canvases.
      const thumb = await thumbnailToBlob(rendered.canvas)
      thumbBlobs.set(i, thumb)
      thumbnails.set(i, URL.createObjectURL(thumb))

      // While the page is still in hand. Doing this later would mean rendering
      // every page a second time to find out most of them have no pictures.
      const found = await detectIllustrations(rendered.canvas, i, result.words)
      illustrations.push(...found)
      for (const c of found) {
        const preview = await blobOfUrl(c.previewUrl)
        if (preview) illustrationBlobs.push({ region: c.region, ink: c.ink, preview })
      }

      onProgress?.({ page: i + 1, total, phase: 'ocr', meanConfidence: result.meanConfidence })

      // Release the page before the next one is rendered.
      rendered.canvas.width = 0
      rendered.canvas.height = 0

      // Every so often, not every leaf: a checkpoint is a structured clone of
      // everything read so far, and writing one per page would spend more time
      // in storage than in Tesseract.
      if ((i + 1) % checkpointEvery === 0 && i + 1 < total) checkpoint(i + 1)
    }
    checkpoint(total)

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
    const contextCrops = new Map<string, string>()
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
        try {
          const wider = contextBox(w, boxesByPage.get(pageIndex) ?? [])
          contextCrops.set(w.id, await cropToObjectUrl(rendered.canvas, wider, 0))
        } catch {
          // Same rule. The word crop above is the one that has to be there.
        }
      }
      rendered.canvas.width = 0
      rendered.canvas.height = 0
    }

    onProgress?.({ page: total, total, phase: 'done' })
    return {
      pageCount: doc.numPages,
      words,
      lexicon,
      crops,
      contextCrops,
      thumbnails,
      illustrations,
      pageText,
      source: embedded ? 'embedded' : 'ocr'
    }
  } finally {
    await engine?.dispose()
  }
}

/** Release every object URL a recon produced. */
export function releaseRecon(result: ReconResult): void {
  for (const url of result.crops.values()) URL.revokeObjectURL(url)
  for (const url of result.contextCrops.values()) URL.revokeObjectURL(url)
  for (const url of result.thumbnails.values()) URL.revokeObjectURL(url)
  for (const c of result.illustrations) URL.revokeObjectURL(c.previewUrl)
}
