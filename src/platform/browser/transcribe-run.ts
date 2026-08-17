/**
 * Browser glue for the transcription run.
 *
 * Re-renders each page at the resolution chosen for the model, encodes it, and
 * hands `@core/transcribe` the sources it needs. Page images are produced and
 * released one at a time for the same reason recon does it: a whole book of
 * decoded pages will not fit in a tab.
 */
import {
  runTranscription,
  type PageSource,
  type RunResult,
  type RunProgress,
  type RunOptions,
  type PageTranscription,
  type ClientConfig
} from '@core/transcribe'
import type { LexiconEntry, TermCorrection } from '@core/lexicon'
import type { OrthographyPolicy } from '@core/transcribe'
import { openPdf } from './pdf'
import { renderPageToBase64 } from './page-image'
import type { OcrWord } from './ocr'

export interface BrowserRunOptions {
  fileData: ArrayBuffer | Blob
  ocrWordsByPage: Map<number, OcrWord[]>
  pageText: string[]
  client: ClientConfig
  lexicon: readonly LexiconEntry[]
  /** Misreadings the user corrected at Gate 1. */
  termCorrections?: readonly TermCorrection[]
  orthography: OrthographyPolicy
  normalizeLongS: boolean
  bookContext?: string
  /** Long edge for the image sent to the model — the main cost lever. */
  imageLongEdge?: number
  maxPages?: number
  /** Re-run only these pages (the review gate's "read this again"). */
  onlyPages?: readonly number[]
  onProgress?: (p: RunProgress) => void
  signal?: AbortSignal
  /** Pages a previous run already paid for — skipped, not re-sent. */
  resumeFrom?: readonly PageTranscription[]
  /** Called as pages come in, so a stopped run keeps what it bought. */
  onCheckpoint?: RunOptions['onCheckpoint']
}

export async function runBrowserTranscription(options: BrowserRunOptions): Promise<RunResult> {
  const doc = await openPdf(options.fileData)
  const total = Math.min(doc.numPages, options.maxPages ?? doc.numPages)
  const longEdge = options.imageLongEdge ?? 1568

  const renderOne = (pageIndex: number): Promise<string> =>
    renderPageToBase64(doc, pageIndex, longEdge)

  // Descriptors only: no page is rendered until the runner asks for it. Doing
  // this eagerly would hold the whole book's images at once (~1 GB for 300
  // pages) and would also make the user wait for every page to render before
  // the first request went out.
  const wanted = options.onlyPages ? new Set(options.onlyPages) : null

  const sources: PageSource[] = []
  for (let i = 0; i < total; i++) {
    if (wanted && !wanted.has(i)) continue
    sources.push({
      pageIndex: i,
      image: () => renderOne(i),
      ocrText: options.pageText[i] ?? '',
      ocrWords: options.ocrWordsByPage.get(i) ?? []
    })
  }

  return runTranscription(sources, {
    client: options.client,
    lexicon: options.lexicon,
    ...(options.termCorrections ? { termCorrections: options.termCorrections } : {}),
    orthography: options.orthography,
    normalizeLongS: options.normalizeLongS,
    bookContext: options.bookContext,
    onProgress: options.onProgress,
    onCheckpoint: options.onCheckpoint,
    resumeFrom: options.resumeFrom,
    signal: options.signal
  })
}
