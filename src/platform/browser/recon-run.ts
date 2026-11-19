/**
 * Reading a stored book's scan once, for the driver: `drive.mjs recon`, and
 * the line `load` reports about it.
 *
 * The app reads a scan when one is opened (`startRecon` in `App.tsx`); the
 * driver loads books straight into the store and never opened one, so on a
 * real book nothing read the scan and every `transcribe` reported its OCR
 * cross-check NOT CHECKED. This is the same pipeline as the app's, called
 * the same way: `loadReconCache` / `loadReconCheckpoint` under `BOOK_RECON`,
 * `runRecon` resuming from a checkpoint, `saveReconCheckpoint` as it goes and
 * `saveReconCache` at the end. What to do is decided by `planRecon` in core.
 *
 * A long book takes most of an hour. The reading runs inside the driver's
 * page whether or not anyone is still waiting for the answer, writes a
 * checkpoint every twenty leaves, and says how far it has got to anyone who
 * asks (`reconUnderWay`). A page reload or a browser restart loses only the
 * leaves since the last checkpoint; running `recon` again carries on.
 *
 * Browser-only.
 */
import {
  planRecon,
  reconCacheUsable,
  reconDoesNotApply,
  reconResumeFrom,
  reconStatus,
  shelfReadingFor,
  textFrom,
  type CheckpointSummary,
  type ReadingSummary,
  type ReconHandoff,
  type ReconPlan,
  type ShelfReading
} from '@core/project'
import { BOOK_RECON, releaseRecon, runRecon, type ReconPartial } from './recon'
import { loadReconCheckpoint, saveReconCache, saveReconCheckpoint } from './recon-cache'
import { deleteRecon, loadReconRecord, loadRun, loadSourceFile } from './run-store'
import { openPdf } from './pdf'

/** What this device's recon store holds for a book, read without changing it. */
export async function reconRecordState(
  key: string
): Promise<{ finished: ReadingSummary | null; checkpoint: CheckpointSummary | null }> {
  const raw = await loadReconRecord(key)
  if (!raw || typeof raw !== 'object') return { finished: null, checkpoint: null }
  const r = raw as { pageCount?: number; words?: unknown; source?: string }
  if (reconCacheUsable(raw, BOOK_RECON)) {
    return {
      finished: {
        leaves: r.pageCount ?? 0,
        words: Array.isArray(r.words) ? r.words.length : 0,
        source: r.source === 'embedded' ? 'embedded' : 'ocr'
      },
      checkpoint: null
    }
  }
  const pagesDone = reconResumeFrom(raw, BOOK_RECON)
  return {
    finished: null,
    checkpoint: pagesDone > 0 ? { pagesDone, pageCount: r.pageCount ?? 0 } : null
  }
}

/** The line `load` reports. */
export async function reconStatusLine(key: string, shelfBeside: boolean): Promise<string> {
  const run = await loadRun(key)
  const doesNotApply = reconDoesNotApply({ fileName: run?.fileName ?? key, shape: run?.shape })
  const state = doesNotApply ? { finished: null, checkpoint: null } : await reconRecordState(key)
  return reconStatus({ doesNotApply, ...state, shelfBeside })
}

/**
 * A reading handed off on the shelf, filed in this device's recon cache under
 * `key`: the words, each leaf's text and the vocabulary. Crops and thumbnails
 * do not travel; they are cut from the scan when wanted.
 */
export function saveHandoffAsCache(key: string, handoff: ReconHandoff): Promise<boolean> {
  return saveReconCache(
    key,
    {
      pageCount: handoff.pageCount,
      words: handoff.words,
      lexicon: handoff.lexicon,
      pageText: handoff.pageText,
      source: handoff.source,
      shape: handoff.shape ?? null,
      cleanup: handoff.cleanup,
      crops: new Map(),
      contextCrops: new Map(),
      thumbnails: new Map(),
      illustrations: []
    },
    { dpi: handoff.dpi, maxPages: null, cleanup: handoff.cleanup }
  )
}

/** The gzipped hand-off at `url`, judged against this scan. */
async function shelfReading(
  url: string | null,
  run: { key: string; fileName?: string; pageCount?: number | null }
): Promise<ShelfReading> {
  if (!url) return { kind: 'absent' }
  let bytes: ArrayBuffer
  try {
    const res = await fetch(url)
    if (!res.ok) return { kind: 'refused', why: `it could not be read (${res.status})` }
    bytes = await res.arrayBuffer()
  } catch (err) {
    return { kind: 'refused', why: `it could not be read (${(err as Error).message})` }
  }
  let text: string
  try {
    const unzipped = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    text = await new Response(unzipped).text()
  } catch {
    return { kind: 'refused', why: 'it is not a gzipped file' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { kind: 'refused', why: 'it does not hold JSON' }
  }
  return shelfReadingFor(raw, run, BOOK_RECON)
}

/** A reading under way in this page, as anyone polling is told it. */
export interface ReconUnderWay {
  key: string
  startedAt: number
  resumedFrom: number
  leaf: number
  of: number
  phase: string
}

let underWay: ReconUnderWay | null = null

/** How far the reading in this page has got, or null when none is running. */
export function reconUnderWay(): ReconUnderWay | null {
  return underWay ? { ...underWay } : null
}

export interface ReconOutcome {
  action: ReconPlan['action'] | 'under-way'
  why: string
  notes: string[]
  leaves?: number
  words?: number
  source?: 'ocr' | 'embedded'
  /** `source`, said plainly. */
  textFrom?: string
  resumedFrom?: number
  readOn?: string
  ms: number
  underWay?: ReconUnderWay
}

/**
 * Do what `planRecon` says for the book at `key`: nothing, import the
 * shelf's reading, or read the scan. Throws only on a refusal, or on a
 * reading that finished and could not be stored.
 */
export async function reconBook(
  key: string,
  opts: { fresh: boolean; shelfUrl: string | null }
): Promise<ReconOutcome> {
  const t0 = performance.now()
  const ms = (): number => Math.round(performance.now() - t0)
  if (underWay) {
    return {
      action: 'under-way',
      why: 'A reading is already under way in this browser; this call starts no second one.',
      notes: [],
      ms: 0,
      underWay: reconUnderWay()!
    }
  }
  // Claimed before the first await, so a second call made meanwhile is told
  // a reading is under way rather than starting one of its own.
  underWay = { key, startedAt: Date.now(), resumedFrom: 0, leaf: 0, of: 0, phase: 'deciding' }
  try {
    return await decideAndRead(key, opts, ms)
  } finally {
    underWay = null
  }
}

async function decideAndRead(
  key: string,
  opts: { fresh: boolean; shelfUrl: string | null },
  ms: () => number
): Promise<ReconOutcome> {
  const run = await loadRun(key)
  const fileName = run?.fileName ?? key.split('\u0000')[0] ?? ''
  const doesNotApply = reconDoesNotApply({ fileName, shape: run?.shape })
  const state = doesNotApply ? { finished: null, checkpoint: null } : await reconRecordState(key)
  const file = doesNotApply ? null : await loadSourceFile(key)
  let leaves: number | null = run?.leafCount || null
  if (file) {
    const doc = await openPdf(file)
    leaves = doc.numPages
    await doc.destroy()
  }
  const shelf = doesNotApply
    ? ({ kind: 'absent' } as const)
    : await shelfReading(opts.shelfUrl, { key, fileName, pageCount: leaves })
  const plan = planRecon({
    doesNotApply,
    ...state,
    shelf,
    scanStored: file !== null,
    fresh: opts.fresh
  })
  const said = { action: plan.action, why: plan.why, notes: plan.notes }

  if (plan.action === 'refuse') throw new Error(plan.why)
  if (plan.action === 'not-applicable') return { ...said, ms: ms() }
  if (plan.action === 'cached') {
    const f = state.finished!
    return { ...said, ...f, textFrom: textFrom(f.source), ms: ms() }
  }
  if (plan.action === 'import' && shelf.kind === 'fits') {
    const h = shelf.handoff
    if (!(await saveHandoffAsCache(key, h))) {
      throw new Error('The reading on the shelf fits, but this browser could not store it.')
    }
    return {
      ...said,
      leaves: h.pageCount,
      words: h.words.length,
      source: h.source,
      textFrom: textFrom(h.source),
      readOn: h.savedAt,
      ms: ms()
    }
  }

  // Read the scan. A fresh reading forgets the old record first, so a run
  // stopped before its first checkpoint cannot leave the old one looking
  // current.
  if (opts.fresh) await deleteRecon(key)
  const partial = plan.resumeFrom > 0 ? await loadReconCheckpoint(key, BOOK_RECON) : null
  const resumedFrom = partial?.pagesDone ?? 0
  underWay = {
    key,
    startedAt: underWay?.startedAt ?? Date.now(),
    resumedFrom,
    leaf: resumedFrom,
    of: leaves ?? 0,
    phase: 'starting'
  }
  // Checkpoints are written one after another, each from a copy taken when
  // it was handed over: the loop keeps adding words while a write waits for
  // the store, and a checkpoint holding words past its own `pagesDone` would
  // read those leaves twice on resume. The final save waits for them all, so
  // a late checkpoint can never overwrite the finished reading.
  let writes: Promise<unknown> = Promise.resolve()
  const result = await runRecon(file!, {
    dpi: BOOK_RECON.dpi,
    cleanup: BOOK_RECON.cleanup,
    resumeFrom: partial,
    onProgress: (p) => {
      if (underWay) underWay = { ...underWay, leaf: p.page, of: p.total, phase: p.phase }
    },
    onCheckpoint: (p: ReconPartial) => {
      const copy: ReconPartial = {
        ...p,
        words: p.words.slice(),
        pageText: p.pageText.slice(),
        thumbnails: new Map(p.thumbnails),
        illustrations: p.illustrations.slice()
      }
      writes = writes.then(() => saveReconCheckpoint(key, copy, copy.pageCount, BOOK_RECON))
    }
  })
  await writes
  const saved = await saveReconCache(key, result, BOOK_RECON)
  const counted = {
    leaves: result.pageCount,
    words: result.words.length,
    source: result.source,
    textFrom: textFrom(result.source)
  }
  releaseRecon(result)
  if (!saved) {
    throw new Error(
      'The reading finished but could not be stored in full (a full quota, or storage off). ' +
        'Make room, then run recon --fresh; cachestat shows what was kept.'
    )
  }
  return { ...said, ...counted, ...(resumedFrom > 0 ? { resumedFrom } : {}), ms: ms() }
}
