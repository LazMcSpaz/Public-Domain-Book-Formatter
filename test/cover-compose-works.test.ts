/**
 * (Split from `cover-compose.test.ts` to keep each file short; shares its fixtures.)
 *
 * Composing a cover.
 *
 * Every test here uses `fixedWidthMeasurer`, so a title's width is arithmetic
 * and a failing assertion means the composer changed rather than that EB
 * Garamond did — the same bargain the layout tests strike.
 */
import { describe, expect, it } from 'vitest'
import { fixedWidthMeasurer } from '@core/layout'
import {
  PRESS_MARK_ID,
  composeCover,
  defaultCover,
  itemBounds,
  type CoverDocument,
  type CoverItem,
  type CoverTextItem
} from '@core/cover'

const measurer = fixedWidthMeasurer()

function bookCover(patch: (doc: CoverDocument) => void = () => {}): CoverDocument {
  const doc = defaultCover('6x9', 284)
  doc.content.title = 'A Treatise on Bee Keeping'
  doc.content.author = 'Amos Root'
  doc.content.blurb = 'First published in 1877.\n\nReset and reprinted from the original edition.'
  doc.content.imprint = 'Blackthorn Press'
  doc.look.arrangement = 'typographic'
  patch(doc)
  return doc
}

function texts(items: readonly { kind: string }[]): CoverTextItem[] {
  return items.filter((i): i is CoverTextItem => i.kind === 'text')
}

describe('a volume that binds two works', () => {
  function omnibus(): CoverDocument {
    const doc = defaultCover('6x9', 168)
    doc.content.title = 'The Astral World and The Human Aura'
    doc.content.works = ['The Astral World', 'The Human Aura']
    doc.content.author = 'Swami Panchadasi'
    doc.look.arrangement = 'typographic'
    return doc
  }

  it('sets every work at the same size', () => {
    // The point of the whole branch: two treatises bound together are two
    // treatises. Setting the longer one smaller so it fits would say the
    // shorter one matters more.
    const { items } = composeCover(omnibus(), { measurer })
    const astral = texts(items).find((t) => t.text.toUpperCase().includes('ASTRAL'))!
    const aura = texts(items).find((t) => t.text.toUpperCase().includes('AURA'))!
    expect(astral.sizePt).toBe(aura.sizePt)
  })

  it('joins the works with an italic “and”', () => {
    const { items } = composeCover(omnibus(), { measurer })
    const set = texts(items)
    const conjunction = set.find((t) => t.text === 'and')!
    expect(conjunction.font.style).toBe('italic')
    expect(conjunction.sizePt).toBeLessThan(
      set.find((t) => t.text.toUpperCase().includes('ASTRAL'))!.sizePt
    )
  })

  it('never subordinates the second work to the first', () => {
    // The failure this branch exists to prevent: the second work in `subtitle`,
    // which sets smaller and italic and is a false claim about the book.
    const { items } = composeCover(omnibus(), { measurer })
    const aura = texts(items).find((t) => t.text.toUpperCase().includes('AURA'))!
    expect(aura.font.style).toBe('regular')
  })

  it('says nothing about the count unless the press asks it to', () => {
    // Two titles under one rule with an italic `and` between already say it.
    // A label above them, stacked under a series line, is one line of small
    // capitals too many — so it is off unless a look turns it on.
    const quiet = omnibus()
    expect(
      texts(composeCover(quiet, { measurer }).items).some((t) => t.text.includes('WORKS'))
    ).toBe(false)
  })

  it('counts in words, and counts right, when it is asked to', () => {
    const three = omnibus()
    three.look.announceWorks = true
    three.content.works = ['The Astral World', 'The Human Aura', 'The Inner Consciousness']
    const { items } = composeCover(three, { measurer })
    expect(texts(items).some((t) => t.text === 'THREE WORKS')).toBe(true)
  })

  it('puts no rule above the titles', () => {
    // Closed underneath and open at the top, so the series line above reads as
    // belonging to the cover rather than being boxed in with the titles.
    const doc = omnibus()
    const { items, geometry } = composeCover(doc, { measurer })
    const rules = items.filter((i) => i.kind === 'rule' && i.xPt / 72 > geometry.front.x)
    const firstTitle = texts(items).find((t) => t.text.toUpperCase().includes('ASTRAL'))!
    for (const rule of rules) {
      expect(rule.yPt).toBeGreaterThan(firstTitle.yPt)
    }
  })

  it('leaves an ordinary book exactly as it was', () => {
    const single = omnibus()
    single.content.works = []
    single.content.title = 'The Astral World'
    const { items } = composeCover(single, { measurer })
    expect(texts(items).some((t) => t.text.includes('WORKS'))).toBe(false)
    expect(texts(items).some((t) => t.text === 'and')).toBe(false)
  })

  it('keeps every line of type inside the safe area', () => {
    const { items, geometry } = composeCover(omnibus(), { measurer })
    for (const item of texts(items)) {
      const rect = itemBounds(item)!
      expect(rect.x).toBeGreaterThanOrEqual(geometry.backSafe.x - 1e-6)
      expect(rect.x + rect.width).toBeLessThanOrEqual(
        geometry.front.x + geometry.front.width - 0.25 + 1e-6
      )
    }
  })
})

describe("the press's mark", () => {
  const mark = {
    dataUrl: 'data:image/png;base64,AAAA',
    widthPx: 650,
    heightPx: 650,
    fileName: 'libri-vetus.png'
  }

  it('sits at the foot of the spine, clear of the trim', () => {
    const doc = bookCover((d) => {
      d.look.pressMark = mark
    })
    const { items, geometry } = composeCover(doc, { measurer })
    const placed = items.find((i) => i.kind === 'image' && i.id === PRESS_MARK_ID)!
    if (placed.kind !== 'image') throw new Error('unreachable')
    const rect = itemBounds(placed)!
    expect(rect.y + rect.height).toBeLessThanOrEqual(
      geometry.spine.y + geometry.spine.height - 0.25 + 1e-6
    )
    // Centred across the fold, and inside it.
    expect(rect.x).toBeGreaterThan(geometry.spine.x)
    expect(rect.x + rect.width).toBeLessThan(geometry.spine.x + geometry.spine.width)
    expect(rect.x + rect.width / 2).toBeCloseTo(geometry.spine.x + geometry.spine.width / 2, 6)
  })

  it('never distorts the device', () => {
    const doc = bookCover((d) => {
      d.look.pressMark = { ...mark, widthPx: 300, heightPx: 600 }
    })
    const { items } = composeCover(doc, { measurer })
    const placed = items.find((i) => i.kind === 'image' && i.id === PRESS_MARK_ID)!
    if (placed.kind !== 'image') throw new Error('unreachable')
    expect(placed.heightPt / placed.widthPt).toBeCloseTo(2, 6)
  })

  it('makes room for itself — the spine text stops above it', () => {
    const withMark = bookCover((d) => {
      d.look.pressMark = mark
    })
    const without = bookCover()
    const runOf = (doc: CoverDocument) => {
      const { items } = composeCover(doc, { measurer })
      const spine = texts(items).find((t) => t.rotate === -90)!
      const device = composeCover(doc, { measurer }).items.find(
        (i) => i.kind === 'image' && i.id === PRESS_MARK_ID
      )
      return { start: spine.yPt, end: spine.yPt + spine.widthPt, device }
    }
    // The property, stated directly: the line ends above the device rather
    // than running into it. It used to compare the two runs' start positions,
    // which only held while both were set at the same size — once the fold
    // rather than a fixed ceiling decided that size, the comparison stopped
    // being about the device at all.
    const marked = runOf(withMark)
    expect(marked.device).toBeDefined()
    expect(marked.end).toBeLessThanOrEqual(marked.device!.yPt)
    expect(marked.end).toBeLessThan(runOf(without).end)
  })

  it('is left off a spine too narrow to show it, and says so', () => {
    // A 40-page book has a tenth of an inch of fold. Shrinking the device to
    // fit would print a smudge with a shape it can no longer show, so it is
    // reported instead — the same rule a dropped footnote gets.
    const doc = bookCover((d) => {
      d.pageCount = 40
      d.look.pressMark = mark
    })
    const { items, warnings } = composeCover(doc, { measurer })
    expect(items.some((i) => i.kind === 'image' && i.id === PRESS_MARK_ID)).toBe(false)
    expect(warnings.join(' ')).toMatch(/too narrow to print the press's mark/)
  })

  it('prints on a 128-page book on cream, the thinnest spine on the shelf', () => {
    // The Human Aura and The Astral World: a 0.320 in fold leaves 0.195 in
    // once KDP's clearance is taken off both edges. The floor was 0.2 and the
    // device was left off by five thousandths of an inch, the one spine of
    // the collection without it.
    const doc = bookCover((d) => {
      d.pageCount = 128
      d.paper = 'bw-cream'
      d.look.pressMark = mark
    })
    const { items, warnings } = composeCover(doc, { measurer })
    const device = items.find((i) => i.kind === 'image' && i.id === PRESS_MARK_ID)
    if (!device || device.kind !== 'image') throw new Error('no press mark on the spine')
    expect(device.widthPt / 72).toBeGreaterThanOrEqual(0.18)
    expect(warnings.join(' ')).not.toMatch(/press's mark/)
  })

  it("names the page count the mark needs on the book's own paper", () => {
    const pagesNamed = (paper: CoverDocument['paper']) => {
      const { warnings } = composeCover(
        bookCover((d) => {
          d.pageCount = 40
          d.paper = paper
          d.look.pressMark = mark
        }),
        { measurer }
      )
      const m = /about (\d+) pages/.exec(warnings.join(' '))
      return m ? Number(m[1]) : null
    }
    // 0.305 in of fold: 122 sheets of cream at 0.0025, 136 of white at 0.002252.
    expect(pagesNamed('bw-cream')).toBe(122)
    expect(pagesNamed('bw-white')).toBe(136)
  })

  it('prints once the fold is wide enough', () => {
    const doc = bookCover((d) => {
      d.pageCount = 140
      d.look.pressMark = mark
    })
    const { items, warnings } = composeCover(doc, { measurer })
    expect(items.some((i) => i.kind === 'image' && i.id === PRESS_MARK_ID)).toBe(true)
    expect(warnings.join(' ')).not.toMatch(/press's mark/)
  })

  it('is absent when no press has one', () => {
    const { items } = composeCover(bookCover(), { measurer })
    expect(items.some((i) => i.kind === 'image')).toBe(false)
  })
})

describe('an edition statement goes under the rule', () => {
  /** The y of the title rule: a `rule` item, which is not a thin `fill`. */
  function ruleY(items: readonly CoverItem[]): number {
    const rule = items.find((i) => i.kind === 'rule')
    if (!rule || rule.kind !== 'rule') throw new Error('no rule on this cover')
    return rule.yPt
  }

  function labelled(edition: string): CoverDocument {
    return bookCover((d) => {
      d.look.arrangement = 'label'
      d.content.edition = edition
    })
  }

  it('sets under the rule, not above the title where the series goes', () => {
    const { items } = composeCover(labelled('Illustrated'), { measurer })
    const line = texts(items).find((t) => t.text === 'ILLUSTRATED')
    expect(line).toBeDefined()
    // The whole of the editor's instruction, as an assertion: below the rule.
    expect(line!.yPt).toBeGreaterThan(ruleY(items))
  })

  it('leaves the series above the title, so the two are read apart', () => {
    const doc = labelled('Illustrated')
    doc.content.series = 'Libri Vetus'
    const { items } = composeCover(doc, { measurer })
    const series = texts(items).find((t) => t.text === 'LIBRI VETUS')!
    const edition = texts(items).find((t) => t.text === 'ILLUSTRATED')!
    expect(series.yPt).toBeLessThan(ruleY(items))
    expect(edition.yPt).toBeGreaterThan(ruleY(items))
  })

  it('is set in small capitals in the accent, as the series line is', () => {
    const doc = labelled('Illustrated')
    const { items } = composeCover(doc, { measurer })
    const line = texts(items).find((t) => t.text === 'ILLUSTRATED')!
    expect(line.color).toBe(doc.look.palette.accent)
    // Smaller than the title, which is the point of a statement under a rule.
    const titleSize = Math.max(...texts(items).map((t) => t.sizePt))
    expect(line.sizePt).toBeLessThan(titleSize)
  })

  it('takes space rather than printing over what follows it', () => {
    const without = composeCover(labelled(''), { measurer })
    const withOne = composeCover(labelled('Illustrated'), { measurer })
    const before = texts(without.items).find((t) => t.text === 'Amos Root')!
    const after = texts(withOne.items).find((t) => t.text === 'Amos Root')!
    // The author is pushed down, which is what tells a laid-out line from one
    // drawn on top of its neighbour.
    expect(after.yPt).toBeGreaterThan(before.yPt)
  })

  it('does not count whitespace as a statement', () => {
    // The guard is `.trim()`, and without it a cover whose field was cleared to
    // a space sets an empty line and moves every line under it down.
    const blank = composeCover(labelled('   '), { measurer })
    const none = composeCover(labelled(''), { measurer })
    expect(texts(blank.items).map((t) => t.text)).toEqual(texts(none.items).map((t) => t.text))
    const a = texts(blank.items).find((t) => t.text === 'Amos Root')!
    const b = texts(none.items).find((t) => t.text === 'Amos Root')!
    expect(a.yPt).toBeCloseTo(b.yPt, 6)
  })
})
