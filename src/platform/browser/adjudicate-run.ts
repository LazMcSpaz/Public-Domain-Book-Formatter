/**
 * Browser glue for the second reading.
 *
 * Renders each flagged leaf at the resolution the model reads at, sends it, and
 * lets the image go before rendering the next — the same memory rule the
 * transcription runner follows, for the same reason: a book's worth of decoded
 * pages will not fit in a tab. It matters more here than it looks, because the
 * leaves this pass touches are by definition the dense, difficult ones.
 *
 * Only leaves with something flagged on them are rendered at all. On a book the
 * checks were happy with, this does nothing and costs nothing.
 */
import {
  runAdjudication,
  type AdjudicateProgress,
  type AdjudicateResult,
  type LeafToCheck
} from '@core/adjudicate'
import type { ClientConfig } from '@core/transcribe'
import { openPdf } from './pdf'
import { renderPageToBase64 } from './page-image'

/** One leaf's flagged spots, before its image has been made. */
export interface FlaggedLeaf {
  pageIndex: number
  transcription: string
  spots: LeafToCheck['spots']
}

export interface BrowserAdjudicateOptions {
  fileData: ArrayBuffer | Blob
  leaves: readonly FlaggedLeaf[]
  client: ClientConfig
  /** Long edge of the image sent — the dominant cost, as ever. */
  imageLongEdge?: number
  onProgress?: (p: AdjudicateProgress) => void
  signal?: AbortSignal
}

function empty(): AdjudicateResult {
  return {
    spots: new Map(),
    failures: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    cancelled: false
  }
}

/** Fold one leaf's answer into the running total. */
function merge(into: AdjudicateResult, from: AdjudicateResult): void {
  for (const [id, spot] of from.spots) into.spots.set(id, spot)
  into.failures.push(...from.failures)
  into.usage.inputTokens += from.usage.inputTokens
  into.usage.outputTokens += from.usage.outputTokens
  into.usage.cacheReadTokens += from.usage.cacheReadTokens
}

/**
 * Look again at every flagged leaf.
 *
 * The loop is here rather than in core because only this side can render a
 * page: core's runner takes leaves whose images already exist, which is what
 * makes it testable without a browser. So this drives it a leaf at a time and
 * keeps the running total, and the image for leaf N is unreachable by the time
 * leaf N+1 is drawn.
 */
export async function runBrowserAdjudication(
  options: BrowserAdjudicateOptions
): Promise<AdjudicateResult> {
  const total = empty()
  const wanted = options.leaves.filter((l) => l.spots.length > 0)
  if (wanted.length === 0) return total

  const doc = await openPdf(options.fileData)

  for (const [i, leaf] of wanted.entries()) {
    if (options.signal?.aborted) {
      total.cancelled = true
      break
    }

    const one = await runAdjudication(
      [
        {
          pageIndex: leaf.pageIndex,
          transcription: leaf.transcription,
          spots: leaf.spots,
          imageBase64: await renderPageToBase64(doc, leaf.pageIndex, options.imageLongEdge ?? 1568)
        }
      ],
      {
        client: options.client,
        ...(options.signal ? { signal: options.signal } : {})
      }
    )

    merge(total, one)
    if (one.cancelled) total.cancelled = true
    options.onProgress?.({
      leaf: i + 1,
      total: wanted.length,
      settled: total.spots.size,
      usage: total.usage
    })
    if (total.cancelled) break
  }

  return total
}
