/**
 * The book-level transcription runner.
 *
 * Drives page-by-page transcription with the properties a paid, long-running
 * job needs:
 *   - **Checkpointing** — a failure at page 250 must not re-bill the first 249.
 *   - **Cancellation** — the user can stop and keep what's done.
 *   - **Bounded retry** — transient failures retry; a bad API key does not.
 *   - **Seam context** — each page sees the tail of the previous page's text so
 *     paragraphs stitch across the page boundary.
 *   - **Per-page isolation** — one page failing never aborts the book.
 *
 * Pure orchestration: page images and the transport are supplied by the caller,
 * so this is fully testable without a browser or a network.
 */
import { applyTermCorrections, type LexiconEntry, type TermCorrection } from '@core/lexicon'
import { buildPagePrompt, buildSystemPrompt, tailOf, type OrthographyPolicy } from './prompt'
import { transcribePage, TranscribeError, type ClientConfig, type ApiUsage } from './client'
import { transcriptionText, type PageTranscription } from './schema'
import { verifyPage, type VerificationFinding } from './verify'
import type { OcrWordLike } from './types'

/** What the caller must provide for each page. */
export interface PageSource {
  pageIndex: number
  /**
   * Produces the page's base64 PNG on demand, without a data: prefix.
   *
   * A *function*, not a string, and that is the whole point: a 1568px page
   * encodes to roughly 1-3 MB of base64, and JavaScript strings are UTF-16, so
   * holding a 300-page book's images at once costs over a gigabyte and takes
   * the tab down. The runner calls this immediately before the request and
   * drops the result immediately after, so peak usage is one page.
   */
  image: () => Promise<string>
  ocrText: string
  ocrWords: readonly OcrWordLike[]
}

export interface RunOptions {
  client: ClientConfig
  lexicon: readonly LexiconEntry[]
  /**
   * Misreadings the user corrected at Gate 1, applied to what the model returns.
   *
   * Belt as well as braces. The corrected spelling is already in the prompt, but
   * a vision model reading the same smudge can land on the same wrong answer —
   * and the gate promised the fix would hold everywhere in the book, not
   * usually.
   */
  termCorrections?: readonly TermCorrection[]
  orthography: OrthographyPolicy
  normalizeLongS: boolean
  bookContext?: string
  /** Attempts per page, including the first. Default 3. */
  maxAttempts?: number
  /** Delay between retries, ms. Default 1000 (doubled each attempt). */
  retryDelayMs?: number
  /** Pages already done from a previous run — skipped and kept. */
  resumeFrom?: readonly PageTranscription[]
  onProgress?: (p: RunProgress) => void
  /**
   * Called with everything read so far, so the caller can store it mid-run.
   *
   * Without it, a book is only saved once it is entirely finished, and a tab
   * that dies at page 180 of 300 has spent the money and kept nothing. Awaited,
   * so a slow write throttles the run rather than piling up behind it — and any
   * error is the caller's to swallow, because failing to *save* a page is not a
   * reason to stop *reading* the book.
   */
  onCheckpoint?: (progress: {
    transcriptions: readonly PageTranscription[]
    failures: readonly PageFailure[]
    usage: ApiUsage
  }) => void | Promise<void>
  /** Pages between checkpoints. Default 5. */
  checkpointEvery?: number
  signal?: AbortSignal
  /** Injectable sleep, so tests don't actually wait. */
  sleep?: (ms: number) => Promise<void>
}

export interface RunProgress {
  page: number
  total: number
  /** Running token spend, for the live cost readout. */
  usage: ApiUsage
  /** Pages that failed all attempts. */
  failed: number
}

export interface PageFailure {
  pageIndex: number
  message: string
}

export interface RunResult {
  transcriptions: PageTranscription[]
  findings: VerificationFinding[]
  failures: PageFailure[]
  usage: ApiUsage
  /** True when the run was cancelled before finishing. */
  cancelled: boolean
}

/**
 * Rewrite a page's blocks through the term corrections.
 *
 * Returns the page unchanged when there is nothing to do, so a book with no
 * corrections allocates nothing and the common case costs one comparison.
 *
 * Exported for the batch path, which applies the same corrections on the way
 * *in* from the results file. Gate 1 promised that confirming a word fixes it
 * book-wide, and a promise that holds only on one of the two doors is not one.
 */
export function correctTerms(
  page: PageTranscription,
  corrections: readonly TermCorrection[] | undefined
): PageTranscription {
  if (!corrections || corrections.length === 0) return page
  return {
    ...page,
    blocks: page.blocks.map((block) => {
      const { text, replaced } = applyTermCorrections(block.text, corrections)
      return replaced > 0 ? { ...block, text } : block
    })
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export async function runTranscription(
  pages: readonly PageSource[],
  options: RunOptions
): Promise<RunResult> {
  const {
    client,
    maxAttempts = 3,
    retryDelayMs = 1000,
    onProgress,
    onCheckpoint,
    checkpointEvery = 5,
    signal,
    sleep = defaultSleep
  } = options

  const systemPrompt = buildSystemPrompt({
    lexicon: options.lexicon,
    orthography: options.orthography,
    normalizeLongS: options.normalizeLongS,
    bookContext: options.bookContext
  })

  // Resume: keep completed pages and skip them entirely.
  const done = new Map<number, PageTranscription>()
  for (const t of options.resumeFrom ?? []) done.set(t.pageIndex, t)

  const failures: PageFailure[] = []
  const usage: ApiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
  let previousTail = ''
  let cancelled = false
  let sinceCheckpoint = 0

  const ordered = (): PageTranscription[] =>
    [...done.values()].sort((a, b) => a.pageIndex - b.pageIndex)

  const checkpoint = async (): Promise<void> => {
    if (!onCheckpoint) return
    sinceCheckpoint = 0
    try {
      await onCheckpoint({ transcriptions: ordered(), failures, usage })
    } catch {
      // A failed write must not end a run the user is paying for. The caller
      // reports it; this loop carries on reading.
    }
  }

  for (const [i, source] of pages.entries()) {
    if (signal?.aborted) {
      cancelled = true
      break
    }

    const existing = done.get(source.pageIndex)
    if (existing) {
      previousTail = tailOf(transcriptionText(existing))
      onProgress?.({ page: i + 1, total: pages.length, usage, failed: failures.length })
      continue
    }

    const userPrompt = buildPagePrompt({
      pageIndex: source.pageIndex,
      pageCount: pages.length,
      ocrText: source.ocrText,
      previousTail
    })

    let lastError = ''
    // Scoped to this iteration so the image is collectable as soon as the page
    // is done, whether it succeeded or failed.
    let imageBase64: string | null = null
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal?.aborted) {
        cancelled = true
        break
      }
      try {
        // Rendered once and reused across retries — a retry is a network
        // problem, not a reason to re-render the page.
        imageBase64 ??= await source.image()
        const result = await transcribePage(client, {
          pageIndex: source.pageIndex,
          imageBase64,
          systemPrompt,
          userPrompt
        })
        done.set(source.pageIndex, correctTerms(result.transcription, options.termCorrections))
        usage.inputTokens += result.usage.inputTokens
        usage.outputTokens += result.usage.outputTokens
        usage.cacheReadTokens += result.usage.cacheReadTokens
        previousTail = tailOf(transcriptionText(result.transcription))
        lastError = ''
        break
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        const retryable = err instanceof TranscribeError ? err.retryable : true
        if (!retryable || attempt === maxAttempts) break
        await sleep(retryDelayMs * 2 ** (attempt - 1))
      }
    }

    imageBase64 = null

    if (lastError) {
      // One bad page must not sink the book; record it and carry on.
      failures.push({ pageIndex: source.pageIndex, message: lastError })
    }

    onProgress?.({ page: i + 1, total: pages.length, usage, failed: failures.length })

    sinceCheckpoint += 1
    if (sinceCheckpoint >= checkpointEvery) await checkpoint()
  }

  // The last few pages, and the cancelled case: stopping is exactly when the
  // pages read since the last checkpoint are most at risk of being lost.
  if (sinceCheckpoint > 0) await checkpoint()

  const transcriptions = ordered()
  return { transcriptions, findings: verifyRun(transcriptions, pages), failures, usage, cancelled }
}

/**
 * Cross-check every page against the OCR of that page.
 *
 * Deterministic — evidence, never the model's self-assessment (SPEC §4). Shared
 * with the batch path, which collects the same transcriptions a day later and
 * must be held to exactly the same checks: a finding that only the live runner
 * produces is a gate that quietly stops working when the user takes the cheaper
 * door.
 */
export function verifyRun(
  transcriptions: readonly PageTranscription[],
  pages: readonly { pageIndex: number; ocrWords: readonly OcrWordLike[] }[]
): VerificationFinding[] {
  const byIndex = new Map(pages.map((p) => [p.pageIndex, p]))
  const findings: VerificationFinding[] = []
  for (const t of transcriptions) {
    const source = byIndex.get(t.pageIndex)
    if (source) findings.push(...verifyPage(t, source.ocrWords))
  }
  return findings
}

/** Merge the metadata found across front-matter pages, first non-empty wins. */
export function mergeMetadata(
  transcriptions: readonly PageTranscription[]
): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const t of transcriptions) {
    if (!t.metadata) continue
    for (const [key, value] of Object.entries(t.metadata)) {
      if (typeof value === 'string' && value.trim() && !merged[key]) {
        merged[key] = value.trim()
      }
    }
  }
  return merged
}
