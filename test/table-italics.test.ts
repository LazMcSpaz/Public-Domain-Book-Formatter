import { describe, it, expect } from 'vitest'
import {
  parsePageTranscription,
  withMarkup,
  cellStarts,
  marksForCell,
  normalizeTable,
  type TranscribedBlock
} from '@core/transcribe'
import { assembleBook } from '@core/assemble'
import { applyEdits } from '@core/edits'
import { layout, layoutWithToc, fixedWidthMeasurer, type LaidOutBook } from '@core/layout'
import { defaultStyleProfile } from '@core/style'

/**
 * Italics inside a table cell.
 *
 * The engine used to set every cell in a single font, so a run inside one had
 * nowhere to go and `normalizeTable` dropped it — with a comment saying so.
 * The analytical contents of *Isis Unveiled* Vol. I is what made that worth
 * changing: three of its 156 entries italicise a word (*savants*,
 * *Orohippus*, *Shudâla Mâdan*) and the reprint printed all three in roman.
 *
 * The marks live in the coordinates of the **derived text** — the flattened
 * view with rows on lines and cells separated by a pipe — rather than in a
 * per-cell structure beside `cells`. That is the string the proof editor puts
 * in a textarea, the string the word-count cross-check reads, and the string
 * `withMarkup` writes tags back into, so a word index in a table means exactly
 * what it means in a paragraph. A second list keyed per cell would be the
 * hand-written copy this file's own history warns about.
 */

const EDITION = { title: 'Isis Unveiled', author: 'H. P. Blavatsky', editionDate: '2026' }

function tableBlock(cells: string[][]): TranscribedBlock {
  return normalizeTable<TranscribedBlock>({ kind: 'table', text: '', cells })
}

/**
 * A page carrying one table, given its rows **as notation**.
 *
 * Deliberately not a normalized block: `parsePageTranscription` re-derives the
 * marks from the notation and keeps nothing else, which is the same contract
 * every other kind has, so a fixture that handed it a clean block with an
 * `emphasis` array beside it would be testing a path no reply takes.
 */
function pageWithTable(cells: string[][]) {
  return assembleBook([
    parsePageTranscription(
      { role: 'body', blocks: [{ kind: 'table', cells }], uncertain: [], furniture: {} },
      0
    )
  ])
}

function runsOf(book: LaidOutBook) {
  return book.pages
    .flatMap((p) => p.items)
    .filter((i): i is Extract<typeof i, { kind: 'line' }> => i.kind === 'line')
    .flatMap((l) => l.runs)
}

describe('a table cell keeps its notation', () => {
  it('records the mark against the derived text, not against the cell', () => {
    const block = tableBlock([['The French <i>savants</i>', '60']])
    expect(block.cells).toEqual([['The French savants', '60']])
    expect(block.text).toBe('The French savants | 60')
    expect(block.emphasis).toEqual([2])
  })

  it('counts the pipe as a word, so the second column starts where it says', () => {
    const block = tableBlock([['a b', '<i>c</i>']])
    // a(0) b(1) |(2) c(3)
    expect(block.emphasis).toEqual([3])
  })

  it('carries every kind a paragraph carries', () => {
    const block = tableBlock([['<b>Na<sub>2</sub></b> and <sc>Soda</sc>', '9']])
    expect(block.cells).toEqual([['Na2 and Soda', '9']])
    expect(block.strong).toEqual([0])
    expect(block.subscript).toEqual([{ from: 2, to: 3 }])
    expect(block.smallCaps).toEqual([{ from: 8, to: 12 }])
  })

  it('round-trips through the notation the proof editor shows', () => {
    const block = tableBlock([['The French <i>savants</i>', '60']])
    const shown = withMarkup(block.text, block)
    expect(shown).toBe('The French <i>savants</i> | 60')
    // Retyped in the textarea and read back as a table: same cells, same mark.
    const again = normalizeTable<TranscribedBlock>({ kind: 'table', text: shown })
    expect(again.cells).toEqual(block.cells)
    expect(again.emphasis).toEqual(block.emphasis)
  })

  it('is idempotent, because normalizeTable runs wherever a table enters', () => {
    const once = tableBlock([['The French <i>savants</i>', '60']])
    const twice = normalizeTable(once)
    expect(twice).toEqual(once)
  })
})

describe('the cell the engine is about to set', () => {
  it('gets the part of the marks that falls inside it, in its own coordinates', () => {
    const block = tableBlock([
      ['The French <i>savants</i>', '60'],
      ['Plain', '<i>61</i>']
    ])
    const starts = cellStarts(block.cells!)
    expect(marksForCell(block, starts[0]![0]!, block.cells![0]![0]!)).toEqual({ emphasis: [2] })
    // The number in column two of row one is not marked, and must not inherit
    // the mark from the cell beside it.
    expect(marksForCell(block, starts[0]![1]!, block.cells![0]![1]!)).toEqual({})
    expect(marksForCell(block, starts[1]![1]!, block.cells![1]![1]!)).toEqual({ emphasis: [0] })
  })

  /**
   * The rows are joined by a newline, which is a character the flattened text
   * has and the cells do not. A start that forgot it puts every range in every
   * row after the first one character early — and a word index would not
   * notice, because a newline is whitespace and adds no word.
   */
  it('counts the newline between rows, so a range in the second row lands', () => {
    const block = tableBlock([
      ['ab', 'cd'],
      ['<sc>ef</sc>', 'gh']
    ])
    expect(block.text).toBe('ab | cd\nef | gh')
    const starts = cellStarts(block.cells!)
    expect(starts[1]![0]!.char).toBe(8)
    expect(marksForCell(block, starts[1]![0]!, 'ef')).toEqual({ smallCaps: [{ from: 0, to: 2 }] })
  })

  it('clips a run that reached past the pipe rather than letting it run on', () => {
    // The notation permits it and no book here has it; what must not happen is
    // the second cell taking a mark measured against the first.
    const block: TranscribedBlock = {
      kind: 'table',
      text: 'a b | c d',
      cells: [['a b', 'c d']],
      smallCaps: [{ from: 2, to: 9 }]
    }
    const starts = cellStarts(block.cells!)
    expect(marksForCell(block, starts[0]![0]!, 'a b')).toEqual({ smallCaps: [{ from: 2, to: 3 }] })
    expect(marksForCell(block, starts[0]![1]!, 'c d')).toEqual({ smallCaps: [{ from: 0, to: 3 }] })
  })
})

describe('what the page draws', () => {
  const stub = fixedWidthMeasurer(0.5)

  it('sets the marked word in italic and the rest of the cell in roman', () => {
    const doc = pageWithTable([['The French <i>savants</i>', '60']])
    const book = layout(doc, defaultStyleProfile(), stub, { edition: EDITION })
    const runs = runsOf(book)
    const marked = runs.find((r) => r.text === 'savants')
    expect(marked?.font.style).toBe('italic')
    expect(runs.find((r) => r.text === 'The')?.font.style).toBe('regular')
    // And the cell beside it is untouched: the mark is located per cell, not
    // by counting words down the whole flattened row.
    expect(runs.find((r) => r.text === '60')?.font.style).toBe('regular')
  })

  it('italicises the right cell when the mark is in the second column', () => {
    const doc = pageWithTable([['Lost arts', '<i>49</i>']])
    const book = layout(doc, defaultStyleProfile(), stub, { edition: EDITION })
    const runs = runsOf(book)
    expect(runs.find((r) => r.text === '49')?.font.style).toBe('italic')
    expect(runs.find((r) => r.text === 'Lost')?.font.style).toBe('regular')
  })

  it('survives the correction that re-derives the table', () => {
    const doc = pageWithTable([['Lost arts', '49']])
    const fixed = applyEdits(doc, [
      { kind: 'text', blockId: 'p0b0', text: 'Lost <i>arts</i> | 49' }
    ])
    expect(fixed.blocks[0]?.cells).toEqual([['Lost arts', '49']])
    const book = layout(fixed, defaultStyleProfile(), stub, { edition: EDITION })
    expect(runsOf(book).find((r) => r.text === 'arts')?.font.style).toBe('italic')
  })

  /**
   * A face where italic is three times the width of roman, so a cell measured
   * in the wrong one is off by a number no rounding can hide.
   */
  const wideItalic = {
    ...fixedWidthMeasurer(0.5),
    widthOf: (text: string, font: { style: string }, sizePt: number) =>
      text.length * sizePt * (font.style === 'italic' ? 1.5 : 0.5)
  }

  const runsWith = (doc: ReturnType<typeof pageWithTable>) =>
    runsOf(layout(doc, defaultStyleProfile(), wideItalic, { edition: EDITION }))

  /** How far apart two words sit, which centring does not change. */
  const gapIn = (runs: ReturnType<typeof runsWith>, from: string, to: string): number => {
    const at = (text: string) => runs.find((r) => r.text === text)?.xPt ?? 0
    return at(to) - at(from)
  }

  /**
   * The breaker has to know, not only the renderer: a word after an italic run
   * *inside the same cell* is placed at the sum of the advances before it, so a
   * cell broken entirely in roman and then drawn partly in italic puts every
   * word after the run in the wrong place. The font of the run is no test of
   * this — `toFlowLines` resolves that from the spans either way.
   */
  it('breaks the cell with the advances it will be drawn with', () => {
    const marked = runsWith(pageWithTable([['<i>abcd</i> z', '1']]))
    const plain = runsWith(pageWithTable([['abcd z', '1']]))
    // The gap between the two words, not either position: a wider table is
    // centred differently, so the absolute numbers move for a reason that has
    // nothing to do with what is being asserted.
    expect(gapIn(marked, 'abcd', 'z')).toBeGreaterThan(gapIn(plain, 'abcd', 'z'))
  })

  /**
   * And the column width is that same measurement, so the cell beside it moves
   * too. Two words rather than one, because a single-word cell's natural width
   * is measured by `naturalWidth` alone and would pass with the breaker blind.
   */
  it('measures the column with the faces the cell will be set in', () => {
    const marked = runsWith(pageWithTable([['<i>abcd</i> z', '1']]))
    const plain = runsWith(pageWithTable([['abcd z', '1']]))
    expect(gapIn(marked, 'abcd', '1')).toBeGreaterThan(gapIn(plain, 'abcd', '1'))
  })
})

/**
 * The contents is the case this was actually asked for, and it is a different
 * path from a table in the body: a contents leaf is *discarded* by role, its
 * entries read off into `chapter.topics`, and the topic set by the TOC builder
 * rather than by the table builder. So a change that italicises a body table
 * and stops there sets nothing on the page anyone was looking at.
 */
describe('the original analytical contents', () => {
  const stub = fixedWidthMeasurer(0.5)

  const contents = [
    { kind: 'heading' as const, text: 'CHAPTER III.' },
    { kind: 'heading' as const, text: 'BLIND LEADERS OF THE BLIND.' },
    {
      kind: 'table' as const,
      cells: [
        ['Huxley’s derivation from the <i>Orohippus</i>', '74'],
        ['Comte, his system and disciples', '75'],
        ['The London materialists', '85']
      ]
    },
    { kind: 'heading' as const, text: 'CHAPTER IV.' },
    { kind: 'heading' as const, text: 'THEORIES RESPECTING PSYCHIC PHENOMENA.' },
    {
      kind: 'table' as const,
      cells: [
        ['Theory of de Gasparin', '100'],
        ['Theory of Thury', '101'],
        ['Theory of Babinet', '102']
      ]
    }
  ]

  /**
   * Two chapters and six entries, because `analyticalLooksSound` refuses a
   * parse that has not come back regular — fewer than two groups, or fewer
   * than four arabic folios, and it hands back nothing rather than print a
   * mangled contents. A one-chapter fixture tests the refusal, not the mark.
   */
  function volume() {
    const body = (leaf: number, label: string, folio: string) =>
      parsePageTranscription(
        {
          role: 'chapter-opening',
          blocks: [
            { kind: 'heading', text: label, level: 1 },
            { kind: 'paragraph', text: `The body of ${label} begins here.` }
          ],
          uncertain: [],
          furniture: { folio }
        },
        leaf
      )
    return assembleBook([
      parsePageTranscription(
        { role: 'table-of-contents', blocks: contents, uncertain: [], furniture: {} },
        0
      ),
      body(1, 'CHAPTER III.', '74'),
      body(2, 'CHAPTER IV.', '100')
    ])
  }

  it('carries a cell’s notation into the topic', () => {
    const chapter = volume().chapters.find((c) => c.topics?.length)
    const topic = chapter?.topics?.[0]
    expect(topic?.text).toBe('Huxley’s derivation from the <i>Orohippus</i>')
  })

  it('sets the marked word in italic where the contents prints it', () => {
    // Through `layoutWithToc`, because that is what builds the contents: the
    // topics take their folios on the second pass, and a single `layout` call
    // sets a book with no contents page in it at all.
    const book = layoutWithToc(volume(), defaultStyleProfile(), stub, { edition: EDITION })
    const runs = runsOf(book)
    // The tag never reaches the page as text, and the word it marked is italic.
    expect(runs.some((r) => r.text.includes('<i>'))).toBe(false)
    expect(runs.find((r) => r.text === 'Orohippus')?.font.style).toBe('italic')
    expect(runs.find((r) => r.text === 'derivation')?.font.style).toBe('regular')
  })
})
