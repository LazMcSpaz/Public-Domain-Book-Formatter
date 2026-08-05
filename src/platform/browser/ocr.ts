/**
 * OCR in the browser via Tesseract.js (replaces the tesseract binary).
 *
 * Under the new design OCR is no longer the source of truth — the vision pass
 * reads the page. OCR's job is to be the *independent witness*: a genuinely
 * different system (not a language model, so no shared blind spots) that
 * supplies word boxes for the coordinate map and a confidence signal we can
 * cross-check the model against. Its disagreement is evidence; a model's
 * opinion of its own work is not.
 *
 * All assets (worker, WASM core, language data) are served locally rather than
 * from a CDN, so the app works offline and doesn't depend on a third party.
 */
import TesseractNamespace from 'tesseract.js/dist/tesseract.esm.min.js'

// The package's `main` is CommonJS with no `module`/`exports` field, so the
// prebuilt ESM bundle is imported directly — and it exposes only a default.
const { createWorker } = TesseractNamespace as {
  createWorker: (lang: string, oem?: number, opts?: Record<string, unknown>) => Promise<OcrWorker>
}

interface OcrWorker {
  recognize(
    image: HTMLCanvasElement,
    opts?: Record<string, unknown>,
    output?: Record<string, unknown>
  ): Promise<{ data: RawOcrData }>
  terminate(): Promise<unknown>
}

interface RawOcrWord {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

interface RawOcrData {
  text: string
  blocks?: { paragraphs?: { lines?: { words?: RawOcrWord[] }[] }[] }[]
}

/** One OCR'd word with the geometry the coordinate map needs. */
export interface OcrWord {
  /** Stable id: `p<page>_w<n>`. Survives serialization (SPEC §2 backbone). */
  id: string
  text: string
  /** Tesseract per-word confidence, 0–100 — a real probability (SPEC §4). */
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
  pageIndex: number
}

export interface OcrPageResult {
  pageIndex: number
  text: string
  words: OcrWord[]
  /** Mean word confidence 0–100. */
  meanConfidence: number
}

/** Where the locally-bundled Tesseract assets live. */
export interface OcrAssetPaths {
  workerPath: string
  corePath: string
  langPath: string
}

/**
 * Asset paths resolved against the app's base URL.
 *
 * These must NOT be root-absolute. A leading slash resolves against the
 * *origin*, which is only correct when the app is served from the domain root.
 * On GitHub Pages it lives at `/<repo>/`, so `/tesseract/worker.min.js` asks
 * for `lazmcspaz.github.io/tesseract/...` and the worker 404s — with the
 * failure surfacing from inside a web worker, where it reads as a mysterious
 * `importScripts` NetworkError rather than a missing file.
 *
 * `BASE_URL` is what Vite substitutes for the configured base, and it always
 * ends in a slash, so this is right in dev ('/') and under a subpath alike.
 */
export const DEFAULT_ASSET_PATHS: OcrAssetPaths = {
  workerPath: `${import.meta.env.BASE_URL}tesseract/worker.min.js`,
  corePath: `${import.meta.env.BASE_URL}tesseract/core`,
  langPath: `${import.meta.env.BASE_URL}tesseract/lang`
}

/**
 * A reusable OCR engine. Creating a worker is expensive (it loads ~14 MB of
 * WASM and language data), so one engine is created per book run and reused
 * across every page, then terminated.
 */
export class OcrEngine {
  private worker: OcrWorker | null = null

  constructor(private readonly assets: OcrAssetPaths = DEFAULT_ASSET_PATHS) {}

  async init(): Promise<void> {
    if (this.worker) return
    this.worker = await createWorker('eng', 1, {
      workerPath: this.assets.workerPath,
      corePath: this.assets.corePath,
      langPath: this.assets.langPath,
      gzip: true
    })
  }

  async recognize(canvas: HTMLCanvasElement, pageIndex: number): Promise<OcrPageResult> {
    if (!this.worker) await this.init()
    const { data } = await this.worker!.recognize(canvas, {}, { blocks: true })
    const words = flattenWords(data, pageIndex)
    const meanConfidence = words.length
      ? words.reduce((sum, w) => sum + w.confidence, 0) / words.length
      : 0
    return { pageIndex, text: data.text ?? '', words, meanConfidence }
  }

  async dispose(): Promise<void> {
    await this.worker?.terminate()
    this.worker = null
  }
}

/**
 * Tesseract.js v7 returns a block→paragraph→line→word tree; the coordinate map
 * wants a flat word list. Exported for testing against fixture data.
 */
export function flattenWords(data: RawOcrData, pageIndex: number): OcrWord[] {
  const words: OcrWord[] = []
  let n = 0
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const w of line.words ?? []) {
          if (!w.text?.trim()) continue
          words.push({
            id: `p${pageIndex}_w${n++}`,
            text: w.text,
            confidence: w.confidence,
            bbox: w.bbox,
            pageIndex
          })
        }
      }
    }
  }
  return words
}
