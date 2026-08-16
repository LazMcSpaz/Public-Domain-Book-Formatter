/**
 * Drafting the editor's introduction.
 *
 * The other half of what an editor adds. Notes explain the book line by line;
 * an introduction says what the book *is* and why someone should read this one
 * — which is the piece a reader meets first and the piece a listing quotes.
 *
 * It shares the voice card with the annotation pass, deliberately: an
 * introduction that reads like a different person from the notes underneath it
 * is worse than either alone. Everything about how the editor sounds lives in
 * `voice.ts` and is written once.
 *
 * ## What it is shown
 *
 * The book's own structure — title, author, year, its chapter headings in order
 * — and a *sample* of the prose rather than the whole of it. Sampling is not
 * economising: an introduction is written from the shape of a book and its
 * texture, and a model given three hundred pages writes a summary of the last
 * twenty. Evenly spaced extracts give it the shape and the voice of the work
 * without letting any one chapter dominate.
 *
 * Pure: a document in, a prompt out; the reply parsed and handed back as text.
 */
import type { BookDocument } from '@core/assemble'
import { callModel, type ApiUsage, type ClientConfig } from '@core/transcribe'
import type { BookFacts } from './prompt'
import { outsideClaims } from './schema'
import { voiceBlock, type EditorVoice } from './voice'

/** A drafted introduction, before the user has seen it. */
export interface IntroductionDraft {
  /** What the division is called — usually "Introduction", occasionally not. */
  title: string
  /** The prose, paragraphs separated by blank lines, as a section edit wants. */
  text: string
  /**
   * Dates, figures and names the introduction asserts that the book never did.
   *
   * The same check the notes get, and for the same reason: an introduction
   * makes far more claims than any single note, and this is the list to check
   * rather than the whole draft.
   */
  outsideClaims: string[]
}

export const INTRODUCTION_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    paragraphs: { type: 'array', items: { type: 'string' } }
  },
  required: ['title', 'paragraphs'],
  additionalProperties: false
} as const

/** How long an introduction runs, in words. */
export type IntroductionLength = 'brief' | 'standard' | 'full'

export const INTRODUCTION_WORDS: Record<IntroductionLength, number> = {
  brief: 350,
  standard: 700,
  full: 1400
}

/** How many extracts of the book to show, and how long each runs. */
const SAMPLE_COUNT = 8
const SAMPLE_WORDS = 120

/**
 * Evenly spaced extracts from the body.
 *
 * Spread across the whole book rather than taken from the front, because the
 * opening pages of an old book are the least representative part of it — they
 * are where the dedication and the throat-clearing live.
 */
export function sampleBook(
  doc: BookDocument,
  count: number = SAMPLE_COUNT,
  words: number = SAMPLE_WORDS
): string[] {
  const prose = doc.blocks.filter((b) => b.kind === 'paragraph' && b.text.split(/\s+/u).length > 40)
  if (prose.length === 0) return []

  const step = Math.max(1, Math.floor(prose.length / count))
  const samples: string[] = []
  for (let i = 0; i < prose.length && samples.length < count; i += step) {
    samples.push(prose[i]!.text.split(/\s+/u).slice(0, words).join(' '))
  }
  return samples
}

export interface IntroductionOptions {
  client: ClientConfig
  voice: EditorVoice
  facts?: BookFacts
  length?: IntroductionLength
  /** Anything the user wants said — a theme to draw out, a reason for the edition. */
  brief?: string
}

/** The instruction. Exported so a test can read it without a network. */
export function buildIntroductionPrompt(
  doc: BookDocument,
  options: Omit<IntroductionOptions, 'client'>
): { system: string; user: string } {
  const facts = options.facts ?? {}
  const words = INTRODUCTION_WORDS[options.length ?? 'standard']

  const system = [
    `You are writing the editor's introduction to a new edition of a`,
    `public-domain book. It is the first thing the reader meets, and it is the`,
    `main reason this edition exists rather than a straight reprint.`,
    ``,
    voiceBlock(options.voice),
    ``,
    `WHAT AN INTRODUCTION HAS TO DO:`,
    `Say what the book is and what reading it is like. Place it in its moment —`,
    `who wrote it, when, into what argument or fashion or need. Say what a`,
    `reader today will find strange, and give them what they need to read past`,
    `the strangeness rather than warning them off it. Be honest about what has`,
    `dated and about what has not.`,
    ``,
    `Write about this book, from the extracts given. Do not write the generic`,
    `introduction that would fit any book of the period — if the extracts do not`,
    `tell you something, leave it out rather than filling it in from what books`,
    `like this usually contain.`,
    ``,
    `Do not summarise the plot or the argument chapter by chapter; the reader is`,
    `holding the book. Do not praise it in the abstract. Do not quote a passage`,
    `at length — a phrase is plenty.`,
    ``,
    `Aim for about ${words} words, in paragraphs. Give it a title: "Introduction"`,
    `unless the book calls for something better.`
  ].join('\n')

  const parts: string[] = []
  if (facts.title?.trim()) parts.push(`Title: ${facts.title.trim()}`)
  if (facts.author?.trim()) parts.push(`Author: ${facts.author.trim()}`)
  if (facts.originalYear?.trim()) parts.push(`First published: ${facts.originalYear.trim()}`)
  if (facts.context?.trim()) parts.push(`The editor says of this work: ${facts.context.trim()}`)

  const chapters = doc.chapters.filter((c) => c.level === 1).map((c) => c.title)
  if (chapters.length > 0) {
    parts.push(``, `Its chapters, in order:`, ...chapters.map((t) => `- ${t}`))
  }

  if (options.brief?.trim()) {
    parts.push(``, `The editor wants this introduction to:`, options.brief.trim())
  }

  const samples = sampleBook(doc)
  if (samples.length > 0) {
    parts.push(
      ``,
      `Extracts, evenly spaced through the book, so you can hear it:`,
      ...samples.flatMap((s) => [``, s])
    )
  }

  return { system, user: parts.join('\n') }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Read the reply into a draft. Throws when there is no prose in it at all. */
export function parseIntroduction(raw: unknown): { title: string; text: string } {
  if (!isRecord(raw) || !Array.isArray(raw['paragraphs'])) {
    throw new Error('The reply did not contain an introduction')
  }
  const paragraphs = raw['paragraphs']
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.trim())
    .filter(Boolean)
  if (paragraphs.length === 0) throw new Error('The introduction came back empty')

  const title = typeof raw['title'] === 'string' ? raw['title'].trim() : ''
  return {
    title: title || 'Introduction',
    // Blank lines between paragraphs, which is the convention the section edit
    // already splits on — no markup for anyone to learn.
    text: paragraphs.join('\n\n')
  }
}

/**
 * Draft an introduction.
 *
 * One request, so there is no partial state to reconcile and nothing to
 * checkpoint: it either comes back or it does not, and the user can ask again.
 */
export async function draftIntroduction(
  doc: BookDocument,
  options: IntroductionOptions
): Promise<{ draft: IntroductionDraft; usage: ApiUsage }> {
  const { system, user } = buildIntroductionPrompt(doc, options)

  const { json, usage } = await callModel(options.client, {
    model: options.client.modelId,
    max_tokens: options.client.maxTokens ?? 4000,
    system: [{ type: 'text', text: system }],
    output_config: {
      effort: options.client.effort ?? 'high',
      format: { type: 'json_schema', schema: INTRODUCTION_SCHEMA }
    },
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }]
  })

  const { title, text } = parseIntroduction(json)
  const bookText = doc.blocks.map((b) => b.text).join('\n')

  return { draft: { title, text, outsideClaims: outsideClaims(text, bookText) }, usage }
}
