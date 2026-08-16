import { describe, it, expect } from 'vitest'
import { verifyBook } from '@core/transcribe'
import type { PageTranscription, TranscribedBlock } from '@core/transcribe'

function page(
  pageIndex: number,
  texts: string[],
  over: Partial<PageTranscription> = {}
): PageTranscription {
  return {
    pageIndex,
    role: 'body',
    blocks: texts.map((text): TranscribedBlock => ({ kind: 'paragraph', text })),
    uncertain: [],
    furniture: { runningHead: 'THE ALCHEMIST', folio: String(pageIndex + 1) },
    ...over
  }
}

const codes = (fs: ReturnType<typeof verifyBook>): string[] => fs.map((f) => f.code)

/**
 * `verifyPage` compares a page against the OCR of that same page, which is a
 * great deal and structurally blind to anything that only looks wrong beside
 * its neighbours. These are the classic scan failures, and nothing in the app
 * could see any of them.
 */
describe('seams — where a leaf goes missing', () => {
  it('flags a page that stops mid-sentence beside one that starts afresh', () => {
    const found = verifyBook([
      page(0, ['The alembick being set upon a gentle fire, and the matter therein']),
      page(1, ['Concerning the choice of simples, those gathered under a waxing moone.'])
    ])
    expect(codes(found)).toContain('seam-broken')
    // The evidence, so a reviewer can judge rather than trust.
    expect(found[0]!.words?.[0]).toContain('matter therein')
  })

  it('says nothing when the sentence actually continues', () => {
    const found = verifyBook([
      page(0, ['The alembick being set upon a gentle fire, and the matter therein']),
      page(1, ['digested by the space of fourty dayes, there ariseth a vapour.'])
    ])
    expect(codes(found)).not.toContain('seam-broken')
  })

  it('accepts a chapter heading as the reason for the break', () => {
    // A book may legitimately break mid-clause before a new chapter; the
    // heading is the evidence that the break was the printer's, not ours.
    const found = verifyBook([
      page(0, ['The alembick being set upon a gentle fire, and the matter therein']),
      page(1, ['Of Fire'], {
        blocks: [{ kind: 'heading', text: 'Of Fire', level: 1 }]
      })
    ])
    expect(codes(found)).not.toContain('seam-broken')
  })

  it('reads across a blank leaf rather than tripping on it', () => {
    // A blank page between two halves of a sentence is normal in a scan and
    // must not be mistaken for the sentence ending.
    const found = verifyBook([
      page(0, ['The alembick being set upon a gentle fire, and the matter therein']),
      page(1, [], { role: 'blank', blocks: [] }),
      page(2, ['digested by the space of fourty dayes.'])
    ])
    expect(codes(found)).not.toContain('seam-broken')
  })

  it('ignores a footnote at the foot when judging the seam', () => {
    // The last *block* on a page is often a note; the last block of running
    // text is what continues onto the next leaf.
    const found = verifyBook([
      page(0, ['The alembick being set upon a gentle fire, and the matter therein'], {
        blocks: [
          { kind: 'paragraph', text: 'The alembick being set upon a gentle fire, and the matter' },
          { kind: 'footnote', text: 'See Croll, Basilica Chymica.', marker: '1' }
        ]
      }),
      page(1, ['therein digested by the space of fourty dayes.'])
    ])
    expect(codes(found)).not.toContain('seam-broken')
  })
})

describe('a leaf read twice', () => {
  const prose =
    'The alembick being set upon a gentle fire, and the matter therein digested by the ' +
    'space of fourty dayes, there ariseth a vapour of a whitish colour, which the ancients ' +
    'have named the Flying Eagle, and it must be received into a clean receiver.'

  it('flags two pages that came back word for word identical', () => {
    const found = verifyBook([page(0, [prose]), page(1, [prose])])
    expect(codes(found)).toContain('duplicate-page')
    expect(found[0]!.severity).toBe('high')
  })

  it('does not flag two short pages that happen to match', () => {
    // A half-empty page reading "CHAPTER II" twice is a book, not a bug.
    const found = verifyBook([page(0, ['CHAPTER II']), page(1, ['CHAPTER II'])])
    expect(codes(found)).not.toContain('duplicate-page')
  })
})

describe('furniture that went missing on one page', () => {
  const many = (n: number, over: (i: number) => Partial<PageTranscription> = () => ({})) =>
    Array.from({ length: n }, (_, i) => page(i, [`Page ${i} of prose, at some length.`], over(i)))

  it('flags the odd page out when the habit is well established', () => {
    const pages = many(10)
    pages[4] = page(4, ['Page 4 of prose, at some length.'], {
      furniture: { folio: '5' }
    })
    const found = verifyBook(pages)
    const missing = found.filter((f) => f.code === 'furniture-missing')
    expect(missing).toHaveLength(1)
    expect(missing[0]!.pageIndex).toBe(4)
  })

  it('says nothing about a book that simply has no running heads', () => {
    // The check is for the odd one out. A book without them must not produce
    // one finding per page, which would bury every real finding beside it.
    const pages = many(10, () => ({ furniture: { folio: '1' } }))
    expect(verifyBook(pages).filter((f) => f.code === 'furniture-missing')).toHaveLength(0)
  })

  it('holds its tongue on a book too short to have a habit', () => {
    const pages = many(3, (i) => (i === 1 ? { furniture: {} } : {}))
    expect(verifyBook(pages).filter((f) => f.code === 'furniture-missing')).toHaveLength(0)
  })
})

describe('the findings are usable', () => {
  it('puts the most severe first, then page order', () => {
    // Long enough to clear the duplicate check's floor, which is there so that
    // two half-empty pages reading "CHAPTER II" are not a finding.
    const prose = 'A page of prose long enough to count as substantial for the duplicate check. '
    const found = verifyBook([
      page(0, [prose.repeat(3)]),
      page(1, [prose.repeat(3)]),
      page(2, ['Ends mid'], { furniture: { folio: '3' } }),
      page(3, ['Starts fresh here, with a capital.'])
    ])
    expect(found[0]!.severity).toBe('high')
    const severities = found.map((f) => f.severity)
    expect(severities).toEqual([...severities].sort())
  })

  it('finds nothing to say about a clean book', () => {
    const found = verifyBook([
      page(0, ['The alembick being set upon a gentle fire, and the matter therein']),
      page(1, ['digested by the space of fourty dayes, there ariseth a vapour.']),
      page(2, ['This must be received into a clean receiver, well luted at the joynts.'])
    ])
    expect(found).toEqual([])
  })
})
