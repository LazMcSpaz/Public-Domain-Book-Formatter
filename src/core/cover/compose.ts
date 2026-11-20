/**
 * A cover document, laid out onto the flat sheet.
 *
 * The counterpart of `@core/layout`'s `layout()`, and built to the same
 * contract: a **pure function of its inputs** that returns absolute positions
 * and nothing needing interpretation. Given a font table you can draw what
 * comes out of here, measure it, or diff two of them.
 *
 * Everything is in points with the origin at the top-left of the whole sheet,
 * bleed included, y running downward — the convention the layout engine uses
 * for pages, so `cover-pdf` flips the origin in exactly the way `pdf-out`
 * already does and the two writers stay recognisably the same code.
 *
 * ## Why arrangements rather than a canvas
 *
 * Free placement would make every cover a fresh act of design and make a
 * *collection* — the thing this arm exists for — a matter of remembering what
 * you did last time. An arrangement is a tradition with the sizes derived from
 * the trim, so the same look applied to a 5×8 and a 7×10 is the same look
 * rather than the same numbers.
 *
 * ## Nothing is drawn into the barcode
 *
 * `geometry.barcode` is a hole in the back cover. The blurb's measure stops
 * above it, and the validator warns if anything else lands in it. KDP prints
 * over that rectangle no matter what is under it.
 *
 * Pure: no DOM, no I/O. Text is measured through the injected `TextMeasurer`,
 * which in the browser is the same fontkit call pdf-lib makes to encode text.
 */
import type { TextMeasurer } from '@core/layout'
import { sizeAfterOps } from '@core/image'
import { type CoverDocument } from './document'
import { GROUND_IMAGE_ID, groundPattern, isImageGround, patternOpacity } from './patterns'
import {
  backFigureFramePt,
  figureFramePt,
  framedFigureFrame,
  wrapFigureFramePt,
  figureOpacity,
  GROUND_FIGURE_BACK_ID,
  GROUND_FIGURE_ID
} from './figures'
import { contains, coverGeometry, overlaps, pt, type Rect } from './geometry'
import { layBackCover, laySpine } from './compose-back'
import { layBarcode } from './compose-barcode'
import { FRAME_CLEARANCE_IN, FRAME_INSET_IN } from './compose-constants'
import { layFrontCover } from './compose-front'
import { type ComposeOptions, type ComposedCover, type CoverItem } from './compose-items'
export {
  BARCODE_ID,
  BLURB_PT,
  EDITION_DROP,
  FRAME_CLEARANCE_IN,
  FRAME_INSET_IN,
  FRONT_MARK_ID,
  MIN_MARK_WIDTH_IN,
  PRESS_MARK_ID
} from './compose-constants'
export { blurbFrame, fitArt, frontTypeArea } from './compose-frame'
export {
  type ComposeOptions,
  type ComposedCover,
  type CoverImageItem,
  type CoverItem,
  type CoverOrnamentItem,
  type CoverRuleItem,
  type CoverTextItem,
  type FillItem,
  type PlacedArt
} from './compose-items'
export {
  type StyledRun,
  fitText,
  fitTitlesTogether,
  flattened,
  stackedLines,
  wrapMarkup,
  wrapText
} from './compose-text'

export function composeCover(doc: CoverDocument, options: ComposeOptions): ComposedCover {
  const { measurer } = options
  const geometry = coverGeometry({
    trimSize: doc.trimSize,
    pageCount: doc.pageCount,
    paper: doc.paper,
    binding: doc.binding
  })
  const items: CoverItem[] = []
  const warnings: string[] = []
  const { look, content } = doc
  const palette = look.palette
  const ornament =
    (look.ornamentId && options.ornaments?.find((o) => o.id === look.ornamentId)) || null
  if (look.ornamentId && !ornament) {
    warnings.push(`The ornament "${look.ornamentId}" is not in the library; none was drawn.`)
  }

  // The ground, over the whole sheet including bleed. Anything short of the
  // bleed leaves a white sliver at the trim, which is the commonest way a
  // first cover comes back wrong.
  items.push({
    kind: 'fill',
    xPt: 0,
    yPt: 0,
    widthPt: pt(geometry.fullWidthIn),
    heightPt: pt(geometry.fullHeightIn),
    color: palette.ground
  })

  // The ground pattern, over the whole sheet and under everything else.
  //
  // Placed here — after the ground colour and before any panel — so it runs
  // across the back, the spine and the front as one field. That is the point of
  // it: an allover texture has no alignment to notice, which is what makes it
  // survive a fold that creeps by an eighth of an inch.
  if (look.groundPattern && isImageGround(look.groundPattern)) {
    // Out to every edge, so the trim cuts through the texture rather than
    // past it — and across the fold, because an allover ground has no
    // alignment to misregister.
    items.push({
      kind: 'image',
      id: GROUND_IMAGE_ID,
      xPt: 0,
      yPt: 0,
      widthPt: pt(geometry.fullWidthIn),
      heightPt: pt(geometry.fullHeightIn),
      srcX: 0,
      srcY: 0,
      // Filled in by the renderer once it knows what it rendered; the composer
      // cannot know a vector source's pixel count because it does not have one.
      srcWidth: 0,
      srcHeight: 0,
      opacity: patternOpacity(look.groundPattern, look.groundPatternOpacity)
    })
  } else if (look.groundPattern) {
    const placements = groundPattern(
      look.groundPattern,
      pt(geometry.fullWidthIn),
      pt(geometry.fullHeightIn),
      ornament ?? options.ornaments?.[0] ?? null
    )
    if (placements.length === 0) {
      warnings.push('The fleuron ground needs an ornament to repeat, and none was chosen.')
    }
    for (const place of placements) {
      items.push({
        kind: 'ornament',
        xPt: place.xPt,
        yPt: place.yPt,
        scale: place.scale,
        art: place.art,
        color: palette.ink,
        opacity: patternOpacity(look.groundPattern, look.groundPatternOpacity)
      })
    }
  }

  // The ground figure, over the front panel and under everything on it.
  //
  // After the pattern, because a book that has both wants the figure in front
  // of the texture rather than behind it, and before every panel, because
  // nothing on the front should have to compete with a ground for the eye.
  // Its pixels are the renderer's: a vector source has no pixel count until
  // something has drawn it, which is the same bargain the picture-backed
  // pattern strikes two blocks up.
  if (look.groundFigure) {
    // Three placements, and they are different objects rather than three
    // sizes of one. A wrap runs the whole sheet; a bled figure runs the front
    // panel off three edges; a framed one is a plate standing inside the
    // border, which is what a picture with its own architecture wants.
    const framed = framedFigureFrame(geometry, FRAME_INSET_IN, FRAME_CLEARANCE_IN)
    const frame = look.groundFigureWrap
      ? wrapFigureFramePt(geometry)
      : look.groundFigureInFrame && look.frontFrame !== 'none'
        ? {
            xPt: pt(framed.x),
            yPt: pt(framed.y),
            widthPt: pt(framed.width),
            heightPt: pt(framed.height)
          }
        : figureFramePt(geometry)
    items.push({
      kind: 'image',
      id: GROUND_FIGURE_ID,
      xPt: frame.xPt,
      yPt: frame.yPt,
      widthPt: frame.widthPt,
      heightPt: frame.heightPt,
      srcX: 0,
      srcY: 0,
      srcWidth: 0,
      srcHeight: 0,
      opacity: figureOpacity(look.groundFigureOpacity)
    })

    // And its companion on the back and the spine, at the same tint, fading
    // out before the fold. Placed in its own item rather than as one picture
    // across the wrap: two boxes that never touch cannot misregister, and one
    // that spans the fold always can.
    // No companion when the picture already runs the width of the sheet:
    // there is nothing left on the back for it to sit on.
    if (look.groundFigureBack && !look.groundFigureWrap) {
      const back = backFigureFramePt(geometry)
      items.push({
        kind: 'image',
        id: GROUND_FIGURE_BACK_ID,
        xPt: back.xPt,
        yPt: back.yPt,
        widthPt: back.widthPt,
        heightPt: back.heightPt,
        srcX: 0,
        srcY: 0,
        srcWidth: 0,
        srcHeight: 0,
        opacity: figureOpacity(look.groundFigureOpacity)
      })
    }
  }

  // Art dimensions after retouching — the op stack can crop, and the DPI check
  // must divide the pixels that survive, not the ones that arrived.
  const art = content.art
  const sized =
    art.id && art.sourceWidthPx > 0
      ? sizeAfterOps(art.sourceWidthPx, art.sourceHeightPx, art.ops)
      : { width: 0, height: 0 }
  const hasArt = Boolean(art.id) && sized.width > 0 && sized.height > 0

  let arrangement = look.arrangement
  if (!hasArt && arrangement !== 'typographic' && arrangement !== 'label') {
    warnings.push(
      `The "${arrangement}" arrangement wants a picture and none is chosen; the front was set typographically instead.`
    )
    arrangement = 'typographic'
  }

  const placedArt = layFrontCover(
    items,
    warnings,
    geometry,
    doc,
    arrangement,
    ornament,
    measurer,
    hasArt ? { id: art.id as string, widthPx: sized.width, heightPx: sized.height } : null
  )

  layBackCover(items, warnings, geometry, doc, ornament, measurer)
  laySpine(items, warnings, geometry, doc, measurer)
  layBarcode(items, warnings, geometry, doc, measurer)

  return { geometry, items, placedArt, warnings }
}

/** Every rectangle an item occupies, in inches — what the validator inspects. */
export function itemBounds(item: CoverItem): Rect | null {
  switch (item.kind) {
    case 'fill':
    case 'image':
      return {
        x: item.xPt / 72,
        y: item.yPt / 72,
        width: item.widthPt / 72,
        height: item.heightPt / 72
      }
    case 'rule':
      return {
        x: item.xPt / 72,
        y: item.yPt / 72,
        width: item.widthPt / 72,
        height: item.thicknessPt / 72
      }
    case 'ornament':
      return {
        x: item.xPt / 72,
        y: item.yPt / 72,
        width: (item.art.width * item.scale) / 72,
        height: (item.art.height * item.scale) / 72
      }
    case 'text': {
      // The ink box the composer measured, not a fraction of the point size.
      const lengthIn = item.widthPt / 72
      const ascentIn = item.ascentPt / 72
      const descentIn = item.descentPt / 72
      if (item.rotate === -90) {
        // Turned a quarter clockwise, the run advances downward and the
        // ascender leans toward the front cover.
        return {
          x: item.xPt / 72 - descentIn,
          y: item.yPt / 72,
          width: ascentIn + descentIn,
          height: lengthIn
        }
      }
      return {
        x: item.xPt / 72,
        y: item.yPt / 72 - ascentIn,
        width: lengthIn,
        height: ascentIn + descentIn
      }
    }
  }
}

export { contains, overlaps }

/**
 * Where a picture *would* print on this cover, before there is one.
 *
 * The studio has to say "this needs 1800 × 2700 pixels" while the user is
 * choosing a model, which is before any art exists to measure. Composing with a
 * stand-in of a known size and reading back the rectangle answers that with the
 * real arrangement rather than a second copy of its geometry — so a change to
 * how `plate-window` sizes its window cannot leave this advice behind.
 *
 * Returns null for an arrangement that has no picture in it.
 */
export function artFrame(doc: CoverDocument, measurer: TextMeasurer): Rect | null {
  if (doc.look.arrangement === 'typographic') return null
  const probe: CoverDocument = {
    ...doc,
    content: {
      ...doc.content,
      art: {
        id: '__probe__',
        // A 2:3 stand-in: `cover` fit keeps the frame whatever the proportions,
        // and `contain` needs *some* ratio to letterbox against. Portrait is
        // the right guess for a cover, and the caller is told the frame, not
        // the picture.
        sourceWidthPx: 2000,
        sourceHeightPx: 3000,
        provenance: null,
        ops: [],
        fit: 'cover'
      }
    }
  }
  return composeCover(probe, { measurer }).placedArt?.rect ?? null
}
