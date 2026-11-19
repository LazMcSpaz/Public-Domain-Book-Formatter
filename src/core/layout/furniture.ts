/**
 * Page furniture: the face a running head and a page number are set in, and
 * where a page number at the foot of the page sits.
 *
 * Two places for that page number. The old one hangs it a little under the
 * text block (`bottomFolioBaseline`), and every book set before the house
 * look keeps it. The house look's mirrors the running head: the number's
 * baseline sits exactly as far above the bottom edge as the head's capitals
 * start below the top edge, so the two frame the page evenly. That distance is
 * read off the face's own cap height, through the measurer, never guessed.
 *
 * Pure arithmetic, in points from the top of the page.
 */
import type { StyleProfile } from '@core/model'
import { bottomFolioBaseline, runningHeadBaseline, trimToPoints } from './frames'
import type { TextMeasurer } from './measure'
import { PT_PER_INCH, type FontRef } from './types'

/** Running heads and page numbers are set a little smaller than the text. */
export const FURNITURE_SIZE_RATIO = 0.85

/** KDP's no-print band: nothing is printed nearer the trim than 0.25 in. */
export const KDP_TRIM_SAFE_PT = 0.25 * PT_PER_INCH

/**
 * The face furniture is set in. Only the head takes `runningHeadStyle`: a page
 * number in small capitals is a page number in ordinary figures, since digits
 * have no lower case for `smcp` to map, and one in italic is a mannerism nobody
 * asked for. Real small capitals where the face has them, never faked.
 */
export function furnitureFont(
  profile: StyleProfile,
  measurer: TextMeasurer,
  head: boolean
): FontRef {
  const style = head ? profile.runningHeadStyle : 'plain'
  const realSmallCaps = style === 'smallCaps' && measurer.hasSmallCaps(profile.bodyFont)
  return {
    family: profile.bodyFont,
    style: style === 'italic' ? 'italic' : 'regular',
    ...(realSmallCaps ? { smallCaps: true } : {})
  }
}

/** How far below the top edge the running head's capitals start. */
export function headCapTop(profile: StyleProfile, measurer: TextMeasurer): number {
  const sizePt = profile.bodyFontSize * FURNITURE_SIZE_RATIO
  const metrics = measurer.metrics(furnitureFont(profile, measurer, true), sizePt)
  return runningHeadBaseline(profile) - (metrics.capHeight ?? metrics.ascent)
}

/**
 * Where a page number at the foot of the page has its baseline, from the top.
 *
 * Mirrored, it is never nearer the bottom edge than KDP's 0.25 in plus the
 * face's descent, so even a figure that hangs below the line stays printable.
 */
export function folioBaseline(profile: StyleProfile, measurer: TextMeasurer): number {
  if (!profile.folioMirrorsHead) return bottomFolioBaseline(profile)
  const trim = trimToPoints(profile.trimSize)
  const font = furnitureFont(profile, measurer, false)
  const descent = measurer.metrics(font, profile.bodyFontSize * FURNITURE_SIZE_RATIO).descent
  const fromFoot = Math.max(KDP_TRIM_SAFE_PT + descent, headCapTop(profile, measurer))
  return trim.heightPt - fromFoot
}
