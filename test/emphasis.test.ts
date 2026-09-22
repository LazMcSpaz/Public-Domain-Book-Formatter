import { describe, it, expect } from 'vitest'
import {
  asSource,
  cellEmphasis,
  emphasisForTexts,
  flattenCellEmphasis,
  withoutConversionDamage,
  CONVERSION_DAMAGE
} from '@core/draft/emphasis'
import { tableToText } from '@core/transcribe/schema'
import type { DraftWord } from '@core/draft'

/** A source stream. `*word` is set in italic. */
function words(spec: string): DraftWord[] {
  return spec
    .split(/\s+/u)
    .filter(Boolean)
    .map((token, i) => ({
      text: token.startsWith('*') ? token.slice(1) : token,
      confidence: 100,
      italic: token.startsWith('*'),
      bbox: { x0: i * 10, y0: 0, x1: i * 10 + 8, y1: 10 }
    }))
}

describe('emphasisForTexts', () => {
  it('puts the flag on the words it belongs to', () => {
    const read = emphasisForTexts(
      ['see The Structure of Magic I for this'],
      words('see *The *Structure *of *Magic *I for this')
    )
    expect(read.emphasis[0]).toEqual([1, 2, 3, 4, 5])
    expect(read.unmatched).toEqual([])
    expect(read.matched).toBe(read.total)
  })

  it('carries emphasis across a hyphen the block healed, from either half', () => {
    // Two source words, one block word — which is what `healWrappedHyphens`
    // leaves behind. A word broken at a line end is one word set in one face,
    // so whichever half the file flagged, the healed word is italic. Both
    // directions, because taking only the first half's face passes the one.
    const head = emphasisForTexts(['a knowledge of it'], words('a *know- ledge of it'))
    expect(head.emphasis[0]).toEqual([1])
    const tail = emphasisForTexts(['a knowledge of it'], words('a know- *ledge of it'))
    expect(tail.emphasis[0]).toEqual([1])
    expect(head.unmatched).toEqual([])
    expect(tail.unmatched).toEqual([])
  })

  it('carries emphasis onto both halves of a word a reader divided', () => {
    const read = emphasisForTexts(['the sun set'], words('the *sunset'))
    expect(read.emphasis[0]).toEqual([1, 2])
    expect(read.unmatched).toEqual([])
  })

  it('steps over the furniture the block never had', () => {
    // A running head and a folio open the source and reach no block.
    const read = emphasisForTexts(
      ['now the induction begins'],
      words('PATTERNS OF THE HYPNOTIC TECHNIQUES 41 now the *induction begins')
    )
    expect(read.emphasis[0]).toEqual([2])
    expect(read.unmatched).toEqual([])
  })

  it('reads several texts as one stream down the leaf', () => {
    const read = emphasisForTexts(
      ['first line here', 'second *line* here'.replace(/\*/gu, ''), 'third'],
      words('first line *here second *line here third')
    )
    expect(read.emphasis).toEqual([[2], [1], []])
  })

  it('names a word the file never had, and keeps the emphasis after it right', () => {
    // A reader typed `very`, which is in no source word. Taking a source word
    // for it would put every later flag one word early — so the source is not
    // advanced, and `deep` still gets its italic.
    const read = emphasisForTexts(
      ['a very *deep trance'.replace(/\*/gu, '')],
      words('a *deep trance')
    )
    expect(read.unmatched).toEqual([{ text: 0, word: 1, is: 'very' }])
    expect(read.emphasis[0]).toEqual([2])
  })

  it('takes a cell at a time, in the order the flattened view sets them', () => {
    const read = emphasisForTexts(
      ['Erickson said', 'you can relax', 'the client hears', 'go inside'],
      words('Erickson said you *can *relax the client hears *go *inside')
    )
    expect(read.emphasis).toEqual([[], [1, 2], [], [0, 1]])
  })

  it('leaves a word roman where the source says nothing', () => {
    const read = emphasisForTexts(['plain prose here'], words('plain prose here'))
    expect(read.emphasis[0]).toEqual([])
  })

  it('does not take an undefined flag for roman or for italic', () => {
    // A scanned leaf carries no flag at all. Nothing is marked, and nothing is
    // reported as unmatched either — the words lined up fine.
    const scanned: DraftWord[] = ['plain', 'prose'].map((text, i) => ({
      text,
      confidence: 88,
      bbox: { x0: i * 10, y0: 0, x1: i * 10 + 8, y1: 10 }
    }))
    const read = emphasisForTexts(['plain prose'], scanned)
    expect(read.emphasis[0]).toEqual([])
    expect(read.matched).toBe(2)
  })
})

describe('withoutConversionDamage', () => {
  const split = (text: string): string[] => text.split(/\s+/u)

  it('drops a lone italic preposition with roman either side', () => {
    const text = split('a partial explanation of the effectiveness of this technique')
    const { emphasis, dropped } = withoutConversionDamage(text, [3, 6])
    expect(emphasis).toEqual([])
    expect(dropped.map((d) => d.is)).toEqual(['of', 'of'])
  })

  it('keeps the same word inside a run', () => {
    // `The Structure of Magic` is a title and the `of` is part of it.
    const text = split('see The Structure of Magic I here')
    const { emphasis, dropped } = withoutConversionDamage(text, [1, 2, 3, 4, 5])
    expect(emphasis).toEqual([1, 2, 3, 4, 5])
    expect(dropped).toEqual([])
  })

  it('keeps one at the edge of the text, where a run may have been cut', () => {
    // A block ending on `of` with `Magic I` opening the next one looks exactly
    // like the damage and is not it.
    const last = split('see The Structure of')
    expect(withoutConversionDamage(last, [3]).emphasis).toEqual([3])
    const first = split('of Magic I follows')
    expect(withoutConversionDamage(first, [0]).emphasis).toEqual([0])
  })

  it('keeps a lone italic word that is not one of the damaged tokens', () => {
    // A word-as-mention, which in a book about language is the whole point.
    const text = split('if I introduce the negative element not into the sentence')
    expect(withoutConversionDamage(text, [6]).emphasis).toEqual([6])
    expect(CONVERSION_DAMAGE.has('not')).toBe(false)
  })

  it('reads through the punctuation attached to the word', () => {
    const text = split('the effectiveness of, this technique')
    expect(withoutConversionDamage(text, [2]).emphasis).toEqual([])
  })
})

describe('flattenCellEmphasis', () => {
  it('counts the separator as a word, because the flattened view sets one', () => {
    const cells = [
      ['you can relax', 'the client hears'],
      ['go inside', 'and he does']
    ]
    // Flattened: you can relax | the client hears \n go inside | and he does
    //            0   1   2     3 4   5      6       7  8      9 10  11 12
    const flat = flattenCellEmphasis(cells, [[1, 2], [], [0, 1], [2]])
    expect(flat).toEqual([1, 2, 7, 8, 12])
  })

  it('agrees with tableToText about where each word is', () => {
    const cells = [
      ['a b', 'c'],
      ['d', 'e f']
    ]
    const words = tableToText(cells).split(/\s+/u)
    const flat = flattenCellEmphasis(cells, [[0], [0], [0], [1]])
    expect(flat.map((i) => words[i])).toEqual(['a', 'c', 'd', 'f'])
  })

  it('still counts the separator beside an empty cell', () => {
    const cells = [
      ['left', ''],
      ['', 'right']
    ]
    const words = tableToText(cells).split(/\s+/u)
    const flat = flattenCellEmphasis(cells, [[0], [], [], [0]])
    expect(flat.map((i) => words[i])).toEqual(['left', 'right'])
  })
})

describe('asSource', () => {
  it('reads a drafted block back as words carrying its faces', () => {
    const src = asSource('see The Structure of Magic here', [1, 2, 3, 4])
    expect(src.filter((w) => w.italic).map((w) => w.text)).toEqual([
      'The',
      'Structure',
      'of',
      'Magic'
    ])
  })

  it('carries the bold too, so a re-run of the walk can read it back', () => {
    // The landing verb rebuilds its source stream from a drafted block, so a
    // stream that knows only the italic loses the bold pass entirely — which
    // is not a missing flag but a missing *question*: `draftPage` switches the
    // bold pass on when any word carries the field at all.
    const src = asSource('Step 3 - Form two sentences', [], [0, 1])
    expect(src.filter((w) => w.bold).map((w) => w.text)).toEqual(['Step', '3'])
    const read = emphasisForTexts(['Step 3 - Form two sentences'], src, 'bold')
    expect(read.emphasis).toEqual([[0, 1]])
  })

  it('carries a table through its flattened view, separators and all', () => {
    // The draft's side is the flattened text; the corrected side is the cells.
    // The ` | ` has no letters in it, so the walk steps over it and the two
    // line up — which is what lets a reader's re-divided table keep its
    // emphasis.
    const cells = [['you can relax', 'the client hears']]
    const flat = tableToText(cells)
    const marked = flattenCellEmphasis(cells, [[1, 2], []])
    const read = emphasisForTexts(cells.flat(), asSource(flat, marked))
    expect(read.emphasis).toEqual([[1, 2], []])
    expect(read.unmatched).toEqual([])
  })

  it('survives the reader having re-divided the paragraphs', () => {
    const src = asSource('the first part and the second part', [1, 5])
    const read = emphasisForTexts(['the first part', 'and the second part'], src)
    expect(read.emphasis).toEqual([[1], [2]])
    expect(read.unmatched).toEqual([])
  })
})

describe('cellEmphasis', () => {
  const cells = [
    ['you can relax', 'the client hears'],
    ['go inside', 'and he does']
  ]

  it('is the inverse of flattening, cell for cell', () => {
    const perCell = [[1, 2], [], [0, 1], [2]]
    expect(cellEmphasis(cells, flattenCellEmphasis(cells, perCell))).toEqual(perCell)
  })

  it('gives one list per cell even where nothing is marked', () => {
    expect(cellEmphasis(cells, undefined)).toEqual([[], [], [], []])
    expect(cellEmphasis(cells, [])).toEqual([[], [], [], []])
  })

  it('drops an index that lands on a separator or past the end', () => {
    // Flattened: you can relax | the client hears \n go inside | and he does
    //            0   1   2     3 4   5      6       7  8      9 10  11 12
    // 3 and 9 are the separators; 13 is past the end.
    expect(cellEmphasis(cells, [3, 9, 13])).toEqual([[], [], [], []])
  })
})

/**
 * A book can set a portion *of* an italic quotation in bold, and _Patterns of
 * the Hypnotic Techniques_ Vol. I is one: it prints the interspersed command
 * that way and then tells the reader, in as many words, to notice "the portion
 * of Erickson's communication in bold type". Read as one flag the two collapse
 * and that sentence points at nothing, so the same walk runs twice.
 */
describe('the same walk reads the file’s bold', () => {
  /** A source stream where `*word` is italic and `+word` is bold. */
  const faced = (spec: string): DraftWord[] =>
    spec
      .split(/\s+/u)
      .filter(Boolean)
      .map((token, i) => ({
        text: token.replace(/^[*+]+/u, ''),
        confidence: 100,
        italic: token.includes('*'),
        bold: token.includes('+'),
        bbox: { x0: i * 10, y0: 0, x1: i * 10 + 8, y1: 10 }
      }))

  const quote = 'I knew a man once who really understood how to feel good about'
  const source = faced(
    '*I *knew *a *man *once *who *really *understood *how *to *+feel *+good *about'
  )

  it('marks the bold portion and not the whole italic quotation', () => {
    expect(emphasisForTexts([quote], source, 'bold').emphasis[0]).toEqual([10, 11])
  })

  it('still reads the italic off the same words', () => {
    expect(emphasisForTexts([quote], source).emphasis[0]).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
    ])
  })

  it('defaults to the italic, so every caller that asked for one still gets it', () => {
    expect(emphasisForTexts([quote], source)).toEqual(emphasisForTexts([quote], source, 'italic'))
  })

  it('carries bold across a hyphen the block healed, as the italic is carried', () => {
    expect(
      emphasisForTexts(['a knowledge of it'], faced('a +know- ledge of it'), 'bold').emphasis[0]
    ).toEqual([1])
  })

  it('leaves a word roman where the file sets it roman', () => {
    expect(emphasisForTexts([quote], faced('I knew a man'), 'bold').emphasis[0]).toEqual([])
  })
})
