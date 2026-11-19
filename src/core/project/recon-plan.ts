/**
 * What the free first reading (recon) should do for a book, and whether a
 * batch may land without it.
 *
 * Recon renders and OCRs every leaf of a scan, or reads a born-digital PDF's
 * own words, and caches the result. Every later cross-check compares against
 * it: `transcribe` checks each landed leaf against the words recon read off
 * the same page. Nothing started it in the driver, so on a real book every
 * `transcribe` reported the check NOT CHECKED and nobody noticed until the
 * end. These are the decisions around it, kept here so they are tested
 * without a browser:
 *
 *   - **Does it apply at all?** An EPUB has no pages to read, and a compiled
 *     volume has no scan of its own. For those the cross-check does not
 *     apply, which is said, never treated as a failure.
 *   - **What should `drive.mjs recon` do?** Nothing when a finished reading is
 *     cached; load the shelf's `recon.json.gz` when it is a reading of this
 *     scan; otherwise read, carrying on from a checkpoint when one exists.
 *   - **May `transcribe` land a batch?** Not without a reading that covers
 *     its leaves, unless the session says so in as many words.
 *
 * Pure: facts in, a decision and its plain sentence out.
 */
import type { BookShape } from '@core/provenance'
import type { ReconWanted } from './recon-cache'
import { parseReconHandoff, reconMisfit, type ReconHandoff } from './recon-handoff'

/** The flag that lands a batch with no reading to check it against. */
export const WITHOUT_OCR_CHECK = '--without-ocr-check'

const RECON = 'node scripts/drive.mjs recon'

/**
 * Why recon, and so the OCR cross-check, does not apply to this book, or null
 * when it does. Every PDF is read: a scan through OCR, a born-digital file
 * through its own text layer.
 */
export function reconDoesNotApply(book: {
  fileName?: string | null
  shape?: BookShape | null
}): string | null {
  const container = book.shape?.container
  if (container === 'epub' || /\.epub$/iu.test(book.fileName ?? '')) {
    return 'the book was read from an EPUB, which has no page images to read'
  }
  if (container === 'collection') {
    return 'the book is a compilation with no scan of its own; each part was read against its own scan'
  }
  return null
}

/** A finished reading, counted. */
export interface ReadingSummary {
  leaves: number
  words: number
  source: 'ocr' | 'embedded'
}

/** A reading stopped part way. */
export interface CheckpointSummary {
  pagesDone: number
  pageCount: number
}

/** The `recon.json.gz` beside the book, judged against this scan. */
export type ShelfReading =
  { kind: 'absent' } | { kind: 'refused'; why: string } | { kind: 'fits'; handoff: ReconHandoff }

/**
 * Whether the reading on the shelf can stand for this device's reading of
 * this scan: the same refusals `reconimport` makes (not a hand-off, an older
 * app's words, a checkpoint), a reading of another copy (`reconMisfit`), and
 * a reading taken at another resolution or through another cleaning, which
 * the cache would refuse on its next read anyway.
 */
export function shelfReadingFor(
  raw: unknown,
  run: { key: string; fileName?: string; pageCount?: number | null },
  wanted: ReconWanted
): ShelfReading {
  if (raw === undefined || raw === null) return { kind: 'absent' }
  let handoff: ReconHandoff
  try {
    handoff = parseReconHandoff(raw)
  } catch (err) {
    return { kind: 'refused', why: err instanceof Error ? err.message : String(err) }
  }
  const misfit = reconMisfit(handoff, {
    key: run.key,
    fileName: run.fileName,
    ...(typeof run.pageCount === 'number' && run.pageCount > 0 ? { pageCount: run.pageCount } : {})
  })
  if (misfit) return { kind: 'refused', why: `it is not a reading of this scan: ${misfit}` }
  if (handoff.dpi !== wanted.dpi) {
    return {
      kind: 'refused',
      why: `it was read at ${handoff.dpi} DPI; this app reads at ${wanted.dpi}`
    }
  }
  const cleanup = wanted.cleanup ?? 'off'
  if (handoff.cleanup !== cleanup) {
    return {
      kind: 'refused',
      why: `it was read through the "${handoff.cleanup}" cleaning; this app reads through "${cleanup}"`
    }
  }
  return { kind: 'fits', handoff }
}

export interface ReconFacts {
  doesNotApply: string | null
  finished: ReadingSummary | null
  checkpoint: CheckpointSummary | null
  shelf: ShelfReading
  scanStored: boolean
  fresh: boolean
}

export interface ReconPlan {
  action: 'not-applicable' | 'cached' | 'import' | 'refuse' | 'read'
  /** One plain sentence: what is done, or why nothing is. */
  why: string
  /** The leaf a reading starts at: 0, or where a checkpoint stopped. */
  resumeFrom: number
  /** What was passed over and why, said so a session is not left guessing. */
  notes: string[]
}

/** What `drive.mjs recon` does, given what this device and the shelf hold. */
export function planRecon(f: ReconFacts): ReconPlan {
  const notes: string[] = []
  const plan = (action: ReconPlan['action'], why: string, resumeFrom = 0): ReconPlan => ({
    action,
    why,
    resumeFrom,
    notes
  })
  if (f.doesNotApply) {
    return plan('not-applicable', `Recon and the OCR cross-check do not apply: ${f.doesNotApply}.`)
  }
  if (f.finished && !f.fresh) {
    return plan(
      'cached',
      `A finished reading of this scan is already cached (${f.finished.leaves} leaves). ` +
        'Nothing to do; --fresh reads it again.'
    )
  }
  if (f.finished) notes.push('--fresh: the cached reading is discarded and the scan read again.')
  if (f.shelf.kind === 'fits' && !f.fresh) {
    return plan(
      'import',
      'recon.json.gz beside the book is a finished reading of this scan, so it is loaded instead of reading again.'
    )
  }
  if (f.shelf.kind === 'fits') notes.push('--fresh: recon.json.gz beside the book was not used.')
  if (f.shelf.kind === 'refused') {
    notes.push(`recon.json.gz beside the book was not used: ${f.shelf.why.replace(/\.$/u, '')}.`)
  }
  if (!f.scanStored) {
    return plan(
      'refuse',
      'The scan is not stored on this device, so there is nothing to read. Load the book with ' +
        'its scan first: node scripts/drive.mjs load <book.json> <scan.pdf>.'
    )
  }
  const cp = f.checkpoint
  const resumable = cp !== null && cp.pagesDone > 0 && cp.pagesDone < cp.pageCount
  if (resumable && !f.fresh) {
    return plan(
      'read',
      `Carrying on from leaf ${cp.pagesDone} of ${cp.pageCount}, where an earlier reading stopped.`,
      cp.pagesDone
    )
  }
  if (resumable) {
    notes.push(
      `--fresh: the partial reading (${cp.pagesDone} of ${cp.pageCount} leaves) is discarded.`
    )
  }
  return plan('read', 'Reading every leaf of the scan.')
}

/** Where the words of a reading came from, said plainly. */
export function textFrom(source: 'ocr' | 'embedded'): string {
  return source === 'embedded'
    ? "the PDF's own text layer (no OCR was needed)"
    : 'OCR of the page images (Tesseract)'
}

/** The one line `load` reports about the reading of the scan it loaded. */
export function reconStatus(f: {
  doesNotApply: string | null
  finished: ReadingSummary | null
  checkpoint: CheckpointSummary | null
  shelfBeside: boolean
}): string {
  if (f.doesNotApply) return `does not apply: ${f.doesNotApply}`
  if (f.finished) {
    return `cached: ${f.finished.leaves} leaves, ${f.finished.words} words, from ${textFrom(f.finished.source)}`
  }
  if (f.checkpoint) {
    return `partial: ${f.checkpoint.pagesDone} of ${f.checkpoint.pageCount} leaves read; run ${RECON} to carry on`
  }
  if (f.shelfBeside) {
    return `none cached; recon.json.gz sits beside the book: run ${RECON} to load it`
  }
  return `none cached for this scan: run ${RECON} before transcribe`
}

export interface OcrGateFacts {
  doesNotApply: string | null
  /** The finished reading this device holds for the book, or null. */
  reading: { pageCount: number } | null
  /** The distinct leaves the batch lands. */
  leaves: readonly number[]
  withoutCheck: boolean
}

/**
 * Why `transcribe` must not land this batch, or null when it may.
 *
 * A batch lands only when a reading covers every one of its leaves, so each
 * leaf is compared with what OCR read off the same page. A leaf the reading
 * read and found no words on (a blank, a plate) is covered: it is reported,
 * not refused. The flag lands the batch anyway and the report still says
 * NOT CHECKED.
 */
export function ocrGateRefusal(f: OcrGateFacts): string | null {
  if (f.doesNotApply || f.withoutCheck) return null
  const unchecked = `To land them unchecked, add ${WITHOUT_OCR_CHECK}. Nothing was written.`
  if (!f.reading) {
    return (
      `No reading of this scan is cached on this device, so these ${f.leaves.length} leaf(s) ` +
      `cannot be checked against OCR. Run ${RECON} first (it loads recon.json.gz from beside ` +
      `the book when one fits). ${unchecked}`
    )
  }
  const outside = f.leaves.filter((n) => n >= f.reading!.pageCount)
  if (outside.length > 0) {
    return (
      `The cached reading covers leaves 0 to ${f.reading.pageCount - 1}, and this batch lands ` +
      `leaf ${outside.join(', ')} outside it. Is this batch for this scan? ${unchecked}`
    )
  }
  return null
}

/** The `ocr` line of `transcribe`'s report. */
export function ocrReport(f: {
  doesNotApply: string | null
  reading: boolean
  /** Distinct leaves landed. */
  leaves: number
  /** Leaves really compared with OCR words. */
  compared: number
  /** Landed leaves the reading has no words for. */
  wordless: readonly number[]
  withoutCheck: boolean
}): string {
  if (f.doesNotApply) return `does not apply: ${f.doesNotApply}`
  if (!f.reading) {
    return (
      'NOT CHECKED: no cached reading on this device' +
      (f.withoutCheck ? ` (landed with ${WITHOUT_OCR_CHECK})` : '')
    )
  }
  if (f.compared === f.leaves) return `checked against the cached reading, all ${f.leaves} leaf(s)`
  return (
    `NOT CHECKED on ${f.leaves - f.compared} of ${f.leaves} leaf(s): the cached reading has ` +
    `no words for leaf ${f.wordless.join(', ')}`
  )
}
