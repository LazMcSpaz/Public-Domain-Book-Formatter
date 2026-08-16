/**
 * The fact bank: what each book is worth keeping after it is printed.
 *
 * Every book that goes through this app is read closely once, by something
 * capable of noticing what is in it, and then that reading is thrown away. The
 * bank keeps it — so that a shelf of reprints becomes a body of material to
 * write *from*, rather than forty PDFs.
 *
 * ## What is worth keeping, and what is not
 *
 * A model already knows the general history of any subject an old book covers.
 * What it cannot know, and what nothing else has, is **this book saying this
 * particular thing in its own words**. So the bank is built around primary
 * attestation, not summary: the value of an entry is that a named work of a
 * known year is on record saying it, and the quotation is right there. An entry
 * that merely restates common knowledge is a worse encyclopaedia, generated at
 * cost, and the prompt says so in as many words.
 *
 * ## Footing
 *
 * The single most important field. Mixing "the book says this" with "the model
 * knows this" produces a document that cannot be used for anything two years
 * later, because there is no way to tell which is which. Three footings, and a
 * `stated` entry whose quotation cannot be found in the book is **demoted**
 * rather than trusted — see `checkFacts`.
 *
 * Pure: no I/O.
 */

/** Where an entry stands: what the book attests, versus what was supplied. */
export type Footing =
  /** The book says it. A verified quotation is attached. */
  | 'stated'
  /** Fairly inferred from what the book says, but not said outright. */
  | 'implied'
  /** Supplied by the editor or the model. The book never said this. */
  | 'context'

export const FOOTINGS: readonly Footing[] = ['stated', 'implied', 'context']

export const FOOTING_LABEL: Record<Footing, string> = {
  stated: 'stated by the book',
  implied: 'implied by the book',
  context: 'supplied — not from the book'
}

/** One entry, as the model proposes it. */
export interface RawFact {
  /** A short label — what this entry is about. */
  title: string
  /**
   * The entry itself, at length.
   *
   * Deliberately not a one-liner. Storage is free and the reader of this file
   * is a future writing project with no access to the book, so an entry that
   * explains the thing properly is worth many times one that names it.
   */
  body: string
  footing: Footing
  /** The single best heading for it. */
  category: string
  /** Everything else it touches — how one field's entry is found from another. */
  tags: string[]
  /** The block it came out of, named by the id assembly gave it. */
  blockId: string
  /** Words from the book supporting it, verbatim. Empty for `context`. */
  quote: string
}

/** An entry located in the book and checked. */
export interface Fact extends RawFact {
  /**
   * Stable across runs, derived from the content rather than a counter.
   *
   * A counted id changes when an earlier entry is dropped, which would make the
   * same fact look new every time a book is re-harvested and defeat any later
   * merge.
   */
  id: string
  /** Zero-based page of the *scan* the block came from, for going back to it. */
  sourcePage: number | null
  /**
   * Whether the quotation was actually found in the book.
   *
   * False only on a `context` entry, which is not supposed to have one. A
   * `stated` entry that failed this check has already been demoted by the time
   * anyone sees it.
   */
  quoteVerified: boolean
  /** Set when the footing was lowered because the quotation did not check out. */
  demotedFrom?: Footing
}

/** The book an entry came out of, recorded on every record so files can merge. */
export interface FactSource {
  title: string
  author: string
  /** When the original was published — what dates everything in it. */
  originalYear: string
  /** The file the scan came from, for finding it again. */
  fileName: string
  /** ISO date the harvest ran. */
  harvestedAt: string
}

/**
 * Normalise a tag.
 *
 * Case and whitespace only. Nothing clever: an aggressive normaliser that
 * stemmed words would fold "mineral" and "minerals" together correctly and
 * "physic" and "physics" together disastrously.
 */
export function normalizeTag(tag: string): string {
  return tag
    .toLocaleLowerCase()
    .replace(/[\s_]+/gu, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})]+$/gu, '')
    .trim()
}

/**
 * Map a tag onto one the vocabulary already has, where they mean the same.
 *
 * This is the whole defence against the failure that kills these banks: forty
 * books in, `alchemy`, `alchemical`, `Alchemy` and `alchemy ` are four tags
 * that join nothing to anything. Carrying the vocabulary into the prompt does
 * most of the work; this catches what slips through.
 *
 * Only exact matches after normalisation, and the one difference that is always
 * safe — a trailing plural `s` — are folded. Anything more would merge tags
 * that a person deliberately kept apart.
 */
export function canonicalTag(tag: string, vocabulary: readonly string[]): string {
  const normalized = normalizeTag(tag)
  if (!normalized) return ''

  const known = new Set(vocabulary.map(normalizeTag))
  if (known.has(normalized)) return normalized

  const singular = normalized.replace(/s$/u, '')
  const plural = `${normalized}s`
  if (singular !== normalized && known.has(singular)) return singular
  if (known.has(plural)) return plural

  return normalized
}

/** Fold a list of tags onto the vocabulary, dropping empties and duplicates. */
export function canonicalTags(tags: readonly string[], vocabulary: readonly string[]): string[] {
  const out: string[] = []
  for (const tag of tags) {
    const canonical = canonicalTag(tag, vocabulary)
    if (canonical && !out.includes(canonical)) out.push(canonical)
  }
  return out
}

/**
 * How many tags travel into the prompt.
 *
 * Enough that the model reaches for an existing one instead of coining a
 * synonym; few enough that the vocabulary does not crowd out the book. Ordered
 * by use, so the tags that actually organise the bank are the ones offered.
 */
export const MAX_PROMPT_TAGS = 120

/** The tag vocabulary, as it accretes across books. */
export interface TagVocabulary {
  /** Tag to the number of entries that have carried it. */
  counts: Record<string, number>
}

export function emptyVocabulary(): TagVocabulary {
  return { counts: {} }
}

/** The most-used tags first — what the prompt is shown. */
export function topTags(vocabulary: TagVocabulary, limit = MAX_PROMPT_TAGS): string[] {
  return Object.entries(vocabulary.counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag]) => tag)
}

/** Record the tags of entries the user kept, so the vocabulary grows by use. */
export function growVocabulary(vocabulary: TagVocabulary, facts: readonly Fact[]): TagVocabulary {
  const counts = { ...vocabulary.counts }
  for (const fact of facts) {
    for (const tag of fact.tags) counts[tag] = (counts[tag] ?? 0) + 1
    // The category is a tag that happens to be the primary one, and is worth
    // offering back as a tag on the next book.
    const category = normalizeTag(fact.category)
    if (category) counts[category] = (counts[category] ?? 0) + 1
  }
  return { counts }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function normalizeVocabulary(raw: unknown): TagVocabulary {
  if (!isRecord(raw) || !isRecord(raw['counts'])) return emptyVocabulary()
  const counts: Record<string, number> = {}
  for (const [tag, n] of Object.entries(raw['counts'])) {
    const key = normalizeTag(tag)
    if (key && typeof n === 'number' && Number.isFinite(n)) counts[key] = Math.max(1, Math.round(n))
  }
  return { counts }
}

/**
 * A content-derived id, stable across re-harvests of the same book.
 *
 * A small non-cryptographic hash: this identifies an entry within a file that a
 * person will read, not a secret, and a short readable id keeps the JSONL
 * legible.
 */
export function factId(fact: Pick<RawFact, 'title' | 'body'>, source: string): string {
  const material = `${source} ${fact.title} ${fact.body}`
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < material.length; i++) {
    const c = material.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0
  }
  return `f${h1.toString(36)}${h2.toString(36)}`.slice(0, 13)
}
