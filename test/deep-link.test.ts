import { describe, it, expect } from 'vitest'
import { parseDeepLink, deepLink, stepsBefore } from '@core/wizard'

const BASE = 'https://example.github.io/Public-Domain-Book-Formatter/'

describe('reading a link', () => {
  it('names the book and where to land', () => {
    expect(parseDeepLink('#book=human-aura-4f2a1c&at=review')).toEqual({
      slug: 'human-aura-4f2a1c',
      at: 'gate-uncertainties',
      leaf: null
    })
  })

  it('takes a step id as well as a friendly name', () => {
    expect(parseDeepLink('#book=a-book-1&at=proof').at).toBe('proof')
    expect(parseDeepLink('#book=a-book-1&at=gate-structure').at).toBe('gate-structure')
  })

  it('carries a leaf, for a link about one spot', () => {
    expect(parseDeepLink('#book=a-book-1&at=review&leaf=42').leaf).toBe(42)
  })

  it('lets the flow decide when no place is named', () => {
    expect(parseDeepLink('#book=a-book-1').at).toBeNull()
  })

  /**
   * A hash arrives from a phone's address bar. The worst outcome of a typo is
   * the ordinary intake screen — never a throw, and never a book nobody asked
   * for.
   */
  describe('anything it does not recognise comes back empty', () => {
    for (const [what, hash] of [
      ['no hash at all', ''],
      ['some other route', '#settings'],
      ['a slug with a slash in it', '#book=../../etc/passwd'],
      ['a slug with a space', '#book=human aura'],
      ['an upper-case slug, which no shelf makes', '#book=Human-Aura'],
      ['an empty slug', '#book=']
    ] as const) {
      it(what, () => {
        expect(parseDeepLink(hash).slug).toBeNull()
      })
    }

    it('a step that does not exist, keeping the book', () => {
      const link = parseDeepLink('#book=a-book-1&at=whenever')
      expect(link.slug).toBe('a-book-1')
      expect(link.at).toBeNull()
    })

    it('a leaf that is not a number', () => {
      expect(parseDeepLink('#book=a-book-1&leaf=last').leaf).toBeNull()
    })
  })
})

describe('building a link', () => {
  it('round-trips', () => {
    const built = deepLink(BASE, { slug: 'human-aura-4f2a1c', at: 'gate-uncertainties', leaf: 42 })
    expect(parseDeepLink(new URL(built).hash)).toEqual({
      slug: 'human-aura-4f2a1c',
      at: 'gate-uncertainties',
      leaf: 42
    })
  })

  it('does not double a slash or keep an old hash', () => {
    expect(deepLink('https://x.dev/app/#book=old', { slug: 'a-1' })).toBe(
      'https://x.dev/app/#book=a-1'
    )
  })
})

/**
 * The rule that keeps a link from skipping a decision: earlier steps are marked
 * done, later ones never are.
 */
describe('what a link is allowed to mark as walked', () => {
  it('marks everything before the landing step', () => {
    expect(stepsBefore('gate-structure')).toEqual([
      'intake',
      'recon',
      'gate-identity',
      'transcribe',
      'gate-uncertainties'
    ])
  })

  it('never marks the landing step itself, which still has to be answered', () => {
    expect(stepsBefore('proof')).not.toContain('proof')
  })

  it('never marks anything after it', () => {
    expect(stepsBefore('proof')).not.toContain('design')
    expect(stepsBefore('proof')).not.toContain('export')
  })

  it('marks nothing for the first step', () => {
    expect(stepsBefore('intake')).toEqual([])
  })

  /**
   * The load-bearing claim, checked against the flow's own idea of where the
   * proof step begins rather than against a list written here.
   *
   * `test/wizard-steps.test.ts` builds a state it calls `afterStructure` — the
   * point at which `activeStep` returns `proof` — by marking exactly these six.
   * If the two ever disagree, a link would land somewhere the flow does not
   * consider reachable.
   */
  it('marks exactly what the flow itself calls "past the structure gate"', () => {
    expect(stepsBefore('proof')).toEqual([
      'intake',
      'recon',
      'gate-identity',
      'transcribe',
      'gate-uncertainties',
      'gate-structure'
    ])
  })
})
