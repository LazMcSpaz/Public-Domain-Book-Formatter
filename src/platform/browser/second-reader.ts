/**
 * A second OCR engine, so every scanned book has a witness.
 *
 * `@core/witness` does the valuable part — two machine readings of a leaf
 * side by side, the mechanical disagreements settled without anyone looking,
 * the substantive ones handed back worst first — and until now the second
 * reading came only from archive.org's OCR layer or a Gutenberg text, so a
 * book with neither had one reader. This is a second reader that is not a
 * language model and not Tesseract: PaddleOCR's detection and recognition
 * models, run in the browser through ONNX Runtime Web, with the weights
 * vendored under `public/paddle/` (see the README there).
 *
 * Three rules, from `docs/PLAN-second-reader.md`:
 *
 * - **It reads the original render.** Never a cleaned one: two readers that
 *   share a preprocessing step share its blind spots, and independence is
 *   the whole point of a witness.
 * - **Lines into reading order is pure core** (`@core/witness/reading-order`),
 *   built on the draft's own column geometry rather than a second opinion.
 * - **Loaded lazily.** The engine, its runtime and its weights are fetched
 *   the first time a leaf is read; a wizard user who never asks pays
 *   nothing for it.
 *
 * WASM only. Headless Chromium in a session container has no WebGPU, and a
 * reading that changed with the execution provider would be two readers
 * under one name. Single-threaded too, since the page is not cross-origin
 * isolated and ONNX Runtime pins `numThreads` to 1 without it.
 */
import { readingOrder, type TextBox } from '@core/witness/reading-order'
// Through the package's own export map, which is the only door it leaves
// open to the file; a deep `dist/` path is refused by Vite. The default build
// of `onnxruntime-web` can fetch the binary and its JavaScript glue from
// wherever it is told; both are named here so neither comes from a CDN.
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'

/** The tiers vendored under `public/paddle/`. */
export const SECOND_READER_TIERS = ['tiny', 'small'] as const
export type SecondReaderTier = (typeof SECOND_READER_TIERS)[number]

/** The model id a cached reading is keyed by; changes when the weights do. */
export function secondReaderModelId(tier: SecondReaderTier): string {
  // `per-box`: see `serviceFor`. A reading taken with the package's default
  // strategy is a different reading, and naming it the same would serve it
  // from the cache as though it were this one.
  return `ppu-paddle-ocr@6.6.0/pp-ocrv6-${tier}/per-box`
}

export interface SecondReading {
  pageIndex: number
  /** Lines in reading order, joined with newlines — what `second.json` carries. */
  text: string
  lines: TextBox[]
  /** Mean line confidence, 0–1 as the engine gives it. */
  meanConfidence: number
  /** Milliseconds the engine took on this leaf. */
  ms: number
  model: string
}

interface Service {
  initialize(): Promise<void>
  recognize(
    image: HTMLCanvasElement,
    options: { flatten: true }
  ): Promise<{
    text: string
    results: {
      text: string
      box: { x: number; y: number; width: number; height: number }
      confidence: number
    }[]
  }>
  destroy(): Promise<void>
}

/** One engine per tier, created on first use and kept for the tab's life. */
const services = new Map<SecondReaderTier, Promise<Service>>()

async function serviceFor(tier: SecondReaderTier): Promise<Service> {
  let pending = services.get(tier)
  if (!pending) {
    pending = (async () => {
      // The runtime first, and its wasm path set before the engine's module
      // is so much as imported: that module sets a CDN path at import time
      // unless one is already there, and this app fetches nothing from a CDN
      // at run time. The binary is served as a hashed asset of this app.
      const ort = await import('onnxruntime-web')
      ort.env.wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortMjsUrl }
      ort.env.wasm.numThreads = 1
      const paddle = await import('ppu-paddle-ocr/web')
      const base = `${import.meta.env.BASE_URL}paddle/${tier}/`
      const service = new paddle.PaddleOcrService({
        model: {
          detection: `${base}det.ort`,
          recognition: `${base}rec.ort`,
          charactersDictionary: `${base}dict.txt`
        },
        // `.ort` files are already optimised; re-optimising costs time and
        // changes nothing, per the models repository's own note.
        session: { graphOptimizationLevel: 'disabled', executionProviders: ['wasm'] },
        processing: { engine: 'canvas-native' },
        // Each detected box read on its own. The package's default,
        // `per-line`, merges every box sharing a line's height before reading
        // it, and a scan carries one box that shares every line's height: the
        // tall region the detector draws over a leaf's margin, 794 by 1740
        // pixels on Isis Unveiled. Merged with it, every body line it spans
        // became one huge crop, squashed to the recogniser's 48 pixels and
        // read as nothing — twenty-nine consecutive lines of leaf 304 came back
        // empty and were dropped, while the footnotes below it read cleanly.
        // That is what the Isis agreement of 32.8% was measuring. Costs about
        // two and a half times the time a leaf; see the second-reader ledger.
        // The empty dictionary is the package's own default: the dictionary
        // comes from `model.charactersDictionary` above.
        recognition: { strategy: 'per-box', charactersDictionary: [] }
      }) as unknown as Service
      await service.initialize()
      return service
    })()
    services.set(tier, pending)
  }
  return pending
}

/**
 * Read one rendered leaf with the second reader.
 *
 * The canvas is the original render at the recon DPI, untouched; the
 * engine's line boxes come back in its coordinates and are put into
 * reading order by the core rule.
 */
export async function readLeafSecond(
  canvas: HTMLCanvasElement,
  pageIndex: number,
  tier: SecondReaderTier = 'tiny'
): Promise<SecondReading> {
  const service = await serviceFor(tier)
  const t0 = performance.now()
  const result = await service.recognize(canvas, { flatten: true })
  const ms = performance.now() - t0
  const lines: TextBox[] = result.results
    .filter((r) => r.text.trim() !== '')
    .map((r) => ({
      text: r.text,
      x: r.box.x,
      y: r.box.y,
      width: r.box.width,
      height: r.box.height,
      confidence: r.confidence
    }))
  const meanConfidence =
    lines.length === 0 ? 0 : lines.reduce((n, l) => n + (l.confidence ?? 0), 0) / lines.length
  return {
    pageIndex,
    text: readingOrder(lines),
    lines,
    meanConfidence,
    ms,
    model: secondReaderModelId(tier)
  }
}

/** Release the engines, for a tab that is done reading. */
export async function disposeSecondReader(): Promise<void> {
  for (const pending of services.values()) {
    try {
      await (await pending).destroy()
    } catch {
      /* already gone */
    }
  }
  services.clear()
}
