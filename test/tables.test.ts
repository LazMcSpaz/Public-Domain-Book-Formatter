import { describe, it, expect } from 'vitest'
import {
  normalizeTable,
  parsePageTranscription,
  parseTableText,
  tableToText,
  transcriptionText,
  BLOCK_KINDS,
  PAGE_SCHEMA,
  type TranscribedBlock
} from '@core/transcribe'
import { assembleBook } from '@core/assemble'
import { applyEdits } from '@core/edits'
import {
  fixedWidthMeasurer,
  layout,
  type LaidOutBook,
  type LaidOutPage,
  type LayoutEdition,
  type PositionedLine,
  type RuleShape
} from '@core/layout'
import { defaultStyleProfile } from '@core/style'
import type { BookBlock, BookDocument } from '@core/assemble'

const measurer = fixedWidthMeasurer(0.5)

const EDITION: LayoutEdition = {
  title: 'A Treatise of Airs',
  author: 'Robert Boyle',
  editionDate: '2026'
}

function doc(blocks: BookBlock[]): BookDocument {
  return {
    blocks,
    footnotes: [],
    chapters: [],
    asides: [],
    illustrations: [],
    sections: [],
    skipped: [],
    synopsesUnmatched: []
  }
}

function tableBlock(cells: string[][], headerRow = false): BookBlock {
  return {
    id: 'p0b0',
    kind: 'table',
    text: tableToText(cells),
    cells,
    sourcePages: [0],
    ...(headerRow ? { headerRow: true } : {})
  }
}

const run = (document: BookDocument): LaidOutBook =>
  layout(document, defaultStyleProfile(), measurer, { edition: EDITION })

const lines = (page: LaidOutPage): PositionedLine[] =>
  page.items.filter((i): i is PositionedLine => i.kind === 'line')

const rules = (book: LaidOutBook): RuleShape[] =>
  book.pages.flatMap((p) => p.items.filter((i): i is RuleShape => i.kind === 'rule'))

/** Every run in the book that carries a given word, wherever it landed. */
function runsSaying(book: LaidOutBook, text: string) {
  return book.pages.flatMap((p) => lines(p).flatMap((l) => l.runs.filter((r) => r.text === text)))
}

/**
 * Before this, `BlockKind` had no table in it. A page of columns — a schedule of
 * rates, a list of dates against places — came back as paragraphs, and the
 * numbers were set as running prose with the columns gone. The design interview
 * meanwhile offered "Reference or technical" as a kind of book, which is exactly
 * the kind the pipeline could not carry.
 */
describe('the schema knows what a table is', () => {
  it('offers table as a block kind, to the model as well as to us', () => {
    expect(BLOCK_KINDS).toContain('table')
    const blocks = PAGE_SCHEMA.properties.blocks.items
    expect(blocks.properties.kind.enum).toContain('table')
    expect(blocks.properties.cells.type).toBe('array')
  })

  it('flattens rows to text, and reads that text back as rows', () => {
    const cells = [
      ['Year', 'Barrels'],
      ['1665', '1,204']
    ]
    expect(tableToText(cells)).toBe('Year | Barrels\n1665 | 1,204')
    expect(parseTableText(tableToText(cells))).toEqual(cells)
  })

  it('keeps the structure and the text from ever disagreeing', () => {
    // Whichever the caller supplies, both come out of `normalizeTable`
    // consistent — which is what lets the proof step edit a table as text.
    const fromCells = normalizeTable({
      kind: 'table',
      text: 'stale, from before the correction',
      cells: [['a', 'b']]
    })
    expect(fromCells.text).toBe('a | b')

    const fromText = normalizeTable<TranscribedBlock>({ kind: 'table', text: 'a | b\nc | d' })
    expect(fromText.cells).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ])
  })

  it('recovers the rows of a table the model described without cells', () => {
    // A table with its columns lost still has its lines, and printing those
    // beats printing the figures run together into a paragraph.
    const page = parsePageTranscription(
      {
        role: 'body',
        blocks: [{ kind: 'table', text: '1665 | 1,204\n1666 | 987' }],
        uncertain: [],
        furniture: {}
      },
      0
    )
    expect(page.blocks[0]!.cells).toEqual([
      ['1665', '1,204'],
      ['1666', '987']
    ])
  })

  it('drops the rows from a block that is no longer a table', () => {
    const retyped = normalizeTable({
      kind: 'paragraph',
      text: 'a | b',
      cells: [['a', 'b']],
      headerRow: true
    } as TranscribedBlock)
    expect(retyped.cells).toBeUndefined()
    expect(retyped.headerRow).toBeUndefined()
  })

  it('still reads as text to everything that counts words', () => {
    // The OCR cross-check and the seam checks read a page as prose. A table
    // invisible to them would look like a page the model had skipped.
    const page = parsePageTranscription(
      {
        role: 'body',
        blocks: [{ kind: 'table', cells: [['Year', 'Barrels']], text: '' }],
        uncertain: [],
        furniture: {}
      },
      0
    )
    expect(transcriptionText(page)).toContain('Barrels')
  })
})

describe('assembly leaves a table whole', () => {
  const pageWith = (blocks: TranscribedBlock[]) => ({
    pageIndex: 0,
    role: 'body' as const,
    blocks,
    uncertain: [],
    furniture: {}
  })

  it('never stitches a table onto the paragraph before it', () => {
    // Seam repair joins a paragraph that runs across the page edge. A table
    // swallowed into the paragraph above it would lose its columns entirely.
    const book = assembleBook([
      pageWith([
        { kind: 'paragraph', text: 'The yields for the period were as follows' },
        { kind: 'table', cells: [['1665', '1,204']], text: '' }
      ])
    ])
    expect(book.blocks).toHaveLength(2)
    expect(book.blocks[1]!.kind).toBe('table')
  })

  it('cleans the cells, not only the flattened text', () => {
    // Soft hyphens are scan noise. Stripping them from the text alone would
    // leave the two views describing different tables.
    const book = assembleBook([
      pageWith([{ kind: 'table', cells: [['Bar­rels', '1,204']], text: '' }])
    ])
    expect(book.blocks[0]!.cells).toEqual([['Barrels', '1,204']])
    expect(book.blocks[0]!.text).toBe('Barrels | 1,204')
  })
})

describe('a table on the page', () => {
  const CELLS = [
    ['Year', 'Barrels', 'Port'],
    ['1665', '1,204', 'Bristol'],
    ['1666', '987', 'Hull']
  ]

  it('sets every cell, in the right order', () => {
    const book = run(doc([tableBlock(CELLS, true)]))
    for (const cell of CELLS.flat()) {
      expect(runsSaying(book, cell).length).toBeGreaterThan(0)
    }
  })

  it('puts each row on its own baseline, columns side by side', () => {
    const book = run(doc([tableBlock(CELLS, true)]))
    const year = runsSaying(book, '1665')[0]!
    const barrels = runsSaying(book, '1,204')[0]!
    const next = runsSaying(book, '1666')[0]!
    // Same row: the second column starts to the right of the first.
    expect(barrels.xPt).toBeGreaterThan(year.xPt)
    // Next row: same column, so the same left edge.
    expect(next.xPt).toBeCloseTo(year.xPt, 6)
  })

  it('sets a column of figures to the right and a column of words to the left', () => {
    // The whole point of a table of numbers is that the magnitudes line up
    // down the column, which only right alignment gives.
    const book = run(doc([tableBlock(CELLS, true)]))
    expect(runsSaying(book, '1,204')[0]!.xPt).not.toBeCloseTo(runsSaying(book, '987')[0]!.xPt, 1)
    expect(runsSaying(book, 'Bristol')[0]!.xPt).toBeCloseTo(runsSaying(book, 'Hull')[0]!.xPt, 6)
  })

  it('sets the column heads apart, with a rule under them', () => {
    const book = run(doc([tableBlock(CELLS, true)]))
    expect(runsSaying(book, 'Year')[0]!.font.style).toBe('italic')
    expect(runsSaying(book, '1665')[0]!.font.style).toBe('regular')
    // Head rule and foot rule; the footnote separator is not in this book.
    expect(rules(book)).toHaveLength(2)
  })

  it('draws no rules at all for a table with no column heads', () => {
    // A lone rule under the last row of a headless table is a line across the
    // page with nothing to close.
    expect(rules(run(doc([tableBlock(CELLS)])))).toHaveLength(0)
  })

  it('keeps the whole table inside the measure', () => {
    const wide = [
      ['A description long enough to want more room than it can have', 'x'],
      ['Another description of similar and considerable length here', 'y']
    ]
    const book = run(doc([tableBlock(wide)]))
    const page = book.pages.find((p) => lines(p).some((l) => l.runs.some((r) => r.text === 'x')))!
    const right = page.frame.xPt + page.frame.widthPt
    for (const line of lines(page)) {
      for (const r of line.runs) expect(r.xPt).toBeLessThanOrEqual(right)
    }
  })

  it('centres a table narrower than the measure rather than stretching it', () => {
    const book = run(doc([tableBlock([['i', 'ii']])]))
    const page = book.pages.find((p) => lines(p).some((l) => l.runs.some((r) => r.text === 'i')))!
    expect(runsSaying(book, 'i')[0]!.xPt).toBeGreaterThan(page.frame.xPt)
  })
})

describe('a table too long for one page', () => {
  // `lot-3` rather than a bare number, so a row's own words can never be
  // confused with the folio printed at the foot of the page it landed on.
  const long = Array.from({ length: 200 }, (_, i) => [String(1600 + i), `lot-${i} barrels`])

  it('breaks between rows and sets every one of them', () => {
    const book = run(doc([tableBlock([['Year', 'Yield'], ...long], true)]))
    for (const row of [long[0]!, long[99]!, long[199]!]) {
      expect(runsSaying(book, row[0]!).length).toBe(1)
    }
  })

  it('never splits a row across the break', () => {
    // A row is the indivisible thing. Half a row at the foot of one page and
    // half at the head of the next is a table that lies about its own data.
    const book = run(doc([tableBlock([['Year', 'Yield'], ...long], true)]))
    const pageOf = (text: string): number[] =>
      book.pages
        .filter((p) => lines(p).some((l) => l.runs.some((r) => r.text === text)))
        .map((p) => p.index)

    long.forEach((row, i) => {
      // The year is the first cell and `lot-i` the first word of the second,
      // so they are the two ends of one row.
      const first = pageOf(row[0]!)
      expect(first).toHaveLength(1)
      expect(pageOf(`lot-${i}`)).toEqual(first)
    })
  })
})

describe('correcting a table at the proof step', () => {
  const base = doc([tableBlock([['1665', '1,204']])])

  it('re-reads the columns from the corrected text', () => {
    // The proof step edits the flattened view. If the cells did not come back
    // from it, the book would print what was read rather than what was typed.
    const fixed = applyEdits(base, [{ kind: 'text', blockId: 'p0b0', text: '1665 | 1,264' }])
    expect(fixed.blocks[0]!.cells).toEqual([['1665', '1,264']])
    expect(runsSaying(run(fixed), '1,264').length).toBeGreaterThan(0)
  })

  it('makes a table out of a paragraph the pass got wrong', () => {
    const asProse = doc([
      { id: 'p0b0', kind: 'paragraph', text: '1665 | 1,204\n1666 | 987', sourcePages: [0] }
    ])
    const fixed = applyEdits(asProse, [
      { kind: 'retype', blockId: 'p0b0', blockKind: 'table' as const }
    ])
    expect(fixed.blocks[0]!.cells).toEqual([
      ['1665', '1,204'],
      ['1666', '987']
    ])
  })

  it('leaves no rows behind when a table is retyped back to prose', () => {
    const fixed = applyEdits(base, [
      { kind: 'retype', blockId: 'p0b0', blockKind: 'paragraph' as const }
    ])
    expect(fixed.blocks[0]!.cells).toBeUndefined()
  })
})
