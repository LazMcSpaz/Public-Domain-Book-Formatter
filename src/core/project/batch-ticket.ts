/**
 * The ticket for a book that has been submitted and not yet collected.
 *
 * ## Why this is the important file
 *
 * Everything else this app stores is an optimisation. The scan can be picked
 * again, the reading redone, the corrections retyped at the cost of an evening.
 * A batch ticket is different in kind: while it is outstanding, **the user has
 * spent money on work whose only address is a batch id**. Lose the id and the
 * pages are read, billed and unreachable — there is no way back to them from
 * the file on disk, because nothing on Anthropic's side knows which book a
 * batch was.
 *
 * So the ticket is written *before* the first batch is submitted and updated
 * after each one, rather than saved at the end of a submission that might not
 * reach its end. A ticket naming a batch that was never created is a wasted
 * lookup; a batch with no ticket naming it is money on the floor. The two
 * failures are not symmetric and the code is not symmetric either.
 *
 * ## What rides along
 *
 * Enough to finish the job in a session that never saw the submission: which
 * pages went into which batch (results come back unordered and a page missing
 * from the file must be *reported*, which needs the list of what was sent), the
 * term corrections Gate 1 promised would apply book-wide, and the identity
 * answers that shaped the prompt. Not the images — those are gone, and the
 * whole point is that they no longer need to exist here.
 *
 * Pure: types, versioning and the expiry arithmetic. The store is in the
 * platform layer.
 */
import type { TermCorrection } from '@core/lexicon'

/** Bump and extend `migrateBatchTicket` on any shape change. */
export const BATCH_TICKET_VERSION = 1

/**
 * How long Anthropic keeps a finished batch's results.
 *
 * Twenty-nine days. Held here as a number because the ticket has to be able to
 * say "this expires on Tuesday" in a session that has no network — a user who
 * opens the app on a plane should still be told the deadline they are up
 * against rather than a spinner.
 */
export const RESULTS_RETAINED_DAYS = 29

/** One submitted batch, and the leaves that went into it. */
export interface TicketBatch {
  id: string
  pageIndexes: number[]
  /** Set once collected, so a partial collection is not redone or re-billed. */
  collected?: boolean
}

export interface BatchTicket {
  version: number
  /** The file this belongs to — same identity as a saved run's. */
  key: string
  fileName: string
  submittedAt: string
  modelId: string
  /** Leaves in the book, so "142 of 300 submitted" can be said. */
  pageCount: number
  batches: TicketBatch[]
  /**
   * Whether every page of the book made it into a batch.
   *
   * False while a submission is still uploading, and false forever if it was
   * interrupted. The difference decides what the user is offered on the way
   * back in: collect what is out there, or submit the rest first.
   */
  complete: boolean
  identityAnswers: Record<string, unknown>
  termCorrections: TermCorrection[]
}

export interface BatchTicketSummary {
  key: string
  fileName: string
  submittedAt: string
  modelId: string
  pageCount: number
  /** Pages that reached a batch. */
  submittedPages: number
  batchCount: number
  /** Batches whose results are already in the saved run. */
  collectedBatches: number
  complete: boolean
  expiresAt: string
}

export function createBatchTicket(init: {
  key: string
  fileName: string
  modelId: string
  pageCount: number
  identityAnswers: Record<string, unknown>
  termCorrections?: readonly TermCorrection[]
  batches?: readonly TicketBatch[]
  complete?: boolean
  submittedAt?: string
}): BatchTicket {
  return {
    version: BATCH_TICKET_VERSION,
    key: init.key,
    fileName: init.fileName,
    submittedAt: init.submittedAt ?? new Date().toISOString(),
    modelId: init.modelId,
    pageCount: init.pageCount,
    batches: [...(init.batches ?? [])].map((b) => ({ ...b, pageIndexes: [...b.pageIndexes] })),
    complete: init.complete ?? false,
    identityAnswers: init.identityAnswers,
    termCorrections: [...(init.termCorrections ?? [])]
  }
}

/** Every page this ticket has out with the API, in order. */
export function submittedPages(ticket: BatchTicket): number[] {
  const pages = new Set<number>()
  for (const batch of ticket.batches) for (const page of batch.pageIndexes) pages.add(page)
  return [...pages].sort((a, b) => a - b)
}

/** Batches still to be fetched. */
export function pendingBatches(ticket: BatchTicket): TicketBatch[] {
  return ticket.batches.filter((b) => !b.collected)
}

/** When this ticket's results stop being fetchable. */
export function expiresAt(ticket: BatchTicket): Date {
  const submitted = new Date(ticket.submittedAt).getTime()
  const base = Number.isFinite(submitted) ? submitted : Date.now()
  return new Date(base + RESULTS_RETAINED_DAYS * 24 * 60 * 60 * 1000)
}

/**
 * Whether the results are past fetching.
 *
 * Not a reason to delete the ticket quietly. An expired ticket is the record of
 * money spent on pages that can no longer be collected, and the user is owed
 * that sentence — deleting it would make the loss look like it never happened.
 */
export function ticketExpired(ticket: BatchTicket, now: Date = new Date()): boolean {
  return now.getTime() > expiresAt(ticket).getTime()
}

export function summarizeTicket(ticket: BatchTicket): BatchTicketSummary {
  return {
    key: ticket.key,
    fileName: ticket.fileName,
    submittedAt: ticket.submittedAt,
    modelId: ticket.modelId,
    pageCount: ticket.pageCount,
    submittedPages: submittedPages(ticket).length,
    batchCount: ticket.batches.length,
    collectedBatches: ticket.batches.filter((b) => b.collected).length,
    complete: ticket.complete,
    expiresAt: expiresAt(ticket).toISOString()
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Read a stored ticket back, or null if there is nothing usable in it.
 *
 * Null rather than throwing, and the opposite choice from `migrateSavedRun`.
 * That refuses loudly because handing back a half-restored *transcription*
 * looks like a book that was read and prints with holes in it. A ticket is a
 * pointer, not content: the worst a malformed one can do is fail to find
 * batches that are still sitting on the server under ids nobody can read
 * anyway. Refusing to open the book over it would help nobody.
 *
 * A batch with no id is dropped; a ticket left with no batches at all is null,
 * because an empty ticket is indistinguishable from no ticket and would offer
 * the user a collection that can never happen.
 */
export function migrateBatchTicket(raw: unknown): BatchTicket | null {
  if (!isObject(raw)) return null
  if (typeof raw['key'] !== 'string') return null

  const batches: TicketBatch[] = []
  for (const value of Array.isArray(raw['batches']) ? raw['batches'] : []) {
    if (!isObject(value)) continue
    const id = value['id']
    if (typeof id !== 'string' || !id) continue
    const pageIndexes = Array.isArray(value['pageIndexes'])
      ? value['pageIndexes'].filter(
          (p): p is number => typeof p === 'number' && Number.isInteger(p)
        )
      : []
    batches.push({
      id,
      pageIndexes,
      ...(value['collected'] === true ? { collected: true } : {})
    })
  }
  if (batches.length === 0) return null

  const corrections = Array.isArray(raw['termCorrections'])
    ? raw['termCorrections'].filter(
        (c): c is TermCorrection =>
          isObject(c) && typeof c['from'] === 'string' && typeof c['to'] === 'string'
      )
    : []

  return {
    version: BATCH_TICKET_VERSION,
    key: raw['key'],
    fileName: typeof raw['fileName'] === 'string' ? raw['fileName'] : 'a book',
    submittedAt:
      typeof raw['submittedAt'] === 'string' ? raw['submittedAt'] : new Date(0).toISOString(),
    modelId: typeof raw['modelId'] === 'string' ? raw['modelId'] : 'unknown',
    pageCount: typeof raw['pageCount'] === 'number' ? raw['pageCount'] : 0,
    batches,
    complete: raw['complete'] === true,
    identityAnswers: isObject(raw['identityAnswers']) ? raw['identityAnswers'] : {},
    termCorrections: corrections
  }
}

/** "submitted 2 hours ago — 300 pages out in 11 batches" for the offer. */
export function describeTicket(summary: BatchTicketSummary, age: string): string {
  const batches = `${summary.batchCount} batch${summary.batchCount === 1 ? '' : 'es'}`
  const scope = summary.complete
    ? `all ${summary.pageCount} page(s)`
    : `${summary.submittedPages} of ${summary.pageCount} page(s)`
  return `${scope} submitted ${age} to ${summary.modelId}, in ${batches}.`
}
