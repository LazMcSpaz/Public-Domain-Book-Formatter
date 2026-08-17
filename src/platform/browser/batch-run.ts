/**
 * Submitting a book to the Batches API, and collecting it again.
 *
 * Two halves that never have to happen in the same session — that is the whole
 * feature. Submission renders every leaf, uploads it and writes down where it
 * went; collection can be days later, on another device, from a tab that has
 * never seen the images.
 *
 * ## Memory, again
 *
 * The sequential runner renders one page, sends it and drops it, so peak usage
 * is one leaf. A batch cannot do that — the requests have to exist together to
 * be posted together — so the rule becomes: peak usage is **one chunk**, and a
 * chunk is bounded by `BATCH_LIMITS` at a size a phone can hold. Pages are
 * rendered into the chunk being filled, the chunk is posted, and the whole
 * thing is released before the next page is rendered. A three-hundred-page book
 * is roughly ten uploads of thirty megabytes, never one of three hundred.
 *
 * ## Order of operations
 *
 * The ticket is written **after each batch is created and before the next page
 * is rendered**. Not at the end: a submission that dies partway must leave
 * behind the ids of the batches that did get created, because those pages are
 * being read and billed whether or not this tab is still open. Writing the
 * ticket last would mean the last batch — often several minutes of upload — is
 * the one most likely to be lost, and losing it is unrecoverable.
 */
import {
  BATCH_LIMITS,
  buildBatchRequest,
  buildPagePrompt,
  buildSystemPrompt,
  correctTerms,
  createBatch,
  fetchBatchResults,
  fits,
  parseBatchResults,
  retrieveBatch,
  sizeOfRequest,
  tailOf,
  verifyRun,
  type ApiUsage,
  type BatchRequest,
  type BatchStatus,
  type ClientConfig,
  type OcrWordLike,
  type OrthographyPolicy,
  type PageFailure,
  type PageTranscription,
  type VerificationFinding
} from '@core/transcribe'
import type { LexiconEntry, TermCorrection } from '@core/lexicon'
import type { TicketBatch } from '@core/project'
import { openPdf } from './pdf'
import { renderPageToBase64 } from './page-image'

export interface SubmitOptions {
  fileData: ArrayBuffer | Blob
  /**
   * The OCR of each leaf.
   *
   * Two jobs, both on the way *out*: it is the hint in the page's own prompt,
   * and the tail of the previous entry is the seam context. The word boxes the
   * live runner cross-checks against are not needed here at all — that happens
   * at collection, against the same `verifyRun` the sequential path uses.
   */
  pageText: string[]
  client: ClientConfig
  lexicon: readonly LexiconEntry[]
  orthography: OrthographyPolicy
  normalizeLongS: boolean
  bookContext?: string
  imageLongEdge?: number
  maxPages?: number
  /** Submit only these leaves. Defaults to the whole book. */
  onlyPages?: readonly number[]
  onProgress?: (p: SubmitProgress) => void
  /**
   * Called the moment a batch exists, before anything else is rendered.
   *
   * Awaited, and a rejection **stops the submission**. This is the callback
   * that writes the ticket, and carrying on after failing to record a batch id
   * would mean uploading more pages the user could never collect.
   */
  onBatchCreated: (batch: TicketBatch) => Promise<void>
  signal?: AbortSignal
}

export interface SubmitProgress {
  /** Leaves rendered and packed so far. */
  page: number
  total: number
  /** Batches successfully created. */
  batches: number
}

export interface SubmitResult {
  batches: TicketBatch[]
  /** True when every requested leaf reached a batch. */
  complete: boolean
  cancelled: boolean
}

/**
 * Render the book into batches and post them.
 *
 * The seam context is the *OCR* of the previous leaf rather than the model's
 * reading of it, because page N's request is built before page N−1 has been
 * read. See `buildPagePrompt` — the prompt says which it is getting.
 */
export async function submitBookBatch(options: SubmitOptions): Promise<SubmitResult> {
  const doc = await openPdf(options.fileData)
  const total = Math.min(doc.numPages, options.maxPages ?? doc.numPages)
  const longEdge = options.imageLongEdge ?? 1568

  const systemPrompt = buildSystemPrompt({
    lexicon: options.lexicon,
    orthography: options.orthography,
    normalizeLongS: options.normalizeLongS,
    bookContext: options.bookContext
  })

  const wanted = options.onlyPages ? new Set(options.onlyPages) : null
  const pageIndexes: number[] = []
  for (let i = 0; i < total; i++) {
    if (!wanted || wanted.has(i)) pageIndexes.push(i)
  }

  const created: TicketBatch[] = []
  let pending: BatchRequest[] = []
  let pendingBytes = 0
  let pendingPages: number[] = []
  let done = 0
  let cancelled = false

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return
    const status = await createBatch(options.client, pending)
    const batch: TicketBatch = { id: status.id, pageIndexes: [...pendingPages] }
    // Released before the ticket is written, not after: the write can be slow,
    // and holding thirty megabytes of base64 across it for no reason is how a
    // phone runs out of memory at the one moment that costs money.
    pending = []
    pendingBytes = 0
    pendingPages = []
    await options.onBatchCreated(batch)
    created.push(batch)
    options.onProgress?.({ page: done, total: pageIndexes.length, batches: created.length })
  }

  for (const pageIndex of pageIndexes) {
    if (options.signal?.aborted) {
      cancelled = true
      break
    }

    const imageBase64 = await renderPageToBase64(doc, pageIndex, longEdge)
    const request = buildBatchRequest(options.client, {
      pageIndex,
      imageBase64,
      systemPrompt,
      userPrompt: buildPagePrompt({
        pageIndex,
        pageCount: total,
        ocrText: options.pageText[pageIndex] ?? '',
        previousTail: tailOf(options.pageText[pageIndex - 1] ?? ''),
        previousTailIsOcr: true
      })
    })
    const size = sizeOfRequest(request)

    if (!fits({ count: pending.length, bytes: pendingBytes }, size, BATCH_LIMITS)) {
      await flush()
    }
    pending.push(request)
    pendingBytes += size
    pendingPages.push(pageIndex)
    done += 1
    options.onProgress?.({ page: done, total: pageIndexes.length, batches: created.length })
  }

  // The tail chunk, and the cancelled case — where the pages packed since the
  // last flush are exactly the ones at risk of being rendered for nothing.
  await flush()

  const submitted = created.reduce((n, b) => n + b.pageIndexes.length, 0)
  return { batches: created, complete: !cancelled && submitted === pageIndexes.length, cancelled }
}

// ---------------------------------------------------------------------------
// Collecting
// ---------------------------------------------------------------------------

export interface CollectOptions {
  client: ClientConfig
  batches: readonly TicketBatch[]
  ocrWordsByPage: Map<number, OcrWordLike[]>
  termCorrections?: readonly TermCorrection[]
  onProgress?: (p: CollectProgress) => void
  signal?: AbortSignal
}

export interface CollectProgress {
  /** Batches whose status has been checked. */
  checked: number
  total: number
  /** Batches finished and fetched. */
  collected: number
}

export interface CollectResult {
  transcriptions: PageTranscription[]
  findings: VerificationFinding[]
  failures: PageFailure[]
  usage: ApiUsage
  /** Batch ids whose results are now in hand — the ticket marks these done. */
  collectedIds: string[]
  /** Batches still working, with what the API says about each. */
  stillRunning: BatchStatus[]
  /** True when every batch has ended and been fetched. */
  complete: boolean
}

/**
 * Check every batch, fetch the finished ones, and read them into pages.
 *
 * Partial by design. A book submitted as eleven batches will not finish as one
 * event, and making the user wait for the last one before seeing any of it
 * would throw away the main advantage of chunking. Each collected batch is
 * reported with its id so the ticket can mark it done — a batch fetched twice
 * is not billed twice, but it is a minute of download and a chance to get the
 * merge wrong.
 */
export async function collectBookBatch(options: CollectOptions): Promise<CollectResult> {
  const transcriptions: PageTranscription[] = []
  const failures: PageFailure[] = []
  const usage: ApiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
  const collectedIds: string[] = []
  const stillRunning: BatchStatus[] = []
  let checked = 0

  for (const batch of options.batches) {
    if (options.signal?.aborted) break
    checked += 1

    const status = await retrieveBatch(options.client, batch.id)
    if (status.processingStatus !== 'ended') {
      stillRunning.push(status)
      options.onProgress?.({
        checked,
        total: options.batches.length,
        collected: collectedIds.length
      })
      continue
    }

    const jsonl = await fetchBatchResults(options.client, status)
    const parsed = parseBatchResults(jsonl, batch.pageIndexes)
    for (const page of parsed.transcriptions) {
      transcriptions.push(correctTerms(page, options.termCorrections))
    }
    failures.push(...parsed.failures)
    usage.inputTokens += parsed.usage.inputTokens
    usage.outputTokens += parsed.usage.outputTokens
    usage.cacheReadTokens += parsed.usage.cacheReadTokens
    collectedIds.push(batch.id)

    options.onProgress?.({ checked, total: options.batches.length, collected: collectedIds.length })
  }

  transcriptions.sort((a, b) => a.pageIndex - b.pageIndex)
  failures.sort((a, b) => a.pageIndex - b.pageIndex)

  // The same deterministic cross-checks the live runner applies. A page that
  // arrived through the cheaper door is held to exactly the same evidence.
  const sources = [...options.ocrWordsByPage].map(([pageIndex, ocrWords]) => ({
    pageIndex,
    ocrWords
  }))

  return {
    transcriptions,
    findings: verifyRun(transcriptions, sources),
    failures,
    usage,
    collectedIds,
    stillRunning,
    complete: stillRunning.length === 0 && collectedIds.length === options.batches.length
  }
}

/** Where every batch of a ticket has got to, without fetching any results. */
export async function checkBatches(
  client: ClientConfig,
  batches: readonly TicketBatch[]
): Promise<BatchStatus[]> {
  const out: BatchStatus[] = []
  for (const batch of batches) out.push(await retrieveBatch(client, batch.id))
  return out
}
