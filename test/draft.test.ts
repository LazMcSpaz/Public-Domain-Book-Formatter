import { describe, it, expect } from 'vitest'
import { draftPage, toLines, type DraftWord } from '@core/draft'

/**
 * A page is described in the units it is actually set in: a line number and a
 * column, turned into boxes here. Written this way because the faults this
 * module has are geometric, and a test that asserts against hand-typed pixel
 * coordinates is unreadable the moment it fails.
 */
const LINE_HEIGHT = 20
const LEADING = 30
const CHAR = 10

interface Placed {
  text: string
  line: number
  from: number
  confidence?: number
  /** Nudge the box up or down, for the cases where a real scan does. */
  drift?: number
  /** Type size against the body, for display lines and running heads. */
  scale?: number
}

const words = (placed: readonly Placed[]): DraftWord[] =>
  placed.map((p) => ({
    text: p.text,
    confidence: p.confidence ?? 95,
    bbox: {
      x0: p.from * CHAR,
      x1: (p.from + p.text.length) * CHAR,
      y0: p.line * LEADING + (p.drift ?? 0),
      y1: p.line * LEADING + LINE_HEIGHT * (p.scale ?? 1) + (p.drift ?? 0)
    }
  }))

/** A full-measure line of filler, so the page has a measure to be judged against. */
const filler = (line: number, from = 0, width = 60): Placed[] =>
  Array.from({ length: Math.floor(width / 6) }, (_, i) => ({
    text: 'wwwww',
    line,
    from: from + i * 6
  }))

describe('gathering words onto their lines', () => {
  /**
   * The regression that mattered. Clustering on distance from the *current*
   * line alone meant a word whose box sat a few pixels low opened a line of its
   * own, which the next line's words then joined — so the last word of every
   * line surfaced at the end of the line below it, and the whole page was
   * quietly reordered.
   */
  it('keeps a low-sitting word on its own line rather than the one below', () => {
    const lines = toLines(
      words([
        { text: 'the', line: 0, from: 0 },
        { text: 'ordinary', line: 0, from: 4 },
        // Sits low enough to sort after the next line's first word.
        { text: 'senses', line: 0, from: 13, drift: 9 },
        { text: 'are', line: 1, from: 0 },
        { text: 'not', line: 1, from: 4 }
      ]),
      LINE_HEIGHT * 0.5
    )
    expect(lines).toHaveLength(2)
    expect(lines[0]!.text).toBe('the ordinary senses')
    expect(lines[1]!.text).toBe('are not')
  })

  it('reads a line left to right whatever order the words arrived in', () => {
    const lines = toLines(
      words([
        { text: 'third', line: 0, from: 12 },
        { text: 'first', line: 0, from: 0 },
        { text: 'second', line: 0, from: 6 }
      ]),
      LINE_HEIGHT * 0.5
    )
    expect(lines[0]!.text).toBe('first second third')
  })

  it('keeps two lines apart when nothing overlaps', () => {
    const lines = toLines(words([...filler(0), ...filler(5)]), LINE_HEIGHT * 0.5)
    expect(lines).toHaveLength(2)
  })
})

describe('drafting a page into blocks', () => {
  /**
   * Indented on the left and a little short on the right, which is what an
   * ordinary paragraph opening looks like — and what an earlier version of the
   * centring rule called a heading.
   */
  it('starts a new paragraph at a first-line indent', () => {
    const page = draftPage(
      words([
        ...filler(0),
        ...filler(1),
        // Indented: a new paragraph, even though the gap is ordinary.
        ...filler(2, 3, 57),
        ...filler(3)
      ])
    )
    expect(page.blocks).toHaveLength(2)
  })

  it('starts a new paragraph at a wide vertical gap', () => {
    const page = draftPage(words([...filler(0), ...filler(1), ...filler(6), ...filler(7)]))
    expect(page.blocks).toHaveLength(2)
  })

  it('calls a line inset equally on both sides a heading', () => {
    const page = draftPage(
      words(
        [
          ...filler(0),
          ...filler(1),
          [{ text: 'THE ASTRAL SENSES', line: 5, from: 21 }],
          ...filler(9),
          ...filler(10)
        ].flat() as Placed[]
      )
    )
    const heading = page.blocks.find((b) => b.kind === 'heading')
    expect(heading?.text).toBe('THE ASTRAL SENSES')
  })

  it('calls a lone line ranged right a caption — which is what a folio line is', () => {
    const page = draftPage(
      words([
        ...filler(0),
        ...filler(1),
        { text: 'Page 13', line: 5, from: 53 },
        ...filler(9),
        ...filler(10)
      ])
    )
    expect(page.blocks.find((b) => b.text === 'Page 13')?.kind).toBe('caption')
  })

  /**
   * Both tests are required together. A chapter opening's title is short and a
   * paragraph's last line is set apart, and neither of those is furniture.
   */
  it('takes a short, detached top line as a running head', () => {
    const page = draftPage(
      words([{ text: 'CLAIRVOYANCE', line: 0, from: 0 }, ...filler(4), ...filler(5), ...filler(6)])
    )
    expect(page.furniture.runningHead).toBe('CLAIRVOYANCE')
    expect(page.blocks.some((b) => b.text.includes('CLAIRVOYANCE'))).toBe(false)
  })

  /**
   * The fault this was written for: a contents page's own title sits exactly
   * where a running head sits, and taking it as one removes the leaf's title
   * from the leaf. Size is what tells them apart.
   */
  it('leaves a detached top line alone when it is set larger than the body', () => {
    const page = draftPage(
      words([
        { text: 'SYNOPSIS OF THE LESSONS', line: 0, from: 18, scale: 1.6 },
        ...filler(4),
        ...filler(5),
        ...filler(6)
      ])
    )
    expect(page.furniture.runningHead).toBeUndefined()
    expect(page.blocks.some((b) => b.text === 'SYNOPSIS OF THE LESSONS')).toBe(true)
  })

  it('takes a detached bare number as a folio rather than a running head', () => {
    const page = draftPage(
      words([...filler(0), ...filler(1), ...filler(2), { text: '28', line: 7, from: 30 }])
    )
    expect(page.furniture.folio).toBe('28')
    expect(page.furniture.runningHead).toBeUndefined()
  })

  it('leaves a short page alone — there is not enough of it to tell furniture from text', () => {
    const page = draftPage(words([{ text: 'FINIS', line: 0, from: 28 }]))
    expect(page.furniture).toEqual({})
  })

  it('says a page with no words is blank rather than guessing at it', () => {
    const page = draftPage([])
    expect(page.role).toBe('blank')
    expect(page.blocks).toEqual([])
  })

  /**
   * A leaf nothing read looks exactly like a blank one from here, and a draft
   * that returns silence is a draft that cannot say it guessed.
   */
  it('still says it is guessing when there are no words at all', () => {
    expect(draftPage([]).structural.join(' ')).toMatch(/nothing read it/)
  })
})

describe('guessing what the leaf is', () => {
  it('knows a contents page by its own title', () => {
    const page = draftPage(
      words([
        { text: 'SYNOPSIS OF THE LESSONS', line: 0, from: 18, scale: 1.6 },
        ...filler(3),
        ...filler(4),
        ...filler(5)
      ])
    )
    expect(page.role).toBe('table-of-contents')
  })

  it('falls back to body, which is what most leaves are', () => {
    const page = draftPage(words([...filler(0), ...filler(1), ...filler(2)]))
    expect(page.role).toBe('body')
  })
})

describe('what OCR was unsure of', () => {
  it('gathers consecutive low-confidence words into one span to look at', () => {
    const page = draftPage(
      words([
        { text: 'the', line: 0, from: 0 },
        { text: 'chirnrgeon', line: 0, from: 4, confidence: 41 },
        { text: 'sayeth', line: 0, from: 15, confidence: 52 },
        { text: 'plainly', line: 0, from: 22 }
      ])
    )
    expect(page.uncertain).toHaveLength(1)
    expect(page.uncertain[0]!.text).toBe('chirnrgeon sayeth')
    expect(page.uncertain[0]!.reason).toBe('OCR confidence 41–52')
  })

  it('leaves a confidently-read page with nothing to look at', () => {
    expect(draftPage(words(filler(0))).uncertain).toEqual([])
  })
})

/**
 * The draft is not a transcription, and the one way it could do real harm is by
 * being mistaken for one. Every draft says so.
 */
describe('a draft says what it guessed', () => {
  it('always reports that the role and the kinds are guesses', () => {
    const page = draftPage(words([...filler(0), ...filler(1)]))
    expect(page.structural.join(' ')).toMatch(/is a guess/)
  })

  it('names a line it took as a running head, so it can be checked', () => {
    const page = draftPage(
      words([{ text: 'CLAIRVOYANCE', line: 0, from: 0 }, ...filler(4), ...filler(5), ...filler(6)])
    )
    expect(page.structural.join(' ')).toContain('CLAIRVOYANCE')
  })
})

/**
 * A full-measure line of prose that happens to end in something number-shaped
 * must stay in the text.
 *
 * The width test used to be skipped the moment anything was peeled off the end
 * of the line, and `BARE_NUMBER` accepted roman numerals case-insensitively —
 * so `civil.`, `mild.`, `did.` and any year qualified, and a line of body text
 * left the leaf as a running head.
 */
describe('a line of prose is not a running head because it ends in a number', () => {
  const prose = (last: string): Placed[] => [
    ...filler(0),
    { text: last, line: 0, from: 54 },
    ...filler(4),
    ...filler(5),
    ...filler(6)
  ]

  it('keeps a full-measure line ending in a year', () => {
    const page = draftPage(words(prose('1893.')))
    expect(page.furniture).toEqual({})
    expect(page.structural.join(' ')).toMatch(/of the measure/)
  })

  it('keeps a full-measure line ending in a word spelled from roman numerals', () => {
    expect(draftPage(words(prose('civil.'))).furniture).toEqual({})
  })

  it('still takes a short head with its folio set off at the margin', () => {
    // The head is short and the folio sits well out from it — which is what a
    // running head actually looks like.
    const page = draftPage(
      words([
        { text: 'CRYSTAL GAZING', line: 0, from: 0 },
        { text: '117', line: 0, from: 52 },
        ...filler(4),
        ...filler(5),
        ...filler(6)
      ])
    )
    expect(page.furniture).toEqual({ runningHead: 'CRYSTAL GAZING', folio: '117' })
  })
})

/**
 * The fault the first real book showed, and the reason it says so rather than
 * mending it.
 *
 * Lines are joined with a space, so a hyphen the compositor set at a line break
 * survives as `ad- vanced` and prints that way: assembly's hyphen healing runs
 * at page seams only. *The Astral World* carried 301 of them past every check,
 * because both OCR engines break the lines in the same places and so no second
 * reader disagrees, and because a leaf read against its render looks right —
 * the paper breaks there too. Only a rendered page showed it.
 */
describe('line-break hyphens are counted and reported', () => {
  const broken: Placed[] = [
    ...filler(0),
    { text: 'ad-', line: 0, from: 54 },
    { text: 'vanced', line: 1, from: 0 },
    ...filler(1, 7),
    ...filler(2),
    ...filler(3)
  ]

  it('names them, and says nothing downstream will heal them', () => {
    const said = draftPage(words(broken)).structural.join(' ')
    expect(said).toMatch(/1 line-break hyphen\(s\)/)
    expect(said).toMatch(/print mid-line/)
  })

  it('says nothing when the leaf has none', () => {
    const clean = draftPage(words([...filler(0), ...filler(1), ...filler(2)]))
    expect(clean.structural.join(' ')).not.toMatch(/line-break hyphen/)
  })

  it('does not join them, because the page cannot settle which are one word', () => {
    // `counter-part` joins and `thought-transference` keeps its hyphen, and
    // nothing on the leaf says which is which. Counting is the honest limit.
    const page = draftPage(words(broken))
    expect(page.blocks.map((b) => b.text).join(' ')).toContain('ad- vanced')
  })
})
