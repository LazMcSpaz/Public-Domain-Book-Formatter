/**
 * The barcode drawn from the book's ISBN, laid on the back cover where KDP
 * expects it.
 *
 * Pure: items out.
 */
import type { TextMeasurer } from '@core/layout'
import { type CoverDocument } from './document'
import {
  BAR_HEIGHT_IN,
  GUARD_DROP_MODULES,
  MODULE_IN,
  QUIET_LEFT_MODULES,
  QUIET_RIGHT_MODULES,
  SYMBOL_MODULES,
  BARCODE_BARS,
  BARCODE_SPACE,
  encodeEan13,
  printedGroups
} from './barcode'
import { pt, type CoverGeometry } from './geometry'
import { BARCODE_ID } from './compose-constants'
import { type CoverItem } from './compose-items'
import { face } from './compose-text'

/**
 * The barcode, in the area KDP reserves for one.
 *
 * Drawn only when the printing has an ISBN. Without one the area stays clear
 * and KDP prints its own there, which is the black-on-white rectangle this
 * exists to replace.
 *
 * Two things are not design decisions and are treated as such. The symbol's
 * proportions are GS1's, so it is scaled to fit the area rather than fitted to
 * it: a barcode stretched to fill a box is a barcode that scans as a different
 * number or not at all. And the colours are KDP's, not the palette's: black
 * on a white patch, which is the one thing KDP's barcode check accepts —
 * see `barcode.ts` for the covers that learnt it.
 */
export function layBarcode(
  items: CoverItem[],
  warnings: string[],
  geometry: CoverGeometry,
  doc: CoverDocument,
  measurer: TextMeasurer
): void {
  const { look, content } = doc
  if (!content.isbn.trim()) return
  const encoded = encodeEan13(content.isbn, content.isbnAddOn)
  if (!encoded) {
    // Refused rather than drawn wrong: a symbol that scans to a number no book
    // has is a return, where no symbol at all is only KDP printing its own.
    warnings.push(
      `"${content.isbn}" is not a valid ISBN-13 (thirteen digits whose check digit agrees), ` +
        'so no barcode was drawn and KDP will print its own.'
    )
    return
  }

  const area = geometry.barcode
  const digitPt = 7
  // A five-digit add-on prints its digits *above* its bars, so the symbol
  // needs headroom that a bare EAN-13 does not. Without it they set above the
  // patch, on the board — which is how this was found, by cropping a render.
  const topPadIn = encoded.addOn ? digitPt / 72 + 0.03 : 0
  // Height: bars, then the line the digits sit on. Width: the symbol plus its
  // quiet zones, which are part of the symbol and not padding round it.
  const widthModules = QUIET_LEFT_MODULES + encoded.widthModules + QUIET_RIGHT_MODULES
  const nominalWidth = widthModules * MODULE_IN
  const nominalHeight = BAR_HEIGHT_IN + digitPt / 72 + topPadIn
  const scale = Math.min(area.width / nominalWidth, area.height / nominalHeight, 1)
  const moduleIn = MODULE_IN * scale
  const barHeightIn = BAR_HEIGHT_IN * scale
  const guardDropIn = GUARD_DROP_MODULES * moduleIn
  if (scale < 1) {
    // Reported because magnification below 80% is outside GS1's range and a
    // printer may refuse it; the symbol is still drawn, to its own proportions.
    warnings.push(
      `The barcode is set at ${(scale * 100).toFixed(0)}% of nominal size to fit the area KDP reserves.`
    )
  }

  const totalWidth = widthModules * moduleIn
  // The digits scale with the symbol. Left at a fixed size they overflow a
  // reduced patch, because the headroom reserved for them shrinks and they do
  // not — which is exactly how the add-on escaped the first time.
  const digitSize = digitPt * scale
  const topIn = encoded.addOn ? digitSize / 72 + 0.03 * scale : 0
  const totalHeight = topIn + barHeightIn + guardDropIn + digitSize / 72
  // Centred in the area, which keeps the quiet zones clear of whatever the
  // back cover does next to it.
  const originX = area.x + (area.width - totalWidth) / 2
  const originY = area.y + (area.height - totalHeight) / 2

  items.push({
    kind: 'fill',
    id: BARCODE_ID,
    xPt: pt(originX),
    yPt: pt(originY),
    widthPt: pt(totalWidth),
    heightPt: pt(totalHeight),
    color: BARCODE_SPACE
  })

  const barsLeft = originX + QUIET_LEFT_MODULES * moduleIn
  const barsTop = originY + topIn
  for (const bar of encoded.bars) {
    const isAddOn = bar.from >= SYMBOL_MODULES
    items.push({
      kind: 'fill',
      id: BARCODE_ID,
      xPt: pt(barsLeft + bar.from * moduleIn),
      yPt: pt(barsTop),
      widthPt: pt(bar.width * moduleIn),
      // An add-on's bars end level with the main symbol's; only the guards of
      // the main symbol run on past the digits.
      heightPt: pt(isAddOn ? barHeightIn : barHeightIn + (bar.guard ? guardDropIn : 0)),
      color: BARCODE_BARS
    })
  }

  // The digits, which are what a human reads when a scanner will not.
  const digitFont = face(look.bodyFont, 'regular')
  const groups = printedGroups(encoded.digits)
  const baseline = barsTop + barHeightIn + guardDropIn + digitSize / 72
  const put = (text: string, centreIn: number): void => {
    const width = measurer.widthOf(text, digitFont, digitSize)
    const metrics = measurer.metrics(digitFont, digitSize)
    items.push({
      kind: 'text',
      id: BARCODE_ID,
      text,
      font: digitFont,
      sizePt: digitSize,
      xPt: pt(centreIn) - width / 2,
      yPt: pt(baseline),
      color: BARCODE_BARS,
      widthPt: width,
      ascentPt: metrics.ascent,
      descentPt: metrics.descent
    })
  }
  // The lead digit sits out in the left quiet zone, which is where EAN-13
  // prints it; the two groups of six sit under their own halves.
  put(groups.lead, originX + (QUIET_LEFT_MODULES - 4) * moduleIn)
  put(groups.left, barsLeft + 24.5 * moduleIn)
  put(groups.right, barsLeft + 71.5 * moduleIn)
  if (encoded.addOn) {
    const addOnCentre = barsLeft + (SYMBOL_MODULES + 9 + 23) * moduleIn
    const width = measurer.widthOf(encoded.addOn, digitFont, digitSize)
    const metrics = measurer.metrics(digitFont, digitSize)
    items.push({
      kind: 'text',
      id: BARCODE_ID,
      text: encoded.addOn,
      font: digitFont,
      sizePt: digitSize,
      xPt: pt(addOnCentre) - width / 2,
      // Above its own bars and inside the patch, where EAN-13 prints it.
      yPt: pt(originY + topIn - 0.03 * scale),
      color: BARCODE_BARS,
      widthPt: width,
      ascentPt: metrics.ascent,
      descentPt: metrics.descent
    })
  }
}
