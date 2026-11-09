import { describe, it, expect } from 'vitest'
import {
  checkPageTurns,
  endsWithoutStop,
  opensLowerCase,
  paperOpening,
  type PageTurnBlock
} from '@core/coherence'
import type { DraftWord } from '@core/draft'

/**
 * A leaf described in the units it is set in — a line number and a column in
 * characters — and turned into boxes here, the way the draft's own tests do it.
 */
const LINE_HEIGHT = 20
const LEADING = 30
const CHAR = 10
const MEASURE = 60

interface Placed {
  text: string
  line: number
  from: number
}

const boxes = (placed: readonly Placed[]): DraftWord[] =>
  placed.map((p) => ({
    text: p.text,
    confidence: 95,
    bbox: {
      x0: p.from * CHAR,
      x1: (p.from + p.text.length) * CHAR,
      y0: p.line * LEADING,
      y1: p.line * LEADING + LINE_HEIGHT
    }
  }))

/** A line of prose from `from` to the right margin, its word breaks moved line to line. */
const prose = (line: number, from = 0): Placed[] => {
  const shift = (line * 2) % 6
  const out: Placed[] = []
  let at = from
  const right = MEASURE
  while (at < right) {
    const next = at === from ? Math.min(right, at + 5 + shift) : Math.min(right, at + 5)
    out.push({ text: 'w'.repeat(Math.max(1, Math.round(next - at))), line, from: at })
    at = next + 1
  }
  return out
}

/**
 * A leaf: a running head with its folio on line 0, flush left, then a dozen
 * lines of prose. `first` is how far the first line of body text is set in
 * from the lines under it. A skewed scan is `base` and `drift`: the first line
 * of text sits `base` characters in, and every line after it moves `drift`
 * characters, so the whole page leans.
 */
const leaf = (first: number, base = 0, drift = 0): DraftWord[] => {
  const placed: Placed[] = [
    { text: 'viii', line: 0, from: 0 },
    { text: 'INTRODUCTION', line: 0, from: 24 }
  ]
  for (let line = 2; line < 16; line++) {
    const lean = base + drift * (line - 2)
    placed.push(...prose(line, lean + (line === 2 ? first : 0)))
  }
  return boxes(placed)
}

describe('paperOpening — what the first line of a leaf does', () => {
  it('reads a first line set flush with the lines under it as running on', () => {
    expect(paperOpening(leaf(0))).toBe('flush')
  })

  it('reads a first line set in by an indent as a paragraph opening', () => {
    expect(paperOpening(leaf(3))).toBe('indented')
  })

  it('measures past the running head, which sits flush at the top of the leaf', () => {
    // Were the head taken for the first line it would read flush.
    expect(paperOpening(leaf(3))).not.toBe('flush')
  })

  it('measures against the lines just below, so a skewed scan cannot make an indent', () => {
    // The top of the page sits a character and a half right of the bottom, as
    // a page photographed a degree off square does. Against the page's own
    // margin the flush first line is set in by more than an indent.
    expect(paperOpening(leaf(0, 1.5, -0.1))).toBe('flush')
    // And an indent on the same leaning page is still an indent.
    expect(paperOpening(leaf(3, 1.5, -0.1))).toBe('indented')
  })

  it('takes a numbered head in capitals for furniture even set close above the text', () => {
    // "28 THE MAHATMA LETTERS", one line above the text with its folio flush
    // left: taken for the first line it reads flush on every verso.
    const placed: Placed[] = [
      { text: '28', line: 0, from: 0 },
      { text: 'THE', line: 0, from: 20 },
      { text: 'MAHATMA', line: 0, from: 24 },
      { text: 'LETTERS', line: 0, from: 32 }
    ]
    for (let line = 1; line < 14; line++) placed.push(...prose(line, line === 1 ? 3 : 0))
    expect(paperOpening(boxes(placed))).toBe('indented')
  })

  it('will not judge a leaf too thin to measure', () => {
    expect(paperOpening(boxes(prose(2)))).toBe('unknown')
  })

  it('will not judge a quotation set in by several indents', () => {
    expect(paperOpening(leaf(12))).toBe('unknown')
  })
})

describe('endsWithoutStop and opensLowerCase', () => {
  it('sees a paragraph that stops in the middle of a sentence', () => {
    expect(endsWithoutStop('the highest interests of The Theosophical')).toBe(true)
  })

  it('looks past a reference mark, a closing quote and a glossary circle', () => {
    expect(endsWithoutStop('to the “ Presence.”¹')).toBe(false)
    expect(endsWithoutStop('the Lama°.')).toBe(false)
    expect(endsWithoutStop('<i>the end of the sun.</i>')).toBe(false)
  })

  it('takes a colon, a semicolon or a dash as an ending', () => {
    expect(endsWithoutStop('will not serve our present purpose :')).toBe(false)
    expect(endsWithoutStop('as the writer has it—')).toBe(false)
  })

  it('sees a lower-case opening past quotation marks and an ellipsis', () => {
    expect(opensLowerCase('they are the relics of subsequent evolution')).toBe(true)
    expect(opensLowerCase('“ you were not, and therefore')).toBe(true)
    expect(opensLowerCase('. . . man and that of a world')).toBe(true)
    expect(opensLowerCase('Society demanded the full publication')).toBe(false)
  })
})

describe('checkPageTurns — paragraphs broken at a turn', () => {
  const block = (
    id: string,
    text: string,
    sourcePages: number[],
    kind = 'paragraph'
  ): PageTurnBlock => ({ id, kind, text, sourcePages })

  it('names a paragraph that stops mid-sentence at the foot of a leaf', () => {
    const found = checkPageTurns([
      block('p10b3', 'when the highest interests of The Theosophical', [10]),
      block('p11b0', 'Society demanded the full publication of The Teachings.', [11])
    ])
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ kind: 'split', before: 'p10b3', after: 'p11b0', leaf: 11 })
    expect(found[0]!.signals).toEqual(['no-stop'])
    expect(found[0]!.paper).toBe('not-read')
  })

  it('names a leaf that opens in lower case', () => {
    const found = checkPageTurns([
      block('p135b1', 'will not serve our present purpose :', [135]),
      block('p136b0', 'they are the relics of subsequent evolution.', [136])
    ])
    expect(found.map((f) => f.signals)).toEqual([['lower-start']])
  })

  it('says nothing of a turn the text gives no reason to doubt, with no paper to read', () => {
    expect(
      checkPageTurns([
        block('p20b4', 'And so the matter ended.', [20]),
        block('p21b0', 'Next morning the letter came.', [21])
      ])
    ).toEqual([])
  })

  it('names a turn where the sentence ends at the foot and the paper runs on', () => {
    const found = checkPageTurns(
      [
        block('p20b4', 'And so the matter ended.', [20]),
        block('p21b0', 'Next morning the letter came.', [21])
      ],
      (n) => (n === 21 ? leaf(0) : undefined)
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.signals).toEqual(['paper-flush'])
  })

  it('trusts the paper when it opens a new paragraph after a sentence that ended', () => {
    expect(
      checkPageTurns(
        [block('p20b4', 'And so the matter ended.', [20]), block('p21b0', 'Next morning.', [21])],
        () => leaf(3)
      )
    ).toEqual([])
  })

  it('leaves a salutation and its letter, and a close and its signature, alone', () => {
    expect(
      checkPageTurns([
        block('p54b11', 'My Dear Brother,', [54]),
        block('p55b0', 'I could assuredly make no objection to the style.', [55]),
        block('p55b6', 'Yours, more than ever,', [55]),
        block('p56b0', 'Koot Hoomi Lal Singh.', [56])
      ])
    ).toEqual([])
  })

  it('looks only at page turns, not at breaks within a leaf', () => {
    expect(
      checkPageTurns([
        block('p129b3', '1, 2, 3, etc., are the minor races', [129]),
        block('p129b4', 'a, a, a, are the subordinate races.', [129])
      ])
    ).toEqual([])
  })

  it('does not read a heading as a paragraph', () => {
    expect(
      checkPageTurns([
        block('p80b3', 'LETTER No. IX', [80], 'heading'),
        block('p81b0', 'he wrote to me of it', [81])
      ])
    ).toEqual([])
  })
})
