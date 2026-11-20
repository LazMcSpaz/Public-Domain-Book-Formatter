/**
 * The back cover and the spine.
 *
 * Pure: items out.
 */
import type { FontRef, TextMeasurer } from '@core/layout'
import { typographicQuotes } from '@core/layout'
import type { OrnamentArt } from '@core/ornament'
import { type CoverDocument } from './document'
import {
  MIN_PAGES_FOR_SPINE_TEXT,
  PAPER_CALIPER_IN,
  pt,
  SAFE_MARGIN_IN,
  SPINE_TEXT_CLEARANCE_IN,
  spineWidth,
  type CoverGeometry
} from './geometry'
import {
  BLURB_FRAME_PAD_IN,
  BLURB_PT,
  IMPRINT_PT,
  MIN_MARK_WIDTH_IN,
  PRESS_MARK_ID,
  SPINE_FOLD_MARGIN,
  SPINE_MAX_PT
} from './compose-constants'
import { blurbFrame, drawFrame } from './compose-frame'
import { type CoverItem } from './compose-items'
import { face, flattened, wrapMarkup } from './compose-text'

export function layBackCover(
  items: CoverItem[],
  warnings: string[],
  geometry: CoverGeometry,
  doc: CoverDocument,
  ornament: OrnamentArt | null,
  measurer: TextMeasurer
): void {
  const { look, content } = doc
  const frame = blurbFrame(geometry)
  const bodyFont = face(look.bodyFont)
  const palette = look.palette

  let y = pt(frame.y)

  if (ornament && look.rule !== 'none') {
    const widthIn = Math.min(frame.width * 0.35, 1.6)
    const scale = pt(widthIn) / ornament.width
    items.push({
      kind: 'ornament',
      xPt: pt(frame.x + frame.width / 2) - (ornament.width * scale) / 2,
      yPt: y,
      scale,
      art: ornament,
      color: palette.accent
    })
    y += ornament.height * scale + 14
  }

  // A cover is new matter entirely — nothing on it is being reproduced from a
  // page — so there is no faithfulness argument for keeping a typewriter mark,
  // and no switch. The function is the interior's own, so the quotes on the
  // board and the quotes inside the book cannot come out differently.
  const paragraphs = typographicQuotes(content.blurb)
    .split(/\n{2,}/)
    .filter((p) => p.trim().length > 0)
  const hasBold = measurer.hasBold(look.bodyFont)
  const blurbFont = (style: 'regular' | 'italic' | 'bold'): FontRef =>
    face(look.bodyFont, style === 'bold' && !hasBold ? 'italic' : style)
  const sizePt = look.blurbSizePt ?? BLURB_PT
  // One set of metrics for every line, taken from the body face: an italic
  // phrase must not shift the line it sits in off the others.
  const metrics = measurer.metrics(bodyFont, sizePt)
  const bottom = pt(frame.y + frame.height)
  const copyTop = y
  let copyBottom = y
  let overflowed = false
  for (const paragraph of paragraphs) {
    const lines = wrapMarkup(paragraph.trim(), pt(frame.width), blurbFont, sizePt, measurer)
    for (const runs of lines) {
      if (y + metrics.ascent > bottom) {
        overflowed = true
        break
      }
      let x = pt(frame.x)
      for (const run of runs) {
        const width = measurer.widthOf(run.text, run.font, sizePt)
        items.push({
          kind: 'text',
          text: run.text,
          font: run.font,
          sizePt,
          xPt: x,
          yPt: y + metrics.ascent,
          color: palette.ink,
          widthPt: width,
          ascentPt: metrics.ascent,
          descentPt: metrics.descent
        })
        x += width
      }
      y += sizePt * 1.4
      copyBottom = y - sizePt * (1.4 - 1)
    }
    if (overflowed) break
    y += sizePt * 0.7
  }
  if (overflowed) {
    warnings.push(
      `The back-cover copy is longer than the space it has at ${sizePt} pt and was cut. Shorten it, or set it smaller.`
    )
  }

  // The box is drawn round the copy that was *set*, not round the frame it was
  // set in: that frame runs down to the barcode, so a box on it would stand
  // three inches of empty board below the last line. Pushed after the type
  // because it is struck round it and never over it.
  if (look.blurbBorder !== 'none' && copyBottom > copyTop) {
    const pad = pt(BLURB_FRAME_PAD_IN)
    drawFrame(
      items,
      look.blurbBorder,
      pt(frame.x) - pad,
      copyTop - pad,
      pt(frame.width) + pad * 2,
      copyBottom - copyTop + pad * 2,
      palette.accent
    )
  }

  if (content.imprint.trim()) {
    const font = face(look.bodyFont, 'regular', measurer.hasSmallCaps(look.bodyFont))
    const m = measurer.metrics(font, IMPRINT_PT)
    items.push({
      kind: 'text',
      text: content.imprint,
      font,
      sizePt: IMPRINT_PT,
      // Aligned with the copy above it, not with the safe area. An imprint
      // sitting three quarters of an inch to the left of the only other text
      // on the panel reads as having come adrift from it.
      xPt: pt(frame.x),
      yPt: pt(geometry.backSafe.y + geometry.backSafe.height) - m.descent,
      color: palette.ink,
      widthPt: measurer.widthOf(content.imprint, font, IMPRINT_PT),
      ascentPt: m.ascent,
      descentPt: m.descent
    })
  }
}

export function laySpine(
  items: CoverItem[],
  warnings: string[],
  geometry: CoverGeometry,
  doc: CoverDocument,
  measurer: TextMeasurer
): void {
  const { look, content } = doc
  const safe = geometry.spineSafe

  // --- the press mark, at the foot ---------------------------------------
  //
  // Placed first because it takes space the text then has to work around, and
  // drawn even on a spine too thin for text: a device three-eighths of an inch
  // wide still reads as a publisher's mark where a line of type would not.
  let markTopIn: number | null = null
  const mark = look.pressMark
  const usableWidth = geometry.spineIn - SPINE_TEXT_CLEARANCE_IN * 2
  if (mark && usableWidth < MIN_MARK_WIDTH_IN) {
    // Reported rather than dropped, which is the rule everywhere else here.
    // Below about a fifth of an inch a device is a smudge with a shape it can
    // no longer show, and shrinking it to fit would print exactly that.
    // The page count it would take is worked from this book's own paper and
    // binding, by the same arithmetic the spine is: a fixed figure in the
    // sentence was right for one stock and wrong for the others.
    const neededIn = MIN_MARK_WIDTH_IN + SPINE_TEXT_CLEARANCE_IN * 2
    const empty = spineWidth(0, geometry.paper, geometry.binding)
    const pages = Math.ceil((neededIn - empty) / PAPER_CALIPER_IN[geometry.paper])
    const atPages = pages > 0 ? ` — about ${pages} pages on this paper` : ''
    warnings.push(
      `The spine is ${geometry.spineIn.toFixed(3)} in, too narrow to print the press's mark ` +
        `legibly, so it was left off. It needs ${neededIn.toFixed(3)} in of fold${atPages}.`
    )
  }
  if (mark && usableWidth >= MIN_MARK_WIDTH_IN) {
    // As much of the fold as it safely can, up to the ceiling. The share only
    // governs a *narrow* spine: on anything over about three-quarters of an
    // inch the 0.42 ceiling binds first, so raising it enlarges the mark on a
    // slim book and moves nothing on a fat one. It was 0.78, which printed a
    // 0.21 in mark on a 0.394 in spine — half the size of the same mark on
    // the thick books beside it, and the editor read that as the mark being
    // wrong rather than the fold being narrow. The clearance either side is
    // already taken off `usableWidth`, so what is left here is a hair of
    // margin against the fold wandering.
    const width = Math.min(usableWidth * 0.95, 0.42)
    const height = width * (mark.heightPx / mark.widthPx)
    // Never more than a fraction of the fold's length: a device that grows
    // with the book would dominate the spine of a thin one.
    const capped = Math.min(height, geometry.spine.height * 0.14)
    const finalWidth = capped < height ? capped * (mark.widthPx / mark.heightPx) : width
    const x = geometry.spine.x + (geometry.spine.width - finalWidth) / 2
    const y = geometry.spine.y + geometry.spine.height - SAFE_MARGIN_IN - capped
    items.push({
      kind: 'image',
      id: PRESS_MARK_ID,
      xPt: pt(x),
      yPt: pt(y),
      widthPt: pt(finalWidth),
      heightPt: pt(capped),
      srcX: 0,
      srcY: 0,
      srcWidth: mark.widthPx,
      srcHeight: mark.heightPx
    })
    markTopIn = y
  }

  if (!look.spineText) return
  if (!geometry.spineTextAllowed) {
    warnings.push(
      `At ${geometry.pageCount} pages the spine is too narrow for KDP to print text on it ` +
        `(they want ${MIN_PAGES_FOR_SPINE_TEXT} pages or more), so it was left blank.`
    )
    return
  }
  if (!safe || safe.width <= 0) {
    warnings.push('The spine is too narrow for text once clearance is allowed; it was left blank.')
    return
  }

  const font = face(look.titleFont, 'regular', measurer.hasSmallCaps(look.titleFont))
  // The spine's *width* is the type's height, so the size is bounded by it.
  // The fold's own bound, taken from the face rather than from a constant.
  //
  // It was `pt(safe.width) * 0.62`, and measured off a rendered sheet that is
  // two and a third times too careful: on the 0.356 in spine of *The Lost
  // Keys of Masonry* the ink came to 0.10 in across a fold with 0.231 in to
  // give, leaving 0.12 and 0.14 in of bare board either side of a line set at
  // 10.3 pt. `spineSafe` has already taken KDP's sixteenth of an inch off
  // each edge, so what is left is the type's to use.
  //
  // What bounds it is the height of the line's own box, which is what the
  // same metrics centre it by, so the two cannot disagree: at 10.3 pt the
  // box is 0.709 em = 0.101 in and the measured ink was 0.10 in. A share of
  // the fold is kept back (`SPINE_FOLD_MARGIN`) so a fold that wanders still
  // has white either side of the type rather than KDP's bare minimum.
  const boxPerEm = (() => {
    const at = measurer.metrics(font, 100)
    // Ascent *plus* descent, which is the box `itemBounds` gives a rotated run
    // and therefore the box the safe-area check measures. The first version of
    // this used `ascent - descent`, which is twice the offset from the fold's
    // centre line to the baseline and not a height at all — 0.709 em against
    // the true 1.305 for this face. It sized the two thin spines at nearly
    // twice what the fold allows and both covers failed their own check.
    //
    // The pixels said otherwise and were not wrong: the *ink* of this line is
    // about 0.71 em, because EB Garamond declares an ascent of 1.007 em to
    // leave room for accented capitals this line does not contain. But the
    // gate measures the declared box, and a gate is not something to argue out
    // of its warning to win a few points of type. Sizing by the ink would need
    // the measurer to report a per-string extent, which it does not; until it
    // does, the engine and the check agree.
    return (at.ascent + at.descent) / 100
  })()
  const maxByThickness =
    boxPerEm > 0 ? (pt(safe.width) * SPINE_FOLD_MARGIN) / boxPerEm : pt(safe.width) * 0.62
  // The spine is one line of type along a fold, so a title the editor stacked
  // for the board is flattened here. Left in, the newline reaches the writer as
  // a character to draw, which is a spine that prints wrong and says nothing.
  const line = [flattened(content.title), content.author].filter((s) => s.trim()).join(' · ')
  if (!line.trim()) return

  // The run of fold the text may occupy: down to the mark, if there is one,
  // with a gap so the two do not touch.
  const runTop = safe.y
  const runBottom = markTopIn === null ? safe.y + safe.height : markTopIn - 0.12
  const runLength = Math.max(0, runBottom - runTop)

  // The collection's own size where it has banked one, the shipped ceiling
  // otherwise. Either is still bounded by the fold's width and then cut down
  // to the run of fold available, because neither of those is a preference.
  const asked = look.spineSizePt ?? SPINE_MAX_PT
  let size = Math.min(asked, maxByThickness)
  const maxLengthPt = pt(runLength)
  while (size > 6 && measurer.widthOf(line, font, size) > maxLengthPt) size -= 0.5
  if (measurer.widthOf(line, font, size) > maxLengthPt) {
    warnings.push('The spine text is longer than the spine; it was left off.')
    return
  }
  // Said rather than left to be noticed on a shelf. A book too thin to carry
  // the collection's spine size is an ordinary fact about that book, and the
  // editor should learn it here and not from the printed copy.
  if (look.spineSizePt !== null && size < look.spineSizePt) {
    warnings.push(
      `The spine sets at ${size.toFixed(1)} pt rather than the collection's ` +
        `${look.spineSizePt.toFixed(1)} pt: ` +
        (size === Math.min(asked, maxByThickness)
          ? `a ${geometry.spineIn.toFixed(3)} in fold holds no more.`
          : 'the title and author are too long for the fold at that size.')
    )
  }

  const metrics = measurer.metrics(font, size)
  const textLength = measurer.widthOf(line, font, size)
  // Rotated −90°, the run starts at the top of the spine and reads downward.
  // x is the baseline's distance across the spine; centre the glyphs in it.
  const centreX = pt(geometry.spine.x + geometry.spine.width / 2)
  const startY = pt(runTop + runLength / 2) - textLength / 2

  items.push({
    kind: 'text',
    text: line,
    font,
    sizePt: size,
    xPt: centreX - (metrics.ascent - metrics.descent) / 2,
    yPt: startY,
    color: look.palette.ink,
    widthPt: textLength,
    ascentPt: metrics.ascent,
    descentPt: metrics.descent,
    rotate: -90
  })
}
