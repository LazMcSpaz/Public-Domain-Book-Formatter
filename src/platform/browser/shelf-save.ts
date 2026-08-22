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
import { fetchVoice, pushBook, pushImage, pushScan, pushVoice } from './shelf'
import { loadAnnotationCheckpoint, loadRun, loadSourceFile } from './run-store'
import { loadReviewProgress, loadVoice, saveVoice } from './settings'

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

  // Each of the editor's own pictures goes up once, under its own digest, and
  // the book file names it rather than carrying it. Inline base64 is a third
  // larger than the bytes and is rewritten on every save — and git keeps every
  // version, so a book with plates in it used to grow the repository by all of
  // them again each time a correction was typed.
  //
  // A picture that will not upload falls back to being carried inline rather
  // than being left out. The failure costs repository tidiness; leaving it out
  // would cost the picture, and nothing is ever drawn in place of one.
  const imagePaths: Record<string, string> = {}
  for (const image of input.run.images) {
    try {
      const { path } = await pushImage(config, image.bytes, input.run.fileName)
      imagePaths[image.id] = path
    } catch {
      /* carried inline instead */
    }
  }

  const json = serializeBookFile({
    run: input.run,
    answers: input.answers,
    voice: input.voice,
    notesCheckpoint: input.notesCheckpoint,
    scan,
    imagePaths
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

  // The editor goes up with the book, every time, on the shelf's own rails.
  //
  // Write-through rather than a separate action, because the whole failure this
  // fixes is a voice that only ever existed in one browser: an editor banked by
  // a button nobody presses is the arrangement we already had. It is a few
  // hundred bytes and it only rewrites when it has changed, so the cost against
  // a history that keeps every version is nothing worth weighing.
  //
  // Failing here does not fail the save. The book is the thing that cost money
  // and an evening; the voice can be sent again by the next save, and refusing
  // to store a finished book because a pen name would not upload gets the
  // priority exactly backwards.
  let voiceNote = ''
  try {
    await pushVoice(config, input.voice, `banked with ${summary.fileName}`)
  } catch {
    voiceNote = ' The editor’s voice could not be sent; the next save will try again.'
  }

  return {
    path,
    scan,
    note: `Sent ${summary.fileName} to ${config.repo}: ${summary.pageCount} page(s).${scanNote}${voiceNote}`
  }
}

/**
 * Take the editor from the shelf, if there is one there.
 *
 * The shelf is the source of truth and the device is a cache of it, so on a
 * device that has one configured this is what the voice *is*. It writes the
 * local copy so everything already reading `loadVoice` keeps working unchanged.
 *
 * What this deliberately does not do is merge. Two divergent voices cannot be
 * reconciled without asking which exemplar belongs to whom, and the honest
 * answer for a record this small is that the shelf wins — the same bargain the
 * book file already strikes, and the reason to keep the voice small enough that
 * losing an offline edit costs a sentence rather than an evening.
 */
export async function pullVoice(config: ShelfConfig, penName: string): Promise<EditorVoice | null> {
  const voice = await fetchVoice(config, penName)
  if (voice) saveVoice(voice)
  return voice
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
