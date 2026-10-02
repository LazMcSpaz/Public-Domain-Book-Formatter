import { describe, it, expect } from 'vitest'
import { checkCoverage, type LayerLeaf } from '@core/witness'
import type { BookBlock, BookDocument } from '@core/assemble'

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
const block = (
  id: string,
  text: string,
  pages: number[],
  kind: BookBlock['kind'] = 'paragraph'
) => ({
  id,
  kind,
  text,
  sourcePages: pages
})

/**
 * A leaf of ordinary prose, written so that every word of it is set more than
 * once in the book: the layer's lines are only judged where the book knows
 * their words, and a fixture of hapaxes would be judged as junk and pass.
 */
const PARAGRAPHS = [
  'So if you are seeing a hundred people and you are closing thirty of them then you need to see three hundred to triple your income in a year.',
  'Every salesman we met had a ritual, a canned approach repeated with each customer, and the trick was always to use it on as many strangers as he could find.',
  'Belief matters here because nobody sells well what he privately despises, and a foundation of product knowledge means knowing what the thing actually does.',
  'Electronics stores should hire clerks who understand computers, so that a buyer is not left waiting on hold for someone abroad to explain the machine to him.'
]
/** The paper's lines for those paragraphs, broken as a page breaks them. */
const lines = (text: string): string[] => {
  const w = text.split(' ')
  const out: string[] = []
  for (let i = 0; i < w.length; i += 9) out.push(w.slice(i, i + 9).join(' '))
  return out
}
const paper = (page: number, paragraphs: string[]): LayerLeaf => ({
  page,
  lines: paragraphs.flatMap(lines)
})
const book = (paragraphs: string[], page = 5) =>
  doc([
    ...paragraphs.map((t, i) => block(`p${page}b${i}`, t, [page])),
    // The same prose again on another leaf, so its words are the book's.
    ...PARAGRAPHS.map((t, i) => block(`p90b${i}`, t, [90]))
  ])

describe('a line the paper prints and the book does not', () => {
  it('is reported, with the paper’s words', () => {
    const [a, b, c, d] = PARAGRAPHS as [string, string, string, string]
    const dropped = b.split(' ').slice(9, 27).join(' ')
    const found = checkCoverage(book([a, b.replace(dropped, '').replace(/\s+/gu, ' '), c, d]), [
      paper(5, PARAGRAPHS)
    ]).filter((f) => f.kind === 'missing')
    expect(found).toHaveLength(1)
    expect(found[0]!.page).toBe(5)
    expect(found[0]!.lines.join(' ')).toContain('repeated with each customer')
  })

  it('is not reported where the book has every line', () => {
    expect(checkCoverage(book(PARAGRAPHS), [paper(5, PARAGRAPHS)])).toEqual([])
  })

  it('is found across a seam, in a paragraph that began on the leaf before', () => {
    const d = doc([
      block('p4b0', PARAGRAPHS.join(' '), [4, 5]),
      ...PARAGRAPHS.map((t, i) => block(`p90b${i}`, t, [90]))
    ])
    expect(checkCoverage(d, [paper(5, PARAGRAPHS)])).toEqual([])
  })

  it('is found where the reading set it on the next leaf', () => {
    const [a, b, c, d] = PARAGRAPHS as [string, string, string, string]
    const doc6 = doc([
      block('p5b0', a, [5]),
      block('p5b1', c, [5]),
      block('p5b2', d, [5]),
      block('p6b0', b, [6]),
      ...PARAGRAPHS.map((t, i) => block(`p90b${i}`, t, [90]))
    ])
    expect(checkCoverage(doc6, [paper(5, PARAGRAPHS)]).filter((f) => f.kind === 'missing')).toEqual(
      []
    )
  })

  it('survives a layer that spaced its letters out', () => {
    const spaced = paper(5, PARAGRAPHS)
    for (const k of [2, 3]) spaced.lines[k] = [...spaced.lines[k]!.replace(/\s+/gu, '')].join(' ')
    // A real book sets single letters as words — the pronoun, a variable, a
    // list — which is what lets such a line be judged at all.
    const d = book(PARAGRAPHS)
    d.blocks.push(block('p91b0', [...'abcdefghijklmnopqrstuvwxyz'].join(' '), [91]))
    expect(checkCoverage(d, [spaced])).toEqual([])
  })

  it('leaves the layer’s own junk alone', () => {
    const junk = paper(5, PARAGRAPHS)
    junk.lines.push(
      'i8euro m uistic p r o g r m n g m as vou reauires articioants',
      'qual ty conqol trrunlng matena s cla mng exertln'
    )
    expect(checkCoverage(book(PARAGRAPHS), [junk])).toEqual([])
  })

  it('leaves a running head alone, folio and all', () => {
    const leaves = [5, 6, 7].map((p) => ({
      page: p,
      lines: [
        `${p + 100} Chapter Two Some Basic Assumptions of the Work You Need to Do Every Day`,
        ...lines(PARAGRAPHS[0]!)
      ]
    }))
    const d = doc([
      ...[5, 6, 7].map((p) => block(`p${p}b0`, PARAGRAPHS[0]!, [p])),
      ...PARAGRAPHS.map((t, i) => block(`p90b${i}`, t, [90])),
      block(
        'p91b0',
        'Chapter Two Some Basic Assumptions of the Work You Need to Do Every Day',
        [91]
      ),
      block(
        'p92b0',
        'Chapter Two Some Basic Assumptions of the Work You Need to Do Every Day',
        [92]
      )
    ])
    expect(checkCoverage(d, leaves)).toEqual([])
  })

  it('leaves a leaf the book left out alone', () => {
    expect(checkCoverage(book(PARAGRAPHS), [paper(1, PARAGRAPHS)])).toEqual([])
  })
})

describe('a line the book sets somewhere other than the paper does', () => {
  it('is reported where the book set it, the case from Persuasion Engineering leaf 15', () => {
    const [a, b, c, d] = PARAGRAPHS as [string, string, string, string]
    // The leaf's last line, set at the end of its first paragraph instead.
    const lastLine = lines(d).slice(-1)[0]!
    const moved = book([`${a} ${lastLine}`, b, c, d.replace(lastLine, '').trim()])
    const found = checkCoverage(moved, [paper(5, PARAGRAPHS)]).filter((f) => f.kind === 'moved')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ page: 5, blockId: 'p5b0', lines: [lastLine] })
  })

  it('is not reported in a row of cells, whose columns the paper interleaves', () => {
    const [a, b, c, d] = PARAGRAPHS as [string, string, string, string]
    const lastLine = lines(d).slice(-1)[0]!
    const moved = book([`${a} | ${lastLine}`, b, c, d.replace(lastLine, '').trim()])
    expect(checkCoverage(moved, [paper(5, PARAGRAPHS)]).filter((f) => f.kind === 'moved')).toEqual(
      []
    )
  })
})

describe('a line out of the paper’s order by a little, across blocks', () => {
  it('is reported where a leaf’s top line ended the paragraph before it', () => {
    const [a, b, c, d] = PARAGRAPHS as [string, string, string, string]
    // Leaf 6 opens a paragraph; its second line was set at the end of leaf
    // 5's last paragraph, two lines back — Persuasion Engineering leaf 113.
    const [first, second, ...rest] = lines(d)
    const moved = doc([
      block('p5b0', a, [5]),
      block('p5b1', b, [5]),
      block('p5b2', `${c} ${second}`, [5, 6]),
      block('p6b0', [first, ...rest].join(' '), [6]),
      ...PARAGRAPHS.map((t, i) => block(`p90b${i}`, t, [90]))
    ])
    const found = checkCoverage(moved, [paper(5, [a, b, c]), paper(6, [d])]).filter(
      (f) => f.kind === 'moved'
    )
    expect(found).toMatchObject([{ page: 6, blockId: 'p5b2', lines: [second] }])
  })

  it('is not reported in boxed matter, which floats on the paper', () => {
    const [a, b, c, d] = PARAGRAPHS as [string, string, string, string]
    const [first, second, ...rest] = lines(d)
    const moved = doc([
      block('p5b0', a, [5]),
      block('p5b1', b, [5]),
      block('p5b2', `${c} ${second}`, [5, 6], 'blockquote'),
      block('p6b0', [first, ...rest].join(' '), [6]),
      ...PARAGRAPHS.map((t, i) => block(`p90b${i}`, t, [90]))
    ])
    expect(
      checkCoverage(moved, [paper(5, [a, b, c]), paper(6, [d])]).filter((f) => f.kind === 'moved')
    ).toEqual([])
  })

  it('is not reported after boxed matter the reading set below the text it sits above', () => {
    const [a, b, c, d] = PARAGRAPHS as [string, string, string, string]
    // The paper prints a tip (d) above paragraph c; the reading set it after.
    const book6 = doc([
      block('p5b0', a, [5]),
      block('p5b1', b, [5]),
      block('p5b2', c, [5]),
      block('p5b3', d, [5], 'blockquote'),
      ...PARAGRAPHS.map((t, i) => block(`p90b${i}`, t, [90]))
    ])
    expect(
      checkCoverage(book6, [paper(5, [a, b, d, c])]).filter((f) => f.kind === 'moved')
    ).toEqual([])
  })
})
