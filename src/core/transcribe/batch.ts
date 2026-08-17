/**
 * The batch path: hand the whole book over at once and collect it later.
 *
 * ## Why this exists
 *
 * The sequential runner issues one request per page and waits for each reply
 * before building the next. That loop lives **in the tab**, which is the honest
 * answer to "why does it stop when my phone screen goes off": nothing on
 * Anthropic's side knows there is a book. There are only three hundred
 * unrelated requests, each one sent by a page that had to be awake to read the
 * previous answer. A wake lock keeps the screen on and a checkpoint keeps what
 * was bought, but neither makes the work survive a locked phone, because
 * nothing in a browser can — workers included.
 *
 * The Message Batches API moves the loop off the device. Every page is
 * submitted in one call, Anthropic runs them, and the tab's only remaining job
 * is to come back and fetch the results. Closing the tab, locking the phone and
 * losing the network all become survivable, and the whole run costs **half**.
 *
 * ## What it costs in exchange
 *
 * **The seam context.** Each sequential request carries the tail of the
 * previous page's *finished reading*, so the model can tell a paragraph that
 * runs across the leaf boundary. A batch cannot: page N's request is built
 * before page N−1 has been read. The tail therefore comes from the previous
 * page's **OCR**, which is available up front and is nearly as good for the one
 * decision it informs — see `buildPagePrompt`. Assembly's seam repair is
 * unchanged and still does the real stitching.
 *
 * **Watching it happen.** There is no live progress: a batch is in progress or
 * it is done. Usually under an hour, at most a day.
 *
 * ## The limits that shape the code
 *
 * A batch takes up to 100,000 requests or 256 MB. A page of a scan is one to
 * two megabytes of base64, so a three-hundred-page book is *larger than one
 * batch* — which is why `fits` exists and why a submission is a list of batches
 * rather than one. The soft byte budget is far below the API's ceiling on
 * purpose: the request body is built as a single JSON string in memory, and a
 * quarter-gigabyte string is how a phone's tab dies at the last moment before
 * the work would have been safe.
 *
 * Pure except for the four HTTP calls at the bottom, which take the same
 * injectable transport as `client.ts` and are tested against a mock.
 */
import {
  API_BASE,
  apiHeaders,
  buildRequestBody,
  readMessage,
  throwIfFailed,
  TranscribeError,
  type ApiUsage,
  type ClientConfig,
  type PageRequest
} from './client'
import { parsePageTranscription, type PageTranscription } from './schema'
import type { PageFailure } from './runner'

/** One entry of a batch: an id we choose, and an ordinary Messages request. */
export interface BatchRequest {
  custom_id: string
  params: Record<string, unknown>
}

export type BatchProcessingStatus = 'in_progress' | 'canceling' | 'ended'

export interface BatchCounts {
  processing: number
  succeeded: number
  errored: number
  canceled: number
  expired: number
}

export interface BatchStatus {
  id: string
  processingStatus: BatchProcessingStatus
  counts: BatchCounts
  /** Where the JSONL lands. Null until the batch has ended. */
  resultsUrl: string | null
  createdAt: string
  /** When the results stop being fetchable — 29 days out. */
  expiresAt: string
}

// ---------------------------------------------------------------------------
// Naming the pages
// ---------------------------------------------------------------------------

/**
 * The `custom_id` for a page.
 *
 * Results come back in **any order**, so this is the only thing tying a reply
 * to the leaf it read. Zero-padded so ids sort the way pages do, which matters
 * nowhere in the code and a great deal when someone is looking at a raw JSONL
 * file trying to work out what went wrong.
 *
 * The API allows up to 64 characters of `[a-zA-Z0-9_-]`; this is nine.
 */
export function customIdFor(pageIndex: number): string {
  return `page-${String(pageIndex).padStart(5, '0')}`
}

/** The page an id names, or null for anything not written by `customIdFor`. */
export function pageIndexOf(customId: string): number | null {
  const match = /^page-(\d{1,9})$/.exec(customId)
  if (!match) return null
  const index = Number(match[1])
  return Number.isInteger(index) ? index : null
}

// ---------------------------------------------------------------------------
// Building and sizing a submission
// ---------------------------------------------------------------------------

/** One page, as a batch entry. The params are the ordinary request body. */
export function buildBatchRequest(config: ClientConfig, req: PageRequest): BatchRequest {
  return { custom_id: customIdFor(req.pageIndex), params: buildRequestBody(config, req) }
}

export interface BatchLimits {
  /** Bytes of serialized JSON per batch. */
  maxBytes: number
  /** Requests per batch. */
  maxRequests: number
}

/**
 * The API's own ceilings, for the record. Not what this app submits against.
 */
export const API_BATCH_MAX_BYTES = 256 * 1024 * 1024
export const API_BATCH_MAX_REQUESTS = 100_000

/**
 * What a submission is actually chunked at.
 *
 * 32 MB is roughly twenty to thirty leaves of a scan. Well under the API's
 * 256 MB, and deliberately so: the body is `JSON.stringify`d whole, so the
 * ceiling that matters is not the one the server enforces but the one the
 * user's phone does. Smaller chunks also mean a failed upload costs one chunk
 * rather than the book, and that results can be collected in pieces.
 *
 * The request cap is a sanity bound for a book of text-light leaves, where the
 * byte budget alone would put four hundred pages in one call.
 */
export const BATCH_LIMITS: BatchLimits = {
  maxBytes: 32 * 1024 * 1024,
  maxRequests: 250
}

/**
 * Whether another request of `nextBytes` still fits in the batch being filled.
 *
 * The single statement of the chunking rule. The platform submitter uses it to
 * decide when to flush — it renders a page at a time and cannot know the sizes
 * in advance — and `planBatches` uses it to chunk a list whose sizes are known.
 * Two copies of this rule would be two chunkings that disagree.
 *
 * An empty batch always accepts, even for an oversized request: refusing would
 * loop forever, and one page that is somehow larger than the whole budget is
 * better sent and rejected by the API with a message than silently dropped.
 */
export function fits(
  pending: { count: number; bytes: number },
  nextBytes: number,
  limits: BatchLimits = BATCH_LIMITS
): boolean {
  if (pending.count === 0) return true
  if (pending.count + 1 > limits.maxRequests) return false
  return pending.bytes + nextBytes <= limits.maxBytes
}

/** Roughly what one entry adds to the body. Serialized, since that is what ships. */
export function sizeOfRequest(request: BatchRequest): number {
  return JSON.stringify(request).length
}

/** Chunk a list of requests into batches that each fit. */
export function planBatches(
  requests: readonly BatchRequest[],
  limits: BatchLimits = BATCH_LIMITS
): BatchRequest[][] {
  const batches: BatchRequest[][] = []
  let current: BatchRequest[] = []
  let bytes = 0

  for (const request of requests) {
    const size = sizeOfRequest(request)
    if (!fits({ count: current.length, bytes }, size, limits)) {
      batches.push(current)
      current = []
      bytes = 0
    }
    current.push(request)
    bytes += size
  }
  if (current.length > 0) batches.push(current)
  return batches
}

// ---------------------------------------------------------------------------
// Reading the results back
// ---------------------------------------------------------------------------

export interface BatchResults {
  transcriptions: PageTranscription[]
  failures: PageFailure[]
  usage: ApiUsage
  /** custom_ids in the file that name no page of this book. */
  unrecognized: string[]
}

/**
 * Why a request that did not succeed did not succeed, in words.
 *
 * The distinction the user cares about is whether re-reading the page would
 * help, so the message says so rather than repeating an error type at them.
 */
function describeFailure(result: Record<string, unknown>): string {
  const type = result['type']
  if (type === 'expired') {
    return 'The batch expired before this page was read. Nothing was charged for it; reading it again would work.'
  }
  if (type === 'canceled') {
    return 'This page was cancelled before it was read.'
  }
  const error = result['error']
  const inner =
    error && typeof error === 'object' ? ((error as Record<string, unknown>)['error'] ?? error) : {}
  const message =
    typeof (inner as Record<string, unknown>)['message'] === 'string'
      ? String((inner as Record<string, unknown>)['message'])
      : 'no reason given'
  const kind =
    typeof (inner as Record<string, unknown>)['type'] === 'string'
      ? String((inner as Record<string, unknown>)['type'])
      : String(type ?? 'error')
  return `The API refused this page (${kind}): ${message}`
}

/**
 * Parse the JSONL a finished batch produces.
 *
 * `expected` is the list of pages this batch was submitted with, and passing it
 * is what turns a silent gap into a reported one: a page whose result is
 * missing entirely — a truncated download, a line that would not parse, an id
 * the server never echoed — comes back as a `failure` rather than as a book
 * that quietly has no page 143 in it. That is the same rule the engine applies
 * to a footnote it cannot place, and for the same reason: the alternative is
 * the user finding out once it is printed.
 *
 * A line this cannot read at all is counted but not attributed, because a
 * malformed line has no id to attribute it to. The reconciliation against
 * `expected` is what catches it.
 */
export function parseBatchResults(jsonl: string, expected?: readonly number[]): BatchResults {
  const transcriptions: PageTranscription[] = []
  const failures: PageFailure[] = []
  const unrecognized: string[] = []
  const usage: ApiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
  const seen = new Set<number>()

  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let record: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (typeof parsed !== 'object' || parsed === null) continue
      record = parsed as Record<string, unknown>
    } catch {
      // No id, so nothing to attribute it to. `expected` reports the gap.
      continue
    }

    const customId = typeof record['custom_id'] === 'string' ? record['custom_id'] : ''
    const pageIndex = pageIndexOf(customId)
    if (pageIndex === null) {
      if (customId) unrecognized.push(customId)
      continue
    }
    seen.add(pageIndex)

    const result = (record['result'] ?? {}) as Record<string, unknown>
    if (result['type'] !== 'succeeded') {
      failures.push({ pageIndex, message: describeFailure(result) })
      continue
    }

    try {
      const { json, usage: spent } = readMessage(result['message'])
      transcriptions.push(parsePageTranscription(json, pageIndex))
      usage.inputTokens += spent.inputTokens
      usage.outputTokens += spent.outputTokens
      usage.cacheReadTokens += spent.cacheReadTokens
    } catch (err) {
      failures.push({
        pageIndex,
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }

  for (const pageIndex of expected ?? []) {
    if (!seen.has(pageIndex)) {
      failures.push({
        pageIndex,
        message: 'No result came back for this page. It was submitted but nothing was returned.'
      })
    }
  }

  transcriptions.sort((a, b) => a.pageIndex - b.pageIndex)
  failures.sort((a, b) => a.pageIndex - b.pageIndex)
  return { transcriptions, failures, usage, unrecognized }
}

// ---------------------------------------------------------------------------
// The four calls
// ---------------------------------------------------------------------------

const BATCHES_URL = `${API_BASE}/v1/messages/batches`

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** Read the API's batch object into the shape the rest of the app uses. */
export function parseBatchStatus(raw: unknown): BatchStatus {
  if (typeof raw !== 'object' || raw === null) {
    throw new TranscribeError('Malformed batch response', null, false)
  }
  const record = raw as Record<string, unknown>
  const id = record['id']
  if (typeof id !== 'string' || !id) {
    throw new TranscribeError('Batch response carried no id', null, false)
  }
  const counts = (record['request_counts'] ?? {}) as Record<string, unknown>
  const status = record['processing_status']
  return {
    id,
    processingStatus:
      status === 'ended' || status === 'canceling' || status === 'in_progress'
        ? status
        : 'in_progress',
    counts: {
      processing: num(counts['processing']),
      succeeded: num(counts['succeeded']),
      errored: num(counts['errored']),
      canceled: num(counts['canceled']),
      expired: num(counts['expired'])
    },
    resultsUrl: typeof record['results_url'] === 'string' ? record['results_url'] : null,
    createdAt: typeof record['created_at'] === 'string' ? record['created_at'] : '',
    expiresAt: typeof record['expires_at'] === 'string' ? record['expires_at'] : ''
  }
}

/** Submit one batch. Throws `TranscribeError`; the caller decides on retry. */
export async function createBatch(
  config: ClientConfig,
  requests: readonly BatchRequest[]
): Promise<BatchStatus> {
  if (requests.length === 0)
    throw new TranscribeError('A batch needs at least one page', null, false)
  const transport = config.transport ?? fetch
  const response = await transport(BATCHES_URL, {
    method: 'POST',
    headers: apiHeaders(config.apiKey),
    body: JSON.stringify({ requests })
  })
  await throwIfFailed(response)
  return parseBatchStatus(await response.json())
}

/** Where a batch has got to. */
export async function retrieveBatch(config: ClientConfig, batchId: string): Promise<BatchStatus> {
  const transport = config.transport ?? fetch
  const response = await transport(`${BATCHES_URL}/${encodeURIComponent(batchId)}`, {
    method: 'GET',
    headers: apiHeaders(config.apiKey)
  })
  await throwIfFailed(response)
  return parseBatchStatus(await response.json())
}

/**
 * The raw JSONL of a finished batch.
 *
 * Prefers the `results_url` the batch itself carries over a path built here —
 * the server is entitled to move it, and following its own pointer is how this
 * keeps working when it does.
 */
export async function fetchBatchResults(
  config: ClientConfig,
  batch: { id: string; resultsUrl?: string | null }
): Promise<string> {
  const transport = config.transport ?? fetch
  const url = batch.resultsUrl || `${BATCHES_URL}/${encodeURIComponent(batch.id)}/results`
  const response = await transport(url, { method: 'GET', headers: apiHeaders(config.apiKey) })
  await throwIfFailed(response)
  return response.text()
}

/** Stop a batch. Pages already read are still charged and still collectable. */
export async function cancelBatch(config: ClientConfig, batchId: string): Promise<BatchStatus> {
  const transport = config.transport ?? fetch
  const response = await transport(`${BATCHES_URL}/${encodeURIComponent(batchId)}/cancel`, {
    method: 'POST',
    headers: apiHeaders(config.apiKey)
  })
  await throwIfFailed(response)
  return parseBatchStatus(await response.json())
}
