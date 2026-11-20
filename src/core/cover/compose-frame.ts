/**
 * The cover's furniture: fitting a picture to its frame, the front's type
 * area, the frame round the front, the rules, and the blurb's measure.
 *
 * Pure: rectangles in, items out.
 */
import type { OrnamentArt } from '@core/ornament'
import { type CoverDocument, type FrameStyle, type Hex } from './document'
import { pt, type CoverGeometry, type Rect } from './geometry'
import {
  BLURB_MAX_MEASURE_IN,
  BLURB_SIDE_INSET_IN,
  FRAME_CLEARANCE_IN,
  FRAME_DOUBLE_GAP_PT,
  FRAME_DOUBLE_INNER_PT,
  FRAME_DOUBLE_OUTER_PT,
  FRAME_INSET_IN,
  FRAME_PLAIN_PT
} from './compose-constants'
import { type CoverItem, type CoverRuleItem, type FillItem } from './compose-items'

/**
 * Fit a picture into a frame, in the printer's sense rather than the browser's.
 *
 * `cover` returns the source rectangle that fills the frame without distorting
 * it — a centred crop. `contain` shrinks the frame to the picture's proportions
 * instead, so nothing is cut and nothing is stretched. Neither ever changes the
 * aspect ratio: a squashed engraving is the tell of a machine-made cover.
 */
export function fitArt(
  frame: Rect,
  sourceWidthPx: number,
  sourceHeightPx: number,
  mode: 'cover' | 'contain'
): { dest: Rect; srcX: number; srcY: number; srcWidth: number; srcHeight: number } | null {
  if (sourceWidthPx <= 0 || sourceHeightPx <= 0 || frame.width <= 0 || frame.height <= 0) {
    return null
  }
  const frameRatio = frame.width / frame.height
  const artRatio = sourceWidthPx / sourceHeightPx

  if (mode === 'contain') {
    const dest =
      artRatio > frameRatio
        ? {
            x: frame.x,
            y: frame.y + (frame.height - frame.width / artRatio) / 2,
            width: frame.width,
            height: frame.width / artRatio
          }
        : {
            x: frame.x + (frame.width - frame.height * artRatio) / 2,
            y: frame.y,
            width: frame.height * artRatio,
            height: frame.height
          }
    return { dest, srcX: 0, srcY: 0, srcWidth: sourceWidthPx, srcHeight: sourceHeightPx }
  }

  // Cover: keep the frame, take the biggest centred crop with the frame's ratio.
  if (artRatio > frameRatio) {
    const srcWidth = sourceHeightPx * frameRatio
    return {
      dest: { ...frame },
      srcX: (sourceWidthPx - srcWidth) / 2,
      srcY: 0,
      srcWidth,
      srcHeight: sourceHeightPx
    }
  }
  const srcHeight = sourceWidthPx / frameRatio
  return {
    dest: { ...frame },
    srcX: 0,
    srcY: (sourceHeightPx - srcHeight) / 2,
    srcWidth: sourceWidthPx,
    srcHeight
  }
}

/**
 * The area of the front panel type may occupy.
 *
 * The safe area, unless a frame is struck — in which case it is whatever the
 * frame leaves, because the safe area lies *outside* the frame and setting to
 * it would run a centred line of any length through the border.
 */
export function frontTypeArea(geometry: CoverGeometry, frame: FrameStyle): Rect {
  if (frame === 'none') return geometry.frontSafe
  const inset = FRAME_INSET_IN + FRAME_CLEARANCE_IN
  const panel = geometry.front
  return {
    x: panel.x + inset,
    y: panel.y + inset,
    width: panel.width - inset * 2,
    height: panel.height - inset * 2
  }
}

/** Four fills making the outline of a rectangle, drawn inside its own edge. */
export function strokeRect(
  items: CoverItem[],
  x: number,
  y: number,
  width: number,
  height: number,
  thickness: number,
  color: Hex
): void {
  if (width <= thickness * 2 || height <= thickness * 2) return
  const bar = (bx: number, by: number, bw: number, bh: number): FillItem => ({
    kind: 'fill',
    xPt: bx,
    yPt: by,
    widthPt: bw,
    heightPt: bh,
    color
  })
  // Sides drawn between the two horizontals rather than corner to corner: at
  // this thickness an overlapped corner is invisible, and a butted one stays
  // right if the frame is ever drawn at partial opacity.
  items.push(bar(x, y, width, thickness))
  items.push(bar(x, y + height - thickness, width, thickness))
  items.push(bar(x, y + thickness, thickness, height - thickness * 2))
  items.push(bar(x + width - thickness, y + thickness, thickness, height - thickness * 2))
}

/**
 * The frame round the front cover, in the accent colour.
 *
 * Drawn after the picture so it sits on top of a bled one, and before the
 * type, which it must never touch — `frontTypeArea` is what keeps them apart.
 */
/**
 * A frame of the given style, in points, round a box given in points.
 *
 * One implementation for both frames this cover can carry. The double rule's
 * arithmetic is the whole of it, and a second copy of that arithmetic is a
 * second frame that comes to look slightly unlike the first.
 */
export function drawFrame(
  items: CoverItem[],
  style: FrameStyle,
  x: number,
  y: number,
  width: number,
  height: number,
  color: Hex
): void {
  if (style === 'none') return
  if (style === 'plain') {
    strokeRect(items, x, y, width, height, FRAME_PLAIN_PT, color)
    return
  }
  strokeRect(items, x, y, width, height, FRAME_DOUBLE_OUTER_PT, color)
  const step = FRAME_DOUBLE_OUTER_PT + FRAME_DOUBLE_GAP_PT
  strokeRect(
    items,
    x + step,
    y + step,
    width - step * 2,
    height - step * 2,
    FRAME_DOUBLE_INNER_PT,
    color
  )
}

/**
 * How far in from its outer edge a frame's innermost line ends, in inches.
 *
 * The plain frame is one line; the double frame is its outer line, the gap and
 * the inner line. Read off the same constants `drawFrame` strikes with, so a
 * box set to it starts exactly where the ink stops.
 */
export function frameStrokeIn(style: FrameStyle): number {
  if (style === 'none') return 0
  if (style === 'plain') return FRAME_PLAIN_PT / 72
  return (FRAME_DOUBLE_OUTER_PT + FRAME_DOUBLE_GAP_PT + FRAME_DOUBLE_INNER_PT) / 72
}

export function drawFrontFrame(
  items: CoverItem[],
  geometry: CoverGeometry,
  style: FrameStyle,
  color: Hex
): void {
  const panel = geometry.front
  drawFrame(
    items,
    style,
    pt(panel.x + FRAME_INSET_IN),
    pt(panel.y + FRAME_INSET_IN),
    pt(panel.width - FRAME_INSET_IN * 2),
    pt(panel.height - FRAME_INSET_IN * 2),
    color
  )
}

export function ruleItem(
  x: number,
  y: number,
  width: number,
  color: Hex,
  thickness = 0.75
): CoverRuleItem {
  return { kind: 'rule', xPt: x, yPt: y, widthPt: width, thicknessPt: thickness, color }
}

export function drawRule(
  items: CoverItem[],
  style: CoverDocument['look']['rule'],
  panel: Rect,
  yPt: number,
  widthIn: number,
  color: Hex,
  ornament: OrnamentArt | null
): number {
  if (style === 'none') return yPt
  const width = pt(widthIn)
  const x = pt(panel.x + panel.width / 2) - width / 2
  if (style === 'ornamented' && ornament) {
    const scale = pt(widthIn * 0.5) / ornament.width
    items.push({
      kind: 'ornament',
      xPt: pt(panel.x + panel.width / 2) - (ornament.width * scale) / 2,
      yPt,
      scale,
      art: ornament,
      color
    })
    return yPt + ornament.height * scale
  }
  items.push(ruleItem(x, yPt, width, color))
  if (style === 'double') {
    items.push(ruleItem(x, yPt + 3, width, color))
    return yPt + 3.75
  }
  return yPt + 0.75
}

/** The measure available for back-cover copy, stopping short of the barcode. */
export function blurbFrame(geometry: CoverGeometry): Rect {
  // Started a little down the panel rather than hard against the top safe line.
  // Back-cover copy set at the very top of the panel reads as a caption that
  // slid; every printed book puts it in the upper middle.
  const inset = geometry.backSafe.height * 0.12

  // In from both trimmed edges by the inset, then narrowed further and centred
  // if that still leaves too long a line to read.
  const available = Math.max(0, geometry.back.width - BLURB_SIDE_INSET_IN * 2)
  const width = Math.min(available, BLURB_MAX_MEASURE_IN)
  const x = geometry.back.x + (geometry.back.width - width) / 2

  const safe = {
    x,
    width,
    y: geometry.backSafe.y + inset,
    height: geometry.backSafe.height - inset
  }
  // The barcode sits in the bottom corner; the copy simply ends above it rather
  // than flowing around it. Wrapping text around a rectangle KDP will paste
  // over is fiddly and looks, on the printed book, like a mistake.
  const bottomLimit = geometry.barcode.y - 0.25
  return { ...safe, height: Math.max(0, Math.min(safe.y + safe.height, bottomLimit) - safe.y) }
}
