/**
 * The front cover on its own — the picture of a book, rather than the sheet it
 * prints on.
 *
 * A cover is one flat sheet: back, spine, front, plus the bleed the printer
 * trims off. That is the right shape for KDP and the wrong shape for every
 * other use of a cover, because a person looking at a shelf recognises the
 * *front*, trimmed, the way it looks in a hand. The app itself needs that
 * picture — a book on the shelf with no cover beside it is a filename — and so
 * does anywhere a book is listed.
 *
 * Nothing is composed differently for it. The cover is composed once, written
 * once, and the front panel is cut out of the rendered sheet: one composer and
 * one renderer, which is the rule the design gate and the cover studio both
 * run on. An icon is therefore a *view* of the deliverable, and cannot show a
 * front cover the PDF does not contain.
 *
 * Two things this module exists to get right, both of them arithmetic and so
 * both of them tested without a browser:
 *
 * - **Cut at the trim, not at the bleed.** The eighth of an inch outside the
 *   trim is thrown away by the printer. An icon that included it would show a
 *   band of artwork down one side that no reader will ever see, and would be
 *   the wrong proportion — so a cover judged by its icon would be judged
 *   against something that is not the book.
 * - **Say what resolution it is.** An icon is a screen object and its DPI
 *   across the printed front is usually far below print standard. That is
 *   fine, and it is reported rather than rounded up to look respectable: the
 *   number is what stops an icon being handed to a printer by mistake.
 */
import { PT_PER_INCH, type CoverGeometry } from './geometry'

/**
 * Narrower than this and the type on a front cover is not resolved at all, so
 * the picture stops being evidence of anything.
 */
export const MIN_ICON_WIDTH_PX = 64

/**
 * A ceiling, because the rasteriser allocates this canvas and a mistyped width
 * is a dead tab rather than an error. 2400 across a 6-inch front is 400 DPI —
 * past anything an icon needs, and past print standard, so nothing legitimate
 * is being refused.
 */
export const MAX_ICON_WIDTH_PX = 2400

/** What the studio renders when nobody has asked for a size. */
export const DEFAULT_ICON_WIDTH_PX = 1000

export interface FrontIconPlan {
  /**
   * Pixels per point to rasterise the sheet at. The rasteriser renders *only*
   * the crop at this scale rather than the whole sheet, so a large icon of a
   * long book does not allocate the back cover as well.
   */
  scale: number
  /** The front panel's top-left corner, in points from the sheet's top-left. */
  xPt: number
  yPt: number
  widthPx: number
  heightPx: number
  /**
   * What the icon works out to across the printed front cover. Reported, never
   * enforced: an icon is not a cover file and this number is how a reader of
   * the code, or of the UI, can tell the two apart.
   */
  dpi: number
}

/**
 * Where to cut, how big, and at what scale.
 *
 * `widthPx` is a request rather than a promise — it is clamped, and the height
 * follows from the panel's own proportions so an icon is never stretched. The
 * scale is derived from the width that survived the clamp, so the crop and the
 * canvas cannot disagree by a pixel.
 */
export function frontIconPlan(geometry: CoverGeometry, widthPx: number): FrontIconPlan {
  const requested = Number.isFinite(widthPx) ? Math.round(widthPx) : DEFAULT_ICON_WIDTH_PX
  const width = Math.min(MAX_ICON_WIDTH_PX, Math.max(MIN_ICON_WIDTH_PX, requested))

  const front = geometry.front
  const widthPt = front.width * PT_PER_INCH
  const heightPt = front.height * PT_PER_INCH
  const scale = width / widthPt

  return {
    scale,
    xPt: front.x * PT_PER_INCH,
    yPt: front.y * PT_PER_INCH,
    widthPx: width,
    // At least one pixel: a trim height of zero is not reachable through the
    // interview, and a zero-height canvas throws rather than returning a
    // picture of nothing.
    heightPx: Math.max(1, Math.round(heightPt * scale)),
    dpi: width / front.width
  }
}
