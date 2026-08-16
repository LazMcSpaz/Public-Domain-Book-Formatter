/**
 * What the harvest is asked for.
 *
 * Written once and used twice — appended to the annotation pass's instruction
 * when the two ride together, and used alone when a book is harvested without
 * being annotated. Two copies of this would drift, and the drift would be
 * invisible: the entries would simply get worse on one path.
 *
 * Pure: options in, strings out.
 */
import type { BookFacts } from './source'
import { MAX_PROMPT_TAGS, type TagVocabulary, topTags } from './fact'

/** How many entries a thousand words should attract. */
export type HarvestDepth = 'selective' | 'standard' | 'thorough'

export const FACTS_PER_THOUSAND_WORDS: Record<HarvestDepth, number> = {
  selective: 1,
  standard: 2.5,
  thorough: 5
}

/**
 * The standing instruction, which is mostly about what *not* to keep.
 *
 * Every line here is aimed at a specific way a fact bank goes bad. The worst of
 * them, and the one that would waste the whole exercise, is an entry that
 * restates what any reference work already says: it costs money to generate, it
 * fills the file, and it is worth less than nothing because it dilutes the
 * entries that are actually primary.
 */
const HARVEST_RULES: readonly string[] = [
  `Keep what THIS book uniquely witnesses. Its value is that a named work of a`,
  `known year is on record saying this, with the words to prove it. A entry`,
  `that merely restates what any encyclopaedia says is worthless here — worse`,
  `than worthless, because it buries the entries that are not.`,
  ``,
  `So prefer: what the author claims and how they argue it; a practice`,
  `described in enough detail to reconstruct; a measurement, price, dose,`,
  `recipe or method as actually given; what the author assumes the reader`,
  `already believes; a disagreement named; the texture of how people lived,`,
  `worked or thought that only a contemporary would bother to record.`,
  ``,
  `Avoid: dates and biographies of famous people; definitions of common terms;`,
  `summaries of the book's argument; anything you would have known without`,
  `reading this book.`,
  ``,
  `WRITE THEM AT LENGTH. The reader of this file will not have the book. An`,
  `entry that names a thing is useless; one that explains what it was, how it`,
  `worked, what it was for and what the author thought about it is worth`,
  `keeping for years. Several sentences each, and more where the thing earns`,
  `it. Do not compress.`,
  ``,
  `FOOTING. Every entry is marked with where it stands, and this matters more`,
  `than any other field:`,
  `- "stated" — the book says it. Give the words as "quote", copied exactly`,
  `  from the text as supplied, so they can be found again. Never paraphrase`,
  `  into the quote field.`,
  `- "implied" — a fair reading of what the book says, but not said outright.`,
  `  Quote the passage it rests on.`,
  `- "context" — you are supplying it and the book does not say it. This is`,
  `  allowed and often useful, but it must be marked, and the quote is empty.`,
  `Do not label something "stated" to make it look better sourced. A quote that`,
  `cannot be found in the book is checked for and the entry is demoted, so the`,
  `only thing an overclaim achieves is a worse entry.`
]

export interface HarvestPromptOptions {
  depth?: HarvestDepth
  vocabulary?: TagVocabulary
  /** Anything the user is collecting towards — a subject to weight entries by. */
  interest?: string
}

/**
 * The harvest instruction, ready to be appended to a system prompt.
 *
 * The tag vocabulary rides along, which is the whole defence against a bank
 * whose tags join nothing to anything: the model is shown the tags already in
 * use and asked to reach for one before coining a synonym. The same technique
 * as the book's confirmed vocabulary at Gate 1 and the editor's approved notes.
 */
export function buildHarvestBlock(options: HarvestPromptOptions = {}): string {
  const depth = options.depth ?? 'standard'
  const parts: string[] = []

  parts.push(
    `ALSO: HARVEST WHAT IS WORTH KEEPING.`,
    `Besides the reading itself, pull out entries for a reference bank the`,
    `editor is building across many books — material to write from later, long`,
    `after this book is off the desk.`,
    ``,
    ...HARVEST_RULES,
    ``,
    `Name the block each entry came from, by the id in brackets.`,
    `Aim for roughly ${FACTS_PER_THOUSAND_WORDS[depth]} entries per thousand words,`,
    `as a target and not a quota. A passage with nothing worth keeping should`,
    `yield nothing.`
  )

  if (options.interest?.trim()) {
    parts.push(
      ``,
      `THE EDITOR IS COLLECTING TOWARDS:`,
      options.interest.trim(),
      `Weight the harvest that way where the book allows, but do not force it —`,
      `a book that has nothing on the subject should still give up what it has.`
    )
  }

  const tags = options.vocabulary ? topTags(options.vocabulary, MAX_PROMPT_TAGS) : []
  parts.push(
    ``,
    `CATEGORIES AND TAGS.`,
    `Give each entry one "category" — the single best heading for it — and any`,
    `number of "tags" for everything else it touches. Tags are how an entry`,
    `filed under one subject is found from another, which is most of the point:`,
    `this material relates across fields constantly.`
  )

  if (tags.length > 0) {
    parts.push(
      ``,
      `These tags are already in use across the bank. Reuse one wherever it`,
      `fits — a new tag that means the same as an existing one joins nothing to`,
      `anything. Coin a new one only when none of these will do:`,
      tags.join(', ')
    )
  } else {
    parts.push(
      ``,
      `The bank is empty, so you are setting the vocabulary. Choose tags a`,
      `later book could reuse: broad enough to recur, specific enough to mean`,
      `something. Lower case, and singular where it reads naturally.`
    )
  }

  return parts.join('\n')
}

/** The whole instruction, for a harvest that is not riding an annotation pass. */
export function buildHarvestSystemPrompt(
  facts: BookFacts = {},
  options: HarvestPromptOptions = {}
): string {
  const parts: string[] = [
    `You are reading a public-domain book closely, once, so that what is worth`,
    `keeping in it survives after the book is put away.`,
    ``
  ]

  const about: string[] = []
  if (facts.title?.trim()) about.push(`Title: ${facts.title.trim()}`)
  if (facts.author?.trim()) about.push(`Author: ${facts.author.trim()}`)
  if (facts.originalYear?.trim()) {
    about.push(
      `First published: ${facts.originalYear.trim()} — date everything in the`,
      `book against this, not against today.`
    )
  }
  if (facts.context?.trim()) about.push(`The editor says of this work: ${facts.context.trim()}`)
  if (about.length > 0) parts.push(`THE BOOK:`, ...about, ``)

  parts.push(buildHarvestBlock(options))
  return parts.join('\n')
}
