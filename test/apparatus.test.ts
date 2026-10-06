import { describe, it, expect } from 'vitest'
import { checkApparatus, honourRulings, type ApparatusFinding } from '@core/coherence'
import type { BookBlock, BookDocument, Footnote } from '@core/assemble'

let nextId = 0
function block(text: string, kind: BookBlock['kind'] = 'paragraph', pages = [0]): BookBlock {
  return { id: `p${pages[0]}b${nextId++}`, kind, text, sourcePages: pages }
}

function doc(blocks: BookBlock[], over: Partial<BookDocument> = {}): BookDocument {
  return {
    blocks,
    footnotes: [],
    chapters: [],
    asides: [],
    illustrations: [],
    sections: [],
    skipped: [],
    synopsesUnmatched: [],
    ...over
  }
}

const build = (texts: string[], over: Partial<BookDocument> = {}): BookDocument => {
  nextId = 0
  return doc(
    texts.map((t) => block(t)),
    over
  )
}

const of = (d: BookDocument, kind: ApparatusFinding['kind']) =>
  checkApparatus(d).filter((f) => f.kind === kind)

const note = (marker: string, text: string, pageIndex = 0, id = 'fn1'): Footnote => ({
  id,
  originalMarker: marker,
  text,
  pageIndex,
  orphaned: false
})

/**
 * A reference mark with nothing under it.
 *
 * _The Structure of Magic_ Vol. I printed 48 such marks and no notes, because
 * its notes were read as paragraphs; nothing said so.
 */
describe('a mark no note claims', () => {
  it('is reported in a book that has no notes at all', () => {
    const found = of(
      build(['Smell and taste are little used as ways of gaining information.¹ Each of these.']),
      'unclaimed-mark'
    )
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ found: '¹', blockId: 'p0b0' })
    expect(found[0]!.against).toContain('no notes at all')
  })

  it('is not reported once a note claims it', () => {
    const d = build(['Smell and taste are little used as ways of gaining information.¹'], {
      footnotes: [note('¹', 'We talk here about major input channels.')]
    })
    expect(of(d, 'unclaimed-mark')).toEqual([])
  })

  it('is not reported where the editor declared it bare', () => {
    const d = build(['The mark against the Presbytere de Cideville‡ refers to nothing.'], {
      bareMarks: [{ blockId: 'p0b0', marker: '‡', nth: 1 }]
    })
    expect(of(d, 'unclaimed-mark')).toEqual([])
  })

  it('leaves notation alone', () => {
    const d = build([
      'The inverse patterns d⁻¹, r⁻¹ and n⁻¹ apply to family members c¹ and c⁴.',
      'The rule X NP¹ V NP² Y moves the noun phrases.',
      'The chance is (1/6)⁶ and the energy E = mc².',
      'Where the super-script ³ on the predicate specifies the place.'
    ])
    expect(of(d, 'unclaimed-mark')).toEqual([])
  })

  it('leaves the linguist’s star alone, which marks a sentence and not a note', () => {
    const d = build([
      'Compare *the boy are tall with the boy is tall.',
      'Lakoff also uses the "*" to mark logical items, and C₁*, C₂* are consequences.'
    ])
    expect(of(d, 'unclaimed-mark')).toEqual([])
  })

  it('reports a symbol mark that closes onto its word', () => {
    expect(
      of(build(['The hot-bed of the Shammar or Bhon rites*—between the ninth.']), 'unclaimed-mark')
    ).toHaveLength(1)
  })
})

describe('notes set as body text', () => {
  const section = [
    'Smell and taste are little used as ways of gaining information.¹',
    'Most of us value one or more of these representational systems.²'
  ]

  it('names the heading, when the book carries marks no note claims', () => {
    nextId = 0
    const d = doc([
      ...section.map((t) => block(t)),
      block('FOOTNOTES FOR PART I', 'heading'),
      block('1. We talk here about major input channels.'),
      block('2. By most highly valued representational system we mean the system used.')
    ])
    const found = of(d, 'notes-as-text')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ found: 'FOOTNOTES FOR PART I' })
    expect(found[0]!.against).toContain('2 numbered paragraphs')
  })

  it('says nothing when every mark is claimed', () => {
    nextId = 0
    const d = doc(
      [
        block('Smell and taste are little used as ways of gaining information.¹'),
        block('Notes', 'heading'),
        block('1. A paragraph that happens to be numbered.')
      ],
      { footnotes: [note('¹', 'We talk here about major input channels.')] }
    )
    expect(of(d, 'notes-as-text')).toEqual([])
  })
})

/** The count the compositor kept, read off the marks as printed. */
describe('marks that do not count up', () => {
  const marks = (values: string[]) =>
    build(values.map((v, i) => `Sentence number ${i} carries its reference.${v}`))

  it('names a figure used twice once, and keeps counting from where it was', () => {
    const found = of(marks(['¹', '²', '³', '²', '⁴', '⁵']), 'mark-sequence')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ found: '²', blockId: 'p0b3' })
    expect(found[0]!.against).toContain('repeats')
  })

  it('names a mark missing from the count', () => {
    const found = of(marks(['¹', '²', '⁴', '⁵']), 'mark-sequence')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ found: '⁴' })
    expect(found[0]!.against).toContain('reads 2')
  })

  it('names a Part that restarts without its 1, and nothing after it', () => {
    const found = of(marks(['¹', '²', '³', '²', '³', '⁴']), 'mark-sequence')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ found: '²' })
    expect(found[0]!.against).toContain('its 1 is missing')
  })

  it('names one figure out of step between two that agree', () => {
    const found = of(marks(['¹', '²', '⁹', '⁴', '⁵']), 'mark-sequence')
    expect(found).toHaveLength(1)
    expect(found[0]!.against).toContain('should read 3')
  })

  it('accepts a count that restarts at 1', () => {
    expect(of(marks(['¹', '²', '³', '¹', '²', '¹']), 'mark-sequence')).toEqual([])
  })
})

/**
 * A book's references to its own pages. _Patterns_ Vol. I was exported with
 * "(see page 103)" naming pages of the 1975 typescript.
 */
describe('a reference to one of the book’s own pages', () => {
  it('is reported in each of the forms these books use', () => {
    const found = of(
      build([
        'is called derivation (see page 10).',
        'the transderivational search as shown on page 223.',
        'construction in the reversed order: (See page 103)',
        'for the full table see pages 40 and 41.'
      ]),
      'page-reference'
    )
    expect(found.map((f) => f.found)).toEqual([
      '(see page 10)',
      'shown on page 223',
      '(See page 103)',
      'see pages 40 and 41'
    ])
  })

  it('leaves a citation of another work alone', () => {
    const d = build([
      'In his Introduction to the Science of Religion (p. 278) we find the Professor saying.',
      'Sherlock Holmes presents examples - see page 423 of Volume I.',
      'As he writes in his book Guru, see page 146, the teacher waits.'
    ])
    expect(of(d, 'page-reference')).toEqual([])
  })

  it('reads the book’s own notes too', () => {
    const d = build(['A body sentence.¹'], {
      footnotes: [note('¹', 'The tree is drawn in full (see page 206).', 3)]
    })
    expect(of(d, 'page-reference')).toMatchObject([{ blockId: 'fn1', pages: [3] }])
  })
})

describe('a finding the editor ruled as printed', () => {
  it('is honoured by the same rule damage findings are', () => {
    const d = build(['is called derivation (see page 10).'])
    const { kept, honoured } = honourRulings(
      checkApparatus(d),
      [{ pageIndex: 0, quote: 'see page 10', decision: 'as-printed' }],
      d
    )
    expect(kept).toEqual([])
    expect(honoured).toHaveLength(1)
  })
})
