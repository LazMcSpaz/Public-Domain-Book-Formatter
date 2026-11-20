/**
 * A ground texture from a file (`texture.ts`): reading a spec's `texture`
 * block, and placing the picture by the same rules a built-in figure is placed
 * by. No real picture is used: the composer needs only a source and a size.
 */
import { describe, expect, it } from 'vitest'
import { fixedWidthMeasurer } from '@core/layout'
import {
  alignedOffset,
  applyTexture,
  BANKED_COVER_KEYS,
  composeCover,
  defaultCover,
  emptyContent,
  GROUND_FIGURE_ID,
  MAX_FIGURE_OPACITY,
  readTextureSpec,
  type CoverDocument,
  type CoverImageItem,
  type TextureSpec
} from '@core/cover'

const measurer = fixedWidthMeasurer()
const IMAGE = { src: 'data:,', fileName: 'made-up-plate.png', widthPx: 1800, heightPx: 2700 }

function cover(patch: (doc: CoverDocument) => void = () => {}): CoverDocument {
  const doc = defaultCover('7x10', 320)
  doc.content.title = 'A Made-Up Title'
  doc.content.author = 'A. N. Author'
  doc.look.arrangement = 'label'
  doc.look.frontFrame = 'double'
  patch(doc)
  return doc
}

function spec(raw: Record<string, unknown>): TextureSpec {
  const read = readTextureSpec({ file: 'made-up-plate.png', ...raw })
  expect(read.problems).toEqual([])
  return read.spec!
}

function figureBox(doc: CoverDocument): CoverImageItem | undefined {
  const { items } = composeCover(doc, { measurer })
  return items.find((i) => i.kind === 'image' && i.id === GROUND_FIGURE_ID) as
    CoverImageItem | undefined
}

describe('readTextureSpec', () => {
  it('reads a bare file name with the defaults', () => {
    expect(spec({})).toEqual({
      file: 'made-up-plate.png',
      placement: 'front',
      scale: 1,
      alignX: 0.5,
      alignY: 0.5,
      opacity: null,
      toEdge: false,
      back: false,
      invert: false
    })
  })

  it('takes an SVG, which is what a text ground is made as', () => {
    expect(readTextureSpec({ file: 'text-ground.svg', placement: 'wrap' }).problems).toEqual([])
  })

  it('reads every field a typesetter can set', () => {
    const read = spec({
      placement: 'on-rule',
      scale: 1.4,
      align: { x: 0, y: 1 },
      opacity: 0.06,
      toEdge: true,
      back: true,
      invert: true
    })
    expect(read).toMatchObject({ placement: 'on-rule', scale: 1.4, alignX: 0, alignY: 1 })
    expect(read).toMatchObject({ opacity: 0.06, toEdge: true, back: true, invert: true })
  })

  it('names each fault rather than drawing half a block', () => {
    const faults: [Record<string, unknown>, RegExp][] = [
      [{ file: '' }, /texture\.file must name/],
      [{ file: 'plate.tif' }, /texture\.file must be a png/],
      [{ placement: 'inside' }, /texture\.placement must be one of/],
      [{ scale: 0.5 }, /texture\.scale must be a number of at least 1/],
      [{ scale: 9 }, /texture\.scale may be at most/],
      [{ align: { x: 2 } }, /texture\.align\.x must be/],
      [{ align: 'left' }, /texture\.align must be an object/],
      [{ opacity: 'faint' }, /texture\.opacity must be a number/],
      [{ back: 'yes' }, /texture\.back must be true or false/]
    ]
    for (const [raw, expected] of faults) {
      const read = readTextureSpec({ file: 'made-up-plate.png', ...raw })
      expect(read.spec, JSON.stringify(raw)).toBeNull()
      expect(read.problems.join(' '), JSON.stringify(raw)).toMatch(expected)
    }
    expect(readTextureSpec('plate.png').problems).toEqual(['texture must be an object.'])
  })
})

describe('applyTexture', () => {
  it('is drawn as the ground figure, with no built-in figure named', () => {
    const doc = applyTexture(cover(), spec({}), IMAGE)
    expect(doc.look.groundFigure).toBeNull()
    expect(doc.content.groundTexture?.fileName).toBe('made-up-plate.png')
    expect(figureBox(doc)).toBeDefined()
  })

  it('takes the place of a built-in figure the look had', () => {
    const doc = applyTexture(
      cover((d) => (d.look.groundFigure = 'arcade')),
      spec({}),
      IMAGE
    )
    expect(doc.look.groundFigure).toBeNull()
  })

  // One box for a texture and a built-in figure alike: each placement must put
  // the texture exactly where the same switches put the arcade.
  const placements: [TextureSpec['placement'], (d: CoverDocument) => void][] = [
    ['front', () => {}],
    ['framed', (d) => (d.look.groundFigureInFrame = true)],
    [
      'on-rule',
      (d) => {
        d.look.groundFigureInFrame = true
        d.look.groundFigureOnRule = true
      }
    ],
    ['wrap', (d) => (d.look.groundFigureWrap = true)]
  ]
  for (const [placement, switches] of placements) {
    it(`puts a ${placement} texture in the box a figure gets with the same switches`, () => {
      const textured = figureBox(applyTexture(cover(), spec({ placement }), IMAGE))
      const figured = figureBox(
        cover((d) => {
          d.look.groundFigure = 'arcade'
          switches(d)
        })
      )
      expect(textured).toBeDefined()
      expect(textured).toEqual(figured)
    })
  }

  it('gives the four placements four different boxes', () => {
    const boxes = (['front', 'framed', 'on-rule', 'wrap'] as const).map((placement) =>
      JSON.stringify(figureBox(applyTexture(cover(), spec({ placement }), IMAGE)))
    )
    expect(new Set(boxes).size).toBe(4)
  })

  it("keeps the look's tint unless the spec sets one, and clamps one it sets", () => {
    const base = cover((d) => (d.look.groundFigureOpacity = 0.07))
    expect(applyTexture(base, spec({}), IMAGE).look.groundFigureOpacity).toBe(0.07)
    expect(applyTexture(base, spec({ opacity: 0.06 }), IMAGE).look.groundFigureOpacity).toBe(0.06)
    expect(applyTexture(base, spec({ opacity: 0.9 }), IMAGE).look.groundFigureOpacity).toBe(
      MAX_FIGURE_OPACITY
    )
  })

  it('carries its scale and alignment to the renderer', () => {
    const doc = applyTexture(cover(), spec({ scale: 1.4, align: { x: 0, y: 1 } }), IMAGE)
    expect(doc.content.groundTexture).toMatchObject({ scale: 1.4, alignX: 0, alignY: 1 })
  })

  it('says so when it is asked to stand in a frame the front does not have', () => {
    const doc = applyTexture(
      cover((d) => (d.look.frontFrame = 'none')),
      spec({ placement: 'framed' }),
      IMAGE
    )
    const { warnings } = composeCover(doc, { measurer })
    expect(warnings.join(' ')).toMatch(/made-up-plate\.png was asked to stand inside the frame/)
  })
})

describe('a texture is the book’s, not the collection’s', () => {
  it('lives in the content, which is never banked', () => {
    expect(emptyContent().groundTexture).toBeNull()
    expect(BANKED_COVER_KEYS as readonly string[]).not.toContain('groundTexture')
  })
})

describe('alignedOffset', () => {
  it('puts an overflowing picture at its start, its middle or its end', () => {
    expect(alignedOffset(100, 140, 0)).toBe(-0)
    expect(alignedOffset(100, 140, 0.5)).toBe(-20)
    expect(alignedOffset(100, 140, 1)).toBe(-40)
  })

  it('never aligns past either end', () => {
    expect(alignedOffset(100, 140, -1)).toBe(-0)
    expect(alignedOffset(100, 140, 2)).toBe(-40)
  })
})
