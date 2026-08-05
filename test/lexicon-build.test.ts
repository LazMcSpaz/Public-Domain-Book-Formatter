import { describe, it, expect } from 'vitest'
import {
  buildLexicon,
  lexiconPromptBlock,
  normalizeToken,
  editDistance,
  type LexiconToken
} from '@core/lexicon'

/** Build n occurrences of a word, optionally with a confidence/page spread. */
function occurrences(
  text: string,
  n: number,
  opts: { confidence?: number; page?: number } = {}
): LexiconToken[] {
  return Array.from({ length: n }, (_, i) => ({
    text,
    confidence: opts.confidence ?? 95,
    pageIndex: opts.page ?? i % 5,
    tokenId: `${text}-${i}`
  }))
}

describe('normalizeToken', () => {
  it('strips surrounding punctuation but keeps internal marks', () => {
    expect(normalizeToken('"chirurgeon,"')).toBe('chirurgeon')
    expect(normalizeToken('(alembick)')).toBe('alembick')
    expect(normalizeToken('well-nigh')).toBe('well-nigh')
    expect(normalizeToken("th'other")).toBe("th'other")
  })
})

describe('editDistance', () => {
  it('measures single-edit differences and bails past the cap', () => {
    expect(editDistance('chirurgeon', 'chirurgeon')).toBe(0)
    expect(editDistance('chirurgeon', 'chirurgeen')).toBe(1)
    expect(editDistance('cat', 'elephant', 1)).toBeGreaterThan(1)
  })
})

describe('buildLexicon', () => {
  it('surfaces frequent unknown words and ignores ordinary ones', () => {
    const tokens = [
      ...occurrences('chirurgeon', 12),
      ...occurrences('the', 200),
      ...occurrences('and', 150)
    ]
    const terms = buildLexicon(tokens).map((e) => e.term)
    expect(terms).toContain('chirurgeon')
    expect(terms).not.toContain('the')
    expect(terms).not.toContain('and')
  })

  it('drops one-off strings as OCR noise but keeps repeated vocabulary', () => {
    const tokens = [...occurrences('alembick', 9), ...occurrences('xqzrt', 1)]
    const terms = buildLexicon(tokens).map((e) => e.term)
    expect(terms).toContain('alembick')
    expect(terms).not.toContain('xqzrt')
  })

  it('keeps an index-corroborated term even when it appears only once', () => {
    const tokens = occurrences('Paracelsus', 1)
    const entry = buildLexicon(tokens, { corroborated: ['Paracelsus'] })[0]
    expect(entry?.term).toBe('Paracelsus')
    expect(entry?.signals).toContain('index-corroborated')
  })

  it('flags archaic orthography', () => {
    const entry = buildLexicon(occurrences('knoweth', 8))[0]
    expect(entry?.signals).toContain('archaic-orthography')
  })

  it('flags low OCR confidence', () => {
    const entry = buildLexicon(occurrences('quintessence', 6, { confidence: 55 }))[0]
    expect(entry?.signals).toContain('low-confidence')
  })

  it('flags capitalized unknowns as proper nouns', () => {
    const entry = buildLexicon(occurrences('Basilica', 7))[0]
    expect(entry?.signals).toContain('proper-noun')
  })

  it('folds near-identical OCR variants into one entry', () => {
    // Same word, one page misread by a single character.
    const tokens = [...occurrences('chirurgeon', 20), ...occurrences('chirurgeun', 4)]
    const entries = buildLexicon(tokens)
    const hosts = entries.filter((e) => e.term.startsWith('chirurge'))
    expect(hosts).toHaveLength(1)
    expect(hosts[0]!.term).toBe('chirurgeon') // more frequent spelling wins
    expect(hosts[0]!.variants).toContain('chirurgeun')
    expect(hosts[0]!.count).toBe(24) // counts merged
  })

  it('ranks by impact so frequent terms come first', () => {
    const tokens = [...occurrences('alembick', 30), ...occurrences('crucible', 4)]
    const entries = buildLexicon(tokens)
    expect(entries[0]!.term).toBe('alembick')
    expect(entries[0]!.impact).toBeGreaterThan(entries[1]!.impact)
  })

  it('records the pages a term appears on and a sample token for the crop', () => {
    const tokens = [
      { text: 'aqua', confidence: 90, pageIndex: 3, tokenId: 't1' },
      { text: 'aqua', confidence: 90, pageIndex: 7, tokenId: 't2' },
      { text: 'aqua', confidence: 90, pageIndex: 3, tokenId: 't3' }
    ]
    const entry = buildLexicon(tokens, { minCount: 3 })[0]
    expect(entry?.pages).toEqual([3, 7])
    expect(entry?.sampleTokenId).toBe('t1')
  })

  it('ignores short tokens and bare numbers (page furniture)', () => {
    const tokens = [...occurrences('37', 40), ...occurrences('iv', 20)]
    expect(buildLexicon(tokens)).toHaveLength(0)
  })

  it('respects the limit', () => {
    // Distinct stems, so variant-clustering doesn't fold them together.
    const stems = [
      'alembick',
      'chirurgeon',
      'quintessence',
      'calcination',
      'putrefaction',
      'soveraigne',
      'medicament',
      'crucible',
      'sublimate',
      'menstruum',
      'vitriol',
      'antimonie',
      'cinnabar',
      'lapidary',
      'tincture'
    ]
    const tokens = stems.flatMap((s) => occurrences(s, 5))
    expect(buildLexicon(tokens, { limit: 10 })).toHaveLength(10)
  })
})

describe('lexiconPromptBlock', () => {
  it('renders confirmed terms as a preserve-spelling instruction', () => {
    const entries = buildLexicon([...occurrences('chirurgeon', 10), ...occurrences('alembick', 8)])
    const block = lexiconPromptBlock(entries)
    expect(block).toContain('chirurgeon')
    expect(block).toContain('alembick')
    expect(block.toLowerCase()).toContain('preserved')
  })

  it('is empty when there is no lexicon', () => {
    expect(lexiconPromptBlock([])).toBe('')
  })
})
