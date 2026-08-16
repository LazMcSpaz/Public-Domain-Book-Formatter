/**
 * Keeping the reading of a scan, so opening a book twice does not read it twice.
 *
 * `runRecon` renders every page, runs Tesseract over it, harvests the book's
 * vocabulary and cuts the word crops. On a three-hundred-page scan that is ten
 * minutes and a warm phone — and it produced exactly the same answer last time,
 * because a PDF does not change. The app was already careful to keep the half
 * of the pipeline that costs money and careless with the half that costs an
 * afternoon; this is the other half.
 *
 * ## What has to be converted
 *
 * A `ReconResult` is full of object URLs, which are meaningless in a later
 * session — they name a Blob in a page that has since been closed. So the
 * record holds the **Blobs**, and rehydrating mints fresh URLs that
 * `releaseRecon` frees exactly as it frees the originals. The Blobs are
 * recovered from the live URLs by fetching them, which costs no re-encoding and
 * keeps `runRecon` free of any knowledge that a cache exists.
 *
 * ## What is deliberately not cached
 *
 * Nothing is written unless the user has agreed to book data being kept on the
 * device — the same answer that governs storing the scan, because someone who
 * declined that did not decline it in order to accept a larger pile of
 * thumbnails instead.
 *
 * Every call degrades to a miss rather than throwing. A cache that fails is a
 * slow session; a cache that lies is a wrong book.
 *
 * Browser-only.
 */
import { reconCacheUsable, reconStamp, type ReconWanted } from '@core/project'
import type { LexiconEntry } from '@core/lexicon'
import type { ImageRegion } from '@core/model'
import { deleteRecon, loadReconRecord, saveRecon } from './run-store'
import type { ReconResult } from './recon'
import type { OcrWord } from './ocr'

/** The stored form: no object URLs, everything structured-cloneable. */
interface StoredRecon {
  key: string
  savedAt: string
  version: number
  dpi: number
  maxPages: number | null
  /** Roughly what this record occupies, so the settings screen can say. */
  bytes: number
  pageCount: number
  words: OcrWord[]
  lexicon: LexiconEntry[]
  pageText: string[]
  crops: Map<string, Blob>
  contextCrops: Map<string, Blob>
  thumbnails: Map<number, Blob>
  illustrations: { region: ImageRegion; ink: number; preview: Blob }[]
}

/** The Blob behind a live object URL. Null if it has already been revoked. */
async function blobOf(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url)
    return await response.blob()
  } catch {
    return null
  }
}

async function blobMap<K>(entries: Iterable<[K, string]>): Promise<Map<K, Blob>> {
  const out = new Map<K, Blob>()
  for (const [key, url] of entries) {
    const blob = await blobOf(url)
    if (blob) out.set(key, blob)
  }
  return out
}

function weigh(record: Omit<StoredRecon, 'bytes'>): number {
  let bytes = 0
  for (const blob of record.crops.values()) bytes += blob.size
  for (const blob of record.contextCrops.values()) bytes += blob.size
  for (const blob of record.thumbnails.values()) bytes += blob.size
  for (const c of record.illustrations) bytes += c.preview.size
  // Word boxes are the other half of the weight and are not Blobs; ~90 bytes a
  // word is close enough for a figure shown to a person.
  return bytes + record.words.length * 90
}

/**
 * Keep this reading against the file it came from.
 *
 * Best-effort in every direction: a browser with storage switched off, a full
 * quota, or a revoked URL all end as `false` rather than as an error the user
 * has to think about. Nothing here is unrecoverable — that is the premise.
 */
export async function saveReconCache(
  key: string,
  result: ReconResult,
  wanted: ReconWanted
): Promise<boolean> {
  if (!key) return false
  try {
    const base = {
      key,
      savedAt: new Date().toISOString(),
      ...reconStamp(wanted),
      pageCount: result.pageCount,
      words: result.words,
      lexicon: result.lexicon,
      pageText: result.pageText,
      crops: await blobMap(result.crops),
      contextCrops: await blobMap(result.contextCrops),
      thumbnails: await blobMap(result.thumbnails),
      illustrations: (
        await Promise.all(
          result.illustrations.map(async (c) => {
            const preview = await blobOf(c.previewUrl)
            return preview ? { region: c.region, ink: c.ink, preview } : null
          })
        )
      ).filter((c): c is { region: ImageRegion; ink: number; preview: Blob } => c !== null)
    }
    return await saveRecon({ ...base, bytes: weigh(base) })
  } catch {
    return false
  }
}

/**
 * The stored reading for a file, as a `ReconResult` ready to use.
 *
 * Returns null on anything unexpected, and *deletes* a record whose stamp does
 * not match rather than leaving it to be rejected again on every open. A stale
 * reading is worth nothing: unlike a transcription it can be rebuilt for free.
 */
export async function loadReconCache(
  key: string,
  wanted: ReconWanted
): Promise<ReconResult | null> {
  if (!key) return null
  const raw = await loadReconRecord(key)
  if (!raw || typeof raw !== 'object') return null
  if (!reconCacheUsable(raw, wanted)) {
    void deleteRecon(key)
    return null
  }

  try {
    const record = raw as StoredRecon
    // One bad field means a record written by something this version does not
    // understand. Reading the scan again is the cheap, correct answer.
    if (!Array.isArray(record.words) || !Array.isArray(record.pageText)) return null
    if (!(record.crops instanceof Map) || !(record.thumbnails instanceof Map)) return null

    const urls = <K>(blobs: Map<K, Blob>): Map<K, string> => {
      const out = new Map<K, string>()
      for (const [k, blob] of blobs) out.set(k, URL.createObjectURL(blob))
      return out
    }

    return {
      pageCount: record.pageCount,
      words: record.words,
      lexicon: record.lexicon ?? [],
      pageText: record.pageText,
      crops: urls(record.crops),
      contextCrops: urls(record.contextCrops ?? new Map()),
      thumbnails: urls(record.thumbnails),
      illustrations: (record.illustrations ?? []).map((c) => ({
        region: c.region,
        ink: c.ink,
        previewUrl: URL.createObjectURL(c.preview)
      }))
    }
  } catch {
    return null
  }
}
