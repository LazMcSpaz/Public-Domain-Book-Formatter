import { describe, it, expect } from 'vitest'
import {
  PAGE_SCHEMA,
  parsePageTranscription,
  transcriptionText,
  buildSystemPrompt,
  buildPagePrompt,
  buildLexiconBlock,
  tailOf,
  verifyPage,
  pagesNeedingReview,
  summarize,
  estimateCost,
  type PageTranscription,
  type OcrWordLike
} from '@core/transcribe'
import type { LexiconEntry } from '@core/lexicon'
import { ALL_PAGE_ROLES, dispositionFor } from '@core/pages'

function lex(term: string): LexiconEntry {
  return {
    term,
    count: 10,
    meanConfidence: 92,
    pages: [1],
    variants: [],
    signals: ['frequent-unknown'],
    impact: 10
  }
}

function page(overrides: Partial<PageTranscription> = {}): PageTranscription {
  return {
    pageIndex: 0,
    role: 'body',
    blocks: [{ kind: 'paragraph', text: 'The alembick being set upon a gentle fire.' }],
    uncertain: [],
    furniture: {},
    ...overrides
  }
}

function ocr(text: string, confidence = 95): OcrWordLike[] {
  return text.split(/\s+/).map((t) => ({ text: t, confidence }))
}

// ---------------------------------------------------------------- schema ----

describe('parsePageTranscription', () => {
  it('parses a well-formed reply', () => {
    const parsed = parsePageTranscription(
      {
        role: 'chapter-opening',
        blocks: [
          { kind: 'heading', text: 'Chapter IV', level: 1 },
          { kind: 'paragraph', text: 'IT hath beene shewed…', continuesNext: true }
        ],
        uncertain: [{ text: 'shewed', alternatives: ['shewad'], reason: 'faint ink' }],
        furniture: { runningHead: 'THE ALCHEMIST', folio: '37' }
      },
      3
    )
    expect(parsed.pageIndex).toBe(3)
    expect(parsed.role).toBe('chapter-opening')
    expect(parsed.blocks[0]).toMatchObject({ kind: 'heading', level: 1 })
    expect(parsed.blocks[1]!.continuesNext).toBe(true)
    expect(parsed.furniture.folio).toBe('37')
    expect(parsed.uncertain[0]!.alternatives).toEqual(['shewad'])
  })

  it('extracts front-matter metadata when present', () => {
    const parsed = parsePageTranscription(
      {
        role: 'title-page',
        blocks: [],
        uncertain: [],
        furniture: {},
        metadata: { title: 'The Alchemist', author: 'Anonymous', originalYear: '1662' }
      },
      0
    )
    expect(parsed.metadata).toMatchObject({ title: 'The Alchemist', originalYear: '1662' })
  })

  it('rejects an unknown role rather than guessing', () => {
    expect(() =>
      parsePageTranscription({ role: 'sidebar', blocks: [], uncertain: [], furniture: {} }, 0)
    ).toThrow(/unknown page role/i)
  })

  it('rejects a malformed block instead of importing half a page', () => {
    expect(() =>
      parsePageTranscription(
        { role: 'body', blocks: [{ kind: 'paragraph' }], uncertain: [], furniture: {} },
        2
      )
    ).toThrow(/no text/i)
  })

  it('clamps heading levels into range', () => {
    const parsed = parsePageTranscription(
      {
        role: 'body',
        blocks: [{ kind: 'heading', text: 'X', level: 99 }],
        uncertain: [],
        furniture: {}
      },
      0
    )
    expect(parsed.blocks[0]!.level).toBe(6)
  })

  it('exposes a schema that forbids unexpected fields', () => {
    expect(PAGE_SCHEMA.additionalProperties).toBe(false)
    expect(PAGE_SCHEMA.required).toContain('role')
    expect(PAGE_SCHEMA.required).toContain('blocks')
  })
})

// ---------------------------------------------------------------- prompt ----

describe('buildSystemPrompt', () => {
  it('states the facsimile stance and forbids modernizing when preserving', () => {
    const p = buildSystemPrompt({
      lexicon: [],
      orthography: 'preserve',
      normalizeLongS: false
    })
    expect(p).toMatch(/FACSIMILE, NOT AN EDIT/i)
    expect(p).toMatch(/do not\s+modernize/i)
  })

  it('switches stance when modernizing', () => {
    const p = buildSystemPrompt({ lexicon: [], orthography: 'modernize', normalizeLongS: false })
    expect(p).toMatch(/Modernize archaic spelling/i)
  })

  it('injects the confirmed lexicon so terms are not "corrected"', () => {
    const p = buildSystemPrompt({
      lexicon: [lex('chirurgeon'), lex('alembick')],
      orthography: 'preserve',
      normalizeLongS: false
    })
    expect(p).toContain('chirurgeon')
    expect(p).toContain('alembick')
    expect(p).toMatch(/KNOWN VOCABULARY/i)
  })

  it('mentions long-s only when that policy is on', () => {
    const off = buildSystemPrompt({ lexicon: [], orthography: 'preserve', normalizeLongS: false })
    const on = buildSystemPrompt({ lexicon: [], orthography: 'preserve', normalizeLongS: true })
    expect(off).not.toMatch(/long-s/i)
    expect(on).toMatch(/long-s/i)
  })

  it('tells the model to strip running heads and folios', () => {
    const p = buildSystemPrompt({ lexicon: [], orthography: 'preserve', normalizeLongS: false })
    expect(p).toMatch(/running heads and page numbers/i)
    expect(p).toMatch(/furniture/i)
  })

  it('tells the model to flag rather than guess', () => {
    const p = buildSystemPrompt({ lexicon: [], orthography: 'preserve', normalizeLongS: false })
    expect(p).toMatch(/do not silently pick/i)
  })

  it('includes user-supplied book context when given', () => {
    const p = buildSystemPrompt({
      lexicon: [],
      orthography: 'preserve',
      normalizeLongS: false,
      bookContext: 'A 1662 alchemical treatise printed in London.'
    })
    expect(p).toContain('1662 alchemical treatise')
  })

  it('omits the lexicon block entirely when there is none', () => {
    expect(buildLexiconBlock([])).toBe('')
  })
})

describe('buildPagePrompt', () => {
  it('numbers the page and passes OCR as a hint', () => {
    const p = buildPagePrompt({ pageIndex: 4, pageCount: 100, ocrText: 'some ocr' })
    expect(p).toContain('Page 5 of 100')
    expect(p).toMatch(/hint only/i)
    expect(p).toContain('some ocr')
  })

  it('carries the previous page tail so paragraph seams stitch', () => {
    const p = buildPagePrompt({
      pageIndex: 1,
      pageCount: 9,
      ocrText: 'x',
      previousTail: 'and the spirit ascendeth'
    })
    expect(p).toContain('and the spirit ascendeth')
    expect(p).toMatch(/continuesPrevious/)
    expect(p).toMatch(/do not repeat this text/i)
  })

  it('tolerates a page with no OCR text', () => {
    expect(buildPagePrompt({ pageIndex: 0, pageCount: 1, ocrText: '   ' })).toContain(
      '(no OCR text)'
    )
  })
})

describe('tailOf', () => {
  it('returns the end of long text and all of short text', () => {
    expect(tailOf('short')).toBe('short')
    expect(tailOf('a'.repeat(500), 100)).toHaveLength(100)
  })
})

// ---------------------------------------------------------- verification ----

describe('verifyPage', () => {
  it('passes a page that matches what OCR saw', () => {
    const p = page({ blocks: [{ kind: 'paragraph', text: 'one two three four five six' }] })
    expect(verifyPage(p, ocr('one two three four five six'))).toHaveLength(0)
  })

  it('flags dropped text — the silent, catastrophic case', () => {
    const p = page({ blocks: [{ kind: 'paragraph', text: 'one two three' }] })
    const seen = ocr(Array.from({ length: 40 }, (_, i) => `word${i}`).join(' '))
    const f = verifyPage(p, seen)
    expect(f.some((x) => x.code === 'text-dropped')).toBe(true)
    expect(f[0]!.severity).toBe('high')
  })

  it('flags invented text', () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')
    const p = page({ blocks: [{ kind: 'paragraph', text: long }] })
    const f = verifyPage(
      p,
      ocr(
        'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 ' +
          'word11 word12 word13 word14 word15 word16 word17 word18 word19 word20'
      )
    )
    expect(f.some((x) => x.code === 'text-added')).toBe(true)
  })

  it('flags a page transcribed as empty when OCR clearly read text', () => {
    const p = page({ blocks: [] })
    const f = verifyPage(p, ocr(Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ')))
    expect(f[0]!.code).toBe('empty-page')
    expect(f[0]!.severity).toBe('high')
  })

  it('flags words OCR read confidently that never made it into the text', () => {
    const p = page({
      blocks: [{ kind: 'paragraph', text: 'alpha bravo charlie delta echo foxtrot' }]
    })
    const seen = [
      ...ocr('alpha bravo charlie delta echo foxtrot'),
      ...ocr('quintessence calcination putrefaction soveraigne medicament', 97)
    ]
    const f = verifyPage(p, seen)
    const finding = f.find((x) => x.code === 'confident-word-missing')
    expect(finding).toBeDefined()
    expect(finding!.words).toContain('quintessence')
  })

  it('ignores low-confidence OCR words when checking for omissions', () => {
    const p = page({
      blocks: [{ kind: 'paragraph', text: 'alpha bravo charlie delta echo foxtrot' }]
    })
    const seen = [
      ...ocr('alpha bravo charlie delta echo foxtrot'),
      ...ocr('garbled noise junk trash', 30)
    ]
    expect(verifyPage(p, seen).some((x) => x.code === 'confident-word-missing')).toBe(false)
  })

  it('flags a footnote with no marker to link back to', () => {
    const p = page({
      blocks: [
        { kind: 'paragraph', text: 'one two three four five' },
        { kind: 'footnote', text: 'See the Basilica Chymica.' }
      ]
    })
    expect(
      verifyPage(p, ocr('one two three four five')).some((x) => x.code === 'orphan-footnote')
    ).toBe(true)
  })

  it('does not flag blank or plate pages for having little text', () => {
    const blank = page({ role: 'blank', blocks: [] })
    expect(
      verifyPage(blank, ocr(Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ')))
    ).toHaveLength(0)
  })

  it('skips checks on pages with too little OCR to compare against', () => {
    const p = page({ blocks: [] })
    expect(verifyPage(p, ocr('just a few words'))).toHaveLength(0)
  })
})

describe('pagesNeedingReview', () => {
  it('escalates on deterministic evidence, not on model self-report alone', () => {
    const findings = [
      { code: 'text-dropped' as const, severity: 'high' as const, pageIndex: 5, message: '' },
      { code: 'orphan-footnote' as const, severity: 'low' as const, pageIndex: 9, message: '' }
    ]
    // Page 9 has only a low-severity finding, so evidence alone doesn't escalate it.
    expect(pagesNeedingReview(findings, [])).toEqual([5])
  })

  it('additionally includes pages the model itself flagged as uncertain', () => {
    const pages = [
      page({ pageIndex: 2, uncertain: [{ text: 'x', alternatives: [], reason: 'blur' }] })
    ]
    expect(pagesNeedingReview([], pages)).toEqual([2])
  })

  it('merges both sources without duplicates', () => {
    const findings = [
      { code: 'text-dropped' as const, severity: 'high' as const, pageIndex: 2, message: '' }
    ]
    const pages = [
      page({ pageIndex: 2, uncertain: [{ text: 'x', alternatives: [], reason: 'blur' }] })
    ]
    expect(pagesNeedingReview(findings, pages)).toEqual([2])
  })
})

describe('summarize', () => {
  it('counts severities and clean pages', () => {
    const s = summarize(
      [
        { code: 'text-dropped', severity: 'high', pageIndex: 1, message: '' },
        { code: 'orphan-footnote', severity: 'low', pageIndex: 1, message: '' },
        { code: 'text-added', severity: 'medium', pageIndex: 4, message: '' }
      ],
      10
    )
    expect(s).toMatchObject({ high: 1, medium: 1, low: 1, cleanPages: 8 })
  })
})

// ------------------------------------------------------------------ cost ----

describe('estimateCost', () => {
  it('scales with page count', () => {
    const a = estimateCost({ pageCount: 100, modelId: 'claude-opus-5' })
    const b = estimateCost({ pageCount: 300, modelId: 'claude-opus-5' })
    expect(b.usd).toBeGreaterThan(a.usd * 2.5)
  })

  it('is cheaper on a cheaper model', () => {
    const opus = estimateCost({ pageCount: 300, modelId: 'claude-opus-5' })
    const haiku = estimateCost({ pageCount: 300, modelId: 'claude-haiku-4-5' })
    expect(haiku.usd).toBeLessThan(opus.usd)
  })

  it('charges more for larger page images', () => {
    const small = estimateCost({ pageCount: 100, modelId: 'claude-opus-5', imageLongEdge: 1000 })
    const large = estimateCost({ pageCount: 100, modelId: 'claude-opus-5', imageLongEdge: 2576 })
    expect(large.imageTokensPerPage).toBeGreaterThan(small.imageTokensPerPage)
    expect(large.usd).toBeGreaterThan(small.usd)
  })

  it('caps image tokens at the documented ceiling', () => {
    const huge = estimateCost({ pageCount: 1, modelId: 'claude-opus-5', imageLongEdge: 8000 })
    expect(huge.imageTokensPerPage).toBeLessThanOrEqual(4784)
  })

  it('brackets the midpoint with an honest range', () => {
    const e = estimateCost({ pageCount: 300, modelId: 'claude-opus-5' })
    expect(e.usdLow).toBeLessThan(e.usd)
    expect(e.usdHigh).toBeGreaterThan(e.usd)
  })

  it('falls back to the default model for an unknown id', () => {
    expect(estimateCost({ pageCount: 10, modelId: 'nope' }).usd).toBeGreaterThan(0)
  })
})

describe('transcriptionText', () => {
  it('joins blocks into checkable plain text', () => {
    const p = page({
      blocks: [
        { kind: 'heading', text: 'Chapter IV' },
        { kind: 'paragraph', text: 'Body text.' }
      ]
    })
    expect(transcriptionText(p)).toBe('Chapter IV\n\nBody text.')
  })
})

/**
 * The parser keeps its own list of roles, and a list is a thing that drifts
 * from the type it is meant to mirror.
 *
 * `digitization-notice` was added to `PageRole` for exactly the leaf every
 * archive.org scan carries, and never added here — so the one role written to
 * describe a scanner's insert was the one role the parser refused, and a batch
 * that used it failed whole. `advertisement` is the same gap from the other
 * end: a publisher's list of its own titles bound into the book is neither
 * blank, nor stale pagination, nor the scanner's, and until there was a role
 * for it the only way to keep such a leaf out of a reprint was to call it
 * something it is not.
 */
describe('every role the type allows, the parser takes', () => {
  it('accepts each of them, and still refuses one that is not a role', () => {
    for (const role of ALL_PAGE_ROLES) {
      const parsed = parsePageTranscription({ role, blocks: [], uncertain: [], furniture: {} }, 0)
      expect(parsed.role, `should accept ${role}`).toBe(role)
    }
    expect(() =>
      parsePageTranscription({ role: 'advertisment', blocks: [], uncertain: [], furniture: {} }, 0)
    ).toThrow(/unknown page role/)
  })

  it('discards an advertisement and the scanner’s own leaf from the body', () => {
    expect(dispositionFor('advertisement')).toBe('discard')
    expect(dispositionFor('digitization-notice')).toBe('discard')
  })
})
