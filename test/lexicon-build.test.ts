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

/**
 * Reported from a real book: the grid was "all basic words, ranked by how many
 * times they appear". It was — `impact` multiplied by the raw count, so a
 * common word seen three thousand times buried every distinctive one. And a
 * word OCR stumbles over is, almost by definition, not one of the commonest in
 * the book.
 */
describe('the grid ranks by distinctiveness, not by frequency', () => {
  const token = (text: string, confidence: number, n: number, page = 0): LexiconToken[] =>
    Array.from({ length: n }, (_, i) => ({
      text,
      confidence,
      pageIndex: page,
      tokenId: `${text}-${i}`
    }))

  it('keeps an ordinary word out however badly it was read', () => {
    // A common word OCR struggled with is a scanning problem, not a vocabulary
    // one, and no prompt needs telling that "the" is a word.
    const entries = buildLexicon([...token('the', 62, 400), ...token('chirurgeon', 71, 6)])
    expect(entries.map((e) => e.term)).not.toContain('the')
    expect(entries.map((e) => e.term)).toContain('chirurgeon')
  })

  it('puts an odd word above a mundane one that appears far more often', () => {
    // "knoweth" is archaic orthography; "hospital" is merely not in the common
    // list. The archaic one wins despite being outnumbered twenty to one,
    // because confirming "hospital" teaches the model nothing.
    const entries = buildLexicon([...token('hospital', 96, 120), ...token('knoweth', 88, 6)])
    expect(entries[0]!.term).toBe('knoweth')
  })

  it('still lets frequency separate two equally odd words', () => {
    const entries = buildLexicon([...token('alembick', 80, 40), ...token('cucurbite', 80, 4)])
    expect(entries[0]!.term).toBe('alembick')
  })

  it('does not let frequency run away with the ranking', () => {
    // Ten times the sightings must not mean ten times the score, or the grid
    // becomes a frequency list again.
    const [many] = buildLexicon(token('alembick', 80, 200))
    const [few] = buildLexicon(token('alembick', 80, 20))
    expect(many!.impact / few!.impact).toBeLessThan(2)
  })
})
