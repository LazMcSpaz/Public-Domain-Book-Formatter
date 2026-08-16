/**
 * Reading harvested entries back, and checking them against the book.
 *
 * The check is the point. An entry claiming to be `stated` is claiming the book
 * said it, and the quotation is the evidence — so the quotation is *looked for*
 * rather than believed. One that cannot be found anywhere in the book means the
 * entry is not stated by the book, whatever it says of itself, and it is
 * demoted to `context` with the demotion recorded.
 *
 * That is a deterministic comparison against the source text, not the model's
 * opinion of its own accuracy, which is the only kind of check SPEC §4 permits
 * to carry weight.
 *
 * Pure: replies in, checked facts out.
 */
import type { BookBlock } from '@core/assemble'
import {
  FOOTINGS,
  canonicalTags,
  factId,
  normalizeTag,
  type Fact,
  type Footing,
  type RawFact
} from './fact'

/**
 * The shape of one entry, shared by both passes.
 *
 * Exported as a fragment rather than a whole schema because facts ride the
 * annotation reply as well as arriving on their own — and two hand-written
 * copies of this shape would drift the moment either changed.
 */
export const FACT_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    body: { type: 'string' },
    footing: { type: 'string', enum: [...FOOTINGS] },
    category: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    blockId: { type: 'string' },
    quote: { type: 'string' }
  },
  required: ['title', 'body', 'footing', 'category', 'tags', 'blockId', 'quote'],
  additionalProperties: false
} as const

export const FACT_LIST_SCHEMA = {
  type: 'object',
  properties: { facts: { type: 'array', items: FACT_ITEM_SCHEMA } },
  required: ['facts'],
  additionalProperties: false
} as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Pull the usable entries out of a reply.
 *
 * Forgiving, like the annotation parser and for the same reason: a malformed
 * entry is one line missing from a file nobody has read yet, not a hole in a
 * book. Bad entries are counted and dropped.
 */
export function parseFacts(
  raw: unknown,
  vocabulary: readonly string[] = []
): { facts: RawFact[]; discarded: number } {
  const list = isRecord(raw) && Array.isArray(raw['facts']) ? raw['facts'] : null
  if (!list) return { facts: [], discarded: 0 }

  const facts: RawFact[] = []
  let discarded = 0

  for (const entry of list) {
    if (!isRecord(entry)) {
      discarded += 1
      continue
    }
    const title = typeof entry['title'] === 'string' ? entry['title'].trim() : ''
    const body = typeof entry['body'] === 'string' ? entry['body'].trim() : ''
    if (!title || !body) {
      discarded += 1
      continue
    }
    const footing = entry['footing']
    const rawTags = Array.isArray(entry['tags'])
      ? entry['tags'].filter((t): t is string => typeof t === 'string')
      : []

    facts.push({
      title,
      body,
      // An unrecognised footing is treated as the weakest one. Guessing upward
      // would let a malformed reply pass itself off as attested.
      footing: FOOTINGS.includes(footing as Footing) ? (footing as Footing) : 'context',
      category:
        normalizeTag(typeof entry['category'] === 'string' ? entry['category'] : '') || 'general',
      tags: canonicalTags(rawTags, vocabulary),
      blockId: typeof entry['blockId'] === 'string' ? entry['blockId'] : '',
      quote: typeof entry['quote'] === 'string' ? entry['quote'].trim() : ''
    })
  }

  return { facts, discarded }
}

/** Collapse whitespace so a quotation spanning a line break still matches. */
const loosen = (text: string): string => text.replace(/\s+/gu, ' ').trim()

/**
 * Locate each entry in the book, and demote any that cannot support itself.
 *
 * The quotation is looked for in the block the entry names, then in the book at
 * large — a model that attributed the right words to the wrong block has made a
 * bookkeeping error, not a false claim, and demoting for it would throw away a
 * good entry.
 */
export function checkFacts(
  raw: readonly RawFact[],
  blocks: readonly BookBlock[],
  sourceKey: string
): Fact[] {
  const byId = new Map(blocks.map((b) => [b.id, b]))
  const bookText = loosen(blocks.map((b) => b.text).join('\n')).toLocaleLowerCase()

  return raw.map((entry) => {
    const block = byId.get(entry.blockId)
    const quote = loosen(entry.quote)
    const inBlock = quote.length > 0 && loosen(block?.text ?? '').includes(quote)
    const inBook = quote.length > 0 && bookText.includes(quote.toLocaleLowerCase())
    const quoteVerified = inBlock || inBook

    // A claim the book is supposed to have made, whose words are not in the
    // book. Whatever it is, it is not attested here.
    const demoted = entry.footing === 'stated' && !quoteVerified
    const footing: Footing = demoted ? 'context' : entry.footing

    return {
      ...entry,
      footing,
      ...(demoted ? { demotedFrom: 'stated' as Footing } : {}),
      id: factId(entry, sourceKey),
      sourcePage: block?.sourcePages[0] ?? null,
      quote: quoteVerified ? entry.quote : '',
      quoteVerified
    }
  })
}

/**
 * Drop entries that say the same thing twice.
 *
 * Within one book only. Across books a repeat is *corroboration* — two
 * independent works attesting the same thing is worth more than one, and
 * collapsing that would destroy the most useful signal the bank can carry — so
 * merging files is deliberately left to whatever consolidates them later.
 */
export function dedupeFacts(facts: readonly Fact[]): Fact[] {
  const seen = new Set<string>()
  const out: Fact[] = []
  for (const fact of facts) {
    if (seen.has(fact.id)) continue
    seen.add(fact.id)
    out.push(fact)
  }
  return out
}
