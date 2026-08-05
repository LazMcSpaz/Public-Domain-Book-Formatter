/**
 * Prompt construction for the vision pass.
 *
 * Kept in `core` (not in the client) so it is version-controlled, reviewable,
 * and unit-testable — the prompt is the most behaviour-defining part of this
 * feature, and it should not be buried in a network call.
 *
 * Two things do the heavy lifting:
 *   1. The **book's own lexicon** — harvested at recon and confirmed by the user
 *      — so ambiguous pixels resolve toward what this book actually says rather
 *      than toward modern English.
 *   2. An explicit **facsimile, not edit** stance. Without it a model
 *      "helpfully" modernizes archaic spelling and quietly destroys the
 *      character of the text.
 */
import type { LexiconEntry } from '@core/lexicon'

export type OrthographyPolicy = 'preserve' | 'modernize'

export interface PromptOptions {
  /** Terms the user confirmed at Gate 1. */
  lexicon: readonly LexiconEntry[]
  orthography: OrthographyPolicy
  /** Convert long-s (ſ) to a modern s. */
  normalizeLongS: boolean
  /** Free-text context the user gave about the book. */
  bookContext?: string
  /** Tail of the previous page's text, so paragraph seams stitch correctly. */
  previousTail?: string
}

/**
 * The system prompt: stable across every page of a run, so it caches well and
 * the per-page request stays small.
 */
export function buildSystemPrompt(options: PromptOptions): string {
  const parts: string[] = []

  parts.push(
    `You are transcribing a scanned public-domain book so it can be reprinted.`,
    `You are given a page image and the raw OCR text for that page. The OCR is`,
    `unreliable and is provided only as a hint — read the IMAGE and let the`,
    `pixels decide. Where the OCR and the image disagree, the image wins.`
  )

  parts.push(
    ``,
    `THIS IS A FACSIMILE, NOT AN EDIT.`,
    options.orthography === 'preserve'
      ? `Preserve the original spelling, grammar, capitalization, and punctuation` +
          ` exactly as printed. Archaic and unusual spellings are CORRECT — do not` +
          ` modernize them, and do not substitute a similar modern word.`
      : `Modernize archaic spelling to current standard English, but do not` +
          ` rewrite, abridge, or reorder the author's sentences.`
  )

  if (options.normalizeLongS) {
    parts.push(`Render the long-s (ſ) as a normal "s".`)
  }

  parts.push(
    ``,
    `WHAT TO REMOVE:`,
    `Running heads and page numbers are page furniture, not content. Report them`,
    `in "furniture" and leave them OUT of the blocks — if they stay in, they end`,
    `up interleaved into the middle of paragraphs.`
  )

  parts.push(
    ``,
    `WHAT TO RECOVER:`,
    `Classify the page's role. Split the text into blocks by what each run of`,
    `text IS — paragraph, heading, block quote, verse, epigraph, caption,`,
    `footnote, list item. Join words hyphenated across line breaks. Reflow lines`,
    `into whole paragraphs; do not preserve the original line wrapping. Mark`,
    `continuesPrevious/continuesNext when a paragraph runs across the page edge.`
  )

  parts.push(
    ``,
    `FRONT MATTER:`,
    `On a title page, half-title, or copyright page, extract the bibliographic`,
    `details into "metadata" (title, author, original year, publisher, place).`,
    `These pages are a source of data for a NEW edition, so a verbatim`,
    `transcription of them is not needed.`
  )

  parts.push(
    ``,
    `WHEN YOU CANNOT READ SOMETHING:`,
    `Report it in "uncertain" with your best guess and the plausible`,
    `alternatives. Do NOT silently pick a confident-looking word — a flagged`,
    `uncertainty gets checked by a human against the scan, while a wrong guess`,
    `that looks right does not.`
  )

  const lexiconBlock = buildLexiconBlock(options.lexicon)
  if (lexiconBlock) parts.push(``, lexiconBlock)

  if (options.bookContext?.trim()) {
    parts.push(``, `ABOUT THIS BOOK:`, options.bookContext.trim())
  }

  return parts.join('\n')
}

/**
 * The confirmed vocabulary, rendered as an instruction. This is the single most
 * effective defence against a model "correcting" `chirurgeon` into `surgeon`.
 */
export function buildLexiconBlock(entries: readonly LexiconEntry[]): string {
  if (entries.length === 0) return ''
  const terms = entries.map((e) => e.term).join(', ')
  return [
    `KNOWN VOCABULARY IN THIS WORK.`,
    `These spellings have been confirmed as correct for this book. Prefer them`,
    `over similar modern words when the pixels are ambiguous, and reproduce them`,
    `exactly:`,
    terms
  ].join('\n')
}

/** The per-page text half of the request (the image is attached alongside). */
export function buildPagePrompt(options: {
  pageIndex: number
  pageCount: number
  ocrText: string
  previousTail?: string
}): string {
  const parts: string[] = [`Page ${options.pageIndex + 1} of ${options.pageCount}.`]

  if (options.previousTail?.trim()) {
    parts.push(
      ``,
      `The previous page ended with the text below. If this page opens by`,
      `continuing that sentence or paragraph, set continuesPrevious on the first`,
      `block. Do not repeat this text in your output:`,
      `"""`,
      options.previousTail.trim().slice(-400),
      `"""`
    )
  }

  parts.push(
    ``,
    `Raw OCR for this page (a hint only — trust the image over this):`,
    `"""`,
    options.ocrText.trim() || '(no OCR text)',
    `"""`
  )

  return parts.join('\n')
}

/** Last few sentences of a page, used as the next page's seam context. */
export function tailOf(text: string, chars = 400): string {
  const trimmed = text.trim()
  return trimmed.length <= chars ? trimmed : trimmed.slice(-chars)
}
