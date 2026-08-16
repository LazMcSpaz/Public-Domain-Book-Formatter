/**
 * Cutting a finished book into runs a model can hold in view.
 *
 * Shared by every pass that reads the whole book — the annotation pass and the
 * fact harvest — because both want the same thing: consecutive prose, in
 * word-sized pieces, with the tail of the previous piece carried over so a
 * sentence whose sense was set up a paragraph earlier is not read blind.
 *
 * Pages are deliberately not the unit. They are an accident of the original
 * printing, a paragraph routinely straddles two of them, and the notes are set
 * in *this* edition's pagination anyway — which does not exist yet.
 *
 * Pure: blocks in, chunks out.
 */
import type { BookBlock } from '@core/assemble'

/**
 * A run of consecutive blocks, sent as one request.
 *
 * Sized in words rather than blocks because block length varies by an order of
 * magnitude — a chapter heading and a page of unbroken argument are both one
 * block — and it is words that decide both what the model can hold in view and
 * what the request costs.
 */
export interface BookChunk {
  index: number
  blocks: BookBlock[]
  wordCount: number
}

/** Kinds that carry no running prose, and that a note cannot hang inside. */
export const NOT_PROSE = new Set(['heading', 'caption', 'footnote', 'table'])

/** How many words of the book go into one request. */
export const CHUNK_WORDS = 1200

/**
 * How much of the previous chunk is repeated at the head of the next.
 *
 * A note often belongs to a sentence whose sense was set up a paragraph
 * earlier, and a chunk boundary would otherwise hide that setup. The overlap
 * blocks are marked as context and explicitly cannot be written about, so the
 * seam produces neither a blind spot nor a duplicate.
 */
export const OVERLAP_WORDS = 200

const wordsIn = (text: string): number => text.split(/\s+/u).filter(Boolean).length

export interface ChunkOptions {
  chunkWords?: number
  /**
   * Skip chunks that contain no running prose at all.
   *
   * True for annotation, where a run of nothing but headings has nothing a note
   * could hang in and would be paid for to be told so. **False for harvesting**,
   * because a table of weights or a list of dates is some of the densest
   * material in an old book — exactly what a fact bank is for.
   */
  requireProse?: boolean
}

/**
 * Cut the body into chunks of roughly `CHUNK_WORDS`, never splitting a block.
 *
 * Blocks that carry no running prose are kept inside the chunk regardless: they
 * are part of what the reader reads, and dropping a heading silently would make
 * a chapter opening look like the middle of a paragraph.
 */
export function chunkBlocks(
  blocks: readonly BookBlock[],
  options: ChunkOptions | number = {}
): BookChunk[] {
  // A bare number keeps the older call sites reading as they did.
  const opts: ChunkOptions = typeof options === 'number' ? { chunkWords: options } : options
  const chunkWords = opts.chunkWords ?? CHUNK_WORDS
  const requireProse = opts.requireProse ?? true

  const chunks: BookChunk[] = []
  let current: BookBlock[] = []
  let words = 0

  const flush = (): void => {
    if (current.length === 0) return
    if (!requireProse || current.some((b) => !NOT_PROSE.has(b.kind))) {
      chunks.push({ index: chunks.length, blocks: current, wordCount: words })
    }
    current = []
    words = 0
  }

  for (const block of blocks) {
    const size = wordsIn(block.text)
    if (words > 0 && words + size > chunkWords) flush()
    current.push(block)
    words += size
  }
  flush()

  return chunks
}

/**
 * The blocks from the end of the previous chunk that lead into this one.
 *
 * Taken from the tail backwards until the overlap budget is spent, so the
 * context handed over is the prose immediately preceding rather than an
 * arbitrary block count.
 */
export function contextFor(
  previous: BookChunk | undefined,
  overlapWords: number = OVERLAP_WORDS
): BookBlock[] {
  if (!previous) return []
  const context: BookBlock[] = []
  let words = 0
  for (let i = previous.blocks.length - 1; i >= 0 && words < overlapWords; i--) {
    const block = previous.blocks[i]!
    context.unshift(block)
    words += wordsIn(block.text)
  }
  return context
}

/** A chunk rendered for a prompt, with each block named by its id. */
export function renderChunk(
  chunk: BookChunk,
  contextBlocks: readonly BookBlock[] = [],
  label = 'annotate'
): string {
  const parts: string[] = []

  if (contextBlocks.length > 0) {
    parts.push(`What comes immediately before this passage:`, ``)
    for (const block of contextBlocks) {
      parts.push(`[${block.id}] [context only] ${block.text}`, ``)
    }
    parts.push(`---`, ``)
  }

  parts.push(`The passage to ${label}:`, ``)
  for (const block of chunk.blocks) {
    const marker = NOT_PROSE.has(block.kind) ? ` [${block.kind}]` : ''
    parts.push(`[${block.id}]${marker} ${block.text}`, ``)
  }

  return parts.join('\n')
}
