/**
 * Put this browser's reading of a scan on the shelf, for a session to pick up.
 *
 * The rules are `@core/project/recon-handoff`'s; this is the gzip and the
 * write. Gzipped because the words of a long book are tens of megabytes of
 * JSON that compress about five to one, and the shelf is a repository that
 * keeps every version it is ever given.
 *
 * Only a book the shelf already holds gets one. The directory is asked of the
 * listing, and a book whose card is not there would have its reading written
 * into a directory of its own with no book in it — a stray nobody could open.
 */
import { reconHandoff, reconHandoffPath, toBase64, type HandoffWord } from '@core/project'
import type { CleanupPreset } from '@core/image/cleanup'
import type { ShelfConfig } from '@core/sync'
import type { ReconResult } from './recon'
import { getBytes, putFile, shelfDirFor, shelfHas } from './shelf'

export type HandoffOutcome =
  { sent: true; path: string; bytes: number } | { sent: false; reason: string }

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function pushReconToShelf(
  config: ShelfConfig,
  key: string,
  fileName: string,
  result: ReconResult,
  wanted: { dpi: number; cleanup: CleanupPreset }
): Promise<HandoffOutcome> {
  const dir = await shelfDirFor(config, key)
  if (!(await shelfHas(config, `books/${dir}/about.json`))) {
    return { sent: false, reason: 'the book is not on the shelf yet' }
  }
  const handoff = reconHandoff({
    key,
    fileName,
    dpi: wanted.dpi,
    cleanup: wanted.cleanup,
    pageCount: result.pageCount,
    source: result.source,
    ...(result.shape ? { shape: result.shape } : {}),
    words: result.words as HandoffWord[],
    lexicon: result.lexicon,
    pageText: result.pageText
  })
  const bytes = await gzip(JSON.stringify(handoff))
  const path = reconHandoffPath(dir)
  await putFile(
    config,
    path,
    toBase64(bytes),
    `${fileName}: the scan read in the browser (${result.pageCount} leaves)`
  )
  return { sent: true, path, bytes: bytes.length }
}

export interface ShelfReadProgress {
  /** Leaves read so far, and of how many. Zero of zero while the scan comes down. */
  page: number
  total: number
  phase: 'fetching' | 'rendering' | 'ocr' | 'harvesting' | 'sending' | 'done'
  /** Leaves an earlier, interrupted run had already read. */
  resumedAt: number
}

/**
 * Read one book's scan straight off the shelf, and put the reading back beside
 * it. The queue's unit of work, and the one-book button's too.
 *
 * Nothing of the wizard is involved: no run is opened, no gate is entered, and
 * the tab can be left. What makes that safe to leave is the checkpoint — every
 * twenty leaves the reading so far is written to this device under the book's
 * key, and a run that finds one carries on from it. So a closed lid or a
 * reload costs the leaves since the last checkpoint, not the book.
 */
export async function readScanFromShelf(
  config: ShelfConfig,
  about: { key: string; fileName: string; scanPath: string | null },
  options: {
    wanted: { dpi: number; maxPages: null; cleanup: CleanupPreset }
    onProgress?: (p: ShelfReadProgress) => void
    signal?: AbortSignal
  }
): Promise<HandoffOutcome> {
  const { wanted, onProgress, signal } = options
  if (!about.scanPath) return { sent: false, reason: 'the scan is not on the shelf' }

  const { runRecon, releaseRecon } = await import('./recon')
  const { loadReconCache, loadReconCheckpoint, saveReconCache, saveReconCheckpoint } =
    await import('./recon-cache')

  onProgress?.({ page: 0, total: 0, phase: 'fetching', resumedAt: 0 })
  const fileName = about.fileName
  // A reading this device already finished is sent as it is.
  const cached = await loadReconCache(about.key, wanted)
  let result = cached
  let resumedAt = 0
  if (!result) {
    const bytes = await getBytes(config, about.scanPath)
    if (!bytes) return { sent: false, reason: 'the scan could not be fetched from the shelf' }
    if (signal?.aborted) throw new Error('Cancelled')
    const partial = await loadReconCheckpoint(about.key, wanted)
    resumedAt = partial?.pagesDone ?? 0
    result = await runRecon(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), {
      resumeFrom: partial,
      signal,
      cleanup: wanted.cleanup,
      onProgress: (p) => onProgress?.({ ...p, resumedAt }),
      // Awaited by nobody, like the wizard's: a slow write must not hold up
      // the next leaf, and a failed one costs the leaves since the last.
      onCheckpoint: (p) => void saveReconCheckpoint(about.key, p, p.pageCount, wanted)
    })
    await saveReconCache(about.key, result, wanted)
  }
  try {
    onProgress?.({
      page: result.pageCount,
      total: result.pageCount,
      phase: 'sending',
      resumedAt
    })
    const sent = await pushReconToShelf(config, about.key, fileName, result, wanted)
    onProgress?.({ page: result.pageCount, total: result.pageCount, phase: 'done', resumedAt })
    return sent
  } finally {
    releaseRecon(result)
  }
}
