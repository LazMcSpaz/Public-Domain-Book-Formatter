import { describe, it, expect } from 'vitest'
import {
  anchorIllustrations,
  fixedWidthMeasurer,
  layout,
  leadingFor,
  type ImageItem,
  type LaidOutBook,
  type LaidOutPage,
  type LayoutEdition,
  type PositionedLine
} from '@core/layout'
import { defaultStyleProfile } from '@core/style'
import { assembleBook, type BookDocument, type IllustrationSource } from '@core/assemble'
import type { StyleProfile } from '@core/model'
import type { PageTranscription, TranscribedBlock } from '@core/transcribe'

const measurer = fixedWidthMeasurer(0.5)

const EDITION: LayoutEdition = { title: 'A Treatise of Airs', author: 'Robert Boyle' }

const PROSE =
  'The chirurgeon examined the specimen with extraordinary care and reported his findings to the assembled company that evening. '

function page(pageIndex: number, blocks: TranscribedBlock[]): PageTranscription {
  return { pageIndex, role: 'body', blocks, uncertain: [], furniture: {} }
}

/** A crop, described the way the platform describes one after cutting it out. */
function crop(
  id: string,
  pageIndex: number,
  sourceWidth: number,
  sourceHeight: number
): IllustrationSource {
  return { id, pageIndex, sourceWidth, sourceHeight }
}

function run(doc: BookDocument, over: Partial<StyleProfile> = {}): LaidOutBook {
  return layout(doc, { ...defaultStyleProfile(), ...over }, measurer, { edition: EDITION })
}

const lines = (p: LaidOutPage): PositionedLine[] =>
  p.items.filter((i): i is PositionedLine => i.kind === 'line')

const images = (p: LaidOutPage): ImageItem[] =>
  p.items.filter((i): i is ImageItem => i.kind === 'image')

const textOf = (p: LaidOutPage): string =>
  lines(p)
    .map((l) => l.runs.map((r) => r.text).join(' '))
    .join(' · ')

const bookText = (b: LaidOutBook): string => b.pages.map(textOf).join(' · ')
const allImages = (b: LaidOutBook): ImageItem[] => b.pages.flatMap(images)

describe('anchorIllustrations — where a picture goes in the reading order', () => {
  const blocks = (pages: number[][]) =>
    pages.map((sourcePages, i) => ({
      id: `p${sourcePages[0]}b${i}`,
      kind: 'paragraph' as const,
      text: 'x',
      sourcePages
    }))

  const illustration = (id: string, pageIndex: number) => ({
    id,
    pageIndex,
    sourceWidth: 100,
    sourceHeight: 100,
    caption: null
  })

  it('places it after the last block that shared its page', () => {
    const anchored = anchorIllustrations(blocks([[0], [1], [1], [2]]), [illustration('i1', 1)])
    expect(anchored.get(2)).toHaveLength(1)
  })

  it('follows a block joined across a seam to the last page it touches', () => {
    // A paragraph that began on page 1 and finished on page 2 is not over until
    // page 2, so a picture from page 2 comes after it, not before.
    const anchored = anchorIllustrations(blocks([[0], [1, 2], [3]]), [illustration('i1', 2)])
    expect(anchored.get(1)).toHaveLength(1)
  })

  it('puts a plate that precedes all surviving text before the first block', () => {
    const anchored = anchorIllustrations(blocks([[4], [5]]), [illustration('i1', 2)])
    expect(anchored.get(-1)).toHaveLength(1)
  })

  it('anchors every illustration exactly once — none may go missing', () => {
    const many = [illustration('a', 0), illustration('b', 1), illustration('c', 9)]
    const anchored = anchorIllustrations(blocks([[0], [1], [2]]), many)
    const ids = [...anchored.values()].flat().map((i) => i.id)
    expect(ids.sort()).toEqual(['a', 'b', 'c'])
  })

  it('handles a book with no text at all', () => {
    const anchored = anchorIllustrations([], [illustration('i1', 0)])
    expect(anchored.get(-1)).toHaveLength(1)
  })
})

describe('assembleBook — captions and pictures', () => {
  it('takes the caption out of the flow and gives it to the picture', () => {
    const doc = assembleBook(
      [
        page(0, [
          { kind: 'paragraph', text: PROSE },
          { kind: 'caption', text: 'Fig. 1. The alembick.' }
        ])
      ],
      { illustrations: [crop('i1', 0, 800, 600)] }
    )
    expect(doc.illustrations).toHaveLength(1)
    expect(doc.illustrations[0]!.caption).toBe('Fig. 1. The alembick.')
    // And it is no longer a paragraph of the book.
    expect(doc.blocks.map((b) => b.kind)).toEqual(['paragraph'])
  })

  it('leaves an uncaptioned plate uncaptioned rather than borrowing text', () => {
    const doc = assembleBook([page(0, [{ kind: 'paragraph', text: PROSE }])], {
      illustrations: [crop('i1', 0, 800, 600)]
    })
    expect(doc.illustrations[0]!.caption).toBeNull()
    expect(doc.blocks).toHaveLength(1)
  })

  it('pairs several pictures with several captions in printed order', () => {
    const doc = assembleBook(
      [
        page(0, [
          { kind: 'caption', text: 'Fig. 1.' },
          { kind: 'caption', text: 'Fig. 2.' }
        ])
      ],
      { illustrations: [crop('i1', 0, 10, 10), crop('i2', 0, 10, 10)] }
    )
    expect(doc.illustrations.map((i) => i.caption)).toEqual(['Fig. 1.', 'Fig. 2.'])
  })

  it('leaves a spare caption in the text rather than deleting a line of the book', () => {
    const doc = assembleBook([page(0, [{ kind: 'caption', text: 'Fig. 9.' }])], {
      illustrations: []
    })
    expect(doc.blocks.map((b) => b.text)).toEqual(['Fig. 9.'])
  })

  it('adding pictures changes nothing else about the book', () => {
    // The structure gate assembles the book a *second* time, once the accepted
    // regions have been cut, so this pass has to be additive. Anything it
    // changes about the text is a change nobody asked for and nobody sees.
    const pages = [
      page(0, [{ kind: 'paragraph', text: 'The alembick being set', continuesNext: true }]),
      page(1, [
        { kind: 'paragraph', text: 'upon a gentle fire.', continuesPrevious: true },
        { kind: 'caption', text: 'Fig. 1.' }
      ])
    ]
    const before = assembleBook(pages)
    const after = assembleBook(pages, { illustrations: [crop('i1', 1, 800, 600)] })

    // The caption is the one thing that legitimately leaves the flow.
    expect(before.blocks.map((b) => b.text)).toEqual([
      'The alembick being set upon a gentle fire.',
      'Fig. 1.'
    ])
    expect(after.blocks.map((b) => b.text)).toEqual(['The alembick being set upon a gentle fire.'])
    expect(after.skipped).toEqual(before.skipped)
  })

  it('does not break a paragraph that runs across a discarded page', () => {
    // The bug this pins: the second assembly once took its exclusions from
    // `skipped`, which also lists every page dropped by its *disposition*. A
    // page dropped that way carries no body text, so the paragraph genuinely
    // does run across it — handing those back as user exclusions severed the
    // seam and left two half-sentences.
    const pages = [
      page(0, [{ kind: 'paragraph', text: 'The alembick being set', continuesNext: true }]),
      { ...page(1, []), role: 'blank' as const },
      page(2, [{ kind: 'paragraph', text: 'upon a gentle fire.', continuesPrevious: true }])
    ]
    const joined = assembleBook(pages, { illustrations: [crop('i1', 2, 800, 600)] })
    expect(joined.blocks.map((b) => b.text)).toEqual(['The alembick being set upon a gentle fire.'])

    // Whereas a page the *user* removed does sever it, because real text went
    // with it and splicing the halves would fabricate a sentence.
    const severed = assembleBook(pages, { excludePages: [1] })
    expect(severed.blocks.map((b) => b.text)).toEqual([
      'The alembick being set',
      'upon a gentle fire.'
    ])
  })

  it('drops a picture whose page the user left out', () => {
    // Its pixels came from a leaf that was removed; embedding them would put
    // back the one thing the user asked to take out.
    const doc = assembleBook(
      [
        page(0, [{ kind: 'paragraph', text: PROSE }]),
        page(1, [{ kind: 'paragraph', text: PROSE }])
      ],
      { illustrations: [crop('i1', 1, 800, 600)], excludePages: [1] }
    )
    expect(doc.illustrations).toEqual([])
  })
})

describe('layout — setting an illustration', () => {
  /** A wide, short figure: it shares a page rather than becoming a plate. */
  const inline = (caption?: string): BookDocument =>
    assembleBook(
      [
        page(0, [
          { kind: 'heading', text: 'Of the Air', level: 1 },
          { kind: 'paragraph', text: PROSE.repeat(3) },
          ...(caption ? [{ kind: 'caption' as const, text: caption }] : [])
        ]),
        page(1, [{ kind: 'paragraph', text: PROSE.repeat(3) }])
      ],
      { illustrations: [crop('i1', 0, 1200, 400)] }
    )

  it('sets it to the full measure, on the page its text was on', () => {
    const book = run(inline())
    const placed = allImages(book)
    expect(placed).toHaveLength(1)

    const page = book.pages.find((p) => images(p).length > 0)!
    expect(placed[0]!.widthPt).toBeCloseTo(page.frame.widthPt, 6)
    expect(placed[0]!.xPt).toBeCloseTo(page.frame.xPt, 6)
  })

  it('never distorts it — height follows width', () => {
    const item = allImages(run(inline()))[0]!
    expect(item.heightPt / item.widthPt).toBeCloseTo(400 / 1200, 6)
  })

  it('holds slots for its height, so the text below is not set over it', () => {
    const book = run(inline())
    const page = book.pages.find((p) => images(p).length > 0)!
    const item = images(page)[0]!
    const below = lines(page)
      .map((l) => l.baselinePt)
      .filter((y) => y > item.yPt)
    for (const baseline of below) {
      expect(baseline).toBeGreaterThanOrEqual(item.yPt + item.heightPt)
    }
  })

  it('sets the caption under it, centred and smaller than the body', () => {
    const book = run(inline('Fig. 1. The alembick, as the author drew it.'))
    const page = book.pages.find((p) => images(p).length > 0)!
    const item = images(page)[0]!
    const caption = lines(page).find((l) => l.runs.some((r) => r.text.includes('alembick')))!

    expect(caption.baselinePt).toBeGreaterThan(item.yPt + item.heightPt)
    expect(caption.runs[0]!.sizePt).toBeLessThan(defaultStyleProfile().bodyFontSize)
    expect(caption.runs[0]!.font.style).toBe('italic')

    // Centred: the same slack on both sides of the measure.
    const width = caption.runs.reduce(
      (w, r) => Math.max(w, r.xPt + measurer.widthOf(r.text, r.font, r.sizePt)),
      0
    )
    const left = Math.min(...caption.runs.map((r) => r.xPt)) - page.frame.xPt
    const right = page.frame.xPt + page.frame.widthPt - width
    expect(left).toBeCloseTo(right, 1)
  })

  it('keeps the caption on the picture’s page', () => {
    const book = run(inline('Fig. 1. The alembick.'))
    const page = book.pages.find((p) => images(p).length > 0)!
    expect(textOf(page)).toContain('alembick')
  })
})

describe('layout — plates', () => {
  /** A tall figure: too big to share a page with anything. */
  const plated = (): BookDocument =>
    assembleBook(
      [
        page(0, [
          { kind: 'heading', text: 'Of the Air', level: 1 },
          { kind: 'paragraph', text: PROSE.repeat(4) }
        ]),
        page(1, [{ kind: 'paragraph', text: PROSE.repeat(4) }])
      ],
      { illustrations: [crop('i1', 0, 600, 900)] }
    )

  it('gives a tall figure a leaf of its own', () => {
    const book = run(plated())
    const page = book.pages.find((p) => images(p).length > 0)!
    expect(page.kind).toBe('plate')
    // Nothing on the leaf but the picture and its folio. The folio stays: these
    // plates are part of the signature, not tipped in, so skipping a number
    // would put the contents page out by one.
    expect(textOf(page)).not.toContain('chirurgeon')
    expect(page.folio).not.toBeNull()
  })

  it('scales it down to fit the page rather than letting it run off', () => {
    const book = run(plated())
    const page = book.pages.find((p) => images(p).length > 0)!
    const item = images(page)[0]!
    expect(item.yPt).toBeGreaterThanOrEqual(page.frame.yPt - 0.001)
    expect(item.yPt + item.heightPt).toBeLessThanOrEqual(
      page.frame.yPt + page.frame.heightPt + 0.001
    )
    // Still undistorted after the scale-down.
    expect(item.heightPt / item.widthPt).toBeCloseTo(900 / 600, 6)
  })

  it('centres it on the leaf instead of hanging it from the top', () => {
    const book = run(plated())
    const page = book.pages.find((p) => images(p).length > 0)!
    const item = images(page)[0]!
    const above = item.yPt - page.frame.yPt
    const below = page.frame.yPt + page.frame.heightPt - (item.yPt + item.heightPt)
    // Within half a slot of centred: the sink is rounded to a whole slot so the
    // picture stays on the baseline grid, which is worth half a line of drift.
    const leading = leadingFor(defaultStyleProfile().bodyFontSize)
    expect(Math.abs(above - below)).toBeLessThanOrEqual(leading)
  })

  it('carries no running head — there is no text on the page to head', () => {
    const book = run(plated())
    const page = book.pages.find((p) => images(p).length > 0)!
    expect(textOf(page)).not.toContain('Boyle')
  })

  it('does not leave a blank page in front of a plate that already fell at a break', () => {
    const book = run(plated())
    const plate = book.pages.findIndex((p) => images(p).length > 0)
    const before = book.pages[plate - 1]!
    expect(lines(before).length).toBeGreaterThan(0)
  })

  it('never splits a picture across two pages', () => {
    const book = run(plated())
    expect(allImages(book)).toHaveLength(1)
  })
})

describe('layout — what it reports about pictures', () => {
  const doc = (sourceWidth: number, sourceHeight: number): BookDocument =>
    assembleBook(
      [
        page(0, [
          { kind: 'paragraph', text: PROSE.repeat(3) },
          { kind: 'caption', text: 'Fig. 1.' }
        ])
      ],
      { illustrations: [crop('i1', 0, sourceWidth, sourceHeight)] }
    )

  it('measures the resolution each one actually got', () => {
    const book = run(doc(1200, 400))
    expect(book.imagesPlaced).toHaveLength(1)
    const placed = book.imagesPlaced[0]!
    // The engine set it to the measure, so the DPI is source pixels over the
    // measure in inches — the number KDP cares about, from the box that was drawn.
    expect(placed.dpi).toBeCloseTo(1200 / (placed.widthPt / 72), 6)
    expect(book.pages[placed.pageIndex]!.index).toBe(placed.pageIndex)
  })

  it('reports a low resolution honestly rather than upscaling to hide it', () => {
    // 200px across a ~4.4in measure is about 45 DPI. Nothing here rescues that;
    // the export screen has to be able to say so.
    const book = run(doc(200, 150))
    expect(book.imagesPlaced[0]!.dpi).toBeLessThan(100)
    expect(book.imagesDropped).toEqual([])
  })

  it('reports a picture that fell outside a truncated layout instead of losing it', () => {
    // The design preview lays out a sample. A picture past the sample is not in
    // the book *that was laid out*, and saying nothing would look like it had
    // simply been dropped.
    const long = assembleBook(
      [
        page(0, [{ kind: 'paragraph', text: PROSE.repeat(40) }]),
        page(1, [{ kind: 'paragraph', text: PROSE.repeat(40) }])
      ],
      { illustrations: [crop('i1', 1, 800, 600)] }
    )
    const book = layout(long, defaultStyleProfile(), measurer, {
      edition: EDITION,
      maxBodyPages: 1
    })
    expect(book.imagesPlaced).toEqual([])
    expect(book.imagesDropped.map((i) => i.id)).toEqual(['i1'])
  })

  it('says nothing about pictures in a book that has none', () => {
    const plain = assembleBook([page(0, [{ kind: 'paragraph', text: PROSE }])])
    const book = run(plain)
    expect(book.imagesPlaced).toEqual([])
    expect(book.imagesDropped).toEqual([])
    expect(allImages(book)).toEqual([])
  })

  it('settles: laying the same book out twice gives the same pages', () => {
    expect(JSON.stringify(run(doc(1200, 400)))).toBe(JSON.stringify(run(doc(1200, 400))))
  })

  it('keeps the text of the book intact around the picture', () => {
    expect(bookText(run(doc(1200, 400)))).toContain('chirurgeon')
  })
})
