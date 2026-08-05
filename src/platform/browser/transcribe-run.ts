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
  type ClientConfig
} from '@core/transcribe'
import type { LexiconEntry } from '@core/lexicon'
import type { OrthographyPolicy } from '@core/transcribe'
import { openPdf, renderPage } from './pdf'
import type { OcrWord } from './ocr'

export interface BrowserRunOptions {
  fileData: ArrayBuffer
  ocrWordsByPage: Map<number, OcrWord[]>
  pageText: string[]
  client: ClientConfig
  lexicon: readonly LexiconEntry[]
  orthography: OrthographyPolicy
  normalizeLongS: boolean
  bookContext?: string
  /** Long edge for the image sent to the model — the main cost lever. */
  imageLongEdge?: number
  maxPages?: number
  onProgress?: (p: RunProgress) => void
  signal?: AbortSignal
}

/** Canvas → bare base64 (no data: prefix), which is what the API expects. */
async function toBase64Png(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not encode page image')
  const buffer = await blob.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const CHUNK = 0x8000 // chunked to avoid blowing the argument limit on big pages
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export async function runBrowserTranscription(options: BrowserRunOptions): Promise<RunResult> {
  const doc = await openPdf(options.fileData)
  const total = Math.min(doc.numPages, options.maxPages ?? doc.numPages)
  const longEdge = options.imageLongEdge ?? 1568

  /**
   * Render one page at the DPI that yields the requested long edge, so cost is
   * a function of our setting rather than of the source page's dimensions.
   * The canvas is released before returning; only the base64 survives, and the
   * runner drops that as soon as the page is sent.
   */
  const renderOne = async (pageIndex: number): Promise<string> => {
    const probe = await renderPage(doc, pageIndex, 72)
    const scale = longEdge / Math.max(probe.width, probe.height)
    probe.canvas.width = 0
    probe.canvas.height = 0

    const rendered = await renderPage(doc, pageIndex, Math.max(72, Math.round(72 * scale)))
    try {
      return await toBase64Png(rendered.canvas)
    } finally {
      rendered.canvas.width = 0
      rendered.canvas.height = 0
    }
  }

  // Descriptors only: no page is rendered until the runner asks for it. Doing
  // this eagerly would hold the whole book's images at once (~1 GB for 300
  // pages) and would also make the user wait for every page to render before
  // the first request went out.
  const sources: PageSource[] = []
  for (let i = 0; i < total; i++) {
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
    orthography: options.orthography,
    normalizeLongS: options.normalizeLongS,
    bookContext: options.bookContext,
    onProgress: options.onProgress,
    signal: options.signal
  })
}
