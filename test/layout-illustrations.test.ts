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

  /**
   * _The Secret Doctrine_ Vol. I, leaf 245: a diagram whose engraving carries
   * `*`, `†` and `‡`, with the three notes printed beneath it. As footnotes
   * they were numbered against a line repeating the figure's labels and set on
   * the page before the picture. A caption of several paragraphs is the key.
   */
  it('sets a caption of several marked paragraphs as a key, like notes', () => {
    const doc = inline()
    doc.illustrations[0]!.caption =
      '* The <i>Arupa</i> or formless world.\n† The archetypal world.\n‡ The four lower planes.'
    const book = run(doc)
    const page = book.pages.find((p) => images(p).length > 0)!
    const item = images(page)[0]!
    const body = defaultStyleProfile().bodyFontSize
    const key = lines(page).filter(
      (l) =>
        l.baselinePt > item.yPt + item.heightPt &&
        l.runs.length > 0 &&
        l.runs.every((r) => r.sizePt < body)
    )
    const said = key.map((l) => l.runs.map((r) => r.text).join(' ')).filter((t) => /\p{L}/u.test(t))
    expect(said).toEqual([
      '* The Arupa or formless world.',
      '† The archetypal world.',
      '‡ The four lower planes.'
    ])
    // Each paragraph's printed mark is raised and hangs left of its words.
    for (const line of key.filter((l) => /\p{L}/u.test(l.runs.map((r) => r.text).join('')))) {
      const [mark, ...words] = line.runs
      expect(mark!.risePt ?? 0).toBeGreaterThan(0)
      expect(Math.min(...words.map((r) => r.xPt))).toBeGreaterThan(mark!.xPt)
    }
    // Roman, with the marked word in italic, at the notes' size.
    const runs = key.flatMap((l) => l.runs).filter((r) => !(r.risePt ?? 0))
    expect(runs.find((r) => r.text.includes('Arupa'))!.font.style).toBe('italic')
    expect(runs.find((r) => r.text.includes('archetypal'))!.font.style).toBe('regular')
    expect(runs.some((r) => r.text.includes('<'))).toBe(false)
    expect(runs[0]!.sizePt).toBeLessThan(defaultStyleProfile().bodyFontSize * 0.85)
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

/**
 * A figure where the original set it, at the size the original printed it.
 *
 * The engine's own rule — after the last text that shared the leaf, as wide
 * as the measure — is the most the scan can say. A person who has looked at
 * the leaf can say more, and *Isis Unveiled* has three figures that need it:
 * an amulet set into a paragraph with the text run down a column beside it, a
 * symbol drawn mid-sentence, and a chemical formula at its own small size.
 */
describe('layout — a figure placed where the original set it', () => {
  const profile = defaultStyleProfile()
  const leading = leadingFor(profile.bodyFontSize)
  const WORD = 'nucleus'
  const HOST = `${PROSE}Attach to the ${WORD} three hydroxyl groups and there result triatomic compounds among which is a very familiar substance and the account of it runs on for some lines yet before the paragraph is done with the matter. ${PROSE.repeat(4)}`
  const AT = HOST.indexOf(WORD)

  /** A supplied picture, the way `applyEdits` hands one to the engine. */
  const figure = (
    placement: NonNullable<import('@core/assemble').Illustration['placement']>,
    over: Partial<{ sourceWidth: number; sourceHeight: number }> = {}
  ): import('@core/assemble').Illustration => ({
    id: 'fig1',
    pageIndex: -1,
    sourceWidth: over.sourceWidth ?? 600,
    sourceHeight: over.sourceHeight ?? 300,
    caption: null,
    anchorAfterBlockId: 'p0b1',
    origin: 'supplied',
    placement
  })

  const docWith = (
    placement: NonNullable<import('@core/assemble').Illustration['placement']>,
    over: Partial<{ sourceWidth: number; sourceHeight: number; host: string; before: string }> = {}
  ): BookDocument => {
    const doc = assembleBook([
      page(0, [
        { kind: 'paragraph', text: over.before ?? PROSE },
        { kind: 'paragraph', text: over.host ?? HOST },
        { kind: 'paragraph', text: PROSE.repeat(2) }
      ])
    ])
    return { ...doc, illustrations: [figure(placement, over)] }
  }

  const pageWithImage = (book: LaidOutBook): LaidOutPage =>
    book.pages.find((p) => images(p).length > 0)!
  const rightEdge = (l: PositionedLine): number =>
    Math.max(...l.runs.map((r) => r.xPt + measurer.widthOf(r.text, r.font, r.sizePt)))
  const leftEdge = (l: PositionedLine): number => Math.min(...l.runs.map((r) => r.xPt))
  /** Lines whose baseline falls in the picture's vertical span. */
  const linesBeside = (p: LaidOutPage, item: ImageItem): PositionedLine[] =>
    lines(p).filter(
      (l) =>
        l.runs.length > 0 &&
        l.baselinePt > item.yPt &&
        l.baselinePt < item.yPt + item.heightPt + leading
    )

  it('sets an inline figure at the width the original printed it, centred', () => {
    const book = run(docWith({ kind: 'inline', widthIn: 1.5 }))
    const item = allImages(book)[0]!
    const p = pageWithImage(book)
    expect(item.widthPt).toBeCloseTo(1.5 * 72, 6)
    expect(item.xPt).toBeCloseTo(p.frame.xPt + (p.frame.widthPt - item.widthPt) / 2, 6)
    // Nothing is set over it.
    for (const l of linesBeside(p, item))
      expect(l.baselinePt).toBeGreaterThan(item.yPt + item.heightPt)
  })

  it('never sets an inline figure wider than the measure', () => {
    const book = run(docWith({ kind: 'inline', widthIn: 12 }))
    const item = allImages(book)[0]!
    expect(item.widthPt).toBeCloseTo(pageWithImage(book).frame.widthPt, 6)
  })

  describe('within — a symbol drawn mid-sentence', () => {
    const book = run(docWith({ kind: 'within', widthIn: 1.5, at: AT }))
    const p = pageWithImage(book)
    const item = images(p)[0]!

    it('stops the text before the word, draws the figure, and resumes below it', () => {
      const above = lines(p).filter((l) => l.baselinePt < item.yPt)
      const below = lines(p).filter((l) => l.baselinePt > item.yPt + item.heightPt)
      const textAbove = above.map((l) => l.runs.map((r) => r.text).join(' ')).join(' ')
      const textBelow = below.map((l) => l.runs.map((r) => r.text).join(' ')).join(' ')
      expect(textAbove).toContain('Attach to the')
      expect(textAbove).not.toContain(WORD)
      expect(textBelow.startsWith(`${WORD} three hydroxyl`)).toBe(true)
    })

    it('resumes flush, because it is the same sentence and not a new paragraph', () => {
      const resumed = lines(p).find((l) => l.baselinePt > item.yPt + item.heightPt)!
      expect(leftEdge(resumed)).toBeCloseTo(p.frame.xPt, 3)
    })

    it('draws the figure centred at its printed width', () => {
      expect(item.widthPt).toBeCloseTo(1.5 * 72, 6)
      expect(item.xPt).toBeCloseTo(p.frame.xPt + (p.frame.widthPt - item.widthPt) / 2, 6)
    })

    it('loses no words of the paragraph', () => {
      const all = bookText(book).replace(/·/g, ' ').replace(/\s+/g, ' ')
      for (const w of HOST.split(/\s+/)) expect(all).toContain(w.replace(/-$/, ''))
    })

    it('reports the block on one page, as one thing', () => {
      expect(book.blockPages.filter((b) => b.blockId === 'p0b1')).toHaveLength(1)
    })
  })

  describe('beside — the text run down a column past the figure', () => {
    const gutter = profile.bodyFontSize

    it('narrows the lines from the one carrying the word, on the right', () => {
      const book = run(docWith({ kind: 'beside', widthIn: 1.8, at: AT, side: 'right' }))
      const p = pageWithImage(book)
      const item = images(p)[0]!
      expect(item.xPt).toBeCloseTo(p.frame.xPt + p.frame.widthPt - item.widthPt, 6)
      const beside = linesBeside(p, item)
      expect(beside.length).toBeGreaterThan(2)
      for (const l of beside) {
        expect(leftEdge(l)).toBeCloseTo(p.frame.xPt, 3)
        expect(rightEdge(l)).toBeLessThanOrEqual(item.xPt - gutter + 0.5)
      }
      // The word the placement names is on the first narrowed line.
      expect(beside[0]!.runs.map((r) => r.text).join(' ')).toContain(WORD)
      // And the lines after the figure take the full measure again.
      const after = lines(p).filter((l) => l.baselinePt > item.yPt + item.heightPt + leading)
      expect(after.some((l) => rightEdge(l) > item.xPt + 1)).toBe(true)
    })

    it('narrows the lines on the left, and moves them out past the figure', () => {
      const book = run(docWith({ kind: 'beside', widthIn: 1.8, at: AT, side: 'left' }))
      const p = pageWithImage(book)
      const item = images(p)[0]!
      expect(item.xPt).toBeCloseTo(p.frame.xPt, 6)
      for (const l of linesBeside(p, item)) {
        expect(leftEdge(l)).toBeGreaterThanOrEqual(item.xPt + item.widthPt + gutter - 0.5)
      }
    })

    it('keeps every word', () => {
      const book = run(docWith({ kind: 'beside', widthIn: 1.8, at: AT, side: 'right' }))
      const all = bookText(book).replace(/·/g, ' ').replace(/\s+/g, ' ')
      for (const w of HOST.split(/\s+/)) expect(all).toContain(w.replace(/-$/, ''))
    })

    /**
     * Manuscript 43's seven planes were anchored at "Seven", the last word of a
     * line. Narrowing that line pushed the word down, narrowing the next let it
     * back, and after four passes the figure hung from one line while the
     * narrowing began at the other: the picture was drawn over "right
     * represents the Seven". Whatever word is named, no line beside the figure
     * may reach under it.
     */
    it('never sets text under the figure, wherever the word falls', () => {
      const offsets = [...HOST.slice(0, 900).matchAll(/\S+/g)].map((m) => m.index!)
      for (const at of offsets) {
        const book = run(docWith({ kind: 'beside', widthIn: 1.8, at, side: 'right' }))
        const p = pageWithImage(book)
        const item = images(p)[0]!
        const under = lines(p).filter(
          (l) =>
            l.baselinePt > item.yPt &&
            l.baselinePt - leading < item.yPt + item.heightPt &&
            rightEdge(l) > item.xPt - 0.5
        )
        expect(under.map((l) => `${at}: ${l.runs.map((r) => r.text).join(' ')}`)).toEqual([])
      }
    })

    it('holds the slots beside a figure taller than its paragraph', () => {
      const short = `${PROSE}Attach to the ${WORD} three hydroxyl groups.`
      const book = run(
        docWith(
          { kind: 'beside', widthIn: 1.8, at: short.indexOf(WORD), side: 'right' },
          { host: short, sourceWidth: 300, sourceHeight: 600 }
        )
      )
      const p = pageWithImage(book)
      const item = images(p)[0]!
      const nextBlock = book.blockPages.find((b) => b.blockId === 'p0b2')!
      expect(nextBlock.pageIndex).toBe(p.index)
      const firstOfNext = lines(p).find((l) =>
        l.runs
          .map((r) => r.text)
          .join(' ')
          .startsWith('The chirurgeon')
      )
      // The paragraph after starts below the picture, not through it.
      const below = lines(p).filter((l) => l.baselinePt > item.yPt + item.heightPt)
      expect(below.length).toBeGreaterThan(0)
      expect(firstOfNext).toBeDefined()
    })

    it('never splits a figure from the lines set beside it across a page', () => {
      // The figure is five slots tall. Walk the host paragraph down the first
      // page a paragraph at a time, so that for some length of text before it
      // the run-around would straddle the page break if nothing held it — a
      // fixture at one length passed with the hold removed, because that one
      // length happened not to break inside it.
      const slots = Math.ceil((1.8 * 72 * 300) / 600 / leading)
      let straddled = 0
      for (let k = 1; k <= 24; k++) {
        const book = run(
          docWith(
            { kind: 'beside', widthIn: 1.8, at: AT, side: 'right' },
            { before: PROSE.repeat(k) }
          )
        )
        const p = pageWithImage(book)
        const item = images(p)[0]!
        expect(item.yPt + item.heightPt).toBeLessThanOrEqual(p.frame.yPt + p.frame.heightPt + 0.5)
        // Every narrowed line is on the figure's page: the paragraph is long
        // enough to fill the column, so the page must carry all of them.
        const beside = linesBeside(p, item)
        expect(beside.length).toBe(slots)
        for (const l of beside) expect(rightEdge(l)).toBeLessThanOrEqual(item.xPt - gutter + 0.5)
        if (p.index > 0 && book.blockPages.find((b) => b.blockId === 'p0b1')!.pageIndex < p.index) {
          straddled++
        }
      }
      // And the sweep did put the paragraph across a page break, or it has
      // exercised nothing.
      expect(straddled).toBeGreaterThan(0)
    })

    it('falls back to a line of its own when the text would have no room, and says so', () => {
      const book = run(docWith({ kind: 'beside', widthIn: 4.2, at: AT, side: 'right' }))
      const item = allImages(book)[0]!
      const p = pageWithImage(book)
      expect(item.xPt).toBeCloseTo(p.frame.xPt + (p.frame.widthPt - item.widthPt) / 2, 6)
      expect(book.warnings.some((w) => /too wide/.test(w.text))).toBe(true)
    })
  })
})

describe('layout — a plate and a frontispiece, said outright', () => {
  type Illustration = import('@core/assemble').Illustration
  type Placement = NonNullable<Illustration['placement']>

  /** A supplied picture, the way `applyEdits` hands one to the engine. */
  const supplied = (
    id: string,
    placement: Placement,
    over: Partial<{ sourceWidth: number; sourceHeight: number; caption: string }> = {}
  ): Illustration => ({
    id,
    pageIndex: -1,
    sourceWidth: over.sourceWidth ?? 1080,
    sourceHeight: over.sourceHeight ?? 1450,
    caption: over.caption ?? null,
    anchorAfterBlockId: 'p0b1',
    origin: 'supplied',
    placement
  })

  const book = (...pictures: Illustration[]): BookDocument => {
    const doc = assembleBook([
      page(0, [
        { kind: 'heading', text: 'Of the Air', level: 1 },
        { kind: 'paragraph', text: PROSE.repeat(2) }
      ]),
      page(1, [{ kind: 'paragraph', text: PROSE.repeat(6) }])
    ])
    return { ...doc, illustrations: pictures }
  }

  const imagePages = (b: LaidOutBook): LaidOutPage[] => b.pages.filter((p) => images(p).length > 0)

  describe('plate', () => {
    // Short enough to share a page with text: 1.5 in wide by 1 in high. The
    // height rule alone would set it in the flow, which is the control below.
    const small = { sourceWidth: 450, sourceHeight: 300 }

    it('gives a picture a leaf of its own when the original printed it as one', () => {
      const laid = run(book(supplied('pl', { kind: 'plate', widthIn: 1.5 }, small)))
      const [p] = imagePages(laid)
      expect(p!.kind).toBe('plate')
      expect(textOf(p!)).not.toContain('chirurgeon')
      // The control: the same picture placed inline shares its page with text,
      // so it is the placement and not the size that made the leaf.
      const inline = run(book(supplied('pl', { kind: 'inline', widthIn: 1.5 }, small)))
      expect(textOf(imagePages(inline)[0]!)).toContain('chirurgeon')
    })

    it('sets it at the width the original printed it', () => {
      const laid = run(book(supplied('pl', { kind: 'plate', widthIn: 1.5 }, small)))
      expect(allImages(laid)[0]!.widthPt).toBeCloseTo(1.5 * 72, 6)
    })

    it('keeps its caption on its leaf', () => {
      const laid = run(
        book(
          supplied('pl', { kind: 'plate', widthIn: 1.5 }, { ...small, caption: 'The Master Mason' })
        )
      )
      expect(textOf(imagePages(laid)[0]!)).toContain('The Master Mason')
    })
  })

  describe('a plate waits for the page to end', () => {
    // A chapter whose first block the plate follows, then plenty of text: the
    // page the plate is reached on has room for a good deal more.
    const chapters = (firstLength: number, plates: Illustration[]): BookDocument => {
      const doc = assembleBook([
        page(0, [
          { kind: 'heading', text: 'Of the Air', level: 1 },
          { kind: 'paragraph', text: PROSE },
          { kind: 'paragraph', text: PROSE.repeat(firstLength) }
        ]),
        page(1, [
          { kind: 'heading', text: 'Of the Water', level: 1 },
          { kind: 'paragraph', text: PROSE.repeat(4) }
        ])
      ])
      return { ...doc, illustrations: plates }
    }
    const plateAt = (id: string, after: string): Illustration => ({
      ...supplied(id, { kind: 'plate', widthIn: 1.5 }, { sourceWidth: 450, sourceHeight: 300 }),
      anchorAfterBlockId: after
    })

    it('lets the text run on to the foot of the page, then takes the next leaf', () => {
      const laid = run(chapters(6, [plateAt('pl', 'p0b1')]))
      const plate = laid.pages.findIndex((p) => images(p).length > 0)
      const before = laid.pages[plate - 1]!
      // The paragraph after the anchor is on the page before the plate: the
      // text ran on rather than stopping where the plate was reached.
      expect(textOf(before)).toContain('chirurgeon')
      expect(before.index).toBe(laid.pages.findIndex((p) => textOf(p).includes('chirurgeon')))
      const last = lines(before)
        .filter((l) => l.runs.length > 0)
        .at(-1)!
      const leading = leadingFor(defaultStyleProfile().bodyFontSize)
      expect(before.frame.yPt + before.frame.heightPt - last.baselinePt).toBeLessThan(3 * leading)
      // And the text goes on after it.
      expect(textOf(laid.pages[plate + 1]!)).toContain('chirurgeon')
    })

    it('takes the next leaf when a page of short paragraphs fills exactly', () => {
      // One-line paragraphs: no widow or orphan rule moves a line, so the page
      // fills to its last slot and the next paragraph finds no room at all.
      const doc = assembleBook([
        page(
          0,
          Array.from({ length: 80 }, (_, k) => ({
            kind: 'paragraph' as const,
            text: `Line ${k} of the register.`
          }))
        )
      ])
      const laid = run({ ...doc, illustrations: [plateAt('pl', 'p0b0')] })
      const plate = laid.pages.findIndex((p) => images(p).length > 0)
      const first = laid.pages.findIndex((p) => textOf(p).includes('Line 0 '))
      expect(plate).toBe(first + 1)
      expect(textOf(laid.pages[plate + 1]!)).toMatch(/Line \d+ of the register/)
    })

    it('takes the next leaf when a paragraph will not start in the room left', () => {
      // A long paragraph after a run of one-line ones, its start walked down the
      // page: at some count it meets the foot with one line of room, which the
      // orphan rule refuses, and the page ends there instead of where it filled.
      for (let n = 20; n <= 44; n++) {
        const doc = assembleBook([
          page(0, [
            ...Array.from({ length: n }, (_, k) => ({
              kind: 'paragraph' as const,
              text: `Line ${k} of the register.`
            })),
            { kind: 'paragraph', text: PROSE.repeat(8) }
          ])
        ])
        const laid = run({ ...doc, illustrations: [plateAt('pl', 'p0b0')] })
        const plate = laid.pages.findIndex((p) => images(p).length > 0)
        expect(plate).toBe(laid.pages.findIndex((p) => textOf(p).includes('Line 0 ')) + 1)
      }
    })

    it('keeps several plates in the order they were anchored', () => {
      // Long enough that the page fills before the chapter ends, so both are
      // set at that break rather than before the next opening.
      const laid = run(chapters(20, [plateAt('a', 'p0b1'), plateAt('b', 'p0b1')]))
      expect(laid.imagesPlaced.map((i) => i.id)).toEqual(['a', 'b'])
      expect(laid.imagesPlaced[1]!.pageIndex).toBe(laid.imagesPlaced[0]!.pageIndex + 1)
    })

    it('faces a chapter opening on a recto from the verso before it, whichever side the chapter before ended on', () => {
      const ended = new Set<string>()
      for (let n = 1; n <= 30; n += 2) {
        const laid = run(chapters(n, [plateAt('pl', 'p0b2')]))
        const plate = laid.pages.findIndex((p) => images(p).length > 0)
        const opener = laid.pages.findIndex((p) => /of the water/i.test(textOf(p)))
        expect(laid.pages[plate]!.side).toBe('verso')
        expect(opener).toBe(plate + 1)
        // The side the first chapter's text ended on.
        ended.add(
          laid.pages
            .slice(0, plate)
            .reverse()
            .find((p) => lines(p).length > 0)!.side
        )
      }
      // Both shapes were exercised: a chapter ending on a recto, where the plate
      // takes the verso after it, and on a verso, where a blank recto goes in.
      expect(ended).toEqual(new Set(['recto', 'verso']))
    })

    it('sets a plate still waiting when the book ends after its last page', () => {
      const laid = run(chapters(2, [plateAt('pl', 'p1b1')]))
      expect(laid.imagesDropped).toEqual([])
      const plate = laid.pages.findIndex((p) => images(p).length > 0)
      expect(plate).toBeGreaterThan(laid.pages.findIndex((p) => /of the water/i.test(textOf(p))))
    })

    it('with chapters free to open either side, the chapter follows the plate directly', () => {
      for (let n = 1; n <= 4; n++) {
        const laid = run(chapters(n, [plateAt('pl', 'p0b2')]), { chaptersOpenRecto: false })
        const plate = laid.pages.findIndex((p) => images(p).length > 0)
        expect(textOf(laid.pages[plate + 1]!)).toMatch(/of the water/i)
        expect(lines(laid.pages[plate - 1]!).length).toBeGreaterThan(0)
      }
    })
  })

  describe('frontispiece', () => {
    const front = (caption?: string): Illustration =>
      supplied('fr', { kind: 'frontispiece', widthIn: 3.6 }, caption ? { caption } : {})

    it('faces the title page, on the verso before it', () => {
      const laid = run(book(front()))
      const title = laid.pages.findIndex((p) => p.kind === 'title')
      const [p] = imagePages(laid)
      expect(p!.index).toBe(title - 1)
      expect(p!.side).toBe('verso')
      expect(laid.pages[title]!.side).toBe('recto')
      expect(p!.section).toBe('front')
      expect(p!.folio).toBeNull()
    })

    it('stands on the half-title’s blank verso, so the book is no longer for it', () => {
      expect(run(book(front())).pages).toHaveLength(run(book()).pages.length)
      expect(run(book(front())).pages[0]!.kind).toBe('half-title')
    })

    it('with no half-title, puts a blank in front of it so it still faces the title', () => {
      const laid = run(book(front()), {
        frontMatter: { ...defaultStyleProfile().frontMatter, halfTitle: false }
      })
      expect(laid.pages[0]!.items).toHaveLength(0)
      expect(images(laid.pages[1]!)).toHaveLength(1)
      expect(laid.pages[2]!.kind).toBe('title')
    })

    it('is set once, and not again in the body', () => {
      const laid = run(book(front()))
      expect(allImages(laid)).toHaveLength(1)
      expect(laid.imagesPlaced.map((i) => i.id)).toEqual(['fr'])
      expect(laid.imagesDropped).toEqual([])
      expect(laid.warnings).toEqual([])
    })

    it('is sized as a plate and centred on its leaf, with its caption', () => {
      const laid = run(book(front('O. G. M. H. A. B.')))
      const p = imagePages(laid)[0]!
      const item = images(p)[0]!
      expect(item.widthPt).toBeLessThanOrEqual(3.6 * 72 + 0.001)
      expect(item.yPt + item.heightPt).toBeLessThanOrEqual(p.frame.yPt + p.frame.heightPt + 0.001)
      expect(item.yPt - p.frame.yPt).toBeGreaterThan(0)
      expect(textOf(p)).toContain('O. G. M. H. A. B.')
    })

    it('sets a second one as a plate where it was anchored, and says so', () => {
      const laid = run(book(front(), supplied('fr2', { kind: 'frontispiece', widthIn: 3.6 })))
      const pages = imagePages(laid)
      expect(pages.map((p) => p.section)).toEqual(['front', 'body'])
      expect(pages[1]!.kind).toBe('plate')
      expect(laid.warnings.some((w) => /fr2 was named a frontispiece, but fr/.test(w.text))).toBe(
        true
      )
    })

    it('with no title page to face, is set as a plate where it was anchored, and says so', () => {
      const laid = run(book(front()), {
        frontMatter: { ...defaultStyleProfile().frontMatter, titlePage: false }
      })
      const pages = imagePages(laid)
      expect(pages).toHaveLength(1)
      expect(pages[0]!.section).toBe('body')
      expect(pages[0]!.kind).toBe('plate')
      expect(laid.warnings.some((w) => /no title page for it to face/.test(w.text))).toBe(true)
    })
  })
})
