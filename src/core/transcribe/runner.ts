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
import type { LexiconEntry } from '@core/lexicon'
import { buildPagePrompt, buildSystemPrompt, tailOf, type OrthographyPolicy } from './prompt'
import { transcribePage, TranscribeError, type ClientConfig, type ApiUsage } from './client'
import { transcriptionText, type PageTranscription } from './schema'
import { verifyPage, type VerificationFinding } from './verify'
import type { OcrWordLike } from './types'

/** What the caller must provide for each page. */
export interface PageSource {
  pageIndex: number
  /** Base64 PNG of the page, without a data: prefix. */
  imageBase64: string
  ocrText: string
  ocrWords: readonly OcrWordLike[]
}

export interface RunOptions {
  client: ClientConfig
  lexicon: readonly LexiconEntry[]
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
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal?.aborted) {
        cancelled = true
        break
      }
      try {
        const result = await transcribePage(client, {
          pageIndex: source.pageIndex,
          imageBase64: source.imageBase64,
          systemPrompt,
          userPrompt
        })
        done.set(source.pageIndex, result.transcription)
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

    if (lastError) {
      // One bad page must not sink the book; record it and carry on.
      failures.push({ pageIndex: source.pageIndex, message: lastError })
    }

    onProgress?.({ page: i + 1, total: pages.length, usage, failed: failures.length })
  }

  const transcriptions = [...done.values()].sort((a, b) => a.pageIndex - b.pageIndex)

  // Deterministic verification — evidence, never the model's self-assessment.
  const byIndex = new Map(pages.map((p) => [p.pageIndex, p]))
  const findings: VerificationFinding[] = []
  for (const t of transcriptions) {
    const source = byIndex.get(t.pageIndex)
    if (source) findings.push(...verifyPage(t, source.ocrWords))
  }

  return { transcriptions, findings, failures, usage, cancelled }
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
