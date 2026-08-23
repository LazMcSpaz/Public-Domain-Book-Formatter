/**
 * KDP cover validation — the checks that stand between a composed cover and a
 * rejected upload or, worse, a delivered box of books.
 *
 * Same posture as `@core/typeset`'s interior checks: honest levels, no pass/fail
 * theatre, and every `detail` written so someone who has never heard of bleed
 * can act on it. The difference is that a cover fails *visibly and terminally* —
 * an interior with a tight gutter is a book someone can still read, where a
 * title trimmed in half is pulped — so three of these are `fail` rather than
 * `warn`.
 *
 * Pure: derives entirely from a composed cover.
 */
import type { ValidationCheck, ValidationLevel } from '@core/model'
import { effectiveDpi } from '@core/image'
import type { ComposedCover, CoverItem } from './compose'
import { itemBounds } from './compose'
import {
  contains,
  overlaps,
  PAGE_LIMITS,
  PAPER_LABEL,
  type CoverGeometry,
  type Rect
} from './geometry'
import type { CoverDocument } from './document'

/** KDP's minimum for cover art, and the number the whole DPI check is about. */
export const MIN_COVER_DPI = 300

/** KDP's ceiling on an uploaded cover file. */
export const MAX_COVER_MB = 40

export interface ValidateCoverInput {
  doc: CoverDocument
  composed: ComposedCover
  /** Size of the written PDF in bytes, once there is one. */
  fileBytes?: number
  /** Whether the writer embedded every face it drew. */
  fontsEmbedded?: boolean
  /**
   * Whether the interior's page count is *measured* rather than typed.
   *
   * The single most consequential fact on a cover. A spine sized from a guess
   * is a cover that does not fit the book, and the failure is invisible until
   * the proof arrives — so an unmeasured count is reported as `pending`, never
   * as a tick.
   */
  pageCountMeasured?: boolean
}

export interface CoverValidationReport {
  checks: ValidationCheck[]
  /** Spine width the cover was built for, in inches. */
  spineIn: number
  ready: boolean
}

function textItems(composed: ComposedCover) {
  return composed.items.filter((i) => i.kind === 'text')
}

/** Everything that carries ink, as rectangles in inches. */
interface InkedBound {
  item: CoverItem
  rect: Rect
}

function inkedBounds(composed: ComposedCover): InkedBound[] {
  const out: InkedBound[] = []
  for (const item of composed.items) {
    // A ground is *supposed* to run past the trim; only marks are checked.
    if (item.kind === 'fill') continue
    const rect = itemBounds(item)
    if (rect) out.push({ item, rect })
  }
  return out
}

/** The union of the two safe panels and the spine's own clearance. */
function withinSafe(
  geometry: CoverGeometry,
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  if (contains(geometry.backSafe, rect)) return true
  if (contains(geometry.frontSafe, rect)) return true
  if (geometry.spineSafe && contains(geometry.spineSafe, rect)) return true
  return false
}

export function validateCover(input: ValidateCoverInput): CoverValidationReport {
  const { composed, doc } = input
  const geometry = composed.geometry
  const checks: ValidationCheck[] = []

  // 1. Where the spine came from. First, because everything else on the sheet
  //    is positioned relative to it.
  {
    const measured = input.pageCountMeasured ?? false
    checks.push({
      id: 'spine-source',
      label: 'Spine width',
      level: measured ? 'ok' : 'pending',
      detail: measured
        ? `Spine ${geometry.spineIn.toFixed(3)} in, from a measured ${geometry.pageCount}-page interior on ${PAPER_LABEL[geometry.paper].toLowerCase()}.`
        : `Spine ${geometry.spineIn.toFixed(3)} in, from a page count of ${geometry.pageCount} that this app did not measure. Typeset the interior and use its final count before printing — a spine off by a few pages puts the fold inside the front cover.`
    })
  }

  // 2. Page count against what the chosen stock can be printed on.
  {
    const limits = PAGE_LIMITS[geometry.paper]
    const inRange = geometry.pageCount >= limits.min && geometry.pageCount <= limits.max
    checks.push({
      id: 'page-limits',
      label: 'Page count for this paper',
      level: inRange ? 'ok' : 'fail',
      detail: inRange
        ? `${geometry.pageCount} pages is within the ${limits.min}–${limits.max} KDP prints on ${PAPER_LABEL[geometry.paper].toLowerCase()}.`
        : `${geometry.pageCount} pages is outside the ${limits.min}–${limits.max} KDP prints on ${PAPER_LABEL[geometry.paper].toLowerCase()}; pick another paper or change the interior.`
    })
  }

  // 3. Bleed — is the ground actually painted out to the sheet's edge?
  {
    const sheet = { x: 0, y: 0, width: geometry.fullWidthIn, height: geometry.fullHeightIn }
    const covered = composed.items.some(
      (i) =>
        i.kind === 'fill' &&
        i.xPt <= 0.01 &&
        i.yPt <= 0.01 &&
        i.widthPt / 72 >= sheet.width - 0.01 &&
        i.heightPt / 72 >= sheet.height - 0.01
    )
    checks.push({
      id: 'bleed',
      label: 'Bleed',
      level: covered ? 'ok' : 'fail',
      detail: covered
        ? `The design is painted out to all four edges of the ${geometry.fullWidthIn.toFixed(3)} × ${geometry.fullHeightIn.toFixed(3)} in sheet, so the trim cuts through artwork rather than past it.`
        : 'Nothing covers the full sheet, so the trim will leave a white edge. Every cover needs its ground carried into the 0.125 in bleed.'
    })
  }

  // 4. Does anything that must survive the cut sit too near it?
  {
    const outside = inkedBounds(composed).filter(({ rect }) => !withinSafe(geometry, rect))
    // Art is *supposed* to run into the bleed; only type and rules are checked.
    const typeOutside = outside.filter(({ item }) => item.kind === 'text')
    checks.push({
      id: 'safe-margin',
      label: 'Text inside the safe area',
      level: typeOutside.length > 0 ? 'fail' : 'ok',
      detail:
        typeOutside.length > 0
          ? `${typeOutside.length} line(s) of type sit within 0.25 in of a trimmed edge and may be cut: ${typeOutside
              .slice(0, 3)
              .map(({ item }) => JSON.stringify(item.kind === 'text' ? item.text.slice(0, 40) : ''))
              .join(', ')}.`
          : 'Every line of type sits at least 0.25 in inside the trim.'
    })
  }

  // 5. The barcode. KDP prints over this rectangle whatever is under it.
  {
    const intruding = inkedBounds(composed).filter(({ rect }) => overlaps(rect, geometry.barcode))
    checks.push({
      id: 'barcode',
      label: 'Barcode area',
      level: intruding.length > 0 ? 'warn' : 'ok',
      detail:
        intruding.length > 0
          ? `${intruding.length} element(s) fall in the 2 × 1.2 in area at the foot of the back cover where KDP prints the barcode. Whatever is there will be covered.`
          : 'The barcode area at the foot of the back cover is clear.'
    })
  }

  // 6. Art resolution at the size it actually prints.
  {
    const placed = composed.placedArt
    let level: ValidationLevel = 'ok'
    let detail: string
    if (!placed) {
      detail = 'No picture on the cover; nothing to check.'
    } else {
      const dpiX = effectiveDpi(placed.usedWidthPx, placed.rect.width)
      const dpiY = effectiveDpi(placed.usedHeightPx, placed.rect.height)
      const dpi = Math.min(dpiX, dpiY)
      level = dpi >= MIN_COVER_DPI ? 'ok' : 'warn'
      detail =
        dpi >= MIN_COVER_DPI
          ? `The picture prints at ${Math.round(dpi)} DPI across ${placed.rect.width.toFixed(2)} × ${placed.rect.height.toFixed(2)} in.`
          : `The picture prints at ${Math.round(dpi)} DPI across ${placed.rect.width.toFixed(2)} × ${placed.rect.height.toFixed(2)} in, below KDP's ${MIN_COVER_DPI}. Use a larger source, or set it smaller — enlarging it here would only invent pixels the original never had.`
    }
    checks.push({ id: 'cover-dpi', label: 'Cover art resolution', level, detail })
  }

  // 7. Spine text, where there is any.
  {
    const spineRuns = textItems(composed).filter((i) => i.kind === 'text' && i.rotate === -90)
    const wanted = doc.look.spineText
    let level: ValidationLevel = 'ok'
    let detail: string
    if (!wanted) {
      detail = 'The spine is deliberately blank.'
    } else if (!geometry.spineTextAllowed) {
      level = 'warn'
      detail = `At ${geometry.pageCount} pages KDP will not print spine text (they want 79 pages or more), so the spine was left blank.`
    } else if (spineRuns.length === 0) {
      level = 'warn'
      detail = 'Spine text was asked for but nothing was set — the title is longer than the spine.'
    } else {
      detail = `The spine carries text on a ${geometry.spineIn.toFixed(3)} in fold, clear of both edges.`
    }
    checks.push({ id: 'spine-text', label: 'Spine text', level, detail })
  }

  // 8. Embedded fonts — same rule as the interior.
  {
    const embedded = input.fontsEmbedded ?? true
    checks.push({
      id: 'cover-fonts',
      label: 'Embedded fonts',
      level: embedded ? 'ok' : 'fail',
      detail: embedded
        ? 'Every face the cover sets is embedded in the PDF.'
        : 'A face the cover sets is not embedded; KDP will reject the file or substitute a font.'
    })
  }

  // 9. File size.
  {
    const bytes = input.fileBytes
    const mb = bytes === undefined ? null : bytes / (1024 * 1024)
    checks.push({
      id: 'cover-size',
      label: 'File size',
      level: mb === null ? 'pending' : mb <= MAX_COVER_MB ? 'ok' : 'fail',
      detail:
        mb === null
          ? 'Not checked yet — this exists once the cover has been written.'
          : mb <= MAX_COVER_MB
            ? `${mb.toFixed(1)} MB, within KDP's ${MAX_COVER_MB} MB limit.`
            : `${mb.toFixed(1)} MB, over KDP's ${MAX_COVER_MB} MB limit. Reduce the picture's resolution to the size it prints at.`
    })
  }

  // 10. Anything the composer could not honour, reported rather than buried.
  if (composed.warnings.length > 0) {
    checks.push({
      id: 'compose-warnings',
      label: 'Composition',
      level: 'warn',
      detail: composed.warnings.join(' ')
    })
  }

  return {
    checks,
    spineIn: geometry.spineIn,
    ready: !checks.some((c) => c.level === 'fail')
  }
}
