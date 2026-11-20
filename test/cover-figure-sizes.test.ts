/**
 * (Split from `cover-figure.test.ts` to keep each file short; shares its fixtures.)
 *
 * The ground figure.
 *
 * What is pinned here is where it stops, because that is the decision the
 * module exists to make. A texture may run across the fold: it repeats, so
 * there is no alignment to notice when the fold creeps. A figure has a centre
 * and a pair of wing tips, so it must not — and the consequence of getting it
 * wrong is not an error but a faint picture half-printed on the back cover of
 * a book somebody has already bought.
 */
import { describe, expect, it } from 'vitest'
import { fixedWidthMeasurer } from '@core/layout'
import { composeCover, defaultCover, type CoverDocument } from '@core/cover'

const measurer = fixedWidthMeasurer()

function cover(patch: (doc: CoverDocument) => void = () => {}): CoverDocument {
  const doc = defaultCover('6x9', 400)
  doc.content.title = 'Isis Unveiled'
  doc.content.author = 'H. P. Blavatsky'
  doc.look.arrangement = 'label'
  patch(doc)
  return doc
}

/**
 * Nothing on the board prints larger than the title.
 *
 * The fault that prompted it, measured on this shelf: with the author pinned
 * at 26 pt for the collection, the two covers whose titles were crushed by a
 * device over them printed an 18 pt title under a 26 pt name. A share could
 * never do that; a pinned size can, which is the cost of pinning one number
 * across a collection. The editor read it off a render in one glance.
 */
describe('the title is the largest thing on the board', () => {
  const sizes = (tweak: (d: CoverDocument) => void) => {
    const doc = cover((d) => {
      d.content.title = 'Keys'
      d.content.subtitle = 'Annotated'
      d.content.author = 'M. P. Hall'
      d.look.titleCase = 'upper'
      d.look.titleSizePt = 18
      tweak(d)
    })
    const composed = composeCover(doc, { measurer })
    const sizeOf = (text: string): number => {
      const item = composed.items.find((i) => i.kind === 'text' && i.text === text)
      return item?.kind === 'text' ? item.sizePt : 0
    }
    return {
      title: sizeOf('KEYS'),
      subtitle: sizeOf('Annotated'),
      author: sizeOf('M. P. Hall'),
      warnings: composed.warnings.join(' ')
    }
  }

  it('holds a pinned author back to the title’s size', () => {
    const s = sizes((d) => (d.look.authorSizePt = 26))
    expect(s.title).toBe(18)
    expect(s.author).toBeLessThanOrEqual(s.title)
    expect(s.warnings).toMatch(/does not print larger than the title/)
  })

  it('holds a pinned subtitle under the title', () => {
    const s = sizes((d) => (d.look.subtitleSizePt = 26))
    expect(s.subtitle).toBeLessThan(s.title)
    expect(s.warnings).toMatch(/stays under the title/)
  })

  it('leaves a pinned size that already fits exactly as asked', () => {
    // The bound must not be a tax on the ordinary case: on a 32 pt title the
    // collection's own 16 and 26 are both well inside it.
    const s = sizes((d) => {
      d.look.titleSizePt = 32
      d.look.subtitleSizePt = 16
      d.look.authorSizePt = 26
    })
    expect(s.subtitle).toBe(16)
    expect(s.author).toBe(26)
    expect(s.warnings).not.toMatch(/than the title|under the title/)
  })

  it('keeps the floor on a name, even under a tiny title', () => {
    // `AUTHOR_MIN_PT` is older than this bound and wins where they meet: a
    // name nobody can read along a shelf is the worse of the two faults, and
    // the real answer there is a larger title.
    const s = sizes((d) => {
      d.look.titleSizePt = 14
      d.look.authorSizePt = 26
    })
    expect(s.author).toBeGreaterThanOrEqual(16)
  })

  it('still lets a share set a subtitle level with the title', () => {
    // The case the share exists for: a reprinted multi-volume work whose
    // subtitle names the volume. Only a pinned size is bounded.
    const s = sizes((d) => {
      d.look.subtitleRatio = 1
      d.look.subtitleSizePt = null
    })
    expect(s.subtitle).toBe(s.title)
    expect(s.warnings).not.toMatch(/stays under the title/)
  })
})

/**
 * The edition line is the subtitle slot, or a label under one.
 *
 * On a cover with no subtitle it *is* the subtitle — the Glossary says
 * "Illustrated" there, the Aura names its volumes — so it takes the banked
 * subtitle size. With a real subtitle beside it, it is the line that says
 * what this printing is, and set at the same size the two read as two
 * subtitles arguing: the editor's words were that a parenthetical would
 * "ruin the whole look of the title".
 */
describe('the edition line knows which job it has', () => {
  const sizeOfEdition = (subtitle: string): number => {
    const doc = cover((d) => {
      d.content.title = 'Keys'
      d.content.subtitle = subtitle
      d.content.edition = 'Annotated'
      d.look.titleCase = 'upper'
      d.look.titleSizePt = 32
      d.look.subtitleSizePt = 16
    })
    const item = composeCover(doc, { measurer }).items.find(
      (i) => i.kind === 'text' && i.text === 'ANNOTATED'
    )
    expect(item?.kind).toBe('text')
    return item?.kind === 'text' ? item.sizePt : 0
  }

  it('takes the subtitle’s own size when it is the subtitle', () => {
    expect(sizeOfEdition('')).toBe(16)
  })

  it('drops to a label where a subtitle is set beside it', () => {
    const label = sizeOfEdition('The Legend of Hiram Abiff')
    expect(label).toBeLessThan(16)
    expect(label).toBeGreaterThanOrEqual(8)
  })

  it('never sets it so small it stops being readable on a board', () => {
    // The floor matters because KDP requires an edition of a public-domain
    // text to say on its cover how it differs from the free copies, and a
    // line nobody can read does not say it.
    const doc = cover((d) => {
      d.content.title = 'Keys'
      d.content.subtitle = 'A Subtitle'
      d.content.edition = 'Annotated'
      d.look.titleCase = 'upper'
      d.look.subtitleSizePt = 10
    })
    const item = composeCover(doc, { measurer }).items.find(
      (i) => i.kind === 'text' && i.text === 'ANNOTATED'
    )
    expect(item?.kind === 'text' && item.sizePt).toBeGreaterThanOrEqual(8)
  })
})
