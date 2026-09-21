import { describe, it, expect } from 'vitest'
import {
  ledgerNumbers,
  ledgerSection,
  withLedgerSection,
  LEDGER_HEADING
} from '@core/project/ledger'

const book = {
  run: {
    pageCount: 121,
    complete: true,
    rulings: [{ queryKey: 'a' }, { queryKey: 'b' }],
    facts: [{ id: 1 }],
    edits: [
      { kind: 'text', blockId: 'p1b0' },
      { kind: 'text', blockId: 'p2b0' },
      { kind: 'split', blockId: 'p3b0' },
      { kind: 'note', blockId: 'p3b1' },
      // Two of one and one of the other, deliberately: with one of each, a
      // check that counted bare marks as highlights passed unseen.
      { kind: 'bare-mark', blockId: 'p4b0' },
      { kind: 'bare-mark', blockId: 'p4b1' },
      { kind: 'highlight', blockId: 'p5b0' },
      { kind: 'section', sectionId: 'intro', placement: 'front', title: 'Before You Begin' }
    ],
    transcriptions: [
      {
        pageIndex: 0,
        blocks: [{ kind: 'heading' }, { kind: 'paragraph' }, { kind: 'footnote' }],
        queries: [{ kind: 'inconsistent' }]
      },
      {
        pageIndex: 1,
        blocks: [{ kind: 'paragraph' }, { kind: 'paragraph' }],
        queries: [{ kind: 'inconsistent' }, { kind: 'printers-error' }]
      }
    ]
  },
  images: [{ id: 'a' }, { id: 'b' }],
  scan: { path: 'scans/abc.pdf', bytes: 512136 }
}

describe('the numbers, read off a book file', () => {
  const n = ledgerNumbers(book)

  it('counts the leaves, the edits and the queries', () => {
    expect(n.leaves).toBe(121)
    expect(n.complete).toBe(true)
    expect(n.editTotal).toBe(8)
    expect(n.edits).toContainEqual({ kind: 'text', count: 2 })
    expect(n.queryTotal).toBe(3)
    expect(n.rulings).toBe(2)
  })

  it('counts what the reading found the book to be made of', () => {
    expect(n.blocks).toContainEqual({ kind: 'paragraph', count: 3 })
    expect(n.footnotes).toBe(1)
    // The original's notes and the editor's are different questions: a book
    // with none of the first and 23 of the second reads as 23 if they are
    // added together, and that is what _Clairvoyance_ would have said.
    expect(n.editorNotes).toBe(1)
  })

  it('separates the apparatus from the edits that carry it', () => {
    expect(n.bareMarks).toBe(2)
    expect(n.marked).toBe(1)
    expect(n.sections).toEqual(['Before You Begin'])
    expect(n.front).toBe(true)
    expect(n.pictures).toBe(2)
    expect(n.facts).toBe(1)
  })

  /**
   * A report that throws on a half-finished book is a report nobody runs until
   * it is too late to be useful — which is how the ledger came to be missing
   * from eight books in the first place.
   */
  it('finds front matter by its place in the book, never by its title', () => {
    // Every book on this shelf calls its introduction "Before You Begin".
    // Matching the word would report all five as lacking one.
    expect(ledgerNumbers(book).front).toBe(true)
    expect(
      ledgerNumbers({ run: { edits: [{ kind: 'section', title: 'Glossary', placement: 'back' }] } })
        .front
    ).toBe(false)
  })

  it('reports zeroes for a book file with nothing in it rather than throwing', () => {
    const empty = ledgerNumbers({})
    expect(empty.leaves).toBe(0)
    expect(empty.complete).toBe(false)
    expect(empty.editTotal).toBe(0)
    expect(empty.scan.path).toBeNull()
    expect(() => ledgerNumbers(null)).not.toThrow()
    expect(() => ledgerNumbers('not a book')).not.toThrow()
  })

  it('says so, loudly, when a reading is not finished or has no scan', () => {
    const text = ledgerSection(ledgerNumbers({ run: { pageCount: 4 } }))
    expect(text).toContain('**not complete**')
    expect(text).toContain('**not recorded**')
  })
})

describe('the section', () => {
  it('states counts and never interprets one', () => {
    const text = ledgerSection(ledgerNumbers(book))
    expect(text).toContain('121')
    expect(text).toContain('2 bare-mark, 2 text')
    expect(text).toContain('3 raised (2 inconsistent, 1 printers-error), 2 rulings filed')
    expect(text).toContain('500 KB')
    // No sentence that judges a number — that half is the editor's.
    expect(text).not.toMatch(/\b(good|clean|poor|earning|noise|should)\b/u)
  })

  it('says "1 ruling" and not "1 rulings"', () => {
    const one = ledgerSection(
      ledgerNumbers({
        run: { rulings: [{}], transcriptions: [{ pageIndex: 0, queries: [{ kind: 'unclear' }] }] }
      })
    )
    expect(one).toContain('1 ruling filed')
  })
})

describe('splicing it into a ledger', () => {
  const section = ledgerSection(ledgerNumbers(book))

  it('appends to a hand-written ledger that has never had one', () => {
    const out = withLedgerSection('# Ledger\n\nThe scan is a photograph.\n', section)
    expect(out).toContain('The scan is a photograph.')
    expect(out).toContain(LEDGER_HEADING)
    expect(out.indexOf('photograph')).toBeLessThan(out.indexOf(LEDGER_HEADING))
  })

  it('replaces the old section and keeps everything else', () => {
    const before = `# Ledger\n\nProse above.\n\n${LEDGER_HEADING}\n\n| | |\n| --- | --- |\n| Leaves | 9 |\n\n## After\n\nProse below.\n`
    const out = withLedgerSection(before, section)
    expect(out).toContain('Prose above.')
    expect(out).toContain('Prose below.')
    expect(out).toContain('## After')
    expect(out).toContain('| Leaves | 121 |')
    expect(out).not.toContain('| Leaves | 9 |')
  })

  it('is idempotent, so a check can compare rather than guess', () => {
    const once = withLedgerSection('# Ledger\n\nProse.\n', section)
    expect(withLedgerSection(once, section)).toBe(once)
  })

  /**
   * The trap, and the one this module could not avoid meeting.
   *
   * A ledger that explains this machinery quotes its own heading in a
   * sentence. Searching for the text anywhere rather than at the start of a
   * line finds the quotation first and eats every word from there on — and the
   * words it eats are the ones nothing can rebuild.
   */
  it('is not fooled by a paragraph that mentions the heading', () => {
    const before = `# Ledger\n\nThe section under ${LEDGER_HEADING} is rebuilt, so do not edit it.\n\nMore prose that must survive.\n`
    const out = withLedgerSection(before, section)
    expect(out).toContain('is rebuilt, so do not edit it.')
    expect(out).toContain('More prose that must survive.')
  })

  it('writes the section alone into an empty file', () => {
    expect(withLedgerSection(null, section).startsWith(LEDGER_HEADING)).toBe(true)
    expect(withLedgerSection('', section).startsWith(LEDGER_HEADING)).toBe(true)
  })
})

describe('queries waiting, and queries held', () => {
  const standing = {
    pageIndex: null,
    quote: 'practiced / practised',
    kind: 'inconsistent',
    decision: 'as-printed',
    covers: ['practiced'],
    decidedOn: '2026-09-10'
  }
  const leaf = (pageIndex: number, quote: string, kind = 'inconsistent') => ({
    pageIndex,
    blocks: [],
    queries: [{ quote, why: 'because', kind }]
  })

  it('counts a query with no ruling on the spot as waiting, and one a standing ruling reaches as held', () => {
    const n = ledgerNumbers({
      run: {
        pageCount: 3,
        transcriptions: [
          leaf(1, 'they practiced it'),
          leaf(2, 'a stray point', 'printers-error'),
          leaf(3, 'settled')
        ],
        rulings: [
          standing,
          {
            pageIndex: 3,
            quote: 'settled',
            kind: 'inconsistent',
            decision: 'noted',
            decidedOn: '2026-09-10'
          }
        ]
      }
    })
    expect(n.queryTotal).toBe(3)
    expect(n.rulings).toBe(2)
    expect(n.queriesWaiting).toBe(2)
    expect(n.queriesHeld).toBe(1)
    expect(ledgerSection(n)).toMatch(
      /\| Queries \| 3 raised .*2 rulings filed, \*\*2 waiting\*\* \(1 held under a standing ruling for approval\)/u
    )
  })

  it('a standing ruling is never counted as settling a query by subtraction', () => {
    // 1 raised against 1 ruling is not 0 waiting when the ruling is standing
    // and reaches nothing.
    const n = ledgerNumbers({
      run: { pageCount: 1, transcriptions: [leaf(1, 'nothing it covers')], rulings: [standing] }
    })
    expect(n.queriesWaiting).toBe(1)
    expect(n.queriesHeld).toBe(0)
  })
})

describe('the shape on the ledger', () => {
  const shape = {
    pixels: false,
    textLayer: 'converted',
    externalText: false,
    container: 'pdf',
    how: 'measured',
    evidence: ['0 of 8 sampled leaves are a photograph', 'producer: Acrobat PDFWriter']
  }

  it('reads the shape and names the route it puts the book on', () => {
    const n = ledgerNumbers({ run: { pageCount: 4, shape } })
    expect(n.shape).toEqual(shape)
    expect(n.route).toBe('converted-text')
    const text = ledgerSection(n)
    expect(text).toMatch(
      /\| Shape \| .*OCR with no page images.*route `converted-text`.*Acrobat PDFWriter/u
    )
  })

  it('says so when no shape was recorded, and how to record one', () => {
    const n = ledgerNumbers({ run: { pageCount: 4 } })
    expect(n.shape).toBeNull()
    expect(n.route).toBeNull()
    expect(ledgerSection(n)).toMatch(/\| Shape \| \*\*not recorded\*\* — `node scripts\/shape.mjs/u)
  })

  it('drops a shape it cannot read rather than routing on it', () => {
    const n = ledgerNumbers({ run: { pageCount: 4, shape: { ...shape, how: 'guessed' } } })
    expect(n.shape).toBeNull()
  })
})
