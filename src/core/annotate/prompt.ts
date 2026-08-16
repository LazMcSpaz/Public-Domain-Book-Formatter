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
import {
  NOT_PROSE,
  buildHarvestBlock,
  type BookChunk,
  type BookFacts,
  type HarvestPromptOptions
} from '@core/harvest'
import { voiceBlock, type EditorVoice } from './voice'

/**
 * Chunking lives in `@core/harvest` because both passes over a finished book
 * need it and neither owns it. Re-exported here so the annotation pass's own
 * callers keep reading as they did.
 */
export { CHUNK_WORDS, OVERLAP_WORDS, chunkBlocks, contextFor, type BookChunk } from '@core/harvest'

/** Kinds that carry no prose a note could hang inside. */
const UNANNOTATABLE = NOT_PROSE

/**
 * The instruction, identical for every chunk of a run so it can be cached.
 *
 * The voice card is the bulk of it, which is the point: the expensive, carefully
 * written half of the prompt is paid for once per run rather than once per
 * chunk.
 */
export function buildAnnotationSystemPrompt(
  voice: EditorVoice,
  facts: BookFacts = {},
  harvest?: HarvestPromptOptions
): string {
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

  // The harvest rides this same request when it is wanted, which is what makes
  // it nearly free: the book is already being read and this instruction is
  // cached with the rest of the system prompt.
  if (harvest) parts.push(``, buildHarvestBlock(harvest))

  return parts.join('\n')
}

/** The chunk itself, as the user turn. */
export function buildAnnotationUserPrompt(
  chunk: BookChunk,
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
