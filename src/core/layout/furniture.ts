/**
 * Page furniture: the face a running head and a page number are set in, and
 * where a page number at the foot of the page sits.
 *
 * Three places for that page number. The old one hangs it a little under the
 * text block (`bottomFolioBaseline`), and every book set before the house
 * look keeps it. A mirrored one (`folioMirrorsHead`) sits the number's
 * baseline exactly as far above the bottom edge as the head's capitals start
 * below the top edge, so the two frame the page evenly; that distance is read
 * off the face's own cap height, through the measurer, never guessed. A set
 * one (`folioFromFootPt`) puts the baseline a given distance above the bottom
 * edge, wherever the head is, and wins over mirroring: the house look sets
 * one, so its page number stays put when its head is lowered.
 *
 * Pure arithmetic, in points from the top of the page.
 */
import type { StyleProfile } from '@core/model'
import {
  RUNNING_HEAD_RISE,
  RUNNING_HEAD_RISE_LEAST,
  RUNNING_HEAD_RISE_MOST,
  bottomFolioBaseline,
  isHeadRise,
  runningHeadBaseline,
  trimToPoints
} from './frames'
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

/** How a page number at the foot is placed: hung under the text, mirroring the head, or set. */
export type FolioRule = 'underText' | 'mirrorsHead' | 'fromFoot'

/** Where a page number at the foot of the page has its baseline, and by which rule. */
export interface FolioPlace {
  /** The baseline, in points from the top of the page. */
  baseline: number
  rule: FolioRule
  /** False when the place asked for would rise toward the text, so the old place is kept. */
  honoured: boolean
}

/** The distance above the bottom edge a profile sets for its page number, in points; null for none. */
export function folioFromFoot(profile: StyleProfile): number | null {
  const pt: unknown = profile.folioFromFootPt
  return typeof pt === 'number' && Number.isFinite(pt) && pt > 0 ? pt : null
}

/**
 * Where a page number at the foot of the page has its baseline, from the top.
 *
 * Mirrored or set, it is never nearer the bottom edge than KDP's 0.25 in plus
 * the face's descent, so even a figure that hangs below the line stays
 * printable. Nor is it ever higher than the old place: a book with a deep top
 * margin and a shallow bottom one, or a distance set too large, would
 * otherwise print its page number into the last line of text. Then the old
 * place is kept, and `honoured` says so.
 */
export function folioPlace(profile: StyleProfile, measurer: TextMeasurer): FolioPlace {
  const old = bottomFolioBaseline(profile)
  const set = folioFromFoot(profile)
  const rule: FolioRule =
    set !== null ? 'fromFoot' : profile.folioMirrorsHead ? 'mirrorsHead' : 'underText'
  if (rule === 'underText') return { baseline: old, rule, honoured: true }
  const trim = trimToPoints(profile.trimSize)
  const font = furnitureFont(profile, measurer, false)
  const descent = measurer.metrics(font, profile.bodyFontSize * FURNITURE_SIZE_RATIO).descent
  const fromFoot = Math.max(KDP_TRIM_SAFE_PT + descent, set ?? headCapTop(profile, measurer))
  const baseline = trim.heightPt - fromFoot
  return baseline < old
    ? { baseline: old, rule, honoured: false }
    : { baseline, rule, honoured: true }
}

/** The warning a book gets when its page number cannot be mirrored. */
export const FOLIO_NOT_MIRRORED =
  'the page number cannot sit as far from the foot as the running head sits from the top ' +
  '(KDP keeps it a quarter inch from the edge, and it never rises toward the text), so it ' +
  'keeps its old place; change the top or bottom margin'

/** The warning a book gets when its page number cannot sit where its look sets it. */
export const FOLIO_NOT_PLACED =
  'the page number cannot sit as far from the foot as the look sets it (KDP keeps it a ' +
  'quarter inch from the edge, and it never rises toward the text), so it keeps its old ' +
  'place; change the bottom margin or the page number’s distance from the foot'

/** The warning a book gets when its look sets a running head rise out of range. */
export function headRiseRefused(rise: unknown): string {
  return (
    `the running head is set ${RUNNING_HEAD_RISE} body sizes above the text, not the ` +
    `${String(rise)} the look asks for: only ${RUNNING_HEAD_RISE_LEAST} to ` +
    `${RUNNING_HEAD_RISE_MOST} are allowed, so the head never comes nearer the trim than ` +
    'its standard place'
  )
}

/**
 * What the furniture could not do as the look asked, said once for the book:
 * a running head rise out of range, and a page number at the foot that keeps
 * its old place.
 */
export function furnitureWarnings(profile: StyleProfile, measurer: TextMeasurer): string[] {
  const warnings: string[] = []
  // Absent from a profile made before the setting: that is the standard rise, not a refusal.
  const rise: unknown = profile.runningHeadRise
  if (rise !== undefined && !isHeadRise(rise)) warnings.push(headRiseRefused(rise))
  const atFoot = profile.pageNumber === 'bottomCenter' || profile.pageNumber === 'bottomOuter'
  const place = atFoot ? folioPlace(profile, measurer) : null
  if (place && !place.honoured) {
    warnings.push(place.rule === 'mirrorsHead' ? FOLIO_NOT_MIRRORED : FOLIO_NOT_PLACED)
  }
  return warnings
}

/** Where a page number at the foot of the page has its baseline, from the top. */
export function folioBaseline(profile: StyleProfile, measurer: TextMeasurer): number {
  return folioPlace(profile, measurer).baseline
}
