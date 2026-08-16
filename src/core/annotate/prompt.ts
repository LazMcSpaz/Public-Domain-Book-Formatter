/**
 * What the annotation pass is asked, and how the book is cut up to ask it.
 *
 * The pass reads the book in runs of consecutive blocks rather than page by
 * page. Pages are an accident of the original printing — a paragraph worth a
 * note routinely straddles two of them — and the notes are set in *this*
 * edition's pagination anyway, which does not exist yet. Consecutive prose is
 * what a note needs to be judged against.
 *
 * Pure: a document in, strings out.
 */
import type { BookBlock } from '@core/assemble'
import { voiceBlock, type EditorVoice } from './voice'

/** Facts about the book that help the editor write about it. */
export interface BookFacts {
  title?: string
  author?: string
  /** When the original was published, which is what dates every reference in it. */
  originalYear?: string
  /** Anything the user told the app about the work at Gate 1. */
  context?: string
}

/**
 * A run of consecutive blocks, sent as one request.
 *
 * Sized in words rather than blocks because block length varies by an order of
 * magnitude — a chapter heading and a page of unbroken argument are both one
 * block — and it is words that decide both what the model can hold in view and
 * what the request costs.
 */
export interface AnnotationChunk {
  index: number
  blocks: BookBlock[]
  wordCount: number
}

/** Kinds that carry no prose worth annotating, and that a note cannot hang in. */
const UNANNOTATABLE = new Set(['heading', 'caption', 'footnote', 'table'])

/** How many words of the book go into one request. */
export const CHUNK_WORDS = 1200

/**
 * How much of the previous chunk is repeated at the head of the next.
 *
 * A note often belongs to a sentence whose sense was set up a paragraph
 * earlier, and a chunk boundary would otherwise hide that setup. The overlap
 * blocks are marked as context and explicitly cannot be annotated, so the seam
 * produces neither a blind spot nor a duplicate note.
 */
export const OVERLAP_WORDS = 200

const wordsIn = (text: string): number => text.split(/\s+/u).filter(Boolean).length

/**
 * Cut the body into chunks of roughly `CHUNK_WORDS`, never splitting a block.
 *
 * Blocks that cannot carry a note — headings, captions, notes, tables — are
 * left out of the chunk's own list but still counted, because they are part of
 * what the reader reads and dropping them silently would make a chapter opening
 * look like the middle of a paragraph.
 */
export function chunkBlocks(
  blocks: readonly BookBlock[],
  chunkWords: number = CHUNK_WORDS
): AnnotationChunk[] {
  const chunks: AnnotationChunk[] = []
  let current: BookBlock[] = []
  let words = 0

  const flush = (): void => {
    if (current.length === 0) return
    // A chunk of nothing but headings has nothing to annotate and would be paid
    // for to be told so.
    if (current.some((b) => !UNANNOTATABLE.has(b.kind))) {
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
 * The instruction, identical for every chunk of a run so it can be cached.
 *
 * The voice card is the bulk of it, which is the point: the expensive, carefully
 * written half of the prompt is paid for once per run rather than once per
 * chunk.
 */
export function buildAnnotationSystemPrompt(voice: EditorVoice, facts: BookFacts = {}): string {
  const parts: string[] = []

  parts.push(
    `You are annotating a public-domain book that is being reprinted as a new`,
    `edition. Your notes will be printed at the foot of the pages they belong`,
    `to, under the editor's name, and are the reason this edition is worth`,
    `publishing rather than a straight reprint.`,
    ``
  )

  const about: string[] = []
  if (facts.title?.trim()) about.push(`Title: ${facts.title.trim()}`)
  if (facts.author?.trim()) about.push(`Author: ${facts.author.trim()}`)
  if (facts.originalYear?.trim()) {
    about.push(
      `First published: ${facts.originalYear.trim()} — date every reference in`,
      `the book against this, not against today.`
    )
  }
  if (facts.context?.trim()) about.push(`The editor says of this work: ${facts.context.trim()}`)
  if (about.length > 0) parts.push(`THE BOOK:`, ...about, ``)

  parts.push(voiceBlock(voice))

  parts.push(
    ``,
    `HOW TO ANSWER:`,
    `Return a list of notes. Each names the block it belongs to by its id, and`,
    `quotes the exact words from that block the note hangs on — copy them`,
    `character for character from the text as given, so the note can be attached`,
    `to the right place. Quote just enough to be unambiguous, a few words.`,
    `Blocks marked [context only] are there so you can see what leads up to the`,
    `passage. Do not write notes on them; they are annotated elsewhere.`,
    ``,
    `Two things are worth more than a full list. Never invent a fact to have`,
    `something to say — if you are not sure who someone was, either say what is`,
    `known and mark the doubt in the note itself, or write no note. And never`,
    `annotate a passage that needs no help; a chunk with nothing to explain`,
    `should come back with an empty list, which is a good answer.`
  )

  return parts.join('\n')
}

/** The chunk itself, as the user turn. */
export function buildAnnotationUserPrompt(
  chunk: AnnotationChunk,
  contextBlocks: readonly BookBlock[] = []
): string {
  const parts: string[] = []

  if (contextBlocks.length > 0) {
    parts.push(`What comes immediately before this passage:`, ``)
    for (const block of contextBlocks) {
      parts.push(`[${block.id}] [context only] ${block.text}`, ``)
    }
    parts.push(`---`, ``)
  }

  parts.push(`The passage to annotate:`, ``)
  for (const block of chunk.blocks) {
    const marker = UNANNOTATABLE.has(block.kind) ? ` [${block.kind}, context only]` : ''
    parts.push(`[${block.id}]${marker} ${block.text}`, ``)
  }

  return parts.join('\n')
}

/**
 * The blocks from the end of the previous chunk that lead into this one.
 *
 * Taken from the tail backwards until the overlap budget is spent, so the
 * context handed over is the prose immediately preceding rather than an
 * arbitrary block count.
 */
export function contextFor(
  previous: AnnotationChunk | undefined,
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
