/**
 * Running the annotation pass over a whole book.
 *
 * The same shape as the transcription runner and for the same reasons —
 * retries with backoff, a cancel that takes effect between chunks, running
 * usage so the cost can be reported against the estimate — but with one
 * important difference in what a failure means.
 *
 * A page that fails to transcribe is a hole in the book. A chunk that fails to
 * annotate is some suggestions the user never sees, in a list of suggestions
 * they are about to accept or reject one at a time. So this runner does not
 * fail the run on a bad chunk: it records the failure, reports it, and carries
 * on. Refusing to annotate the other three hundred pages because chunk nine
 * returned malformed JSON would be the wrong trade.
 *
 * Pure orchestration: the transport is injected, so the whole of this is
 * testable with no key and no spend.
 */
import { callModel, TranscribeError, type ApiUsage, type ClientConfig } from '@core/transcribe'
import type { BookBlock } from '@core/assemble'
import {
  checkFacts,
  dedupeFacts,
  parseFacts,
  topTags,
  type BookFacts,
  type Fact,
  type HarvestPromptOptions
} from '@core/harvest'
import {
  buildAnnotationSystemPrompt,
  buildAnnotationUserPrompt,
  chunkBlocks,
  contextFor,
  type BookChunk
} from './prompt'
import { ANNOTATION_SCHEMA, checkProposals, parseAnnotations, type CheckedProposal } from './schema'
import type { EditorVoice } from './voice'

export interface AnnotationRunOptions {
  client: ClientConfig
  voice: EditorVoice
  facts?: BookFacts
  /**
   * Harvest entries for the fact bank from the same replies.
   *
   * Omit to annotate only. Supplying it costs output tokens and nothing else —
   * the book is already being read and the instruction is cached — which is
   * why this rides here rather than running as a second pass.
   */
  harvest?: HarvestPromptOptions & { sourceKey: string }
  /** Words of the book per request. Defaults to `CHUNK_WORDS`. */
  chunkWords?: number
  maxAttempts?: number
  onProgress?: (done: number, total: number) => void
  /** Polled between chunks, so cancelling costs at most one more request. */
  isCancelled?: () => boolean
  /**
   * Chunks an earlier run already paid for, and this one must not read again.
   *
   * The proposals from those chunks are the caller's to hold — this returns
   * only what it read itself — because merging is where the run and the record
   * on disk would otherwise get two chances to disagree.
   */
  resumeFrom?: number
  /**
   * Called after every chunk with everything read *so far in this run*.
   *
   * Awaited, so a slow write throttles the run rather than piling up behind it,
   * and any error is the caller's to swallow: failing to save a chunk is not a
   * reason to stop reading a book. Every chunk that has come back is billed for
   * whether or not the next one arrives, which is the whole reason this exists.
   */
  onCheckpoint?: (progress: {
    chunksDone: number
    chunksTotal: number
    result: AnnotationRunResult
  }) => void | Promise<void>
  sleep?: (ms: number) => Promise<void>
}

export interface ChunkFailure {
  chunkIndex: number
  message: string
}

export interface AnnotationRunResult {
  proposals: CheckedProposal[]
  /** Bank entries harvested alongside the notes. Empty when none was asked for. */
  facts: Fact[]
  failures: ChunkFailure[]
  /** Entries the reply contained that were not usable notes. */
  discarded: number
  usage: ApiUsage
  cancelled: boolean
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/** The request body for one chunk. Exported so a test can read it without a network. */
export function buildAnnotationBody(
  config: ClientConfig,
  systemPrompt: string,
  userPrompt: string
): Record<string, unknown> {
  return {
    model: config.modelId,
    max_tokens: config.maxTokens ?? 4000,
    system: [
      {
        // Identical for every chunk of a run, so the voice card — the long,
        // carefully written half of the prompt — is paid for once.
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' }
      }
    ],
    output_config: {
      // Unlike transcription, which is perception, deciding what deserves a note
      // and writing it well is the reasoning part of this app.
      effort: config.effort ?? 'high',
      format: { type: 'json_schema', schema: ANNOTATION_SCHEMA }
    },
    messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }]
  }
}

/**
 * Annotate a book.
 *
 * Proposals come back located and checked — see `checkProposals` — because the
 * review screen needs to show the passage beside every note, and a note that
 * could not be located is something the user has to be told about rather than
 * something to attach at a guessed offset.
 */
export async function runAnnotation(
  blocks: readonly BookBlock[],
  options: AnnotationRunOptions
): Promise<AnnotationRunResult> {
  const sleep = options.sleep ?? defaultSleep
  const maxAttempts = options.maxAttempts ?? 3
  const chunks = chunkBlocks(blocks, options.chunkWords)

  const systemPrompt = buildAnnotationSystemPrompt(options.voice, options.facts, options.harvest)
  const knownTags = options.harvest?.vocabulary ? topTags(options.harvest.vocabulary) : []
  const blockText = new Map(blocks.map((b) => [b.id, b.text]))
  const bookText = blocks.map((b) => b.text).join('\n')

  const proposals: CheckedProposal[] = []
  const facts: Fact[] = []
  const failures: ChunkFailure[] = []
  const usage: ApiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
  let discarded = 0
  let cancelled = false

  const resumeFrom = Math.max(0, Math.min(options.resumeFrom ?? 0, chunks.length))

  const result = (): AnnotationRunResult => ({
    proposals,
    facts: dedupeFacts(facts),
    failures,
    discarded,
    usage,
    cancelled
  })

  const checkpoint = async (chunksDone: number): Promise<void> => {
    if (!options.onCheckpoint) return
    try {
      await options.onCheckpoint({ chunksDone, chunksTotal: chunks.length, result: result() })
    } catch {
      // A failed write must not end a run the user is paying for. The caller
      // reports it; this loop carries on reading.
    }
  }

  for (const [i, chunk] of chunks.entries()) {
    // Already read and already paid for. Skipped rather than re-sent, which is
    // the entire point of resuming.
    if (i < resumeFrom) continue

    if (options.isCancelled?.()) {
      cancelled = true
      break
    }

    const context = contextFor(chunks[i - 1])
    const userPrompt = buildAnnotationUserPrompt(chunk, context)
    // Only the chunk's own blocks may be annotated. The overlap is there to be
    // read, and a note on it would duplicate one from the previous chunk.
    const ownIds = new Set(chunk.blocks.map((b) => b.id))

    const outcome = await annotateChunk({
      chunk,
      config: options.client,
      systemPrompt,
      userPrompt,
      ownIds,
      maxAttempts,
      sleep,
      knownTags
    })

    usage.inputTokens += outcome.usage.inputTokens
    usage.outputTokens += outcome.usage.outputTokens
    usage.cacheReadTokens += outcome.usage.cacheReadTokens

    if (outcome.error) {
      failures.push({ chunkIndex: chunk.index, message: outcome.error })
    } else {
      discarded += outcome.discarded
      proposals.push(...checkProposals(outcome.proposals, blockText, bookText))
      if (options.harvest) {
        facts.push(...checkFacts(outcome.facts, blocks, options.harvest.sourceKey))
      }
    }

    options.onProgress?.(i + 1, chunks.length)
    await checkpoint(i + 1)
  }

  // No final write on the way out: the cancel is checked *before* a chunk is
  // sent, so the checkpoint after the last completed chunk already says exactly
  // how far the run got. A cancel on the very first chunk read nothing and has
  // nothing to record.
  return result()
}

interface ChunkOutcome {
  proposals: ReturnType<typeof parseAnnotations>['proposals']
  facts: ReturnType<typeof parseFacts>['facts']
  discarded: number
  usage: ApiUsage
  error?: string
}

async function annotateChunk(args: {
  chunk: BookChunk
  config: ClientConfig
  systemPrompt: string
  userPrompt: string
  ownIds: ReadonlySet<string>
  maxAttempts: number
  sleep: (ms: number) => Promise<void>
  knownTags: readonly string[]
}): Promise<ChunkOutcome> {
  const usage: ApiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
  let lastError = 'unknown error'

  for (let attempt = 1; attempt <= args.maxAttempts; attempt++) {
    try {
      const { json, usage: used } = await callModel(
        args.config,
        buildAnnotationBody(args.config, args.systemPrompt, args.userPrompt)
      )
      usage.inputTokens += used.inputTokens
      usage.outputTokens += used.outputTokens
      usage.cacheReadTokens += used.cacheReadTokens

      const { proposals, discarded } = parseAnnotations(json, args.ownIds)
      // A malformed harvest never costs the notes from the same reply: the two
      // are independent lists, and the notes are the part with a deadline.
      const harvested = parseFacts(json, args.knownTags)
      return {
        proposals,
        facts: harvested.facts,
        discarded: discarded + harvested.discarded,
        usage
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      const retryable = err instanceof TranscribeError ? err.retryable : true
      if (!retryable || attempt === args.maxAttempts) break
      await args.sleep(500 * 2 ** (attempt - 1))
    }
  }

  return { proposals: [], facts: [], discarded: 0, usage, error: lastError }
}
