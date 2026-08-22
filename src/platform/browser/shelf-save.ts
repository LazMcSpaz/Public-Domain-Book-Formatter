/**
 * Sending a book to the shelf, from wherever the asking happens.
 *
 * `App` does this the moment a transcription finishes, and Settings does it for
 * a book that was read before there was a shelf to send it to. Those are two
 * different occasions and must not be two different implementations: a book put
 * up by hand has to be the same file, with the same scan pointer and the same
 * catalogue card, as one put up automatically, or opening it back on another
 * device would depend on which button had been pressed months earlier.
 *
 * ## Why the by-hand path has to exist
 *
 * The automatic save reads the shelf configuration at the moment the reading
 * ends, and does nothing at all when there isn't one. That is the right
 * behaviour and it leaves a hole: connect a shelf afterwards and every book
 * already on the device stays where it is, invisible to the repository, with
 * nothing anywhere offering to move it. The device's own list still shows them,
 * which makes the hole look like a working shelf until somebody goes and reads
 * the repository.
 *
 * Browser-only.
 */
import { scanRefusal, type ShelfConfig } from '@core/sync'
import {
  parseBookFile,
  serializeBookFile,
  summarizeBookFile,
  type AnnotationCheckpoint,
  type SavedRun,
  type ScanPointer
} from '@core/project'
import type { EditorVoice } from '@core/annotate'
import { pushBook, pushScan } from './shelf'
import { loadAnnotationCheckpoint, loadRun, loadSourceFile } from './run-store'
import { loadReviewProgress, loadVoice } from './settings'

export interface ShelfPushResult {
  /** Where the book landed. */
  path: string
  /** The scan, when there was one to send and it was small enough. */
  scan: ScanPointer | null
  /** What to tell the user, including why the scan did not go if it did not. */
  note: string
}

export interface ShelfPushInput {
  key: string
  run: SavedRun
  answers: Record<string, Record<string, unknown>>
  voice: EditorVoice
  notesCheckpoint: AnnotationCheckpoint | null
  /**
   * The scan, if this device still has it.
   *
   * Worth being plain about: a book file without one is a complete record of
   * everything that was paid for and read, and is still worth having on the
   * shelf. What it cannot support is any later work that needs to look at the
   * page — checking a flagged word against the paper needs the paper.
   */
  scanFile: File | null
  /** Goes in the commit message, so the history reads as a log of the work. */
  what: string
}

export async function pushBookToShelf(
  config: ShelfConfig,
  input: ShelfPushInput
): Promise<ShelfPushResult> {
  let scan: ScanPointer | null = null
  let scanNote = ''
  if (input.scanFile) {
    const refusal = scanRefusal(input.scanFile.size)
    if (refusal) {
      scanNote = ` ${refusal}`
    } else {
      // Written once, under its own digest, and skipped ever after: git keeps
      // every version, so re-sending a scan on each save would grow the
      // repository by a whole scan each time and change nothing.
      const { path } = await pushScan(config, input.scanFile, input.scanFile.name)
      scan = { path, fileName: input.scanFile.name, bytes: input.scanFile.size, key: input.key }
    }
  } else {
    scanNote =
      ' The scan itself is not on this device, so only the reading went up — enough to open the ' +
      'book anywhere, not enough to check a word against the page.'
  }

  const json = serializeBookFile({
    run: input.run,
    answers: input.answers,
    voice: input.voice,
    notesCheckpoint: input.notesCheckpoint,
    scan
  })
  // Parsed straight back before it is sent. The book file is the only copy of
  // this work that leaves the device, and a file that will not load is worse
  // than no file — it looks like a saved book until the day it is needed.
  const summary = summarizeBookFile(parseBookFile(json))

  const path = await pushBook(
    config,
    input.key,
    json,
    {
      key: input.key,
      fileName: summary.fileName,
      savedAt: new Date().toISOString(),
      pageCount: summary.pageCount,
      notes: summary.notes,
      corrections: summary.corrections,
      facts: summary.facts,
      complete: summary.complete,
      scanPath: scan?.path ?? null
    },
    input.what
  )

  return {
    path,
    scan,
    note: `Sent ${summary.fileName} to ${config.repo}: ${summary.pageCount} page(s).${scanNote}`
  }
}

/**
 * Send a book this device has stored, gathering the parts from where they live.
 *
 * The by-hand path. Everything a book file holds is already in one store or
 * another; what was missing was anything that went and fetched them.
 */
export async function pushStoredBook(
  config: ShelfConfig,
  key: string,
  what = 'a book already read on this device'
): Promise<ShelfPushResult> {
  const run = await loadRun(key)
  if (!run) throw new Error('That book is no longer in this browser’s storage.')
  return pushBookToShelf(config, {
    key,
    run,
    answers: loadReviewProgress(key),
    voice: loadVoice(),
    notesCheckpoint: await loadAnnotationCheckpoint(key),
    scanFile: await loadSourceFile(key),
    what
  })
}
