/**
 * The front cover: the picture, the frame, the band, the device, and the
 * type block.
 *
 * Pure: items out.
 */
import type { TextMeasurer } from '@core/layout'
import type { OrnamentArt } from '@core/ornament'
import { type CoverDocument } from './document'
import { pt, type CoverGeometry, type Rect } from './geometry'
import {
  FRONT_MARK_FRACTION,
  FRONT_MARK_ID,
  FRONT_MARK_MAX_HEIGHT_SHARE,
  FRONT_MARK_MAX_IN
} from './compose-constants'
import { drawFrontFrame, fitArt, frontTypeArea, ruleItem } from './compose-frame'
import { type CoverItem, type PlacedArt } from './compose-items'
import { applyCase, centeredLines, face } from './compose-text'

import { layFrontType } from './compose-front-type'
export function layFrontCover(
  items: CoverItem[],
  warnings: string[],
  geometry: CoverGeometry,
  doc: CoverDocument,
  arrangement: CoverDocument['look']['arrangement'],
  ornament: OrnamentArt | null,
  measurer: TextMeasurer,
  art: { id: string; widthPx: number; heightPx: number } | null
): PlacedArt | null {
  const { look, content } = doc
  const palette = look.palette
  // Not `geometry.frontSafe`: a frame is struck inside the safe line, so where
  // type may go is whatever the frame leaves. Unframed the two are the same.
  const safe = frontTypeArea(geometry, look.frontFrame)
  const panel = geometry.front
  const smallCaps = look.titleCase === 'small-caps' && measurer.hasSmallCaps(look.titleFont)
  if (look.titleCase === 'small-caps' && !smallCaps) {
    warnings.push(
      `${look.titleFont} has no real small capitals, so the title was set in full capitals rather than scaled-down ones.`
    )
  }
  const titleFont = face(look.titleFont, 'regular', smallCaps)
  const authorFont = face(look.authorFont)
  // A face without real small capitals sets them as full capitals — the same
  // choice the interior's headings make. Scaling capitals down is the forgery
  // this codebase refuses everywhere else, and it would be no less a forgery
  // six inches high on a cover.
  const titleText = smallCaps
    ? content.title
    : applyCase(content.title, look.titleCase === 'small-caps' ? 'upper' : look.titleCase)

  // Where the type sits, and how much of the panel the picture may have.
  const overArt = arrangement === 'full-bleed' || arrangement === 'banded'
  const inkColor = overArt ? palette.overArt : palette.ink

  let placed: PlacedArt | null = null

  // --- the picture ------------------------------------------------------
  if (art) {
    let frame: Rect
    if (arrangement === 'full-bleed') {
      // Out to the sheet's edge on three sides; the fold is the fourth.
      frame = {
        x: panel.x,
        y: 0,
        width: geometry.fullWidthIn - panel.x,
        height: geometry.fullHeightIn
      }
    } else if (arrangement === 'banded') {
      // The art takes the whole panel; the band is drawn over it below.
      frame = {
        x: panel.x,
        y: 0,
        width: geometry.fullWidthIn - panel.x,
        height: geometry.fullHeightIn
      }
    } else if (arrangement === 'plate-window') {
      frame = {
        x: safe.x,
        y: safe.y + safe.height * 0.26,
        width: safe.width,
        height: safe.height * 0.46
      }
    } else {
      // classic-centered: the lower half, below the type.
      frame = {
        x: safe.x,
        y: safe.y + safe.height * 0.44,
        width: safe.width,
        height: safe.height * 0.5
      }
    }

    const fitted = fitArt(frame, art.widthPx, art.heightPx, content.art.fit)
    if (fitted) {
      items.push({
        kind: 'image',
        id: art.id,
        xPt: pt(fitted.dest.x),
        yPt: pt(fitted.dest.y),
        widthPt: pt(fitted.dest.width),
        heightPt: pt(fitted.dest.height),
        srcX: fitted.srcX,
        srcY: fitted.srcY,
        srcWidth: fitted.srcWidth,
        srcHeight: fitted.srcHeight
      })
      placed = {
        id: art.id,
        rect: fitted.dest,
        usedWidthPx: fitted.srcWidth,
        usedHeightPx: fitted.srcHeight
      }
      if (arrangement === 'plate-window') {
        const border = fitted.dest
        items.push(ruleItem(pt(border.x), pt(border.y) - 4, pt(border.width), palette.accent))
        items.push(
          ruleItem(pt(border.x), pt(border.y + border.height) + 4, pt(border.width), palette.accent)
        )
      }
    }
  }

  // --- the frame ---------------------------------------------------------
  //
  // After the picture, so a bled plate is framed rather than covering the
  // border, and before the type, which `frontTypeArea` has already kept clear
  // of it.
  drawFrontFrame(items, geometry, look.frontFrame, palette.accent)

  // --- the band, over the art -------------------------------------------
  let typeTop = pt(safe.y)
  let typeBox = { widthPt: pt(safe.width), heightPt: pt(safe.height) }

  if (arrangement === 'banded') {
    const bandHeightIn = panel.height * 0.34
    items.push({
      kind: 'fill',
      xPt: pt(panel.x),
      yPt: 0,
      widthPt: pt(geometry.fullWidthIn - panel.x),
      heightPt: pt(bandHeightIn + geometry.bleedIn),
      color: palette.accent
    })
    typeTop = pt(geometry.bleedIn + 0.3)
    typeBox = { widthPt: pt(safe.width), heightPt: pt(bandHeightIn - 0.4) }
  } else if (arrangement === 'full-bleed') {
    // A scrim, so the title is legible over whatever the picture is doing
    // there. Held to the type's own block rather than the whole cover: a
    // full-cover wash is how a good picture is turned into a grey one.
    const scrimTop = geometry.fullHeightIn * 0.58
    items.push({
      kind: 'fill',
      xPt: pt(panel.x),
      yPt: pt(scrimTop),
      widthPt: pt(geometry.fullWidthIn - panel.x),
      heightPt: pt(geometry.fullHeightIn - scrimTop),
      color: palette.ink,
      opacity: 0.55
    })
    typeTop = pt(scrimTop + 0.35)
    typeBox = { widthPt: pt(safe.width), heightPt: pt(geometry.fullHeightIn - scrimTop - 0.7) }
  } else if (arrangement === 'plate-window') {
    typeBox = { widthPt: pt(safe.width), heightPt: pt(safe.height * 0.22) }
  } else if (arrangement === 'classic-centered') {
    typeBox = { widthPt: pt(safe.width), heightPt: pt(safe.height * 0.38) }
  } else if (arrangement === 'label') {
    // A label sits near the head and holds everything: the empty board below
    // it is the design, so the block must not drift down into it. Started a
    // little below the safe line rather than on it, because type hard against
    // a frame reads as having been pushed there.
    typeTop = pt(safe.y + safe.height * 0.06)
    typeBox = { widthPt: pt(safe.width), heightPt: pt(safe.height * 0.34) }
  } else {
    // Typographic. With no picture to balance against, type starting at the top
    // safe line reads as a page that lost its illustration. The old jobbing
    // printers put the title in the upper third and the imprint at the foot,
    // and the space between them is the design — so the block starts down the
    // panel and the author goes to the foot below.
    typeTop = pt(safe.y + safe.height * 0.16)
    typeBox = { widthPt: pt(safe.width), heightPt: pt(safe.height * 0.5) }
  }

  let y = typeTop

  // --- the device, over the type ------------------------------------------
  //
  // Placed before anything else and charged against the type's own height
  // budget, so the title is fitted to the space that is actually left rather
  // than to the space there would have been without it.
  // The book's own emblem where it has one, and the printer's mark otherwise:
  // a publisher with one device still gets it on the board by setting nothing.
  const frontDevice = look.frontMark ?? look.pressMark
  if (look.markOnFront && frontDevice) {
    const mark = frontDevice
    const wantedWidthIn = Math.min(safe.width * FRONT_MARK_FRACTION, FRONT_MARK_MAX_IN)
    // The width was capped and the height never was, so a tall device scaled
    // off the board: at six to one on a 6 x 9 the artwork alone is 6.6 in on a
    // 7.5 in safe area, and everything under it sets past the trim. The cap is
    // on the device's *height* as a share of the safe area, with the width
    // taken back in proportion so the artwork is never squashed to fit.
    const wantedHeightIn = wantedWidthIn * (mark.heightPx / mark.widthPx)
    const maxHeightIn = safe.height * FRONT_MARK_MAX_HEIGHT_SHARE
    const scale = wantedHeightIn > maxHeightIn ? maxHeightIn / wantedHeightIn : 1
    if (scale < 1) {
      warnings.push(
        `The device on the front is ${wantedHeightIn.toFixed(2)} in deep for its width, ` +
          `which is more board than a device may have, so it was set at ` +
          `${(wantedWidthIn * scale).toFixed(2)} in wide.`
      )
    }
    const widthIn = wantedWidthIn * scale
    const heightIn = wantedHeightIn * scale
    items.push({
      kind: 'image',
      id: FRONT_MARK_ID,
      xPt: pt(panel.x + panel.width / 2) - pt(widthIn) / 2,
      yPt: y,
      widthPt: pt(widthIn),
      heightPt: pt(heightIn),
      srcX: 0,
      srcY: 0,
      srcWidth: mark.widthPx,
      srcHeight: mark.heightPx
    })
    const consumed = pt(heightIn) + pt(widthIn) * 0.32
    y += consumed
    // The device moves the type down; it does not eat the title.
    //
    // It used to be charged against the height budget, on the reasoning that a
    // title should be fitted to the space actually left. The consequence was
    // not what anybody chose: the `label` box is a third of the panel, a
    // device is an inch and a third of it, and *The Theosophical Glossary*
    // came out with an 18 pt title where the same cover without a device
    // fits 42. Measured beside its neighbours the effect was plain — the
    // author, pinned at 26, printed half again as large as the title above it.
    //
    // That is this file's own lesson about the author's size, in the other
    // direction: check what a size is a share *of*. The box was sized without
    // a device in mind, so charging one against it takes the title's space
    // rather than the slack there never was. The budget is kept and the block
    // starts lower, clamped so it still ends inside the safe area — and the
    // clamp reports, because a title quietly refitted is the failure mode.
    const roomBelow = pt(safe.y + safe.height) - y
    const kept = Math.min(typeBox.heightPt, Math.max(0, roomBelow))
    if (kept < typeBox.heightPt) {
      warnings.push(
        'The device over the title leaves less room than the arrangement asks for, ' +
          'so the title was fitted to what is left.'
      )
    }
    typeBox = { widthPt: typeBox.widthPt, heightPt: kept }
  }

  // --- series line -------------------------------------------------------
  if (content.series.trim()) {
    const size = Math.max(9, Math.min(16, typeBox.widthPt * 0.035))
    y = centeredLines(
      items,
      [content.series.toUpperCase()],
      geometry.front,
      y,
      face(look.bodyFont, 'regular', measurer.hasSmallCaps(look.bodyFont)),
      size,
      overArt ? palette.overArt : palette.accent,
      measurer
    )
    y += size * 0.9
  }

  layFrontType(
    {
      items,
      warnings,
      geometry,
      doc,
      arrangement,
      ornament,
      measurer,
      safe,
      panel,
      typeBox,
      titleFont,
      authorFont,
      smallCaps,
      titleText,
      overArt,
      inkColor
    },
    y
  )

  return placed
}
