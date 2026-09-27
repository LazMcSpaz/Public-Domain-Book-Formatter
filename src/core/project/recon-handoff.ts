/**
 * A reading of a scan, taken in one browser and handed to another.
 *
 * Recon — render, OCR, harvest — is free and slow: ten minutes of a laptop on
 * a three-hundred-leaf book. The editor's own browser can do that while they
 * are at the desk, and the session that reads the book afterwards should not
 * have to do it again in the driver's. So the finished reading goes up to the
 * shelf beside the book as one file, and the driver loads it into its own
 * recon cache under the book's key.
 *
 * What travels is the part that cannot be had without the ten minutes: every
 * word with its box and confidence, the text of each leaf, the harvested
 * vocabulary, where the words came from and what the file is made of. What
 * does not travel is pixels — word crops, thumbnails, illustration previews —
 * because they are cut from the scan, which is already on the shelf, and
 * sending them would put the size of the book's images into git history for
 * the sake of saving a few seconds of cutting.
 *
 * The rules that matter are the ones the recon cache already keeps, applied at
 * the door:
 *
 *   - **A checkpoint is not a reading.** A tab that died at leaf 660 of 747
 *     has a record that looks complete unless the counts are compared; a
 *     handoff of one is refused, never loaded as the whole book.
 *   - **A different shape of record is refused**, not guessed at. The words
 *     carry fields (`italic`, `bold`) whose absence is indistinguishable from
 *     a book that sets nothing in them, which is why the cache version exists.
 *   - **The stamp travels**: the DPI every box is in and the cleaning preset
 *     the words were read through, so the receiving cache can refuse it on the
 *     same terms it refuses a reading of its own.
 *
 * Pure: a value in, a value or an error out. The compression and the upload
 * are the platform's.
 */
import type { LexiconEntry } from '@core/lexicon'
import { parseShape, type BookShape } from '@core/provenance'
import { parseCleanupPreset, type CleanupPreset } from '@core/image/cleanup'
import { RECON_CACHE_VERSION } from './recon-cache'

export const RECON_HANDOFF_FORMAT = 'pdbf-recon'
/** Bump when this file's own shape changes. The words' shape is `reconVersion`. */
export const RECON_HANDOFF_VERSION = 1
/** Beside `book.json` in the book's directory. Gzipped JSON. */
export const RECON_HANDOFF_FILE = 'recon.json.gz'

/** The path of a book's handed-off reading on the shelf. */
export function reconHandoffPath(dir: string): string {
  return `books/${dir}/${RECON_HANDOFF_FILE}`
}

/** One word as recon boxed it. The same shape as the platform's `OcrWord`. */
export interface HandoffWord {
  id: string
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
  pageIndex: number
  italic?: boolean
  bold?: boolean
}

export interface ReconHandoff {
  format: typeof RECON_HANDOFF_FORMAT
  version: number
  /** The recon cache version the words were written under. */
  reconVersion: number
  /** The run key the book is filed under — what the receiving cache is keyed by. */
  key: string
  fileName: string
  savedAt: string
  dpi: number
  cleanup: CleanupPreset
  pageCount: number
  pagesDone: number
  source: 'ocr' | 'embedded'
  shape?: BookShape
  words: HandoffWord[]
  lexicon: LexiconEntry[]
  pageText: string[]
}

export interface ReconHandoffInput {
  key: string
  fileName: string
  dpi: number
  cleanup: CleanupPreset
  pageCount: number
  source: 'ocr' | 'embedded'
  shape?: BookShape
  words: HandoffWord[]
  lexicon: LexiconEntry[]
  pageText: string[]
  now?: Date
}

/**
 * Build the file from a finished reading.
 *
 * Throws on a reading that is not finished, so a checkpoint cannot be sent up
 * by a caller that forgot to ask.
 */
export function reconHandoff(input: ReconHandoffInput): ReconHandoff {
  if (input.pageText.length !== input.pageCount) {
    throw new Error(
      `The reading covers ${input.pageText.length} of ${input.pageCount} leaves; only a finished reading can be handed on.`
    )
  }
  return {
    format: RECON_HANDOFF_FORMAT,
    version: RECON_HANDOFF_VERSION,
    reconVersion: RECON_CACHE_VERSION,
    key: input.key,
    fileName: input.fileName,
    savedAt: (input.now ?? new Date()).toISOString(),
    dpi: input.dpi,
    cleanup: input.cleanup,
    pageCount: input.pageCount,
    pagesDone: input.pageCount,
    source: input.source,
    ...(input.shape ? { shape: input.shape } : {}),
    words: input.words.map((w) => ({
      id: w.id,
      text: w.text,
      confidence: w.confidence,
      bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 },
      pageIndex: w.pageIndex,
      ...(w.italic !== undefined ? { italic: w.italic } : {}),
      ...(w.bold !== undefined ? { bold: w.bold } : {})
    })),
    lexicon: input.lexicon,
    pageText: input.pageText
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function parseWord(raw: unknown, at: number): HandoffWord {
  const w = raw as Record<string, unknown> | null
  const b = (w?.['bbox'] ?? null) as Record<string, unknown> | null
  if (
    !w ||
    typeof w['id'] !== 'string' ||
    typeof w['text'] !== 'string' ||
    !isNum(w['confidence']) ||
    !isNum(w['pageIndex']) ||
    !b ||
    !isNum(b['x0']) ||
    !isNum(b['y0']) ||
    !isNum(b['x1']) ||
    !isNum(b['y1'])
  ) {
    throw new Error(`Word ${at} of the reading is not a word record.`)
  }
  return {
    id: w['id'],
    text: w['text'],
    confidence: w['confidence'],
    bbox: { x0: b['x0'], y0: b['y0'], x1: b['x1'], y1: b['y1'] },
    pageIndex: w['pageIndex'],
    ...(typeof w['italic'] === 'boolean' ? { italic: w['italic'] } : {}),
    ...(typeof w['bold'] === 'boolean' ? { bold: w['bold'] } : {})
  }
}

/**
 * Read a handed-off reading, or say exactly why it cannot be used.
 *
 * Every refusal is an error with a sentence in it, because the caller is a
 * session deciding whether to run recon itself, and "invalid" does not tell it
 * whether the file is stale, partial or not a reading at all.
 */
export function parseReconHandoff(raw: unknown): ReconHandoff {
  const r = raw as Record<string, unknown> | null
  if (!r || r['format'] !== RECON_HANDOFF_FORMAT) {
    throw new Error('This is not a reading handed off by the app.')
  }
  if (r['version'] !== RECON_HANDOFF_VERSION) {
    throw new Error(
      `The reading is in handoff format ${String(r['version'])}; this app reads ${RECON_HANDOFF_VERSION}.`
    )
  }
  if (r['reconVersion'] !== RECON_CACHE_VERSION) {
    throw new Error(
      `The reading was taken by an older app (recon version ${String(r['reconVersion'])}, now ${RECON_CACHE_VERSION}); its words may lack fields this one relies on. Read the scan again.`
    )
  }
  const cleanup = parseCleanupPreset(r['cleanup'])
  const source = r['source'] === 'ocr' || r['source'] === 'embedded' ? r['source'] : null
  if (
    typeof r['key'] !== 'string' ||
    !r['key'] ||
    typeof r['fileName'] !== 'string' ||
    typeof r['savedAt'] !== 'string' ||
    !isNum(r['dpi']) ||
    !cleanup ||
    !isNum(r['pageCount']) ||
    !isNum(r['pagesDone']) ||
    !source ||
    !Array.isArray(r['words']) ||
    !Array.isArray(r['lexicon']) ||
    !Array.isArray(r['pageText'])
  ) {
    throw new Error('The reading is missing fields it needs.')
  }
  const pageCount = r['pageCount']
  const pagesDone = r['pagesDone']
  const pageText = r['pageText'] as unknown[]
  if (pagesDone < pageCount || pageText.length !== pageCount) {
    throw new Error(
      `The reading stopped at leaf ${Math.min(pagesDone, pageText.length)} of ${pageCount}; a partial reading is not loaded as the whole book.`
    )
  }
  if (!pageText.every((t) => typeof t === 'string')) {
    throw new Error('The reading has a leaf whose text is not text.')
  }
  const shape = r['shape'] === undefined ? null : parseShape(r['shape'])
  return {
    format: RECON_HANDOFF_FORMAT,
    version: RECON_HANDOFF_VERSION,
    reconVersion: RECON_CACHE_VERSION,
    key: r['key'],
    fileName: r['fileName'],
    savedAt: r['savedAt'],
    dpi: r['dpi'],
    cleanup,
    pageCount,
    pagesDone,
    source,
    ...(shape ? { shape } : {}),
    words: (r['words'] as unknown[]).map(parseWord),
    lexicon: r['lexicon'] as LexiconEntry[],
    pageText: pageText as string[]
  }
}
