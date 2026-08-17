/**
 * Running the second reading over the flagged leaves.
 *
 * One request per leaf, carrying that leaf's image once and every flagged spot
 * on it. Per *leaf* rather than per spot because the image is nearly all of the
 * cost: a leaf with eight disagreements on it costs the same as a leaf with one,
 * and asking eight times would cost eight times as much for a worse answer,
 * since each question would arrive without the others for context.
 *
 * Clean leaves are never sent. That is what keeps this cheap enough to be worth
 * offering at all — on a typical book it touches ten to thirty per cent of the
 * leaves, and it costs nothing at all on a book the checks were happy with.
 *
 * Pure orchestration: images and the transport come from the caller, so this is
 * testable with no browser and no network.
 */
import { callModel, TranscribeError, type ApiUsage, type ClientConfig } from '@core/transcribe'
import { buildAdjudicationPrompt, buildAdjudicationSystemPrompt } from './prompt'
import {
  ADJUDICATION_SCHEMA,
  parseAdjudication,
  type AdjudicatedSpot,
  type LeafToCheck
} from './schema'

export interface AdjudicateOptions {
  client: ClientConfig
  /** Attempts per leaf, including the first. Default 2. */
  maxAttempts?: number
  onProgress?: (p: AdjudicateProgress) => void
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
}

export interface AdjudicateProgress {
  leaf: number
  total: number
  /** Spots settled so far, for the readout. */
  settled: number
  usage: ApiUsage
}

export interface AdjudicateFailure {
  pageIndex: number
  message: string
}

export interface AdjudicateResult {
  /** Every answered spot, keyed by the discrepancy row's id. */
  spots: Map<string, AdjudicatedSpot>
  failures: AdjudicateFailure[]
  usage: ApiUsage
  cancelled: boolean
}

/** The request body for one leaf: the image, then the questions. */
export function buildAdjudicationBody(
  config: ClientConfig,
  leaf: LeafToCheck
): Record<string, unknown> {
  return {
    model: config.modelId,
    max_tokens: config.maxTokens ?? 2000,
    system: [
      {
        type: 'text',
        text: buildAdjudicationSystemPrompt(),
        // Identical for every leaf of the run, so it caches after the first.
        cache_control: { type: 'ephemeral' }
      }
    ],
    output_config: {
      effort: config.effort ?? 'medium',
      format: { type: 'json_schema', schema: ADJUDICATION_SCHEMA }
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: leaf.imageBase64 }
          },
          { type: 'text', text: buildAdjudicationPrompt(leaf) }
        ]
      }
    ]
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Read every flagged leaf once more.
 *
 * A leaf that fails is recorded and skipped, never retried into the ground and
 * never allowed to stop the rest: its spots simply arrive at the gate
 * unadjudicated, which is exactly what they would have been without this pass.
 * That is the property that makes this safe to offer — the worst outcome of the
 * whole feature is the behaviour that came before it.
 */
export async function runAdjudication(
  leaves: readonly LeafToCheck[],
  options: AdjudicateOptions
): Promise<AdjudicateResult> {
  const { client, maxAttempts = 2, onProgress, signal, sleep = defaultSleep } = options

  const spots = new Map<string, AdjudicatedSpot>()
  const failures: AdjudicateFailure[] = []
  const usage: ApiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
  let cancelled = false

  for (const [i, leaf] of leaves.entries()) {
    if (signal?.aborted) {
      cancelled = true
      break
    }
    if (leaf.spots.length === 0) continue

    const asked = leaf.spots.map((s) => s.id)
    let lastError = ''

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal?.aborted) {
        cancelled = true
        break
      }
      try {
        const { json, usage: spent } = await callModel(client, buildAdjudicationBody(client, leaf))
        for (const spot of parseAdjudication(json, asked)) spots.set(spot.id, spot)
        usage.inputTokens += spent.inputTokens
        usage.outputTokens += spent.outputTokens
        usage.cacheReadTokens += spent.cacheReadTokens
        lastError = ''
        break
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        const retryable = err instanceof TranscribeError ? err.retryable : true
        if (!retryable || attempt === maxAttempts) break
        await sleep(500 * attempt)
      }
    }

    if (lastError) failures.push({ pageIndex: leaf.pageIndex, message: lastError })
    onProgress?.({ leaf: i + 1, total: leaves.length, settled: spots.size, usage })
  }

  return { spots, failures, usage, cancelled }
}

/**
 * What the pass found, in a sentence.
 *
 * Reported rather than assumed: someone who has just paid for a second reading
 * is owed the count, not a screen that silently looks tidier than it did.
 */
export function describeAdjudication(result: AdjudicateResult): string {
  const verdicts = [...result.spots.values()]
  const notThere = verdicts.filter((s) => s.verdict === 'not-there').length
  const missing = verdicts.filter((s) => s.verdict === 'missing').length
  const different = verdicts.filter((s) => s.verdict === 'different').length
  const unsure = verdicts.filter((s) => s.verdict === 'unsure').length

  const parts = [
    `${verdicts.length} spot(s) looked at again`,
    `${notThere} were not on the page`,
    `${missing} really were dropped`
  ]
  if (different > 0) parts.push(`${different} read differently from both`)
  if (unsure > 0) parts.push(`${unsure} could not be settled`)
  if (result.failures.length > 0) {
    parts.push(`${result.failures.length} leaf/leaves could not be checked`)
  }
  return `${parts.join(' · ')}.`
}
