/**
 * Page geometry: trim, margins, gutter → the rectangle text sits in.
 *
 * The one non-obvious rule is mirroring. A book is printed two-sided, so the
 * *inner* margin is against the spine on both pages — which means it is on the
 * right of a verso (left-hand) page and on the left of a recto. The binding
 * offset is added to whichever side that is. Equal margins print visibly
 * off-centre once the book is bound, which is why the profile carries inner and
 * outer rather than left and right.
 *
 * Pure arithmetic, in points.
 */
import type { StyleProfile } from '@core/model'
import { PT_PER_INCH, type PageFrame, type PageSide } from './types'

/** Trim dimensions in points. */
export interface TrimPt {
  widthPt: number
  heightPt: number
}

/**
 * Parse a trim token like "6x9" or "5.5×8.5" into points.
 *
 * Deliberately duplicated from the LaTeX document builder's parser rather than
 * imported: that module is on its way out (see docs/PLAN-layout-preview.md),
 * and the layout engine should not acquire a dependency on something scheduled
 * for deletion. Falls back to 6×9in, KDP's most common size, on anything
 * unparseable — a wrong-but-printable page beats a crash at the design gate.
 */
export function trimToPoints(token: string): TrimPt {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*$/i.exec(token)
  const w = m ? Number(m[1]) : NaN
  const h = m ? Number(m[2]) : NaN
  const ok = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
  return {
    widthPt: (ok ? w : 6) * PT_PER_INCH,
    heightPt: (ok ? h : 9) * PT_PER_INCH
  }
}

/**
 * The text block for one side of the spread.
 *
 * The gutter is added to the inner margin rather than shifting the whole block,
 * which is what `bindingoffset` did in the LaTeX path and what KDP's guidance
 * describes: the binding eats part of the inner edge, so give it more to eat.
 */
export function frameFor(profile: StyleProfile, side: PageSide): PageFrame {
  const trim = trimToPoints(profile.trimSize)
  const m = profile.margins
  const inner = (m.inner + profile.gutter) * PT_PER_INCH
  const outer = m.outer * PT_PER_INCH
  const top = m.top * PT_PER_INCH
  const bottom = m.bottom * PT_PER_INCH

  return {
    xPt: side === 'recto' ? inner : outer,
    yPt: top,
    widthPt: Math.max(1, trim.widthPt - inner - outer),
    heightPt: Math.max(1, trim.heightPt - top - bottom)
  }
}

/**
 * Baseline-to-baseline distance for body text.
 *
 * 1.32× the point size is a book-typography convention rather than a
 * calculation: it is the leading that reads comfortably at 10–12pt on a 4–5in
 * measure, which is every trim this app offers. Fonts' own `lineGap` is
 * routinely zero (EB Garamond's is), so deriving leading from it would set the
 * book solid.
 */
export const LEADING_RATIO = 1.32

export function leadingFor(sizePt: number): number {
  return sizePt * LEADING_RATIO
}

/**
 * How many baselines fit in a frame.
 *
 * The first baseline sits one ascent below the top of the frame, not one full
 * leading, so the text block starts where the margin says it does rather than a
 * few points lower.
 */
export function linesPerFrame(frame: PageFrame, leadingPt: number, ascentPt: number): number {
  if (leadingPt <= 0) return 0
  return Math.max(0, Math.floor((frame.heightPt - ascentPt) / leadingPt) + 1)
}

/** Where the running head's baseline sits — above the text block, in the margin. */
export function runningHeadBaseline(profile: StyleProfile): number {
  return Math.max(12, profile.margins.top * PT_PER_INCH - profile.bodyFontSize * 1.2)
}

/** Where a bottom folio's baseline sits — below the text block, in the margin. */
export function bottomFolioBaseline(profile: StyleProfile): number {
  const trim = trimToPoints(profile.trimSize)
  const bottomMargin = profile.margins.bottom * PT_PER_INCH
  return trim.heightPt - bottomMargin + profile.bodyFontSize * 1.6
}
