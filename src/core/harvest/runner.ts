/**
 * Harvesting a book that is not being annotated.
 *
 * When notes are wanted, the harvest rides the annotation reply and costs
 * output tokens only — the expensive half, reading the book, has already been
 * bought. This is the other case: a book worth mining and not worth annotating,
 * which is a real and common thing. It pays for its own reading, and is priced
 * and approved separately.
 *
 * Failure is per chunk and never fatal, as in the annotation runner: a stretch
 * that came back malformed is some entries missing from a file, not a hole in a
 * book.
 *
 * Pure orchestration behind an injected transport.
 */
import { callModel, TranscribeError, type ApiUsage, type ClientConfig } from '@core/transcribe'
import type { BookBlock } from '@core/assemble'
import { chunkBlocks, contextFor, renderChunk, type ChunkOptions } from './chunk'
import { buildHarvestSystemPrompt, type HarvestPromptOptions } from './prompt'
import { FACT_LIST_SCHEMA, checkFacts, dedupeFacts, parseFacts } from './schema'
import { topTags, type Fact } from './fact'
import type { BookFacts } from './source'

export interface HarvestRunOptions extends HarvestPromptOptions {
  client: ClientConfig
  facts?: BookFacts
  /** Identifies the book, so entry ids are stable across re-harvests of it. */
  sourceKey: string
  chunkWords?: number
  maxAttempts?: number
  onProgress?: (done: number, total: number) => void
  isCancelled?: () => boolean
  sleep?: (ms: number) => Promise<void>
}

export interface HarvestRunResult {
  facts: Fact[]
  failures: { chunkIndex: number; message: string }[]
  discarded: number
  usage: ApiUsage
  cancelled: boolean
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The request body for one chunk. Exported so a test can read it without a network. */
export function buildHarvestBody(
  config: ClientConfig,
  systemPrompt: string,
  userPrompt: string
): Record<string, unknown> {
  return {
    model: config.modelId,
    max_tokens: config.maxTokens ?? 8000,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    output_config: {
      // Deciding what is worth keeping is judgement, not perception.
      effort: config.effort ?? 'high',
      format: { type: 'json_schema', schema: FACT_LIST_SCHEMA }
    },
    messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }]
  }
}

/**
 * Read a whole book for the bank.
 *
 * Chunked with `requireProse: false`, unlike the annotation pass: a table of
 * weights or a list of rates carries no prose to annotate and is some of the
 * densest material an old book has.
 */
export async function runHarvest(
  blocks: readonly BookBlock[],
  options: HarvestRunOptions
): Promise<HarvestRunResult> {
  const sleep = options.sleep ?? defaultSleep
  const maxAttempts = options.maxAttempts ?? 3
  const chunkOptions: ChunkOptions = {
    ...(options.chunkWords === undefined ? {} : { chunkWords: options.chunkWords }),
    requireProse: false
  }
  const chunks = chunkBlocks(blocks, chunkOptions)

  const systemPrompt = buildHarvestSystemPrompt(options.facts, options)
  const known = options.vocabulary ? topTags(options.vocabulary) : []

  const facts: Fact[] = []
  const failures: HarvestRunResult['failures'] = []
  const usage: ApiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
  let discarded = 0
  let cancelled = false

  for (const [i, chunk] of chunks.entries()) {
    if (options.isCancelled?.()) {
      cancelled = true
      break
    }

    const userPrompt = renderChunk(chunk, contextFor(chunks[i - 1]), 'harvest')
    let lastError = 'unknown error'
    let done = false

    for (let attempt = 1; attempt <= maxAttempts && !done; attempt++) {
      try {
        const { json, usage: used } = await callModel(
          options.client,
          buildHarvestBody(options.client, systemPrompt, userPrompt)
        )
        usage.inputTokens += used.inputTokens
        usage.outputTokens += used.outputTokens
        usage.cacheReadTokens += used.cacheReadTokens

        const parsed = parseFacts(json, known)
        discarded += parsed.discarded
        facts.push(...checkFacts(parsed.facts, blocks, options.sourceKey))
        done = true
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        const retryable = err instanceof TranscribeError ? err.retryable : true
        if (!retryable || attempt === maxAttempts) break
        await sleep(500 * 2 ** (attempt - 1))
      }
    }

    if (!done) failures.push({ chunkIndex: chunk.index, message: lastError })
    options.onProgress?.(i + 1, chunks.length)
  }

  return { facts: dedupeFacts(facts), failures, discarded, usage, cancelled }
}
