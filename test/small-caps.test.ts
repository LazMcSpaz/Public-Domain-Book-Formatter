import { describe, it, expect } from 'vitest'
import { parseInlineMarkup, withMarkup, type PageTranscription } from '@core/transcribe'
import { assembleBook, type BookBlock, type BookDocument } from '@core/assemble'
import { applyEdits, markupOfNodes, type RichNode } from '@core/edits'
import { layout, fixedWidthMeasurer, type PositionedLine, type TextMeasurer } from '@core/layout'
import { defaultStyleProfile } from '@core/style'

/**
 * Small capitals in running text. *Unseen Forces* sets SPIRIT, Soul and THE
 * DWELLER ON THE THRESHOLD in them, and Hall's face, Libre Caslon Text, has
 * none: they printed as full capitals. The editor's ruling is to borrow
 * EB Garamond's, sized to Caslon's lower case.
 */
describe('the notation', () => {
  it('reads <sc> into word indices and writes it back', () => {
    const m = parseInlineMarkup('In occult philosophy, <sc>spirit</sc> is <i>that</i>')
    expect(m.text).toBe('In occult philosophy, spirit is that')
    expect(m.smallCaps).toEqual([3])
    expect(m.emphasis).toEqual([5])
    expect(withMarkup(m.text, m.emphasis, m.strong, m.smallCaps)).toBe(
      'In occult philosophy, <sc>spirit</sc> is <i>that</i>'
    )
  })

  it('comes back from the galley’s edited DOM', () => {
    const t = (v: string): RichNode => ({
      nodeType: 3,
      nodeName: '#text',
      nodeValue: v,
      childNodes: []
    })
    const el = (name: string, kids: RichNode[]): RichNode => ({
      nodeType: 1,
      nodeName: name,
      nodeValue: null,
      childNodes: kids
    })
    expect(markupOfNodes([el('SC', [t('Soul')]), t(' is the garment')])).toBe(
      '<sc>Soul</sc> is the garment'
    )
  })
})

describe('edits', () => {
  const page = (blocks: PageTranscription['blocks']): PageTranscription =>
    ({
      pageIndex: 0,
      blocks,
      furniture: []
    }) as unknown as PageTranscription
  const doc = (): BookDocument =>
    assembleBook([
      page([
        {
          kind: 'paragraph',
          text: 'was called by the ancients the dweller on the threshold.',
          smallCaps: [5, 6, 7, 8, 9]
        }
      ]),
      page([{ kind: 'paragraph', text: 'Soul is the garment of spirit.', smallCaps: [0] }])
    ] as PageTranscription[])

  it('keep the small capitals on their words through a split and a merge', () => {
    const first = doc().blocks[0]!
    expect(first.smallCaps).toEqual([5, 6, 7, 8, 9])
    const split = applyEdits(doc(), [
      { kind: 'split', blockId: first.id, at: 'was called by'.length }
    ])
    expect(split.blocks[1]!.text.startsWith('the ancients')).toBe(true)
    expect(split.blocks[1]!.smallCaps).toEqual([2, 3, 4, 5, 6])
    const merged = applyEdits(doc(), [{ kind: 'merge', blockId: first.id }])
    expect(merged.blocks[0]!.smallCaps).toEqual([5, 6, 7, 8, 9, 10])
    // and a correction typed with the tag reads it in
    const typed = applyEdits(doc(), [
      { kind: 'text', blockId: first.id, text: 'was called <sc>the dweller</sc>.' }
    ])
    expect(typed.blocks[0]!.smallCaps).toEqual([2, 3])
  })
})

describe('the engine', () => {
  const blocks: BookBlock[] = [
    {
      id: 'p0b0',
      kind: 'paragraph',
      text: 'In occult philosophy, spirit is that ever-existing essence.',
      smallCaps: [3],
      sourcePages: [0]
    }
  ]
  const doc: BookDocument = {
    blocks,
    footnotes: [],
    chapters: [],
    asides: [],
    illustrations: [],
    sections: [],
    skipped: [],
    synopsesUnmatched: []
  }
  /** A text face with no small capitals beside one that has them. */
  const measurer: TextMeasurer = {
    ...fixedWidthMeasurer(0.5),
    hasSmallCaps: (family) => family === 'Garamond',
    smallCapScale: () => 1.17
  }
  const spirit = (smallCapsFont: string, m: TextMeasurer = measurer) => {
    const profile = { ...defaultStyleProfile(), bodyFont: 'Caslon', smallCapsFont }
    const book = layout(doc, profile, m, {
      edition: { title: 'T', author: 'A', editionDate: '2026' }
    })
    return book.pages
      .flatMap((p) => p.items)
      .filter((i): i is PositionedLine => i.kind === 'line')
      .flatMap((l) => l.runs)
      .find((r) => /^spirit$/iu.test(r.text))!
  }

  it('draws a borrowed face’s small capitals, scaled to the text', () => {
    const run = spirit('Garamond')
    expect(run.text).toBe('spirit')
    expect(run.font).toEqual({ family: 'Garamond', style: 'regular', smallCaps: true })
    expect(run.sizePt).toBeCloseTo(defaultStyleProfile().bodyFontSize * 1.17, 6)
  })

  it('sets full capitals when no face has small capitals', () => {
    const run = spirit('')
    expect(run.text).toBe('SPIRIT')
    expect(run.font.smallCaps ?? false).toBe(false)
  })

  it('measures the word at the size it is drawn, so the next word starts after it', () => {
    const short: BookDocument = {
      ...doc,
      blocks: [
        { id: 'p0b0', kind: 'paragraph', text: 'So spirit is.', smallCaps: [1], sourcePages: [0] }
      ]
    }
    const profile = { ...defaultStyleProfile(), bodyFont: 'Caslon', smallCapsFont: 'Garamond' }
    const book = layout(short, profile, measurer, {
      edition: { title: 'T', author: 'A', editionDate: '2026' }
    })
    const runs = book.pages
      .flatMap((p) => p.items)
      .filter((i): i is PositionedLine => i.kind === 'line')
      .flatMap((l) => l.runs)
    const size = profile.bodyFontSize
    const spiritRun = runs.find((r) => r.text === 'spirit')!
    const isRun = runs.find((r) => r.text === 'is.')!
    expect(isRun.xPt - spiritRun.xPt).toBeCloseTo(6 * 0.5 * size * 1.17 + 0.5 * size, 3)
  })
})
