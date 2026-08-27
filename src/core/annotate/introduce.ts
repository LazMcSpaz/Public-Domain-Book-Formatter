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
 * The book's own structure — title, author, year, its chapters in order with
 * the analytical description the original contents set under each — a *sample*
 * of the prose rather than the whole of it, and the editor's own front matter
 * from books already published, which is the only place the register is shown
 * rather than described. Sampling is not
 * economising: an introduction is written from the shape of a book and its
 * texture, and a model given three hundred pages writes a summary of the last
 * twenty. Evenly spaced extracts give it the shape and the voice of the work
 * without letting any one chapter dominate.
 *
 * Pure: a document in, a prompt out; the reply parsed and handed back as text.
 */
import type { BookDocument } from '@core/assemble'
import { callModel, type ApiUsage, type ClientConfig } from '@core/transcribe'
import type { BookFacts } from '@core/harvest'
import { toMention, type Ruling } from '@core/queries'
import { GLOSSARY_MARK } from './marks'
import { outsideClaims } from './schema'
import { proseBlock, voiceBlock, type EditorVoice } from './voice'

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
 *
 * The glossary marks come out. They are this edition's apparatus rather than
 * the book's words, and an extract is shown so the writer can hear the author:
 * a `trolley-pole°` in the sample is a degree sign the writer did not put there
 * and may well copy into a quotation.
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
    samples.push(
      prose[i]!.text.replaceAll(GLOSSARY_MARK, '').split(/\s+/u).slice(0, words).join(' ')
    )
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
  /**
   * A shape the editor has already approved, from the outline stage.
   *
   * Optional, and its absence means one-shot drafting — which is what the API
   * path has always done and what the batch door would have to do. When it is
   * present the writing stops being a proposal about *what the piece is* and
   * becomes a proposal about how to say it, which is the only half a model
   * should be deciding on its own.
   */
  outline?: string
  /**
   * What this edition decided about its copy-text, so the introduction can end
   * with a note on the text.
   *
   * Only the rulings the editor marked `mention` reach the prompt, and they
   * reach it as **material rather than sentences**: what was kept and what was
   * set right, in that order. A reprint that silently mends its original is not
   * being faithful, and one that silently keeps an obvious error looks
   * careless; either way the fix is to say so once, and the surest way to say
   * it once is for the writer to be handed it rather than to remember it.
   */
  rulings?: readonly Ruling[]
}

/**
 * The note on the text, as material for the writer.
 *
 * Kept things first, then corrections — the order such a note reads best in,
 * because the first is what the reader will see on the page and the second is
 * what they will not.
 */
export function noteOnTheText(rulings: readonly Ruling[]): string[] {
  const { kept, corrected } = toMention(rulings)
  if (kept.length === 0 && corrected.length === 0) return []

  const lines: string[] = [
    ``,
    `A NOTE ON THE TEXT. End the introduction with a short note — two or three`,
    `sentences, no heading of its own — saying what this edition did to its`,
    `copy-text. State it plainly and without apology: a reprint that silently`,
    `mends its original is not being faithful, and one that silently keeps an`,
    `obvious error looks careless. Do not list the individual places.`
  ]
  if (kept.length > 0) {
    lines.push(``, `Kept as the original printed it:`)
    for (const r of kept) lines.push(`- ${r.quote}${r.because ? ` — ${r.because}` : ''}`)
  }
  if (corrected.length > 0) {
    lines.push(``, `Set right, being plain errors of the setting rather than the author's:`)
    for (const r of corrected) {
      lines.push(`- “${r.quote}”, which now reads “${r.correction ?? ''}”`)
    }
    lines.push(``, `Say that such slips were corrected, and how many; do not name them.`)
  }
  return lines
}

/**
 * What an outline has to settle, before there are twelve hundred words of it.
 *
 * A finished introduction is very hard to argue with. It has a rhythm, the
 * sentences are good, and the objection that it spends its third paragraph
 * paraphrasing the contents page arrives after the work is done and reads like
 * a demand to throw it away. The same objection against an outline costs a line
 * and thirty seconds. So the shape is settled first, by the person whose book
 * it is, and the writing happens once against something approved.
 *
 * That is the interview rule this app was built on, turned on the one piece of
 * work it had never been applied to: ask at the moment the answer is cheap, and
 * with the evidence to hand. It is also propose-and-accept in its ordinary
 * form — the writer proposes a shape, the editor accepts one — and it puts the
 * decision that most needs a person in the one place a person can make it
 * quickly.
 *
 * The outline is **not written in prose**, and the instruction says so twice.
 * An outline in finished sentences is a draft wearing a disguise: it gets
 * approved on how it sounds, which is exactly the judgement being deferred, and
 * the writer then has its own phrasing in front of it and writes to that
 * instead of to the book.
 */
export function introductionOutlineTask(length: IntroductionLength = 'standard'): string {
  const words = INTRODUCTION_WORDS[length]
  return [
    `FIRST, THE SHAPE. Do not write the introduction yet.`,
    ``,
    `Propose an outline for the editor to approve or change. Set out:`,
    ``,
    `1. THE OPENING. Name the concrete thing it starts on — an incident, an`,
    `   object, an exercise, a sentence off the page. Say which extract or fact`,
    `   in the briefing it comes from. Not the words you will use: the thing.`,
    `2. THE MOVEMENTS, in order. For each one, three lines and no more:`,
    `   - what it does for the reader;`,
    `   - the specific material it rests on, quoted from the briefing, so the`,
    `     editor can see whether there is enough there to carry it;`,
    `   - which register it is in — what the record shows, what the tradition`,
    `     holds, or my own view — because a movement that cannot be assigned to`,
    `     one of the three is a movement that will blur them.`,
    `3. WHAT IS LEFT OUT, and why. A briefing always carries more than a piece`,
    `   can hold, and the material you decline is a decision the editor may`,
    `   want to reverse. This is the half of an outline that is usually`,
    `   missing and it is the half he cannot reconstruct later.`,
    `4. THE CLOSE. What the last paragraph does, and what the note on the text`,
    `   has to say.`,
    `5. WHAT YOU ARE MISSING. Anything you need that the briefing does not`,
    `   carry, under \`QUERIES:\`. Raise it here rather than after the writing,`,
    `   when it costs a line instead of a rewrite.`,
    ``,
    `About ${words} words of finished prose is the target, so size the movements`,
    `to fit it and say roughly how long each runs. Three long movements beat`,
    `seven short ones: a piece with a movement per topic reads as a list, and`,
    `the commonest failure in this kind of writing is a paragraph that is the`,
    `contents page set as prose.`,
    ``,
    `Write the outline as notes. Not paragraphs, not finished sentences, and`,
    `no sample of the prose — a phrase you have already written is a phrase you`,
    `will write to instead of writing to the book, and an outline that sounds`,
    `good gets approved for its sound. The editor is approving a shape.`
  ].join('\n')
}

/**
 * What the job is, with nothing in it about who is doing it.
 *
 * Split out from the prompt because the writing no longer always happens
 * through the API. When it happens in a session, the voice is already the
 * writer's system prompt — the compiled agent *is* the card — and the only
 * thing left to hand over is the book and the task. Sending the card again in
 * that case is not merely wasteful: it invites the two copies to disagree,
 * which is the one failure the compiled agent exists to prevent.
 *
 * So the task is written once and both doors use it. `buildIntroductionPrompt`
 * puts the voice in front of it for the API; `voice.mjs brief` leaves the voice
 * out because the agent already has it.
 */
export function introductionTask(
  length: IntroductionLength = 'standard',
  approvedOutline = ''
): string {
  const words = INTRODUCTION_WORDS[length]
  const outline = approvedOutline.trim()
  return [
    ...(outline
      ? [
          `THE EDITOR HAS APPROVED THIS SHAPE. Write to it.`,
          ``,
          outline,
          ``,
          `It is approved, so do not redesign it. Where it and the rules below`,
          `disagree, the outline wins on *shape* — what goes in, in what order,`,
          `at what length — and the rules win on everything else. If a movement`,
          `turns out not to be carried by the material, write the rest and say`,
          `so at the end under \`QUERIES:\`, rather than quietly filling it or`,
          `quietly dropping it.`,
          ``
        ]
      : []),
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
}

/**
 * What this edition has added to the book, counted rather than remembered.
 *
 * An introduction is where a reader is told what the apparatus is — how many
 * notes there are, that a small circle means a glossary entry, that the
 * original contents was kept and reset. The writer was being asked to say all
 * of that and given none of it, so the first outline that came back asked for
 * it under `QUERIES`: is there a glossary, are there footnotes, how many, and
 * is the list of corrections exhaustive. Every one of those is sitting in the
 * assembled document.
 *
 * Counted here, once, rather than left to a person to recall — because the
 * failure this catches is already on the shelf. One volume carried 85 glossary
 * marks and 23 notes; the next carried a 74-entry glossary with no marks at
 * all and no footnotes, and the book file, the export report and the KDP checks
 * were all perfectly happy. An introduction is the one place a reader would
 * have caught it, and it can only do that if the writer is told the truth.
 *
 * A count is given only where it can be taken exactly. "About a hundred notes"
 * is worse than no number, because the writer will print it.
 */
export function apparatusOf(doc: BookDocument): string[] {
  const lines: string[] = []
  const chapters = doc.chapters.filter((c) => c.level === 1).length
  const words = doc.blocks.reduce((n, b) => n + b.text.split(/\s+/u).filter(Boolean).length, 0)
  lines.push(
    `The body runs about ${Math.round(words / 1000)},000 words in ${chapters} chapter${
      chapters === 1 ? '' : 's'
    }.`
  )

  const back = doc.sections.filter((s) => s.placement === 'back')
  for (const section of back) {
    // An entry opens with its headword in bold. `book-files.mjs` counts the
    // same thing by matching `<b>` on the section *edit*, where the markup is
    // still text; by the time a block is assembled the bold is a list of word
    // indices, so the same convention is read as "bold starting at word 0".
    // Counting it the other way here silently returned zero and printed "a
    // division at the back" over a seventy-four entry glossary.
    const entries = section.blocks.filter((b) => b.strong?.includes(0)).length
    lines.push(
      entries > 0
        ? `A ${section.title.toLowerCase()} of ${entries} entries at the back, which is this edition's and not the author's.`
        : `A division at the back titled "${section.title}", which is this edition's and not the author's.`
    )
  }

  const marks = doc.blocks.reduce(
    (n, b) => n + [...b.text].filter((c) => c === GLOSSARY_MARK).length,
    0
  )
  if (marks > 0) {
    lines.push(
      `${marks} words in the running text carry a small circle (like this${GLOSSARY_MARK}),` +
        ` marking the first use of a word the glossary defines.`
    )
  }

  if (doc.footnotes.length > 0) {
    lines.push(
      `${doc.footnotes.length} footnote${doc.footnotes.length === 1 ? '' : 's'},` +
        ` set at the foot of the page the reference falls on.`
    )
  }
  if (doc.illustrations.length > 0) {
    lines.push(
      `${doc.illustrations.length} illustration${doc.illustrations.length === 1 ? '' : 's'},` +
        ` cut from the scan and set to the measure.`
    )
  }

  // Said out loud, because "no notes" is a fact about the edition the writer
  // must not fill in the other way, and because a book that should have had
  // them and has none is the thing somebody needs to notice.
  if (doc.footnotes.length === 0) lines.push(`No footnotes.`)
  if (marks === 0 && back.length > 0) lines.push(`No glossary marks in the text.`)
  if (back.length === 0) lines.push(`No glossary.`)

  return lines
}

/** The instruction. Exported so a test can read it without a network. */
export function buildIntroductionPrompt(
  doc: BookDocument,
  options: Omit<IntroductionOptions, 'client'>
): { system: string; user: string } {
  const facts = options.facts ?? {}
  const prose = proseBlock(options.voice)

  const system = [
    `You are writing the editor's introduction to a new edition of a`,
    `public-domain book. It is the first thing the reader meets, and it is the`,
    `main reason this edition exists rather than a straight reprint.`,
    ``,
    voiceBlock(options.voice),
    ``,
    introductionTask(options.length ?? 'standard', options.outline ?? ''),
    // Last, because it is the thing to have most recently read before writing,
    // and because a rule about a register is worth much less than a page of it.
    ...(prose ? [``, prose] : [])
  ].join('\n')

  const parts: string[] = []
  if (facts.title?.trim()) parts.push(`Title: ${facts.title.trim()}`)
  if (facts.author?.trim()) parts.push(`Author: ${facts.author.trim()}`)
  if (facts.originalYear?.trim()) parts.push(`First published: ${facts.originalYear.trim()}`)
  if (facts.context?.trim()) parts.push(`The editor says of this work: ${facts.context.trim()}`)

  // Each chapter with the analytical description the original contents page
  // set under it, where there is one.
  //
  // This was the single largest thing wrong with a briefing, and it is
  // measurable rather than a matter of taste. The editor's own approved
  // introduction names about sixty proper nouns per thousand words; a draft
  // written from the old briefing managed six, because the eight extracts
  // between them offered four usable names. The synopses of one book here
  // carry Cazotte, Napoleon, Julius Caesar, Swedenborg, Perceval, the Fox
  // sisters, the Society for Psychical Research and the Creery Experiments,
  // along with "two hundred and ten successes out of a possible three hundred
  // and eighty-two" — which is to say, nearly every concrete thing that
  // approved introduction is built out of. `synopsis.ts` recovers them, the
  // contents prints them, and the writer was shown a list of titles.
  //
  // They are also the safest material in the briefing. A synopsis is the
  // book's own words about itself, so a writer using one is quoting rather
  // than remembering, which is the whole shape this design is built around.
  const chapters = doc.chapters.filter((c) => c.level === 1)
  if (chapters.length > 0) {
    const described = chapters.filter((c) => c.synopsis?.trim()).length
    parts.push(``, `Its chapters, in order:`)
    if (described > 0) {
      parts.push(
        `Under ${described} of them is the description the original contents page`,
        `set there. Those are the book's own words about itself, so anything in`,
        `one is attested and you may use it. They are also where the names, the`,
        `figures and the cases are: the body of an old book will mention a person`,
        `once in passing where its synopsis lists him.`
      )
    }
    for (const c of chapters) {
      parts.push(`- ${c.title}`)
      if (c.synopsis?.trim()) parts.push(`    ${c.synopsis.trim()}`)
    }
  }

  if (options.brief?.trim()) {
    parts.push(``, `The editor wants this introduction to:`, options.brief.trim())
  }

  parts.push(
    ``,
    `WHAT THIS EDITION CARRIES. Say so in the introduction, and get the`,
    `numbers right; these are counted from the book as it now stands.`,
    ...apparatusOf(doc).map((line) => `- ${line}`)
  )

  parts.push(...noteOnTheText(options.rulings ?? []))

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
